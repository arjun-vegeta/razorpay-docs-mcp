/**
 * Run the full 80-query eval/queries.jsonl set and report recall@3 / recall@10
 * grouped by topic + by category prefix (subscriptions, webhooks, payments,
 * x, integrations, errors).
 */

import { readFileSync } from "node:fs";
import { RetrievalPipeline, loadPipelineConfig } from "../src/retrieval/pipeline.js";

interface EvalQuery {
  id: string;
  query: string;
  topic?: string;
  expected_routes: string[];
  acceptable_routes?: string[];
}

const lines = readFileSync("eval/queries.jsonl", "utf8").split("\n").filter((l) => l.trim());
const queries: EvalQuery[] = lines.map((l) => JSON.parse(l));

const cfg = loadPipelineConfig(process.cwd());
const pipe = new RetrievalPipeline(cfg);

// Bucket queries into semantic categories from expected_routes prefix.
function categoryOf(routes: string[]): string {
  if (routes.some((r) => r.startsWith("api/"))) return "api";
  if (routes.some((r) => r.startsWith("webhooks/"))) return "webhooks";
  if (routes.some((r) => r.startsWith("errors") || r.includes("/errors"))) return "errors";
  if (routes.some((r) => r.includes("subscription"))) return "subscriptions";
  if (routes.some((r) => r.startsWith("x/"))) return "razorpay-x";
  if (routes.some((r) => r.includes("ecommerce-plugins") || r.includes("/plugins/"))) return "plugins";
  if (routes.some((r) => r.includes("/server-integration/"))) return "sdk";
  if (routes.some((r) => r.includes("/payment-gateway/"))) return "payment-gateway";
  if (routes.some((r) => r.includes("/payment-link") || r.includes("/payment-button"))) return "payment-links";
  if (routes.some((r) => r.includes("/refund"))) return "refunds";
  if (routes.some((r) => r.includes("/payouts") || r.includes("/payout"))) return "payouts";
  if (routes.some((r) => r.includes("/test") || r.includes("/sandbox"))) return "testing";
  if (routes.some((r) => r.includes("/security") || r.includes("/whitelist"))) return "security";
  if (routes.some((r) => r.includes("/dashboard"))) return "dashboard";
  return "misc";
}

interface BucketStat {
  total: number;
  hit3: number;
  hit10: number;
  misses: { id: string; q: string; expected: string[]; got: string[]; rank: number }[];
}

const stats = new Map<string, BucketStat>();
const overall: BucketStat = { total: 0, hit3: 0, hit10: 0, misses: [] };

for (const eq of queries) {
  const cat = categoryOf(eq.expected_routes);
  let s = stats.get(cat);
  if (!s) {
    s = { total: 0, hit3: 0, hit10: 0, misses: [] };
    stats.set(cat, s);
  }
  const resp = await pipe.search({ query: eq.query, k: 10 });
  const routes = resp.results.map((r) => r.route);
  // Match against expected_routes ∪ acceptable_routes (the official eval
  // harness in eval/run.ts uses the same union).
  const targets = new Set([...eq.expected_routes, ...(eq.acceptable_routes ?? [])]);
  const idx = routes.findIndex((r) => targets.has(r));
  s.total++;
  overall.total++;
  if (idx >= 0 && idx < 3) {
    s.hit3++;
    overall.hit3++;
  }
  if (idx >= 0 && idx < 10) {
    s.hit10++;
    overall.hit10++;
  }
  if (idx < 0 || idx >= 3) {
    const miss = { id: eq.id, q: eq.query, expected: eq.expected_routes, got: routes.slice(0, 3), rank: idx + 1 };
    s.misses.push(miss);
    overall.misses.push(miss);
  }
}

pipe.close();

// Print by-category table.
const order = ["api", "webhooks", "errors", "sdk", "subscriptions", "razorpay-x", "plugins", "payment-gateway", "payment-links", "refunds", "payouts", "testing", "security", "dashboard", "misc"];
console.log("\nBy-category recall:");
console.log("category".padEnd(20) + "n  ".padStart(4) + "  recall@3".padEnd(12) + "  recall@10");
for (const cat of order) {
  const s = stats.get(cat);
  if (!s || s.total === 0) continue;
  const r3 = ((s.hit3 / s.total) * 100).toFixed(0).padStart(3);
  const r10 = ((s.hit10 / s.total) * 100).toFixed(0).padStart(3);
  console.log(
    `${cat.padEnd(20)}${String(s.total).padStart(3)}   ${s.hit3.toString().padStart(2)}/${s.total} (${r3}%)   ${s.hit10.toString().padStart(2)}/${s.total} (${r10}%)`,
  );
}
const r3 = ((overall.hit3 / overall.total) * 100).toFixed(1);
const r10 = ((overall.hit10 / overall.total) * 100).toFixed(1);
console.log(`\nOVERALL              ${String(overall.total).padStart(3)}   ${overall.hit3}/${overall.total} (${r3}%)   ${overall.hit10}/${overall.total} (${r10}%)`);

console.log(`\nMisses (${overall.misses.length} of ${overall.total}):`);
for (const m of overall.misses) {
  const rankInfo = m.rank > 0 ? `rank ${m.rank}` : "NOT in top-10";
  console.log(`  ${m.id} [${rankInfo.padEnd(13)}] ${m.q}`);
  console.log(`     expected: ${m.expected.join(" | ")}`);
  console.log(`     got:      ${m.got.join(", ")}`);
}
