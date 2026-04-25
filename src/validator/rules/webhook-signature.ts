/**
 * Webhook signature rules — the highest-impact group. A bad signature check
 * lets attackers forge events; a wrong concat order breaks legit traffic.
 *
 * RZP001 — HMAC on JSON-stringified body (must hash raw bytes)
 * RZP002 — Comparing signature with `==`/`===` (use timingSafeEqual)
 * RZP016 — Wrong order of params when verifying payment signature
 * RZP028 — Reading webhook secret from request instead of secure storage
 */

import { asRuleId, Concern, Severity, type DetectorHit, type Rule } from "../types.js";

export const webhookHmacOnStringifiedBody: Rule = {
  id: asRuleId("RZP001"),
  title: "Webhook signature computed over JSON.stringify(req.body)",
  severity: Severity.Error,
  concern: Concern.WebhookSignature,
  languages: ["*"],
  detector: {
    kind: "regex",
    pattern:
      /(?:createHmac|hash_hmac|HmacSHA256|new\s+Mac|hmac\.new)[\s\S]{0,200}?(?:JSON\.stringify\s*\(\s*(?:req\.body|request\.body|body|payload)|json_encode\s*\(\s*\$_(?:POST|REQUEST))/,
  },
  citation: {
    route: "webhooks/validate-test",
    excerpt:
      "Compute the HMAC over the raw request body bytes, not over a re-serialized JSON object.",
  },
  fix: {
    explanation:
      "Razorpay signs the exact bytes it sent. JSON.stringify produces a different byte sequence (key order, whitespace), so the HMAC will never match. Capture the raw body before any JSON parser runs.",
    correctPattern: `// Express: express.raw({ type: 'application/json' })
const expected = crypto
  .createHmac('sha256', process.env.RZP_WEBHOOK_SECRET)
  .update(req.rawBody) // raw bytes, not JSON.stringify(req.body)
  .digest('hex');`,
  },
};

export const webhookSignatureNonTimingSafe: Rule = {
  id: asRuleId("RZP002"),
  title: "Webhook signature compared with `==`/`===` instead of timing-safe equal",
  severity: Severity.Error,
  concern: Concern.WebhookSignature,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      // Only fire when the code is clearly doing HMAC signature work.
      const hmacy = /(createHmac|hash_hmac|HmacSHA256|hmac\.new|new\s+Mac)/.test(code);
      if (!hmacy) return [];
      // Suppress if a timing-safe primitive is present.
      if (/(timingSafeEqual|hash_equals|MessageDigest\.isEqual|hmac\.compare_digest)/.test(code)) {
        return [];
      }
      const re = /^(.*?\b(?:signature|expected|digest|hmac|computed|hash)\b.*?(===|==)\s*[A-Za-z_$].*)$/gim;
      const hits: DetectorHit[] = [];
      const lines = ctx.lines;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (re.test(line)) {
          hits.push({ line: i + 1, column: 1, snippet: line.trim() });
        }
        re.lastIndex = 0;
      }
      return hits;
    },
  },
  citation: {
    route: "webhooks/validate-test",
    excerpt: "Use a constant-time comparison so an attacker cannot learn the secret from timing.",
  },
  fix: {
    explanation:
      "String equality short-circuits on the first mismatched byte, leaking signature timing. Use the language's constant-time primitive.",
    correctPattern: `const sigBuf = Buffer.from(req.headers['x-razorpay-signature'] ?? '', 'hex');
const expBuf = Buffer.from(expected, 'hex');
if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
  return res.status(400).end();
}`,
  },
};

export const paymentSignatureWrongOrder: Rule = {
  id: asRuleId("RZP016"),
  title: "Payment signature concatenation in the wrong order",
  severity: Severity.Error,
  concern: Concern.WebhookSignature,
  languages: ["*"],
  detector: {
    kind: "regex",
    // canonical: `${razorpay_order_id}|${razorpay_payment_id}`
    // wrong:     `${razorpay_payment_id}|${razorpay_order_id}`  (or string-concat equivalents)
    pattern:
      /(?:razorpay_)?payment_id[^|"'`]{0,40}["'`|+\s.${},]+(?:razorpay_)?order_id/i,
  },
  citation: {
    route: "webhooks/validate-test",
    excerpt: "Sign `${razorpay_order_id}|${razorpay_payment_id}` — order id first.",
  },
  fix: {
    explanation:
      "Razorpay's signature contract is `order_id|payment_id`. Reversing the parts produces a different HMAC, so the verification fails (or worse, succeeds on adversary-controlled inputs).",
    correctPattern: `const body = razorpay_order_id + "|" + razorpay_payment_id;
const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');`,
  },
};

export const webhookSecretFromRequest: Rule = {
  id: asRuleId("RZP028"),
  title: "Webhook secret read from request input",
  severity: Severity.Error,
  concern: Concern.WebhookSignature,
  languages: ["*"],
  detector: {
    kind: "regex",
    pattern:
      /\b(?:secret|webhook_secret|webhookSecret)\s*[:=]\s*(?:req\.headers|req\.query|req\.body|request\.headers|request\.query|request\.json|request\.args|\$_(?:GET|POST|REQUEST|HEADERS))/i,
  },
  citation: {
    route: "webhooks/setup-edit-payments",
    excerpt:
      "Store the webhook secret as a server-side environment variable; never accept it from the request.",
  },
  fix: {
    explanation:
      "Reading the secret from the incoming request defeats the entire signature mechanism — the caller can supply any secret and pass verification.",
    correctPattern: `const secret = process.env.RZP_WEBHOOK_SECRET; // configured once, server-side`,
  },
};

export const webhookSignatureRules: readonly Rule[] = [
  webhookHmacOnStringifiedBody,
  webhookSignatureNonTimingSafe,
  paymentSignatureWrongOrder,
  webhookSecretFromRequest,
];
