import { describe, expect, it } from "vitest";
import { ALL_RULES } from "../../src/validator/rules/index.js";
import { ValidationRunner } from "../../src/validator/runner.js";
import {
  StaticCitationResolver,
  findUnresolvedCitations,
} from "../../src/validator/cite.js";
import type { CitationResolver } from "../../src/validator/types.js";

const ALL_ROUTES = new Set<string>();
for (const r of ALL_RULES) ALL_ROUTES.add(r.citation.route);

const stubResolver: CitationResolver = new StaticCitationResolver(
  [...ALL_ROUTES].map((route) => [route, { url: `https://razorpay.com/docs/${route}`, title: route }]),
);

describe("ValidationRunner — registration", () => {
  it("registers all 30 rules without duplicate ids", () => {
    const runner = new ValidationRunner(stubResolver);
    runner.registerAll(ALL_RULES);
    expect(runner.count()).toBe(30);
  });

  it("rejects a duplicate rule id", () => {
    const runner = new ValidationRunner(stubResolver);
    runner.register(ALL_RULES[0]!);
    expect(() => runner.register(ALL_RULES[0]!)).toThrow(/duplicate rule id/);
  });

  it("every rule has a stable RZPNNN id and pos+neg fields populated", () => {
    for (const rule of ALL_RULES) {
      expect(rule.id).toMatch(/^RZP\d{3}$/);
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.fix.correctPattern.length).toBeGreaterThan(0);
      expect(rule.fix.explanation.length).toBeGreaterThan(0);
      expect(rule.citation.route.length).toBeGreaterThan(0);
    }
  });

  it("every rule's citation resolves through the stub resolver", () => {
    const unresolved = findUnresolvedCitations(ALL_RULES, stubResolver);
    expect(unresolved).toEqual([]);
  });

  it("filters by concern when provided", () => {
    const runner = new ValidationRunner(stubResolver);
    runner.registerAll(ALL_RULES);
    const r = runner.validate({
      code: "const k = 'rzp_live_ABCDEFGH123456';",
      languageHint: "node",
      concern: "key_safety",
    });
    expect(r.summary.rulesEvaluated).toBeLessThan(ALL_RULES.length);
    expect(r.issues.every((i) => i.ruleId.startsWith("RZP"))).toBe(true);
  });

  it("dedupes hits on (rule_id, line)", () => {
    const runner = new ValidationRunner(stubResolver);
    runner.registerAll(ALL_RULES);
    // Same hardcoded key on the same line should produce one issue, not two.
    const code = "const a = 'rzp_live_AAAAAAAAAAAAAA'; const b = 'rzp_live_BBBBBBBBBBBBBB';";
    const r = runner.validate({ code, languageHint: "node" });
    const liveHits = r.issues.filter((i) => i.ruleId === "RZP005");
    expect(liveHits.length).toBe(1);
  });

  it("ignores rules whose detector throws (graceful degrade)", () => {
    // Inject a rule whose heuristic throws — ensure it doesn't poison the run.
    const bad: typeof ALL_RULES[number] = {
      ...ALL_RULES[0]!,
      id: "RZP999" as typeof ALL_RULES[number]["id"],
      detector: { kind: "heuristic", fn: () => { throw new Error("boom"); } },
    };
    const resolver = new StaticCitationResolver([
      [bad.citation.route, { url: "https://razorpay.com/x", title: "x" }],
    ]);
    const runner = new ValidationRunner(resolver);
    runner.register(bad);
    const r = runner.validate({ code: "anything", languageHint: "node" });
    expect(r.issues.length).toBe(0);
    expect(r.summary.rulesEvaluated).toBe(1);
  });
});
