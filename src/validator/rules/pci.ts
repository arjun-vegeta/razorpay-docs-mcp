/**
 * PCI compliance rules — never store the cardholder's CVV; never persist
 * full PAN. Both are PCI-DSS violations and put the merchant on the hook.
 *
 * RZP009 — CVV stored server-side
 * RZP010 — Full PAN stored server-side
 */

import { asRuleId, Concern, Severity, type DetectorHit, type Rule } from "../types.js";

const CVV_NAMES = /\b(cvv|cvc|card_code|cardCvv|cardCode|card_security_code)\b/i;

// Deliberately narrow: matches DB writes and log emitters, but NOT bare
// `create` (which catches `razorpay.tokens.create({ cvv })` — that's
// tokenization, not server-side storage).
const PERSIST_VERBS =
  /(?:\b(?:save|insert|update|store|persist|writeFile|appendFile)\b|\bconsole\.(?:log|info|warn|error|debug)\b|\bdb\.[a-z_]+\.(?:save|insert|update|create|upsert)\b|\bprisma\.[a-z_]+\.(?:create|update|upsert)\b|\blogger\.(?:log|info|warn|error|debug)\b)/i;

export const cvvStoredServerSide: Rule = {
  id: asRuleId("RZP009"),
  title: "CVV being stored or logged server-side",
  severity: Severity.Error,
  concern: Concern.PciCompliance,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const hits: DetectorHit[] = [];
      const lines = ctx.lines;
      const stripped = ctx.stripped.split(/\r?\n/);
      for (let i = 0; i < stripped.length; i += 1) {
        const line = stripped[i] ?? "";
        if (!CVV_NAMES.test(line)) continue;
        if (PERSIST_VERBS.test(line)) {
          hits.push({ line: i + 1, column: 1, snippet: (lines[i] ?? "").trim() });
        }
      }
      return hits;
    },
  },
  citation: {
    route: "security/checklist",
    excerpt: "PCI-DSS prohibits storing or logging the card's CVV/CVC under any circumstance.",
  },
  fix: {
    explanation:
      "CVV must only be passed to Razorpay (or your gateway) at the moment of authorization. Never save it, never write it to logs, never include it in an exception trace.",
    correctPattern: `// pass to checkout / tokenize via Razorpay; do not persist
const { token } = await razorpay.tokens.create({ /* card data, including cvv */ });
// store only \`token.id\` server-side`,
  },
};

export const panStoredServerSide: Rule = {
  id: asRuleId("RZP010"),
  title: "Full PAN being stored or logged server-side",
  severity: Severity.Error,
  concern: Concern.PciCompliance,
  languages: ["*"],
  detector: {
    kind: "heuristic",
    fn: (ctx): readonly DetectorHit[] => {
      const hits: DetectorHit[] = [];
      const stripped = ctx.stripped.split(/\r?\n/);
      const lines = ctx.lines;
      const panLiteral = /\b(?:4\d{15}|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12})\b/;
      const panName = /\b(card_?number|pan|full_card|cardNumber|card_no)\b/i;
      for (let i = 0; i < stripped.length; i += 1) {
        const line = stripped[i] ?? "";
        if (panLiteral.test(line) || (panName.test(line) && PERSIST_VERBS.test(line))) {
          hits.push({ line: i + 1, column: 1, snippet: (lines[i] ?? "").trim() });
        }
      }
      return hits;
    },
  },
  citation: {
    route: "security/checklist",
    excerpt:
      "Full PANs may not be stored unencrypted. Use Razorpay tokenization and persist only the token reference.",
  },
  fix: {
    explanation:
      "Storing PANs (or even logging them) puts you in PCI-DSS Level 1 scope. Tokenize once via Razorpay and reference the token thereafter; the PAN never lands in your systems.",
    correctPattern: `// Razorpay returns a token id you can store and re-charge against
const token = await razorpay.tokens.create({ /* card payload */ });
db.cards.insert({ user_id, token_id: token.id }); // no PAN`,
  },
};

export const pciRules: readonly Rule[] = [cvvStoredServerSide, panStoredServerSide];
