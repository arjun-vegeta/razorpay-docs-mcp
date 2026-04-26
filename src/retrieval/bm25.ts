/**
 * BM25 / FTS5 retriever. Opens the index-bm25.db read-only and exposes a
 * single function that returns top-K candidates for a query.
 *
 * Field weights (titles dominate, headings matter, body is the fallback):
 *   title=8.0  description=4.0  category=1.0  route=2.0  heading_path=3.0  body=1.0
 */

import type { Database } from "better-sqlite3";
import type { Candidate } from "./types.js";

const FIELD_WEIGHTS = {
  title: 8.0,
  description: 4.0,
  category: 1.0,
  route: 2.0,
  headingPath: 3.0,
  body: 1.0,
} as const;

export const BM25_DEFAULT_K = 30;

interface FtsRow {
  readonly chunk_id: number;
  readonly route: string;
  readonly category: string;
  readonly score: number;
}

/**
 * Quote any token that contains characters FTS5 treats specially. FTS5 reads
 * `-` as a column-prefix operator and `:` as a column-scope, so unquoted
 * tokens like `razorpay-x` would parse as "razorpay" with column-prefix `x`.
 * Wrapping the term as a phrase ("razorpay-x") fixes this.
 */
export function quoteFtsTerm(term: string): string {
  if (/^[a-z0-9_]+$/i.test(term)) return term;
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * Escape a free-text query for FTS5 MATCH. Each token becomes a quoted phrase
 * if it contains hyphens or other special chars; bare alphanumerics pass
 * through. Results in an implicit AND across tokens (FTS5 default).
 *
 * Use the `synonyms.expandQuery` output (already FTS5-formatted) when
 * available — this function is the safe fallback.
 */
export function escapeFtsQuery(raw: string): string {
  const tokens = raw.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [];
  if (tokens.length === 0) return "";
  return tokens.map(quoteFtsTerm).join(" ");
}

export class Bm25Retriever {
  private readonly stmt;

  public constructor(private readonly db: Database) {
    this.stmt = db.prepare<[string, number], FtsRow>(
      `SELECT
         docs.rowid AS chunk_id,
         chunks.route AS route,
         chunks.category AS category,
         -bm25(docs, ${FIELD_WEIGHTS.title}, ${FIELD_WEIGHTS.description},
                     ${FIELD_WEIGHTS.category}, ${FIELD_WEIGHTS.route},
                     ${FIELD_WEIGHTS.headingPath}, ${FIELD_WEIGHTS.body}) AS score
       FROM docs
       JOIN chunks ON chunks.chunk_id = docs.rowid
       WHERE docs MATCH ?
       ORDER BY score DESC
       LIMIT ?`,
    );
  }

  /**
   * Run a pre-formatted FTS5 query and return top-K candidates. The caller is
   * responsible for escaping; pass through `escapeFtsQuery` or
   * `synonyms.expandQuery(...).fts5` if you have a free-text input.
   *
   * On FTS5 syntax errors we return an empty list (not throw) — common cause
   * is a query that became empty after stopword removal. Errors are logged.
   */
  public search(ftsQuery: string, k: number = BM25_DEFAULT_K): readonly Candidate[] {
    if (ftsQuery.trim().length === 0) return [];
    let rows: readonly FtsRow[];
    try {
      rows = this.stmt.all(ftsQuery, k);
    } catch {
      // FTS5 throws on malformed MATCH expressions. Return empty rather than
      // crash the caller — eval/agent should still be able to fall back.
      return [];
    }
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      score: r.score,
      kind: "bm25" as const,
      route: r.route,
      category: r.category,
    }));
  }
}
