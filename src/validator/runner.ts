/**
 * ValidationRunner — executes a registered set of `Rule`s against a code
 * snippet and produces a `ValidationReport`.
 *
 * Per CLAUDE.md §10.3 each rule:
 *   - runs with a 50 ms wall-clock timeout (regex catastrophic-backtracking
 *     defense)
 *   - failures are caught + logged, never propagated
 *   - duplicate hits (same ruleId + same line) are deduped
 *
 * The runner is pure: takes code in, returns a report. No retrieval, no
 * indexer, no I/O beyond the citation resolver lookup (which is in-memory).
 */

import { Lang } from "../util/lang.js";
import { log } from "../util/log.js";
import { detectLanguage, maskComments, splitLines } from "./parse.js";
import {
  CitationUnresolvedError,
  Severity,
  type CitationResolver,
  type Concern,
  type DetectorContext,
  type DetectorHit,
  type Issue,
  type Rule,
  type RuleId,
  type ValidationReport,
} from "./types.js";

const PER_RULE_TIMEOUT_MS = 50;
const MAX_SNIPPET_LEN = 240;

export interface ValidateInput {
  readonly code: string;
  readonly languageHint?: string;
  readonly concern?: Concern;
  readonly excludePath?: string;
}

/**
 * Run a single regex/heuristic detector synchronously, but with a soft
 * wall-clock budget. Regex backtracking can blow past the budget — we can
 * only check after the fact, so a misbehaving rule still runs to completion
 * once; we just refuse to ship its output and log a warning. (Hard timeouts
 * would require workers; cost > benefit for v1.)
 */
function runDetector(rule: Rule, ctx: DetectorContext): readonly DetectorHit[] {
  const t0 = Date.now();
  let hits: readonly DetectorHit[] = [];
  try {
    if (rule.detector.kind === "regex") {
      hits = collectRegexHits(rule.detector.pattern, ctx.stripped);
    } else if (rule.detector.kind === "heuristic") {
      hits = rule.detector.fn(ctx);
    } else {
      // ast detector — reserved for future tree-sitter backend
      hits = [];
    }
  } catch (err) {
    log.warn("rule failed", rule.id, err instanceof Error ? err.message : String(err));
    return [];
  }
  const elapsed = Date.now() - t0;
  if (elapsed > PER_RULE_TIMEOUT_MS) {
    log.warn("rule exceeded timeout", rule.id, `${elapsed}ms`);
    return [];
  }
  return hits;
}

function collectRegexHits(pattern: RegExp, code: string): readonly DetectorHit[] {
  const hits: DetectorHit[] = [];
  const re = pattern.global
    ? new RegExp(pattern.source, pattern.flags)
    : new RegExp(pattern.source, `${pattern.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    hits.push({
      line: lineFromOffset(code, m.index),
      column: columnFromOffset(code, m.index),
      snippet: m[0].slice(0, MAX_SNIPPET_LEN),
    });
    if (m.index === re.lastIndex) re.lastIndex += 1; // zero-width safety
  }
  return hits;
}

function lineFromOffset(code: string, offset: number): number {
  let line = 1;
  for (let j = 0; j < offset && j < code.length; j += 1) {
    if (code[j] === "\n") line += 1;
  }
  return line;
}

function columnFromOffset(code: string, offset: number): number {
  let lineStart = 0;
  for (let j = 0; j < offset && j < code.length; j += 1) {
    if (code[j] === "\n") lineStart = j + 1;
  }
  return offset - lineStart + 1;
}

export class ValidationRunner {
  private readonly rules: Rule[] = [];
  private readonly resolver: CitationResolver;

  public constructor(resolver: CitationResolver) {
    this.resolver = resolver;
  }

  public register(rule: Rule): void {
    if (this.rules.some((r) => r.id === rule.id)) {
      throw new Error(`duplicate rule id: ${rule.id}`);
    }
    if (this.resolver.resolve(rule.citation.route, rule.citation.section) === undefined) {
      throw new CitationUnresolvedError(
        `rule ${rule.id} cites unknown route '${rule.citation.route}'`,
        rule.citation.route,
      );
    }
    this.rules.push(rule);
  }

  public registerAll(rules: readonly Rule[]): void {
    for (const r of rules) this.register(r);
  }

  public count(): number {
    return this.rules.length;
  }

  public listRules(): readonly Rule[] {
    return this.rules;
  }

  public validate(input: ValidateInput): ValidationReport {
    const lang = detectLanguage(input.code, input.languageHint);
    const stripped = lang === Lang.Unknown ? input.code : maskComments(input.code, lang);
    const ctx: DetectorContext = {
      code: input.code,
      lang,
      lines: splitLines(input.code),
      stripped,
    };

    const concernFilter = input.concern;
    const enabled = this.rules.filter((r) => {
      if (concernFilter !== undefined && concernFilter !== "all" && r.concern !== concernFilter) {
        return false;
      }
      if (!ruleAppliesToLang(r, lang)) return false;
      if (input.excludePath !== undefined && rulePathExcluded(r, input.excludePath)) return false;
      return true;
    });

    const issues: Issue[] = [];
    const seen = new Set<string>();

    for (const rule of enabled) {
      const hits = runDetector(rule, ctx);
      for (const hit of hits) {
        const key = `${rule.id}@${hit.line ?? -1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const citation = this.resolver.resolve(rule.citation.route, rule.citation.section);
        if (citation === undefined) {
          // Defensive — register() already verified, but resolver could be
          // racing in some setups. Skip rather than crash the report.
          continue;
        }
        const enriched: ResolvedCitationWithExcerpt = {
          ...citation,
          excerpt: rule.citation.excerpt,
        };
        issues.push({
          ruleId: rule.id,
          severity: rule.severity,
          title: rule.title,
          ...(hit.line !== undefined && { line: hit.line }),
          ...(hit.column !== undefined && { column: hit.column }),
          snippet: hit.snippet,
          explanation: rule.fix.explanation,
          fixSuggestion: rule.fix.correctPattern,
          citation: enriched,
        });
      }
    }

    issues.sort((a, b) => {
      const sev = severityOrder(a.severity) - severityOrder(b.severity);
      if (sev !== 0) return sev;
      const lineA = a.line ?? Number.MAX_SAFE_INTEGER;
      const lineB = b.line ?? Number.MAX_SAFE_INTEGER;
      if (lineA !== lineB) return lineA - lineB;
      return a.ruleId.localeCompare(b.ruleId);
    });

    const bySeverity: Record<Severity, number> = {
      [Severity.Error]: 0,
      [Severity.Warning]: 0,
      [Severity.Info]: 0,
    };
    for (const i of issues) bySeverity[i.severity] += 1;

    return {
      issues,
      summary: {
        total: issues.length,
        bySeverity,
        rulesEvaluated: enabled.length,
        languageDetected: lang,
      },
    };
  }
}

interface ResolvedCitationWithExcerpt {
  readonly route: string;
  readonly section?: string;
  readonly url: string;
  readonly excerpt: string;
}

function ruleAppliesToLang(rule: Rule, lang: Lang): boolean {
  if (rule.languages.includes("*")) return true;
  if (lang === Lang.Unknown) return false;
  return rule.languages.includes(lang);
}

function rulePathExcluded(rule: Rule, path: string): boolean {
  if (rule.excludes === undefined) return false;
  return rule.excludes.some((p) => path.includes(p));
}

function severityOrder(s: Severity): number {
  if (s === Severity.Error) return 0;
  if (s === Severity.Warning) return 1;
  return 2;
}

/** Re-export so consumers don't have to know about both modules. */
export type { Rule, Issue, ValidationReport, RuleId };
