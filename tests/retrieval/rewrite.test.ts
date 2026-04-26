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

  it("plain fts5 AND-joins discriminative tokens", () => {
    const r = rewriteQuery("verify webhook signature", TABLE);
    expect(r.fts5).toContain("AND");
    expect(r.fts5.toLowerCase()).toContain("webhook");
    expect(r.fts5.toLowerCase()).toContain("signature");
    // Plain fts5 does NOT have OR-groups (those go in fts5WithSynonyms).
    expect(r.fts5).not.toContain(" OR ");
  });

  it("emits a parallel synonym-expanded fts5 for the dual-BM25 pass", () => {
    const r = rewriteQuery("verify webhook signature", TABLE);
    // The synonym-expanded form OR-groups tokens that have synonyms in the
    // table — pipeline runs this as a second BM25 pass and RRF-fuses with
    // the plain pass. Lets natural-language queries find docs that use
    // different wording (e.g., "validate" instead of "verify").
    expect(r.fts5WithSynonyms).toContain("OR");
    expect(r.fts5WithSynonyms.toLowerCase()).toContain("validate");
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

  it("surfaces expandedTerms (alternates) when tokens hit a synonym group", () => {
    // The pipeline applies synonyms as a second BM25 pass; expandedTerms
    // mirrors the alternates used so query_interpretation can show them to
    // the agent for transparency.
    const r = rewriteQuery("refund a payment", TABLE);
    expect(r.tokens).toContain("refund");
    expect(r.tokens).toContain("payment");
    // "refund" maps to a synonym group containing "return"/"reverse"/etc.,
    // and "payment" to a group with "transaction"/"charge".
    expect(r.expandedTerms.length).toBeGreaterThan(0);
  });

  it("preserves the raw query verbatim", () => {
    const r = rewriteQuery("How do I VERIFY webhook signature?", TABLE);
    expect(r.raw).toBe("How do I VERIFY webhook signature?");
  });
});
