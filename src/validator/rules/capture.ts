/**
 * Capture-flow rules.
 *
 * RZP007 — `payment_capture: 0` (manual capture mode) without a follow-up
 *          capture call → payment auto-voids after the cutoff
 * RZP026 — Capture invoked past the 5-day auto-void window
 */

import { asRuleId, Concern, Severity, type DetectorHit, type Rule } from "../types.js";

export const manualCaptureWithoutFollowup: Rule = {
  id: asRuleId("RZP007"),
  title: "`payment_capture: 0` without a follow-up capture call",
  severity: Severity.Warning,
  concern: Concern.Capture,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      const re = /\bpayment_capture\s*[:=]\s*(?:0|false|"0"|'0')/g;
      let m: RegExpExecArray | null;
      const hits: DetectorHit[] = [];
      while ((m = re.exec(code)) !== null) {
        // Suppress if any subsequent capture call exists in the same code.
        const after = code.slice(m.index);
        if (/\b(?:payments?\.capture|payment\.capture|capturePayment|capture_payment|\.capture\s*\()\b/.test(
          after,
        )) {
          continue;
        }
        hits.push({ line: lineOf(ctx.code, m.index), column: 1, snippet: m[0] });
      }
      return hits;
    },
  },
  citation: {
    route: "api/payments/capture",
    excerpt:
      "When `payment_capture` is 0 the payment is only authorized — you must call capture explicitly within the auto-void window.",
  },
  fix: {
    explanation:
      "Setting `payment_capture: 0` puts the payment in 'authorized' state. Without an explicit capture call within 5 days the funds are released back to the customer.",
    correctPattern: `// Either auto-capture:
await razorpay.orders.create({ amount, currency, payment_capture: 1 });
// Or manual capture, with a follow-up:
await razorpay.payments.capture(paymentId, amount, currency);`,
  },
};

export const lateCaptureWindow: Rule = {
  id: asRuleId("RZP026"),
  title: "Capture scheduled past the 5-day auto-void window",
  severity: Severity.Warning,
  concern: Concern.Capture,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      const captureCall =
        /\b(?:payments?\.capture|payment\.capture|capturePayment|capture_payment|\.capture\s*\()/;
      if (!captureCall.test(code)) return [];

      const hits: DetectorHit[] = [];
      const longDelays: readonly RegExp[] = [
        // setTimeout(..., N * 24 * 60 * 60 * 1000) where N >= 5
        /setTimeout\s*\([\s\S]{0,200}?\b([5-9]|[1-9]\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/g,
        // explicit "5 days" / "7 days" mentions in capture context
        /\b([5-9]|[1-9]\d+)\s*(?:d|day|days)\b/g,
        // Date.now() - <large-ms> > 5*24*60*60*1000
        /Date\.now\s*\(\s*\)\s*-[\s\S]{0,100}?\b([5-9]|[1-9]\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/g,
      ];
      for (const re of longDelays) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null) {
          // Only fire if the match is in the same window as a capture call (±400 chars).
          const start = Math.max(0, m.index - 400);
          const window = code.slice(start, m.index + 400);
          if (!captureCall.test(window)) continue;
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
    route: "payments/payments/late-authorisation",
    excerpt:
      "Payments auto-void after 5 days. Capturing past that window requires the late-authorization flow.",
  },
  fix: {
    explanation:
      "If you must capture later, enable late-authorization on your account. Otherwise, capture within 5 days of authorize — preferably immediately on payment.captured webhook.",
    correctPattern: `// On payment.authorized webhook, capture within minutes:
await razorpay.payments.capture(paymentId, amount, currency);`,
  },
};

function lineOf(code: string, offset: number): number {
  let line = 1;
  for (let j = 0; j < offset && j < code.length; j += 1) {
    if (code[j] === "\n") line += 1;
  }
  return line;
}

export const captureRules: readonly Rule[] = [
  manualCaptureWithoutFollowup,
  lateCaptureWindow,
];
