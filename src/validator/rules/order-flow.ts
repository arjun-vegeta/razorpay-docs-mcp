/**
 * Order-flow rules — invariants on the create-order → create-payment lifecycle.
 *
 * RZP004 — payments.create called without a preceding orders.create
 * RZP018 — `receipt` value exceeds 40 chars
 * RZP029 — Receipt generated from a timestamp without a nonce (collision risk)
 */

import { asRuleId, Concern, Severity, type DetectorHit, type Rule } from "../types.js";

const RECEIPT_FIELD = /\breceipt\s*[:=]\s*["'`]([^"'`\n]+)["'`]/g;

export const paymentWithoutOrder: Rule = {
  id: asRuleId("RZP004"),
  title: "payments.create called without a preceding orders.create",
  severity: Severity.Error,
  concern: Concern.OrderFlow,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      const paymentsCreate = /\b(?:payments?\.create|payment\.create|payments\(\)\.create|payment\(\)\.create)\b/g;
      const ordersCreate =
        /\b(?:orders?\.create|order\.create|orders\(\)\.create|order\(\)\.create|client\.order\.create)\b/;
      if (!ordersCreate.test(code)) {
        const hits: DetectorHit[] = [];
        let m: RegExpExecArray | null;
        while ((m = paymentsCreate.exec(code)) !== null) {
          hits.push({ line: lineOf(ctx.code, m.index), column: 1, snippet: m[0] });
        }
        return hits;
      }
      // If both exist, ensure orders.create comes first.
      const firstOrder = code.search(ordersCreate);
      const firstPayment = code.search(paymentsCreate);
      if (firstPayment !== -1 && firstOrder > firstPayment) {
        return [
          {
            line: lineOf(ctx.code, firstPayment),
            column: 1,
            snippet: "payments.create precedes orders.create",
          },
        ];
      }
      return [];
    },
  },
  citation: {
    route: "api/orders/create",
    excerpt:
      "Always create an Order first; the payment that follows is bound to that order's id and currency.",
  },
  fix: {
    explanation:
      "An order is the contract Razorpay verifies against. Creating a payment without one means there's nothing to settle the payment to, and signature verification has no canonical id to sign.",
    correctPattern: `const order = await razorpay.orders.create({ amount, currency: 'INR' });
// pass order.id to the client; client uses it during checkout
// payments are then bound to order.id end-to-end`,
  },
};

export const receiptTooLong: Rule = {
  id: asRuleId("RZP018"),
  title: "`receipt` field exceeds the 40-character limit",
  severity: Severity.Warning,
  concern: Concern.OrderFlow,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const hits: DetectorHit[] = [];
      const re = new RegExp(RECEIPT_FIELD.source, RECEIPT_FIELD.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(ctx.stripped)) !== null) {
        const value = m[1] ?? "";
        if (value.length > 40) {
          hits.push({
            line: lineOf(ctx.code, m.index),
            column: 1,
            snippet: `receipt length ${value.length} (>40): ${value.slice(0, 60)}…`,
          });
        }
      }
      return hits;
    },
  },
  citation: {
    route: "api/orders/create",
    section: "receipt",
    excerpt: "The `receipt` field is capped at 40 characters.",
  },
  fix: {
    explanation:
      "The order create endpoint rejects receipts longer than 40 chars. Use a short, unique tag (e.g., your internal order short-id).",
    correctPattern: `receipt: \`r_\${shortId}\` // ≤ 40 chars`,
  },
};

export const receiptCollisionRisk: Rule = {
  id: asRuleId("RZP029"),
  title: "Receipt derived from time only — collision risk",
  severity: Severity.Warning,
  concern: Concern.OrderFlow,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      // Look for receipt assigned from a time-only expression.
      const patterns = [
        /\breceipt\s*[:=]\s*[`"']?\s*\$?\{?\s*Date\.now\s*\(\s*\)/g,
        /\breceipt\s*[:=]\s*[`"']?\s*\$?\{?\s*time\s*\(\s*\)/g,
        /\breceipt\s*[:=]\s*[`"']?\s*\$?\{?\s*new\s+Date\s*\(/g,
        /\breceipt\s*[:=]\s*[`"']?\s*\$?\{?\s*time\.time\s*\(\s*\)/g,
      ];
      const hits: DetectorHit[] = [];
      for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null) {
          const window = code.slice(m.index, m.index + 220);
          // Suppress if a random/uuid/nonce token is in the same expression.
          if (/(?:randomUUID|uuid|crypto\.random|Math\.random|nanoid|shortid|secrets\.token|nonce|random_int|bin2hex|random_bytes)/i.test(window)) {
            continue;
          }
          hits.push({
            line: lineOf(ctx.code, m.index),
            column: 1,
            snippet: m[0],
          });
        }
      }
      return hits;
    },
  },
  citation: {
    route: "api/orders/create",
    excerpt:
      "Receipts must be unique per order. Two requests in the same millisecond will collide.",
  },
  fix: {
    explanation:
      "Time-only receipts collide under concurrency. Mix in a random token (UUID, nanoid, secrets.token_hex) so duplicates are impossible.",
    correctPattern: `receipt: \`r_\${Date.now()}_\${crypto.randomUUID().slice(0,8)}\``,
  },
};

function lineOf(code: string, offset: number): number {
  let line = 1;
  for (let j = 0; j < offset && j < code.length; j += 1) {
    if (code[j] === "\n") line += 1;
  }
  return line;
}

export const orderFlowRules: readonly Rule[] = [
  paymentWithoutOrder,
  receiptTooLong,
  receiptCollisionRisk,
];
