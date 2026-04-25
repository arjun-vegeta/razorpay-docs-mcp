/**
 * Vector retriever. Wraps a sqlite-vec virtual table; converts a query
 * embedding (Float32Array) to top-K candidates ordered by ascending L2
 * distance, which we surface as similarity = 1/(1+distance) so higher = better
 * lines up with BM25's convention before RRF.
 */

import type { Database } from "better-sqlite3";
import type { Candidate } from "./types.js";

export const VECTOR_DEFAULT_K = 30;

interface VecRow {
  readonly chunk_id: number;
  readonly distance: number;
}

export class VectorRetriever {
  private readonly stmt;

  public constructor(private readonly db: Database) {
    this.stmt = db.prepare<[Buffer, number], VecRow>(
      `SELECT chunk_id, distance
       FROM vec_chunks
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT ?`,
    );
  }

  public search(queryEmbedding: Float32Array, k: number = VECTOR_DEFAULT_K): readonly Candidate[] {
    const buf = Buffer.from(
      queryEmbedding.buffer,
      queryEmbedding.byteOffset,
      queryEmbedding.byteLength,
    );
    const rows = this.stmt.all(buf, k);
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      score: 1 / (1 + r.distance),
      kind: "vector" as const,
    }));
  }
}
