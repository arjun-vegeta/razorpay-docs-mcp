/**
 * Idempotency rules.
 *
 * RZP008 — refunds.create without an Idempotency-Key header
 * RZP021 — Webhook handler doesn't dedup repeat events by event.id
 */

import { asRuleId, Concern, Severity, type DetectorHit, type Rule } from "../types.js";

const REFUND_CREATE = /\b(?:refunds?\.create|refund\.create|create_refund|createRefund|payments?\.refund|payment_id\.refund)\s*\(/g;

export const refundMissingIdempotencyKey: Rule = {
  id: asRuleId("RZP008"),
  title: "Refund created without an Idempotency-Key header",
  severity: Severity.Warning,
  concern: Concern.Idempotency,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const hits: DetectorHit[] = [];
      const code = ctx.stripped;
      const re = new RegExp(REFUND_CREATE.source, REFUND_CREATE.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        // Look ±300 chars for an idempotency hint.
        const start = Math.max(0, m.index - 300);
        const window = code.slice(start, m.index + 300);
        if (/Idempotency[-_]?Key|X[-_]?Razorpay[-_]?Idempotency|setIdempotencyKey/i.test(window)) {
          continue;
        }
        hits.push({
          line: lineOf(ctx.code, m.index),
          column: 1,
          snippet: m[0],
        });
      }
      return hits;
    },
  },
  citation: {
    route: "api/refunds/normal-refunds-idempotent",
    excerpt:
      "Pass `Idempotency-Key` so a retried request doesn't issue two refunds for the same payment.",
  },
  fix: {
    explanation:
      "Refunds are not naturally idempotent. Without a key, a network retry can refund twice. Generate a per-attempt UUID and send it as `Idempotency-Key`.",
    correctPattern: `await razorpay.payments.refund(paymentId, {
  amount,
  notes,
}, { headers: { 'Idempotency-Key': crypto.randomUUID() } });`,
  },
};

export const webhookHandlerNotIdempotent: Rule = {
  id: asRuleId("RZP021"),
  title: "Webhook handler does not dedupe repeat events",
  severity: Severity.Warning,
  concern: Concern.Idempotency,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      // Only consider code that actually looks like a webhook handler.
      const signaled =
        /(x-razorpay-signature|razorpay-signature|webhook(?:_event|Event)?|payment\.captured|order\.paid|invoice\.paid)/i.test(
          code,
        );
      if (!signaled) return [];
      // If the code references event.id / id-based dedup / a seen/processed table, suppress.
      if (
        /\b(?:event\.id|payload\.payment\.entity\.id|event_id|webhook_id)\b[\s\S]{0,200}?\b(?:exists|seen|processed|insertOne|insertIfMissing|insertIgnore|insertIgnoring|find|findOne|select|cache|redis|memcache|getSet|setnx|on conflict)/i.test(
          code,
        )
      ) {
        return [];
      }
      if (/\b(?:processedEvents|seenEvents|alreadyProcessed|isDuplicate|insertIfMissing)\b/.test(code)) {
        return [];
      }
      // Find the handler entry-point line as the report anchor.
      const entry = /\b(?:app\.(?:post|use)|router\.post|@app\.route|def\s+\w*webhook|function\s+\w*webhook|public\s+\w+\s+handle\w*Webhook)/i.exec(
        code,
      );
      if (entry === null) return [];
      return [
        {
          line: lineOf(ctx.code, entry.index),
          column: 1,
          snippet: "webhook handler with no event.id dedup logic",
        },
      ];
    },
  },
  citation: {
    route: "webhooks/best-practices",
    excerpt: "Razorpay re-delivers webhook events; your handler must be idempotent on event id.",
  },
  fix: {
    explanation:
      "Razorpay retries webhook deliveries until it gets a 2xx, and may deliver duplicates. Persist each `event.id` after first processing and short-circuit subsequent deliveries of the same id.",
    correctPattern: `// reject duplicates before doing the work
const inserted = await db.events.insertIfMissing({ event_id: event.id });
if (!inserted) return res.status(200).end(); // already handled
// ... process event ...`,
  },
};

function lineOf(code: string, offset: number): number {
  let line = 1;
  for (let j = 0; j < offset && j < code.length; j += 1) {
    if (code[j] === "\n") line += 1;
  }
  return line;
}

export const idempotencyRules: readonly Rule[] = [
  refundMissingIdempotencyKey,
  webhookHandlerNotIdempotent,
];
