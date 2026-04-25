/**
 * Eval harness — runs queries.jsonl through the retrieval pipeline and
 * computes recall@K + MRR + latency. Phase 1 stub: validates that every
 * `expected_route` resolves in the manifest, so we never ship broken
 * citations. The real retrieval call is wired in Phase 3.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { loadManifest, listRoutes } from "../src/util/manifest.js";

const QuerySchema = z.object({
  id: z.string().regex(/^q\d{3}$/),
  query: z.string().min(3).max(256),
  language: z.string().optional(),
  product: z.string().optional(),
  topic: z.string().optional(),
  expected_routes: z.array(z.string()).min(1),
  acceptable_routes: z.array(z.string()).optional(),
});
type Query = z.infer<typeof QuerySchema>;

const repoRoot = process.cwd();
const sourceDir = resolve(repoRoot, "source");
const queriesPath = resolve(repoRoot, "eval/queries.jsonl");

function readQueries(path: string): Query[] {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    try {
      return QuerySchema.parse(JSON.parse(line));
    } catch (err) {
      throw new Error(`invalid eval query at line ${i + 1}: ${stringifyErr(err)}`);
    }
  });
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function main(): void {
  const queries = readQueries(queriesPath);
  console.error(`loaded ${queries.length} eval queries from ${queriesPath}`);

  const manifest = loadManifest(sourceDir);
  const routes = new Set(listRoutes(manifest));
  console.error(`manifest has ${routes.size} routes`);

  const issues: { id: string; missing: string[] }[] = [];
  for (const q of queries) {
    const targets = [...q.expected_routes, ...(q.acceptable_routes ?? [])];
    const missing = targets.filter((r) => !routes.has(r));
    if (missing.length > 0) issues.push({ id: q.id, missing });
  }

  if (issues.length > 0) {
    console.error("FAIL: eval queries reference routes not in manifest:");
    for (const issue of issues) {
      console.error(`  ${issue.id}: ${issue.missing.join(", ")}`);
    }
    process.exitCode = 1;
    return;
  }

  console.error(`OK: all ${queries.length} eval queries reference valid routes`);
  console.error("note: retrieval evaluation is wired in Phase 3 (see buildplan.md §3.10)");
}

main();
