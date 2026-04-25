/**
 * Synonym dictionary loader + query expander.
 *
 * Razorpay queries are identifier-heavy ("paise", "razorpay-x", "subscription").
 * Phase 1's eval set already shows BM25 wins on most of these directly. The
 * synonyms here cover the long tail of natural-language phrasings ("send money
 * back to a customer" → refund) where pure keyword search misses.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

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

const DEFAULT_PATH = resolve(fileURLToPath(import.meta.url), "..", "..", "data", "synonyms.json");

export function loadSynonyms(path: string = DEFAULT_PATH): SynonymTable {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = SynonymsFileSchema.parse(raw);
  const index = new Map<string, number>();
  parsed.groups.forEach((group, i) => {
    for (const term of group) {
      index.set(term.toLowerCase(), i);
    }
  });
  return { version: parsed.version, groups: parsed.groups, index };
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "i",
  "we",
  "my",
  "our",
  "how",
  "do",
  "does",
  "did",
  "what",
  "where",
  "when",
  "why",
  "this",
  "that",
  "it",
  "its",
  "be",
  "been",
  "have",
  "has",
  "had",
  "can",
  "should",
  "would",
  "could",
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

export interface ExpansionResult {
  /** FTS5-ready query string (terms quoted, hyphens preserved). */
  readonly fts5: string;
  /** The list of synonym groups that were applied. */
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
 * Build an FTS5 MATCH expression from a free-text query, OR-grouping any
 * tokens that belong to known synonym groups.
 */
export function expandQuery(raw: string, table: SynonymTable): ExpansionResult {
  const tokens = tokenizeQuery(raw);
  const usedGroupIndices = new Set<number>();
  const expanded: (readonly string[])[] = [];
  const ftsTerms: string[] = [];

  for (const tok of tokens) {
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

  return {
    fts5: ftsTerms.join(" "),
    expanded,
    tokens,
  };
}
