/**
 * Method-specific rules — subscriptions, UPI, Payment Links, partners, refunds,
 * SDK versioning. Grouped together because each is small and shares the
 * "find this method shape, check for an adjacent field" structure.
 *
 * RZP013 — subscriptions.create with `addons` but no validation
 * RZP014 — UPI intent without `callback_url`
 * RZP015 — Payment Link created without `expire_by`
 * RZP017 — `notes.<key>` value exceeds the 256-char limit
 * RZP024 — Partner integration code missing `X-Razorpay-Account` header
 * RZP025 — Recurring auth amount above the ₹15000 RBI cap with preferred recurring
 * RZP027 — Refund created without a `speed` parameter
 * RZP030 — Outdated Razorpay SDK declared in package.json
 */

import { asRuleId, Concern, Severity, type DetectorHit, type Rule } from "../types.js";

const SUBSCRIPTIONS_CREATE = /\bsubscriptions?\.create\s*\(/g;
const PAYMENT_LINKS_CREATE = /\b(?:paymentLink|paymentLinks|payment_links|payment_link)\.create\s*\(/g;
const REFUND_CALL = /\b(?:refunds?\.create|payments?\.refund|createRefund|create_refund)\s*\(/g;

export const subscriptionAddonsNoValidation: Rule = {
  id: asRuleId("RZP013"),
  title: "Subscription created with `addons` but no validation",
  severity: Severity.Warning,
  concern: Concern.PaymentMethods,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      const hits: DetectorHit[] = [];
      const re = new RegExp(SUBSCRIPTIONS_CREATE.source, SUBSCRIPTIONS_CREATE.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const window = code.slice(m.index, m.index + 600);
        if (!/\baddons\s*[:=]/i.test(window)) continue;
        // Validation hints: presence of any common validation idiom in the same window.
        if (/(?:zod\.|\.parse\(|joi\.|Joi\.|validate|schema\.|assert|isInteger|isFinite|typeof\s+\w+\s*===|in_array|array_key_exists)/i.test(window)) {
          continue;
        }
        hits.push({ line: lineOf(ctx.code, m.index), column: 1, snippet: m[0] });
      }
      return hits;
    },
  },
  citation: {
    route: "payments/subscriptions",
    excerpt:
      "Validate addon shape (item.amount, item.currency, quantity) before passing to subscriptions.create — the API will 400 on malformed entries.",
  },
  fix: {
    explanation:
      "Razorpay rejects ill-formed addons with 400, but the failure path is awkward to recover from after collecting customer payment intent. Validate at the boundary.",
    correctPattern: `const addons = AddonSchema.array().parse(rawAddons);
await razorpay.subscriptions.create({ plan_id, addons, total_count });`,
  },
};

export const upiIntentNoCallbackUrl: Rule = {
  id: asRuleId("RZP014"),
  title: "UPI intent payment without callback_url",
  severity: Severity.Warning,
  concern: Concern.PaymentMethods,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      // Must mention UPI intent flow.
      if (!/\b(?:method\s*[:=]\s*['"`]upi['"`]|"flow"\s*:\s*"intent"|flow\s*[:=]\s*['"`]intent['"`])/i.test(code)) {
        return [];
      }
      if (/\bcallback_url\b/i.test(code)) return [];
      const m = /\b(?:method\s*[:=]\s*['"`]upi['"`]|flow\s*[:=]\s*['"`]intent['"`])/i.exec(code);
      if (m === null) return [];
      return [
        {
          line: lineOf(ctx.code, m.index),
          column: 1,
          snippet: "UPI intent flow without callback_url",
        },
      ];
    },
  },
  citation: {
    route: "payments/payment-methods/upi",
    excerpt:
      "UPI intent flow needs `callback_url` so the PSP app returns control to your page after authorization.",
  },
  fix: {
    explanation:
      "Without `callback_url` the user is stranded in their UPI app after paying — your code never learns the outcome and the user thinks the merchant lost the transaction.",
    correctPattern: `await razorpay.payments.create({
  method: 'upi', flow: 'intent',
  callback_url: 'https://example.com/orders/' + orderId + '/return',
});`,
  },
};

export const paymentLinkNoExpireBy: Rule = {
  id: asRuleId("RZP015"),
  title: "Payment Link created without expire_by",
  severity: Severity.Warning,
  concern: Concern.PaymentMethods,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      const hits: DetectorHit[] = [];
      const re = new RegExp(PAYMENT_LINKS_CREATE.source, PAYMENT_LINKS_CREATE.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const window = code.slice(m.index, m.index + 700);
        if (/\bexpire_by\b/.test(window)) continue;
        hits.push({ line: lineOf(ctx.code, m.index), column: 1, snippet: m[0] });
      }
      return hits;
    },
  },
  citation: {
    route: "api/payments/payment-links/create-standard",
    excerpt:
      "Pass `expire_by` (Unix epoch seconds) so abandoned links can't be paid days later, after price/inventory has changed.",
  },
  fix: {
    explanation:
      "Open-ended Payment Links are a foot-gun: a customer can pay a stale link and force you to refund. Set `expire_by` to a sensible TTL (e.g., 24h).",
    correctPattern: `await razorpay.paymentLink.create({
  amount, currency: 'INR',
  expire_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
});`,
  },
};

export const notesValueTooLong: Rule = {
  id: asRuleId("RZP017"),
  title: "`notes` value exceeds the 256-character limit",
  severity: Severity.Warning,
  concern: Concern.OrderFlow,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      // Match `notes: { ... }` and inspect string values.
      const hits: DetectorHit[] = [];
      const notesIdx = /\bnotes\s*[:=]\s*\{/g;
      let m: RegExpExecArray | null;
      while ((m = notesIdx.exec(code)) !== null) {
        const start = m.index + m[0].length;
        const close = matchClosingBrace(code, start - 1);
        if (close === -1) continue;
        const body = code.slice(start, close);
        const valRe = /["'`]([^"'`]{257,})["'`]/g;
        let vm: RegExpExecArray | null;
        while ((vm = valRe.exec(body)) !== null) {
          const offsetInCode = start + vm.index;
          hits.push({
            line: lineOf(ctx.code, offsetInCode),
            column: 1,
            snippet: `notes value length ${(vm[1] ?? "").length} (>256)`,
          });
        }
      }
      return hits;
    },
  },
  citation: {
    route: "api/orders/create",
    section: "notes",
    excerpt: "Each value in `notes` is capped at 256 characters.",
  },
  fix: {
    explanation:
      "Razorpay rejects notes whose values exceed 256 characters. For longer payloads, store them in your DB and put just the reference id (or a short hash) in notes.",
    correctPattern: `notes: { internal_ref: 'order_42' } // short string; long context lives in your DB`,
  },
};

export const partnerMissingAccountHeader: Rule = {
  id: asRuleId("RZP024"),
  title: "Partner integration without `X-Razorpay-Account` header",
  severity: Severity.Warning,
  concern: Concern.PaymentMethods,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      // Must be partner-flavored code.
      // No trailing \b — accept camelCase suffixes (subMerchantId, partnerCode).
      if (!/\b(?:partner|sub_?merchant|linked[_\s-]?account|aggregator)/i.test(code)) return [];
      // Suppress if header is set anywhere.
      if (/X[-_]?Razorpay[-_]?Account/i.test(code)) return [];
      const m = /\b(?:partner|sub_?merchant|linked[_\s-]?account|aggregator)/i.exec(code);
      if (m === null) return [];
      return [
        {
          line: lineOf(ctx.code, m.index),
          column: 1,
          snippet: "partner integration with no X-Razorpay-Account header",
        },
      ];
    },
  },
  citation: {
    route: "partners",
    excerpt:
      "Partner-scoped requests must carry `X-Razorpay-Account: acc_<sub_merchant_id>` — otherwise the request runs on the partner's account.",
  },
  fix: {
    explanation:
      "Without `X-Razorpay-Account` the request operates on the partner account, not the submerchant. Money flows the wrong way and reconciliation breaks.",
    correctPattern: `await fetch('https://api.razorpay.com/v1/orders', {
  method: 'POST',
  headers: { 'X-Razorpay-Account': 'acc_' + subMerchantId, /* auth */ },
  body: JSON.stringify({ amount, currency: 'INR' }),
});`,
  },
};

export const recurringAuthAmountAboveCap: Rule = {
  id: asRuleId("RZP025"),
  title: "Recurring auth amount above ₹15000 with `recurring=preferred`",
  severity: Severity.Error,
  concern: Concern.PaymentMethods,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      if (!/\brecurring\s*[:=]\s*['"`]preferred['"`]/.test(code)) return [];
      const hits: DetectorHit[] = [];
      const re = /\bauth_?amount\s*[:=]\s*([0-9]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const value = Number.parseInt(m[1] ?? "0", 10);
        if (Number.isFinite(value) && value > 1500000) {
          hits.push({
            line: lineOf(ctx.code, m.index),
            column: 1,
            snippet: `auth_amount ${value} paise (>₹15000)`,
          });
        }
      }
      return hits;
    },
  },
  citation: {
    route: "announcements/rbi-card-mandate-guidelines/recurring-payments",
    excerpt:
      "RBI card-mandate guidelines cap the auth amount at ₹15,000. Use higher values only with explicit AFA flow.",
  },
  fix: {
    explanation:
      "RBI guidelines cap recurring auth at ₹15,000 (1500000 paise) without additional factor authentication. Higher amounts require the explicit AFA path.",
    correctPattern: `auth_amount: 100, // typical ₹1 token charge for mandate setup`,
  },
};

export const refundMissingSpeed: Rule = {
  id: asRuleId("RZP027"),
  title: "Refund created without a `speed` parameter",
  severity: Severity.Warning,
  concern: Concern.Idempotency,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      const hits: DetectorHit[] = [];
      const re = new RegExp(REFUND_CALL.source, REFUND_CALL.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const window = code.slice(m.index, m.index + 600);
        if (/\bspeed\s*[:=]\s*['"`](?:normal|optimum|instant)['"`]/.test(window)) continue;
        hits.push({ line: lineOf(ctx.code, m.index), column: 1, snippet: m[0] });
      }
      return hits;
    },
  },
  citation: {
    route: "api/refunds/create-instant",
    excerpt:
      "Specify `speed` ('normal', 'optimum', or 'instant') so the refund's settlement time is explicit.",
  },
  fix: {
    explanation:
      "Without `speed`, refund settlement falls back to 'normal' (5–7 days). Most consumer-facing flows want 'optimum' (fast where supported, normal otherwise) — pass it explicitly.",
    correctPattern: `await razorpay.payments.refund(paymentId, { amount, speed: 'optimum' });`,
  },
};

export const outdatedSdkVersion: Rule = {
  id: asRuleId("RZP030"),
  title: "Outdated Razorpay SDK declared in package.json",
  severity: Severity.Info,
  concern: Concern.KeySafety,
  languages: ["*"],
  detector: {
    kind: "regex",
    // Catches "razorpay": "^0.x.y" / "1.x.y" / "~1.x.y" — the current major is 2.x.
    pattern: /"razorpay"\s*:\s*"[\^~]?(?:0|1)\.\d+\.\d+(?:[-+][\w.]+)?"/,
  },
  citation: {
    route: "api/changelog",
    excerpt: "Upgrade to the latest major to get new payment method support and bug fixes.",
  },
  fix: {
    explanation:
      "The pinned Razorpay SDK is older than the current major. Upgrade to the latest major to get current API surface (UPI 2.0, recurring v3, latest webhook event shapes).",
    correctPattern: `"razorpay": "^2.9.0"`,
  },
};

function matchClosingBrace(code: string, openIdx: number): number {
  if (code[openIdx] !== "{") return -1;
  let depth = 0;
  for (let i = openIdx; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineOf(code: string, offset: number): number {
  let line = 1;
  for (let j = 0; j < offset && j < code.length; j += 1) {
    if (code[j] === "\n") line += 1;
  }
  return line;
}

export const methodsRules: readonly Rule[] = [
  subscriptionAddonsNoValidation,
  upiIntentNoCallbackUrl,
  paymentLinkNoExpireBy,
  notesValueTooLong,
  partnerMissingAccountHeader,
  recurringAuthAmountAboveCap,
  refundMissingSpeed,
  outdatedSdkVersion,
];
