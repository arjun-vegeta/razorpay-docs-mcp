/**
 * Run the 22-query dogfood eval against the local pipeline.
 * Reports per-query rank of expected_route in the search top-3 (and top-10
 * for diagnosis). Prints summary at end.
 */

import { RetrievalPipeline, loadPipelineConfig } from "../src/retrieval/pipeline.js";

const QUERIES: { id: string; q: string; expected: string[] }[] = [
  { id: "q01", q: "razorpay api authentication", expected: ["api/authentication"] },
  { id: "q17", q: "capture razorpay payment", expected: ["api/payments/capture"] },
  { id: "q03", q: "razorpay api best practices", expected: ["api/best-practices"] },
  { id: "q02", q: "how do I authenticate against the razorpay api", expected: ["api/authentication"] },
  { id: "q04", q: "razorpay sandbox setup", expected: ["api/sandbox-setup"] },
  { id: "q05", q: "razorpay test mode setup", expected: ["api/sandbox-setup"] },
  { id: "q16", q: "order entity properties razorpay", expected: ["api/orders/entity"] },
  { id: "q80", q: "how to convert rupees to paise razorpay", expected: ["razorpay-n8n-node/troubleshooting-faqs"] },
  { id: "q14", q: "fetch payments for an order", expected: ["api/orders/fetch-payments"] },
  { id: "q64", q: "approve a razorpayx payout", expected: ["x/manage-teams/approval-workflow", "x/payouts/api"] },
  { id: "q70", q: "GATEWAY_ERROR retry razorpay", expected: ["errors/common", "errors"] },
  { id: "q08", q: "razorpay errors error codes", expected: ["errors", "errors/common"] },
  { id: "q68", q: "card payment errors razorpay", expected: ["errors/payments/cards", "errors/payments/list"] },
  { id: "q67", q: "common razorpay error codes", expected: ["errors/common"] },
  { id: "q31", q: "how to verify razorpay webhook signature", expected: ["webhooks/validate-test"] },
  { id: "q42", q: "webhook url ports allowed", expected: ["webhooks/best-practices", "payments/payment-gateway/s2s-integration/recurring-payments/webhooks"] },
  { id: "q32", q: "validate webhook hmac razorpay", expected: ["webhooks/validate-test"] },
  { id: "q34", q: "setup razorpay payment webhook", expected: ["webhooks/setup-edit-payments", "webhooks", "payments/dashboard/account-settings/webhooks"] },
  { id: "q74", q: "razorpay java sdk integration", expected: ["payments/server-integration/java/integration-steps", "payments/server-integration/java"] },
  { id: "q75", q: "razorpay ruby on rails sdk", expected: ["payments/server-integration/ruby/integration-steps", "payments/server-integration/ruby"] },
  { id: "q77", q: "razorpay woocommerce plugin", expected: ["payments/payment-gateway/ecommerce-plugins/woocommerce", "payments/payment-gateway/ecommerce-plugins/woocommerce/integration-steps"] },
  { id: "q71", q: "integrate razorpay node js server", expected: ["payments/server-integration/nodejs", "payments/server-integration/nodejs/integration-steps"] },
];

const cfg = loadPipelineConfig(process.cwd());
const pipe = new RetrievalPipeline(cfg);

let hit3 = 0;
let hit10 = 0;
const rows: string[] = [];

for (const { id, q, expected } of QUERIES) {
  const resp = await pipe.search({ query: q, k: 10 });
  const routes = resp.results.map((r) => r.route);
  const idx = routes.findIndex((r) => expected.includes(r));
  const at = idx + 1; // 1-indexed; 0 means missing
  if (at >= 1 && at <= 3) hit3++;
  if (at >= 1 && at <= 10) hit10++;
  const status = at === 0 ? "MISS" : at <= 3 ? `@${at}` : `(@${at})`;
  rows.push(`${id.padEnd(4)} ${status.padEnd(6)} ${q}`);
  if (at === 0) {
    rows.push(`        expected: ${expected.join(" | ")}`);
    rows.push(`        got:      ${routes.slice(0, 3).join(", ")}`);
  } else if (at > 3) {
    rows.push(`        expected: ${expected.join(" | ")}`);
    rows.push(`        top3:     ${routes.slice(0, 3).join(", ")}`);
  }
}

pipe.close();

console.log(rows.join("\n"));
console.log(`\nrecall@3:  ${hit3}/${QUERIES.length} = ${((hit3 / QUERIES.length) * 100).toFixed(1)}%`);
console.log(`recall@10: ${hit10}/${QUERIES.length} = ${((hit10 / QUERIES.length) * 100).toFixed(1)}%`);
