/**
 * Synonym dictionary loader + query expander.
 *
 * Razorpay queries are identifier-heavy ("paise", "razorpay-x", "subscription").
 * Phase 1's eval set already shows BM25 wins on most of these directly. The
 * synonyms here cover the long tail of natural-language phrasings ("send money
 * back to a customer" → refund) where pure keyword search misses.
 */

import { readFileSync } from "node:fs";
import { z } from "zod";
// Static JSON import — bundler (tsup) inlines this so the path resolves the
// same in dev (tsx) and prod (bundled). Avoids "ENOENT data/synonyms.json"
// at runtime in the compiled server.
import synonymsData from "../data/synonyms.json" with { type: "json" };

const SynonymsFileSchema = z.object({
  version: z.number().int().positive(),
  groups: z.array(z.array(z.string().min(1)).min(2)),
});

export interface SynonymTable {
  readonly version: number;
  readonly groups: readonly (readonly string[])[];
  /** lowercase term → group index */
  readonly index: ReadonlyMap<string, number>;
}

function buildTable(parsed: { version: number; groups: readonly (readonly string[])[] }): SynonymTable {
  const index = new Map<string, number>();
  parsed.groups.forEach((group, i) => {
    for (const term of group) {
      index.set(term.toLowerCase(), i);
    }
  });
  return { version: parsed.version, groups: parsed.groups, index };
}

export function loadSynonyms(path?: string): SynonymTable {
  if (path !== undefined) {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    return buildTable(SynonymsFileSchema.parse(raw));
  }
  return buildTable(SynonymsFileSchema.parse(synonymsData));
}

const STOPWORDS = new Set([
  // articles, conjunctions, copulas
  "the", "a", "an", "of", "and", "or", "is", "are", "was", "were", "be", "been",
  // pronouns
  "i", "we", "my", "our", "you", "your", "they", "their", "this", "that", "it", "its",
  // wh-words
  "how", "what", "where", "when", "why", "who",
  // do/have/can family
  "do", "does", "did", "have", "has", "had", "can", "should", "would", "could",
  // prepositions / fillers (high-frequency, low-signal — match too many docs and
  // distort BM25 scoring toward filler-heavy pages)
  "to", "in", "on", "for", "with", "via", "using", "by", "through", "from", "into",
  "as", "at", "about", "across", "between", "over", "after", "before", "up", "down",
  // verbs that don't discriminate Razorpay docs
  "want", "need", "make", "get", "try", "use",
  // common modifiers
  "any", "some", "all", "no", "not", "only", "just", "also", "now", "here", "there",
  "please", "show", "me", "us", "tell",
  // corpus name — every doc is *about* Razorpay, so the term itself adds zero
  // discriminative signal and (worse) requires every chunk to literally contain
  // "razorpay" under strict-AND BM25. Drop it from the query.
  "razorpay",
]);

/**
 * Tokenize a query: lowercase, keep alphanumerics + hyphens, drop short tokens
 * and stopwords. Returns deduped order-preserving tokens.
 */
export function tokenizeQuery(raw: string): string[] {
  const lower = raw.toLowerCase();
  const tokens = lower.match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

export interface ExpansionOptions {
  /**
   * Whether to OR-group known synonyms in the FTS5 string. Off by default —
   * synonym OR-groups improve recall but degrade BM25 precision (a synonym
   * with high doc-frequency will outrank the actual term). Vector retrieval
   * is the better mechanism for semantic synonyms; turn this on only for
   * BM25-only queries that genuinely need the recall boost.
   */
  readonly expandSynonyms?: boolean;
}

export interface ExpansionResult {
  /** FTS5-ready query string (terms quoted, hyphens preserved). */
  readonly fts5: string;
  /** The list of synonym groups that were applied (empty if expandSynonyms=false). */
  readonly expanded: readonly (readonly string[])[];
  /** Tokens after stopword removal. */
  readonly tokens: readonly string[];
}

function quoteFtsTerm(term: string): string {
  // FTS5 treats `-` as a column-prefix operator. Quote any term with non-word
  // characters so they're treated as phrase tokens instead.
  if (/^[a-z0-9_]+$/.test(term)) return term;
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * Build an FTS5 MATCH expression from a free-text query.
 *
 * With `expandSynonyms: true`, tokens belonging to a synonym group are
 * OR-grouped with their alternates (improves recall, degrades precision).
 * With the default `false`, just emits the AND-joined cleaned tokens —
 * relying on vector retrieval to capture semantic synonyms.
 */
export function expandQuery(
  raw: string,
  table: SynonymTable,
  options: ExpansionOptions = {},
): ExpansionResult {
  const tokens = tokenizeQuery(raw);
  const usedGroupIndices = new Set<number>();
  const expanded: (readonly string[])[] = [];
  const ftsTerms: string[] = [];

  for (const tok of tokens) {
    if (!options.expandSynonyms) {
      ftsTerms.push(quoteFtsTerm(tok));
      continue;
    }
    const groupIdx = table.index.get(tok);
    if (groupIdx === undefined) {
      ftsTerms.push(quoteFtsTerm(tok));
      continue;
    }
    if (usedGroupIndices.has(groupIdx)) continue;
    usedGroupIndices.add(groupIdx);
    const group = table.groups[groupIdx];
    if (group === undefined) continue;
    expanded.push(group);
    const orGroup = group.map(quoteFtsTerm).join(" OR ");
    ftsTerms.push(`(${orGroup})`);
  }

  // Explicit AND between top-level terms (synonyms inside each are still
  // OR-grouped when expandSynonyms is on). FTS5 has a quirk: bare-token +
  // paren-group with implicit AND fails ("a (b OR c)" → syntax error), so
  // AND must be emitted explicitly.
  return {
    fts5: ftsTerms.join(" AND "),
    expanded,
    tokens,
  };
}
