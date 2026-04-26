import { describe, expect, it } from "vitest";
import {
  applyHardProductFilter,
  applyRecencyBoost,
  applyRouteSegmentBoost,
  applySoftProductBoost,
  applyTopicBoost,
  RECENCY_BOOST,
  reSortByScore,
  ROUTE_SEGMENT_EXACT_BOOST,
  ROUTE_SEGMENT_WORD_BOOST,
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

describe("applyRouteSegmentBoost", () => {
  it("applies the strong boost when terminal segment exactly equals a token", () => {
    // route "errors" terminal == "errors" token → exact match boost
    const cands = [cand(1, "errors", 1), cand(2, "api/orders/create", 1)];
    const boosted = applyRouteSegmentBoost(cands, ["errors", "list"]);
    expect(boosted.find((c) => c.chunkId === 1)?.score).toBeCloseTo(ROUTE_SEGMENT_EXACT_BOOST);
    expect(boosted.find((c) => c.chunkId === 2)?.score).toBeCloseTo(1);
  });

  it("applies the weaker word boost when a hyphen-split word matches a token", () => {
    // terminal "error-codes" splits to ["error", "codes"]; query has "error"
    const cands = [cand(1, "errors/turbo-upi/error-codes", 1)];
    const boosted = applyRouteSegmentBoost(cands, ["error"]);
    expect(boosted[0]?.score).toBeCloseTo(ROUTE_SEGMENT_WORD_BOOST);
  });

  it("returns input unchanged when no token matches the terminal", () => {
    const cands = [cand(1, "api/orders/create", 1)];
    const boosted = applyRouteSegmentBoost(cands, ["webhook"]);
    expect(boosted[0]?.score).toBeCloseTo(1);
  });

  it("ignores empty-token lists (no-op fast path)", () => {
    const cands = [cand(1, "errors", 1)];
    const boosted = applyRouteSegmentBoost(cands, []);
    expect(boosted).toEqual(cands);
  });
});
