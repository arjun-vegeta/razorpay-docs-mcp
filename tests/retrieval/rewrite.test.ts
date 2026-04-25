import { describe, expect, it } from "vitest";
import { loadSynonyms } from "../../src/indexer/synonyms.js";
import { rewriteQuery } from "../../src/retrieval/rewrite.js";
import { Lang } from "../../src/util/lang.js";
import { ProductSpec } from "../../src/retrieval/types.js";

const TABLE = loadSynonyms();

describe("rewriteQuery", () => {
  it("strips noise phrases", () => {
    const r = rewriteQuery("how do I refund a customer", TABLE);
    expect(r.cleaned).not.toContain("how do i");
    expect(r.cleaned).toContain("refund");
    expect(r.cleaned).toContain("customer");
  });

  it("AND-joins discriminative tokens (synonyms off by default)", () => {
    const r = rewriteQuery("verify webhook signature", TABLE);
    expect(r.fts5).toContain("AND");
    expect(r.fts5.toLowerCase()).toContain("webhook");
    expect(r.fts5.toLowerCase()).toContain("signature");
    expect(r.expandedTerms).toEqual([]);
  });

  it("detects SDK language hints", () => {
    expect(rewriteQuery("create a razorpay order in node", TABLE).detectedLanguage).toBe(Lang.Node);
    expect(rewriteQuery("python sdk for razorpay", TABLE).detectedLanguage).toBe(Lang.Python);
    expect(rewriteQuery("php integration steps", TABLE).detectedLanguage).toBe(Lang.Php);
    expect(rewriteQuery("java spring boot razorpay", TABLE).detectedLanguage).toBe(Lang.Java);
    expect(rewriteQuery("ruby on rails razorpay", TABLE).detectedLanguage).toBe(Lang.Ruby);
    expect(rewriteQuery("golang razorpay", TABLE).detectedLanguage).toBe(Lang.Go);
  });

  it("detects product hints", () => {
    expect(rewriteQuery("razorpay-x payout to bank account", TABLE).detectedProduct).toBe(
      ProductSpec.X,
    );
    expect(rewriteQuery("razorpay payroll for employees", TABLE).detectedProduct).toBe(
      ProductSpec.Payroll,
    );
    expect(rewriteQuery("magic checkout 1cc", TABLE).detectedProduct).toBe(
      ProductSpec.MagicCheckout,
    );
    expect(rewriteQuery("subscription with auto-debit", TABLE).detectedProduct).toBe(
      ProductSpec.Subscriptions,
    );
  });

  it("expandedTerms is empty when synonym expansion is off (default)", () => {
    const r = rewriteQuery("refund a payment", TABLE);
    expect(r.expandedTerms).toEqual([]);
    // Tokens still surface for query interpretation:
    expect(r.tokens).toContain("refund");
    expect(r.tokens).toContain("payment");
  });

  it("preserves the raw query verbatim", () => {
    const r = rewriteQuery("How do I VERIFY webhook signature?", TABLE);
    expect(r.raw).toBe("How do I VERIFY webhook signature?");
  });
});
