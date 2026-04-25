import { describe, expect, it } from "vitest";
import {
  applyHardProductFilter,
  applyRecencyBoost,
  applySoftProductBoost,
  applyTopicBoost,
  RECENCY_BOOST,
  reSortByScore,
  SOFT_BOOST,
  TOPIC_BOOST,
} from "../../src/retrieval/filter.js";
import { ProductSpec, TopicSpec, type Candidate } from "../../src/retrieval/types.js";

function cand(chunkId: number, route: string, score = 1, category?: string): Candidate {
  return {
    chunkId,
    score,
    kind: "rrf",
    route,
    ...(category !== undefined && { category }),
  };
}

describe("applyHardProductFilter", () => {
  it("retains only candidates whose route matches the product prefix set", () => {
    const cands = [
      cand(1, "api/x/payouts/create/bank-account"),
      cand(2, "payments/orders"),
      cand(3, "x/payouts/best-practices"),
    ];
    const filtered = applyHardProductFilter(cands, ProductSpec.X);
    expect(filtered.map((c) => c.chunkId).sort()).toEqual([1, 3]);
  });

  it("returns empty when nothing matches", () => {
    expect(applyHardProductFilter([cand(1, "payments/orders")], ProductSpec.Payroll)).toEqual([]);
  });
});

describe("applySoftProductBoost", () => {
  it("multiplies score for matches, leaves others alone, drops nothing", () => {
    const cands = [
      cand(1, "api/x/payouts", 1),
      cand(2, "payments/orders", 1),
    ];
    const boosted = applySoftProductBoost(cands, ProductSpec.X);
    expect(boosted).toHaveLength(2);
    expect(boosted.find((c) => c.chunkId === 1)?.score).toBeCloseTo(SOFT_BOOST);
    expect(boosted.find((c) => c.chunkId === 2)?.score).toBeCloseTo(1);
  });
});

describe("applyTopicBoost", () => {
  it("multiplies score for routes matching the topic", () => {
    const cands = [
      cand(1, "webhooks/validate-test", 2),
      cand(2, "api/orders/create", 2),
    ];
    const boosted = applyTopicBoost(cands, TopicSpec.Webhooks);
    expect(boosted.find((c) => c.chunkId === 1)?.score).toBeCloseTo(2 * TOPIC_BOOST);
    expect(boosted.find((c) => c.chunkId === 2)?.score).toBeCloseTo(2);
  });
});

describe("applyRecencyBoost", () => {
  it("multiplies score for category=announcements", () => {
    const cands = [
      cand(1, "announcements/foo", 1, "announcements"),
      cand(2, "api/orders", 1, "api"),
    ];
    const boosted = applyRecencyBoost(cands);
    expect(boosted.find((c) => c.chunkId === 1)?.score).toBeCloseTo(RECENCY_BOOST);
    expect(boosted.find((c) => c.chunkId === 2)?.score).toBeCloseTo(1);
  });
});

describe("reSortByScore", () => {
  it("sorts descending and breaks ties by chunkId asc", () => {
    const sorted = reSortByScore([cand(3, "x", 1), cand(1, "x", 2), cand(2, "x", 1)]);
    expect(sorted.map((c) => c.chunkId)).toEqual([1, 2, 3]);
  });
});
