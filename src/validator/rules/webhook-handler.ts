/**
 * Webhook handler rules.
 *
 * RZP011 — Webhook URL configured on a non-standard port (must be 80 or 443)
 * RZP020 — Webhook handler returns a 4xx/5xx in the success path → triggers
 *          unnecessary retry storms
 */

import { asRuleId, Concern, Severity, type DetectorHit, type Rule } from "../types.js";

export const webhookUrlNonStandardPort: Rule = {
  id: asRuleId("RZP011"),
  title: "Webhook URL uses a non-standard port",
  severity: Severity.Warning,
  concern: Concern.WebhookHandler,
  languages: ["*"],
  detector: {
    kind: "regex",
    pattern:
      /https?:\/\/[A-Za-z0-9.-]+:(?!80\b|443\b)(\d{2,5})\/[A-Za-z0-9._~/?%#=&-]*(?:webhook|hooks?|notify|payment|callback)\b[A-Za-z0-9._~/?%#=&-]*/i,
  },
  citation: {
    route: "webhooks/setup-edit-payments",
    excerpt:
      "Razorpay only delivers webhooks to ports 80 (http) and 443 (https). Custom ports are silently dropped.",
  },
  fix: {
    explanation:
      "Razorpay's outbound webhook caller refuses non-standard ports — your endpoint will never be hit. Front the handler with a load balancer or reverse proxy on 443.",
    correctPattern: `// public URL must be on 443 (or 80 plaintext)
https://api.example.com/razorpay/webhook`,
  },
};

export const webhookHandlerReturnsNon2xxOnSuccess: Rule = {
  id: asRuleId("RZP020"),
  title: "Webhook handler returns 4xx/5xx in the success path",
  severity: Severity.Warning,
  concern: Concern.WebhookHandler,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      // Only look at code that is clearly a webhook handler.
      const handlerSignal =
        /(x-razorpay-signature|razorpay-signature|payment\.captured|order\.paid|webhook(?:_event)?|verifyWebhookSignature)/i;
      if (!handlerSignal.test(code)) return [];
      const hits: DetectorHit[] = [];
      const re =
        /\b(?:res\.status\(\s*(?:[45]\d\d)\s*\)\s*\.(?:send|json|end)|return\s+(?:status\s*\(\s*[45]\d\d\)|HttpResponse\(\s*status\s*=\s*[45]\d\d|new\s+ResponseEntity\(\s*HttpStatus\.[A-Z_]+\b))/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        // Suppress when the surrounding line indicates an explicit error/invalid branch.
        const lineStart = code.lastIndexOf("\n", m.index) + 1;
        const lineEnd = code.indexOf("\n", m.index);
        const line = code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd);
        if (/(?:invalid|fail|error|unauthorized|forbidden|signature|verify|verification)/i.test(line)) {
          continue;
        }
        // Also suppress if an explicit `if (!sigValid)` style branch is on the previous line.
        const prevStart = code.lastIndexOf("\n", lineStart - 2) + 1;
        const prevLine = code.slice(prevStart, lineStart);
        if (/if\s*\(\s*!|verify|signature/i.test(prevLine)) continue;
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
    route: "webhooks/best-practices",
    excerpt:
      "Acknowledge with a 2xx as soon as you've received the event; non-2xx triggers retries that compound load.",
  },
  fix: {
    explanation:
      "Razorpay treats any non-2xx as a delivery failure and retries with exponential backoff. Always 200/204 once the event is accepted; do downstream work asynchronously.",
    correctPattern: `// 1. verify signature
// 2. enqueue job
// 3. ack
return res.status(200).end();`,
  },
};

function lineOf(code: string, offset: number): number {
  let line = 1;
  for (let j = 0; j < offset && j < code.length; j += 1) {
    if (code[j] === "\n") line += 1;
  }
  return line;
}

export const webhookHandlerRules: readonly Rule[] = [
  webhookUrlNonStandardPort,
  webhookHandlerReturnsNon2xxOnSuccess,
];
