/**
 * Key safety rules — protect API keys from leakage and environment confusion.
 *
 * RZP005 — Hardcoded live API key (rzp_live_…)
 * RZP006 — Hardcoded test API key (rzp_test_…) — info-level, often intentional
 * RZP019 — Test key paired with `NODE_ENV === 'production'`
 * RZP023 — `key_secret` referenced in client-side / browser code
 */

import { asRuleId, Concern, Severity, type DetectorHit, type Rule } from "../types.js";

export const hardcodedLiveKey: Rule = {
  id: asRuleId("RZP005"),
  title: "Hardcoded live API key",
  severity: Severity.Error,
  concern: Concern.KeySafety,
  languages: ["*"],
  detector: {
    kind: "regex",
    pattern: /\brzp_live_[A-Za-z0-9]{14,}\b/,
  },
  citation: {
    route: "payments/dashboard/account-settings/api-keys",
    excerpt: "Live keys must never be committed; rotate immediately if exposed.",
  },
  fix: {
    explanation:
      "Live keys grant production write access. Move them to environment variables and rotate any key that has touched source control.",
    correctPattern: `const razorpay = new Razorpay({
  key_id: process.env.RZP_KEY_ID,
  key_secret: process.env.RZP_KEY_SECRET,
});`,
  },
};

export const hardcodedTestKey: Rule = {
  id: asRuleId("RZP006"),
  title: "Hardcoded test API key",
  severity: Severity.Info,
  concern: Concern.KeySafety,
  languages: ["*"],
  detector: {
    kind: "regex",
    pattern: /\brzp_test_[A-Za-z0-9]{14,}\b/,
  },
  citation: {
    route: "payments/dashboard/account-settings/api-keys",
    excerpt: "Even test keys leak account routing info; prefer env vars in shared code.",
  },
  fix: {
    explanation:
      "Test keys are lower-risk than live, but still account-scoped. For shared repos, read them from env so you can rotate without a code change.",
    correctPattern: `const razorpay = new Razorpay({
  key_id: process.env.RZP_KEY_ID,
  key_secret: process.env.RZP_KEY_SECRET,
});`,
  },
};

export const testKeyInProductionEnv: Rule = {
  id: asRuleId("RZP019"),
  title: "Test API key paired with production env detection",
  severity: Severity.Error,
  concern: Concern.KeySafety,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      const hasTestKey = /\brzp_test_[A-Za-z0-9]{8,}/.test(code);
      const prodGuard =
        /(?:NODE_ENV\s*[!=]==?\s*["'`]production["'`])|(?:["'`]production["'`]\s*[!=]==?\s*[\w.]*?NODE_ENV)|(?:env\s*\(\s*["']APP_ENV["']\s*\)\s*[!=]==?\s*["']production["'])|(?:RAILS_ENV\s*[!=]==?\s*["']production["'])|(?:os\.environ.{0,40}["']production["'])/i;
      if (!hasTestKey || !prodGuard.test(code)) return [];
      const m = /\brzp_test_[A-Za-z0-9]{8,}/.exec(code);
      if (m === null) return [];
      return [
        {
          line: lineOf(ctx.code, m.index),
          column: 1,
          snippet: "rzp_test_* alongside production-env guard",
        },
      ];
    },
  },
  citation: {
    route: "payments/dashboard",
    excerpt:
      "Production code must use live (`rzp_live_…`) credentials; test keys won't capture real money.",
  },
  fix: {
    explanation:
      "Wiring a test key into a production-only branch silently breaks payments in production. Pick credentials by environment, not by string match.",
    correctPattern: `const isProd = process.env.NODE_ENV === 'production';
const keyId  = isProd ? process.env.RZP_LIVE_KEY_ID  : process.env.RZP_TEST_KEY_ID;
const secret = isProd ? process.env.RZP_LIVE_SECRET : process.env.RZP_TEST_SECRET;`,
  },
};

export const keySecretInClientCode: Rule = {
  id: asRuleId("RZP023"),
  title: "key_secret referenced in client-side code",
  severity: Severity.Error,
  concern: Concern.KeySafety,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const code = ctx.stripped;
      const browsery =
        /\b(?:window\.|document\.|<script\b|useState\b|useEffect\b|React\.|export\s+default\s+function\s+\w+\s*\(\s*\)\s*\{[\s\S]{0,120}?return\s*<|"use client"|'use client'|new\s+RazorpayCheckout)\b/.test(
          code,
        );
      if (!browsery) return [];
      const re = /\b(?:key_secret|RZP_KEY_SECRET|razorpay_secret|secret_key)\b/g;
      const hits: DetectorHit[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        hits.push({ line: lineOf(ctx.code, m.index), column: 1, snippet: m[0] });
      }
      return hits;
    },
  },
  citation: {
    route: "payments/dashboard/account-settings/api-keys",
    excerpt: "`key_secret` must remain server-side; the browser only ever sees `key_id`.",
  },
  fix: {
    explanation:
      "Anything bundled to the browser is public. Sign the order/payment server-side, ship only `key_id` to the client, and let the checkout SDK do the rest.",
    correctPattern: `// server: returns { keyId: process.env.RZP_KEY_ID, orderId } to the client
// client:
new Razorpay({ key: keyId, order_id: orderId, /* no secret */ });`,
  },
};

function lineOf(code: string, offset: number): number {
  let line = 1;
  for (let j = 0; j < offset && j < code.length; j += 1) {
    if (code[j] === "\n") line += 1;
  }
  return line;
}

export const keySafetyRules: readonly Rule[] = [
  hardcodedLiveKey,
  hardcodedTestKey,
  testKeyInProductionEnv,
  keySecretInClientCode,
];
