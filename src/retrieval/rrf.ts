/**
 * Reciprocal Rank Fusion. Rank-based, score-scale-invariant — the right
 * choice for fusing BM25 (negative log-odds) with cosine similarity, which
 * have completely different score distributions.
 *
 * Formula:
 *
 *     score_rrf(d) = Σ 1 / (k + rank_i(d))     k = 60 (default)
 *
 * Where `rank_i(d)` is 1-indexed rank in ranking i (we 0-index internally).
 * Ties broken by chunk_id ASC for determinism.
 */

import type { Candidate } from "./types.js";

export const RRF_DEFAULT_K = 60;

export function rrf(
  rankings: readonly (readonly Candidate[])[],
  k: number = RRF_DEFAULT_K,
): readonly Candidate[] {
  const scores = new Map<number, number>();
  const carryRoute = new Map<number, string>();
  const carryCategory = new Map<number, string>();

  for (const ranking of rankings) {
    ranking.forEach((c, i) => {
      const prior = scores.get(c.chunkId) ?? 0;
      scores.set(c.chunkId, prior + 1 / (k + i + 1));
      if (c.route !== undefined && !carryRoute.has(c.chunkId)) carryRoute.set(c.chunkId, c.route);
      if (c.category !== undefined && !carryCategory.has(c.chunkId))
        carryCategory.set(c.chunkId, c.category);
    });
  }

  const fused: Candidate[] = [];
  for (const [chunkId, score] of scores) {
    const out: Candidate = {
      chunkId,
      score,
      kind: "rrf",
    };
    const route = carryRoute.get(chunkId);
    const category = carryCategory.get(chunkId);
    fused.push({ ...out, ...(route !== undefined && { route }), ...(category !== undefined && { category }) });
  }

  fused.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.chunkId - b.chunkId;
  });

  return fused;
}
