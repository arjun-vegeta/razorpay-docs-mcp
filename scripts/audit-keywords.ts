/**
 * For each expected route in eval/queries.jsonl, verify it actually contains
 * the query's distinctive keywords. If the expected route doesn't contain the
 * keyword, the eval expectation is wrong — our retrieval can't be blamed.
 */

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "do", "i", "we", "how", "what", "where",
  "razorpay", "to", "and", "or", "for", "with", "on", "at", "in", "of",
  "vs", "list", "create", "an",
]);

interface EvalQuery {
  id: string;
  query: string;
  topic?: string;
  expected_routes: string[];
}

const queries: EvalQuery[] = readFileSync("eval/queries.jsonl", "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as EvalQuery);

const db = new Database("dist/index/index-bm25.db", { readonly: true });

function distinctiveTokens(q: string): string[] {
  return q.toLowerCase().match(/[a-z0-9_]+/g)!
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

interface AuditOutcome {
  id: string;
  query: string;
  expected: string[];
  problems: string[];
  correctRoutes?: string[];
}

const audits: AuditOutcome[] = [];

for (const eq of queries) {
  const tokens = distinctiveTokens(eq.query);
  const problems: string[] = [];

  for (const route of eq.expected_routes) {
    const meta = db.prepare<[string], { route: string; title: string }>(
      `SELECT route, title FROM routes WHERE route = ?`,
    ).get(route);
    if (!meta) {
      problems.push(`${route} NOT IN CORPUS`);
      continue;
    }
    const bodies = db.prepare<[string], { body: string }>(
      `SELECT body FROM chunks WHERE route = ?`,
    ).all(route);
    const haystack = (meta.title + "\n" + bodies.map((b) => b.body).join("\n")).toLowerCase();
    // Check each distinctive query token. Allow case-insensitive match and
    // simple plural collapse.
    const missing: string[] = [];
    for (const t of tokens) {
      const stem = t.endsWith("s") && t.length > 4 ? t.slice(0, -1) : t;
      if (!haystack.includes(t) && !haystack.includes(stem)) missing.push(t);
    }
    // Report any expected route where >40% of distinctive query tokens are
    // missing — likely the eval picked the wrong canonical.
    if (tokens.length > 0 && missing.length / tokens.length > 0.4) {
      problems.push(`${route} missing keywords: ${missing.join(", ")} (out of ${tokens.length})`);
    }
  }

  if (problems.length > 0) {
    audits.push({ id: eq.id, query: eq.query, expected: eq.expected_routes, problems });
  }
}

console.log(`\nQueries with eval expectation problems: ${audits.length} of ${queries.length}\n`);
for (const a of audits) {
  console.log(`${a.id}  "${a.query}"`);
  console.log(`  expected: ${a.expected.join(" | ")}`);
  for (const p of a.problems) console.log(`  ✗ ${p}`);
  console.log("");
}

db.close();
