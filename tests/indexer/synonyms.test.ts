import { describe, expect, it } from "vitest";
import { expandQuery, loadSynonyms, tokenizeQuery } from "../../src/indexer/synonyms.js";

describe("tokenizeQuery", () => {
  it("strips stopwords and short tokens", () => {
    expect(tokenizeQuery("how do I refund a customer")).toEqual(["refund", "customer"]);
  });

  it("preserves hyphens in identifiers", () => {
    expect(tokenizeQuery("create a razorpay-x payout")).toEqual(["create", "razorpay-x", "payout"]);
  });

  it("dedupes case-insensitively", () => {
    expect(tokenizeQuery("Webhook webhook WEBHOOK signature")).toEqual(["webhook", "signature"]);
  });
});

describe("expandQuery", () => {
  const table = loadSynonyms();

  it("OR-groups known synonyms in FTS5 syntax", () => {
    const out = expandQuery("how do I refund", table);
    expect(out.fts5.startsWith("(")).toBe(true);
    expect(out.fts5).toContain("refund OR return OR reverse");
  });

  it("quotes terms with non-word characters", () => {
    const out = expandQuery("razorpay-x payout idempotency", table);
    // razorpay-x is in a synonym group; OR group quotes hyphenated terms.
    expect(out.fts5).toContain('"razorpay-x"');
  });

  it("passes through tokens without synonym groups", () => {
    const out = expandQuery("create order receipt", table);
    expect(out.fts5).toContain("receipt");
    // "order" is in a synonym group so it'll be OR-grouped.
    expect(out.fts5).toContain("(order");
  });

  it("returns the underlying tokens", () => {
    const out = expandQuery("verify webhook signature", table);
    expect(out.tokens).toEqual(["verify", "webhook", "signature"]);
  });
});
