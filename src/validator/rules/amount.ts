/**
 * Amount + currency rules.
 *
 * RZP003 — `amount: <small int>` paired with INR (probably rupees, not paise)
 * RZP012 — Order created in INR but payment.create uses USD (or vice versa)
 * RZP022 — `currency:'inr'` lowercase (Razorpay expects ISO uppercase)
 */

import { asRuleId, Concern, Severity, type DetectorHit, type Rule } from "../types.js";

const NUMERIC_LITERAL = /^-?\d+(?:\.\d+)?$/;

function findCurrencyCodes(code: string): readonly string[] {
  const re = /\bcurrency\s*[:=]\s*["'`]([A-Za-z]{3})["'`]/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[1] !== undefined) out.add(m[1].toUpperCase());
  }
  return [...out];
}

export const amountInRupeesNotPaise: Rule = {
  id: asRuleId("RZP003"),
  title: "Amount looks like rupees, not paise",
  severity: Severity.Warning,
  concern: Concern.AmountHandling,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const codes = findCurrencyCodes(ctx.stripped);
      if (!codes.includes("INR")) return [];
      const hits: DetectorHit[] = [];
      const re = /\bamount\s*[:=]\s*([0-9]+(?:\.\d+)?)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ctx.stripped)) !== null) {
        const literal = m[1] ?? "";
        if (!NUMERIC_LITERAL.test(literal)) continue;
        const value = Number.parseFloat(literal);
        if (!Number.isFinite(value)) continue;
        if (value < 1 || value > 9999) continue;
        // Suppress if a *100 multiplier is anywhere in proximity (±120 chars).
        const start = Math.max(0, m.index - 120);
        const window = ctx.stripped.slice(start, m.index + 200);
        if (/\*\s*100(?!\d)/.test(window)) continue;
        if (/in\s*paise|paise\b/i.test(window)) continue;
        const line = lineOf(ctx.code, m.index);
        hits.push({ line, column: 1, snippet: m[0] });
      }
      return hits;
    },
  },
  citation: {
    route: "api/orders/create",
    excerpt:
      "All Razorpay amounts are in the smallest currency unit. ₹100 must be sent as `10000`, not `100`.",
  },
  fix: {
    explanation:
      "Razorpay expects amounts in the smallest unit (paise for INR). A ₹100 order is `amount: 10000`. Multiply rupee values by 100 before sending.",
    correctPattern: `const amountInPaise = Math.round(rupees * 100);
await razorpay.orders.create({ amount: amountInPaise, currency: 'INR' });`,
  },
};

export const orderPaymentCurrencyMismatch: Rule = {
  id: asRuleId("RZP012"),
  title: "Order and payment have different currencies",
  severity: Severity.Error,
  concern: Concern.Currency,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const codes = findCurrencyCodes(ctx.stripped);
      if (codes.length < 2) return [];
      // Hit on the *first* currency declaration so the line is meaningful.
      const re = /\bcurrency\s*[:=]\s*["'`]([A-Za-z]{3})["'`]/;
      const m = re.exec(ctx.stripped);
      if (m === null) return [];
      const line = lineOf(ctx.code, m.index);
      return [
        {
          line,
          column: 1,
          snippet: `currencies present: ${codes.join(", ")}`,
        },
      ];
    },
  },
  citation: {
    route: "api/orders",
    excerpt:
      "The currency on a payment must match the currency of its parent order; otherwise the capture will reject.",
  },
  fix: {
    explanation:
      "Pass the same `currency` to both orders.create and any subsequent payment/refund call. Mixed currencies cause downstream capture failures and reconciliation drift.",
    correctPattern: `const currency = 'INR';
const order = await razorpay.orders.create({ amount, currency });
// ... later
await razorpay.payments.fetch(paymentId); // currency already locked to the order`,
  },
};

export const currencyCodeNotUppercase: Rule = {
  id: asRuleId("RZP022"),
  title: "Currency code is not uppercase ISO 4217",
  severity: Severity.Warning,
  concern: Concern.Currency,
  languages: ["*"],
  detector: {
    kind: "regex",
    pattern: /\bcurrency\s*[:=]\s*["'`]([a-z]{3})["'`]/,
  },
  citation: {
    route: "api",
    excerpt: "Currency codes follow ISO 4217 — three uppercase letters (e.g., INR, USD).",
  },
  fix: {
    explanation:
      "The Razorpay API accepts and expects uppercase ISO 4217 codes. Lowercase values are silently coerced in some SDKs and rejected in others — keep them uppercase to be safe.",
    correctPattern: `currency: 'INR' // not 'inr'`,
  },
};

function lineOf(code: string, offset: number): number {
  let line = 1;
  for (let j = 0; j < offset && j < code.length; j += 1) {
    if (code[j] === "\n") line += 1;
  }
  return line;
}

export const amountRules: readonly Rule[] = [
  amountInRupeesNotPaise,
  orderPaymentCurrencyMismatch,
  currencyCodeNotUppercase,
];
