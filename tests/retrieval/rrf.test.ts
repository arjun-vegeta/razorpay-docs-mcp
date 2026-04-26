import { describe, expect, it } from "vitest";
import { rrf, rrfWeighted, RRF_DEFAULT_K } from "../../src/retrieval/rrf.js";
import type { Candidate } from "../../src/retrieval/types.js";

function bm25Cand(chunkId: number, score: number): Candidate {
  return { chunkId, score, kind: "bm25" };
}

function vectorCand(chunkId: number, score: number): Candidate {
  return { chunkId, score, kind: "vector" };
}

describe("rrf", () => {
  it("fuses two rankings using 1/(k+rank) and sorts descending", () => {
    const bm25 = [bm25Cand(1, 9.0), bm25Cand(2, 8.0), bm25Cand(3, 7.0)];
    const vec = [vectorCand(2, 0.9), vectorCand(4, 0.8), vectorCand(1, 0.7)];
    const fused = rrf([bm25, vec]);
    const top = fused.map((c) => c.chunkId);
    // chunk 2 appears in both at rank 1+2 = 1/61 + 1/62 ≈ 0.03283
    // chunk 1 appears at rank 1+3 = 1/61 + 1/63 ≈ 0.03227
    expect(top[0]).toBe(2);
    expect(top[1]).toBe(1);
    // Both 1 and 2 should outrank chunks that appear only once (3, 4)
    const scoreOf = new Map(fused.map((c) => [c.chunkId, c.score]));
    expect(scoreOf.get(2)!).toBeGreaterThan(scoreOf.get(3) ?? 0);
    expect(scoreOf.get(1)!).toBeGreaterThan(scoreOf.get(4) ?? 0);
  });

  it("breaks score ties by chunkId ascending (deterministic)", () => {
    // To create an actual tie, ranks must swap across rankings:
    //   chunk 7: rank 1 in a, rank 2 in b → 1/61 + 1/62
    //   chunk 2: rank 2 in a, rank 1 in b → 1/62 + 1/61   (same)
    const a = [bm25Cand(7, 1), bm25Cand(2, 1)];
    const b = [vectorCand(2, 1), vectorCand(7, 1)];
    const fused = rrf([a, b]);
    expect(fused[0]?.score).toBeCloseTo(fused[1]?.score ?? -1);
    expect(fused[0]?.chunkId).toBe(2);
    expect(fused[1]?.chunkId).toBe(7);
  });

  it("uses RRF_DEFAULT_K=60 when none provided", () => {
    expect(RRF_DEFAULT_K).toBe(60);
    const fused = rrf([[bm25Cand(1, 1)]]);
    expect(fused[0]?.score).toBeCloseTo(1 / (60 + 1));
  });

  it("custom k changes the discount curve", () => {
    const fused = rrf([[bm25Cand(1, 1)]], 100);
    expect(fused[0]?.score).toBeCloseTo(1 / (100 + 1));
  });

  it("handles empty inputs gracefully", () => {
    expect(rrf([])).toEqual([]);
    expect(rrf([[]])).toEqual([]);
  });

  it("carries over route + category from any input that supplies them", () => {
    const a: readonly Candidate[] = [
      { chunkId: 1, score: 1, kind: "bm25", route: "api/orders", category: "api" },
    ];
    const b: readonly Candidate[] = [{ chunkId: 1, score: 1, kind: "vector" }];
    const fused = rrf([a, b]);
    expect(fused[0]?.route).toBe("api/orders");
    expect(fused[0]?.category).toBe("api");
  });
});

describe("rrfWeighted", () => {
  it("scales each ranking's contribution by its weight", () => {
    // Same rank-1 hit in two rankings; with weights [1, 0.5] the second
    // contributes half as much.
    const a = [bm25Cand(1, 1)];
    const b = [vectorCand(1, 1)];
    const fused = rrfWeighted([a, b], [1.0, 0.5]);
    expect(fused[0]?.score).toBeCloseTo(1 / 61 + 0.5 / 61);
  });

  it("missing weight defaults to 1 (no-op)", () => {
    const a = [bm25Cand(1, 1)];
    const b = [vectorCand(1, 1)];
    expect(rrfWeighted([a, b], [1, 1])[0]?.score).toBeCloseTo(2 / 61);
    expect(rrfWeighted([a, b], [])[0]?.score).toBeCloseTo(2 / 61);
  });

  it("a low-weight ranking can be outvoted by a high-weight one", () => {
    // chunk 1: rank 1 in low-weight (0.3), rank 2 in high-weight (1.0)
    //   = 0.3/61 + 1/62 ≈ 0.0210
    // chunk 2: only in low-weight (0.3) at rank 2
    //   = 0.3/62 ≈ 0.0048
    const lowW = [bm25Cand(1, 1), bm25Cand(2, 1)];
    const highW = [vectorCand(3, 1), vectorCand(1, 1)];
    const fused = rrfWeighted([lowW, highW], [0.3, 1.0]);
    expect(fused[0]?.chunkId).toBe(1);
  });
});
