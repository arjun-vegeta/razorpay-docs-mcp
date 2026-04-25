/**
 * Shared scaffolding for per-rule tests. Builds a runner backed by a static
 * citation resolver that knows about every route any rule cites — keeps each
 * test file focused on detector behavior, not setup boilerplate.
 */

import { ALL_RULES } from "../../src/validator/rules/index.js";
import { StaticCitationResolver } from "../../src/validator/cite.js";
import { ValidationRunner } from "../../src/validator/runner.js";
import type { CitationResolver, Issue } from "../../src/validator/types.js";

const ROUTES = new Set<string>();
for (const r of ALL_RULES) ROUTES.add(r.citation.route);

const resolver: CitationResolver = new StaticCitationResolver(
  [...ROUTES].map((route) => [
    route,
    { url: `https://razorpay.com/docs/${route}`, title: route },
  ]),
);

export function makeRunner(): ValidationRunner {
  const r = new ValidationRunner(resolver);
  r.registerAll(ALL_RULES);
  return r;
}

const runner = makeRunner();

export function fires(code: string, ruleId: string, languageHint = "node"): boolean {
  const r = runner.validate({ code, languageHint });
  return r.issues.some((i) => i.ruleId === ruleId);
}

export function issuesFor(code: string, ruleId: string, languageHint = "node"): readonly Issue[] {
  const r = runner.validate({ code, languageHint });
  return r.issues.filter((i) => i.ruleId === ruleId);
}
