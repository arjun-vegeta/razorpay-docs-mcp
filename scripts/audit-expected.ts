/**
 * For each "miss" in eval/queries.jsonl, verify the expected_routes are
 * sane: do they exist? do they actually contain the query's intent? Is the
 * doc the agent returned arguably a better answer?
 *
 * Outputs a table: query | expected | exists? | length(b) | match-strength
 */

import Database from "better-sqlite3";

const MISSES = [
  { id: "q007", q: "test vs live razorpay keys", expected: ["payments/dashboard/account-settings/api-keys"] },
  { id: "q008", q: "razorpay errors error codes", expected: ["errors", "errors/common"] },
  { id: "q011", q: "about razorpay orders concept", expected: ["payments/orders", "payments/orders/apis"] },
  { id: "q016", q: "order entity properties razorpay", expected: ["api/orders/entity"] },
  { id: "q025", q: "recurring payment card token", expected: ["api/payments/recurring-payments/cards/tokens"] },
  { id: "q028", q: "fetch razorpay settlement details", expected: ["api/settlements/fetch-all", "api/settlements/fetch-with-id"] },
  { id: "q030", q: "about razorpay webhooks", expected: ["webhooks"] },
  { id: "q033", q: "webhook signature is invalid razorpay", expected: ["webhooks/validate-test", "webhooks/best-practices"] },
  { id: "q037", q: "webhook idempotency razorpay", expected: ["webhooks/best-practices"] },
  { id: "q041", q: "webhook ip whitelist razorpay", expected: ["security/whitelists", "webhooks/best-practices"] },
  { id: "q042", q: "webhook url ports allowed", expected: ["webhooks/setup-edit-payments", "webhooks"] },
  { id: "q043", q: "refund a razorpay payment", expected: ["api/refunds/create-normal"] },
  { id: "q048", q: "partial refund razorpay api", expected: ["api/refunds/create-normal"] },
  { id: "q052", q: "add an addon to subscription", expected: ["api/payments/subscriptions/create-add-on", "api/payments/subscriptions/add-on-entity"] },
  { id: "q057", q: "razorpay 1cc one click checkout", expected: ["payments/cod-magic-checkout", "payments/magic-checkout/woocommerce"] },
  { id: "q059", q: "create razorpayx payout", expected: ["api/x/payouts", "api/x/payouts/create/bank-account"] },
  { id: "q060", q: "razorpayx payout to bank account", expected: ["api/x/payouts/create/bank-account"] },
  { id: "q063", q: "fetch razorpayx payouts list", expected: ["api/x/payouts/fetch-all", "api/x/payouts"] },
  { id: "q069", q: "BAD_REQUEST_ERROR razorpay", expected: ["errors/common", "errors"] },
  { id: "q070", q: "GATEWAY_ERROR retry razorpay", expected: ["errors/common", "errors"] },
];

const db = new Database("dist/index/index-bm25.db", { readonly: true });

interface Row {
  route: string;
  title: string;
  description: string | null;
  total_body: number | null;
}

const routeMeta = db.prepare<[string], Row>(
  `SELECT routes.route, routes.title, routes.description,
          (SELECT SUM(length(body)) FROM chunks WHERE route = routes.route) AS total_body
     FROM routes
     WHERE routes.route = ?`,
);

function findKeywordRoutes(keyword: string, limit = 5): string[] {
  const rows = db
    .prepare<[string, number], { route: string }>(
      `SELECT DISTINCT chunks.route FROM chunks WHERE body LIKE ? LIMIT ?`,
    )
    .all(`%${keyword}%`, limit);
  return rows.map((r) => r.route);
}

for (const m of MISSES) {
  console.log(`\n${m.id}  "${m.q}"`);
  console.log(`  expected_routes: ${m.expected.join(", ")}`);
  for (const r of m.expected) {
    const meta = routeMeta.get(r);
    if (!meta) {
      console.log(`    ✗ ${r} — NOT IN CORPUS`);
      continue;
    }
    console.log(`    ✓ ${r}`);
    console.log(`        title: ${meta.title}`);
    console.log(`        size:  ${meta.total_body} bytes`);
  }
  // For specific keywords in the query, find what other routes contain them
  // — these may be better answers.
  if (m.q.match(/GATEWAY_ERROR|BAD_REQUEST_ERROR/)) {
    const tok = m.q.match(/GATEWAY_ERROR|BAD_REQUEST_ERROR/)![0];
    const hits = findKeywordRoutes(tok, 8);
    console.log(`    docs containing "${tok}": ${hits.length}`);
    for (const h of hits.slice(0, 5)) console.log(`      - ${h}`);
  }
  if (m.q.match(/idempotency|whitelist|ports/i)) {
    const tok = (m.q.match(/idempotency|whitelist|ports?/i) as RegExpMatchArray)[0];
    const hits = findKeywordRoutes(tok, 8);
    console.log(`    docs containing "${tok}" (case-sensitive LIKE): ${hits.length}`);
    for (const h of hits.slice(0, 5)) console.log(`      - ${h}`);
  }
}

db.close();
