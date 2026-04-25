/**
 * Indexer subcommand: validate validator rule citations against the live
 * Razorpay manifest, and emit a JSON snapshot for inspection / CI artifacts.
 *
 * This is the CI gate referenced in plan.md §10.6 — if any rule cites a route
 * that the manifest doesn't have, the build fails. Catches rot in the §9
 * catalog when Razorpay reorganizes their docs upstream.
 *
 * Detector implementations stay in code (regex with flags, heuristic
 * functions); rules.json is metadata-only — id, title, severity, concern,
 * languages, citation, fix, and the detector kind. Useful for docs auto-gen
 * (docs/RULES.md) and CI artifact comparison across builds.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findUnresolvedCitations, manifestCitationResolver } from "../validator/cite.js";
import { ALL_RULES } from "../validator/rules/index.js";
import type { Rule } from "../validator/types.js";
import { loadManifest } from "../util/manifest.js";

interface BuildRulesOptions {
  readonly repoRoot: string;
  readonly outPath?: string;
}

interface BuildRulesResult {
  readonly outPath: string;
  readonly rulesEmitted: number;
  readonly unresolved: ReturnType<typeof findUnresolvedCitations>;
}

interface SerializedRule {
  readonly id: string;
  readonly title: string;
  readonly severity: string;
  readonly concern: string;
  readonly languages: readonly string[];
  readonly detector: { readonly kind: string; readonly pattern?: string; readonly flags?: string };
  readonly citation: { readonly route: string; readonly section?: string; readonly excerpt: string };
  readonly fix: { readonly explanation: string; readonly correctPattern: string };
}

function serialize(rule: Rule): SerializedRule {
  const det = rule.detector;
  const detector =
    det.kind === "regex"
      ? { kind: "regex", pattern: det.pattern.source, flags: det.pattern.flags }
      : det.kind === "ast"
        ? { kind: "ast" }
        : { kind: "heuristic" };
  return {
    id: rule.id,
    title: rule.title,
    severity: rule.severity,
    concern: rule.concern,
    languages: [...rule.languages],
    detector,
    citation: {
      route: rule.citation.route,
      ...(rule.citation.section !== undefined && { section: rule.citation.section }),
      excerpt: rule.citation.excerpt,
    },
    fix: {
      explanation: rule.fix.explanation,
      correctPattern: rule.fix.correctPattern,
    },
  };
}

export class CitationGateFailure extends Error {
  public override readonly name = "CitationGateFailure";
  public constructor(
    message: string,
    public readonly unresolved: readonly { ruleId: string; citation: { route: string } }[],
  ) {
    super(message);
  }
}

export function buildRulesIndex(options: BuildRulesOptions): BuildRulesResult {
  const sourceDir = resolve(options.repoRoot, "source");
  const manifest = loadManifest(sourceDir);
  const resolver = manifestCitationResolver(manifest);

  const unresolved = findUnresolvedCitations(ALL_RULES, resolver);
  if (unresolved.length > 0) {
    const summary = unresolved
      .map((u) => `  ${u.ruleId} -> ${u.citation.route}`)
      .join("\n");
    throw new CitationGateFailure(
      `${unresolved.length} rule citation(s) do not resolve:\n${summary}`,
      unresolved,
    );
  }

  const outPath = options.outPath ?? resolve(options.repoRoot, "dist", "index", "rules.json");
  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    version: "1.0",
    generated: new Date().toISOString(),
    total: ALL_RULES.length,
    rules: ALL_RULES.map(serialize),
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  return { outPath, rulesEmitted: ALL_RULES.length, unresolved };
}
