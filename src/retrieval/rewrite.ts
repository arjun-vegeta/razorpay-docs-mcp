/**
 * Query rewrite + intent inference. Sits in front of BM25/vector retrieval to:
 *
 *   1. Tokenize, drop stopwords, normalize whitespace
 *   2. Expand domain synonyms via `synonyms.expandQuery` (Phase 2)
 *   3. Detect SDK language hints embedded in the natural-language query
 *   4. Detect Razorpay product hints
 *
 * Returns BOTH a free-text "cleaned" query (used to embed for vector search)
 * AND an FTS5-formatted query (used for BM25) — they're different transforms.
 */

import { Lang, normalizeLang } from "../util/lang.js";
import { expandQuery, type SynonymTable } from "../indexer/synonyms.js";
import { ProductSpec, TopicSpec, type ProductSpec as Product, type TopicSpec as Topic } from "./types.js";

interface RewriteResult {
  readonly raw: string;
  readonly cleaned: string;
  readonly fts5: string;
  readonly tokens: readonly string[];
  readonly expandedTerms: readonly string[];
  readonly detectedLanguage?: Lang;
  readonly detectedProduct?: Product;
  readonly detectedTopic?: Topic;
}

const LANG_HINTS: ReadonlyArray<readonly [RegExp, Lang]> = [
  [/\b(node\.?js|nodejs|node|express|fastify|nest)\b/i, Lang.Node],
  [/\b(typescript|ts)\b/i, Lang.Node],
  [/\b(python|django|flask|fastapi|pip)\b/i, Lang.Python],
  [/\b(php|laravel|symfony|composer)\b/i, Lang.Php],
  [/\b(java|spring|maven|gradle)\b/i, Lang.Java],
  [/\b(ruby|rails|gem|bundler)\b/i, Lang.Ruby],
  [/\b(go|golang)\b/i, Lang.Go],
  [/\b(\.net|dotnet|csharp|c#|nuget)\b/i, Lang.Dotnet],
  [/\b(kotlin|android)\b/i, Lang.Kotlin],
  [/\b(curl|http)\b/i, Lang.Curl],
];

const TOPIC_HINTS: ReadonlyArray<readonly [RegExp, Topic]> = [
  // Order matters: more specific patterns first
  [/\b(webhook|webhooks|callback)\b/i, TopicSpec.Webhooks],
  [/\b(test|sandbox|test mode|live mode)\b/i, TopicSpec.Testing],
  [/\b(error|failure|errcode|error code)\b/i, TopicSpec.Errors],
  [/\b(integration|integrate|setup|install)\b/i, TopicSpec.Integration],
  [/\b(security|whitelist|ssl|cert|signature)\b/i, TopicSpec.Security],
  // Cover both explicit "api" mentions and implicit API-style action verbs.
  // "create razorpayx payout" / "fetch a single order" / "list payments" all
  // want api/* routes — without this match they default to non-API siblings
  // that outrank by raw text density.
  [/\b(api|endpoint|entity|fetch|create|list|update|delete|cancel|capture|refund|request|response)\b/i, TopicSpec.Api],
];

const PRODUCT_HINTS: ReadonlyArray<readonly [RegExp, Product]> = [
  [/\b(razorpay-?x|rzp-?x|payouts?|disbursement|banking)\b/i, ProductSpec.X],
  [/\b(payroll|salary|payslip|employee)\b/i, ProductSpec.Payroll],
  [/\b(point of sale|smart pos|\bpos\b)\b/i, ProductSpec.Pos],
  [/\b(partner|submerchant|linked account)\b/i, ProductSpec.Partners],
  [/\b(magic checkout|1cc|one click)\b/i, ProductSpec.MagicCheckout],
  [/\b(subscription|recurring|mandate|autopay|e-?mandate|nach)\b/i, ProductSpec.Subscriptions],
  [/\b(payment(s)?|order|refund|capture|webhook|invoice)\b/i, ProductSpec.Payments],
];

const NOISE_PHRASES = [
  /\bhow\s+(do\s+(i|we)|can\s+(i|we)|to)\b/gi,
  /\bwhat\s+(is|are|does)\b/gi,
  /\bwhere\s+(is|are|do(es)?)\b/gi,
  /\bcan\s+(i|we|you)\b/gi,
  /\bplease\b/gi,
  /\bshow\s+me\b/gi,
];

function stripNoise(s: string): string {
  let out = s;
  for (const re of NOISE_PHRASES) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").trim();
}

function detectLanguage(raw: string): Lang | undefined {
  for (const [re, lang] of LANG_HINTS) {
    if (re.test(raw)) return lang;
  }
  return undefined;
}

function detectProduct(raw: string): Product | undefined {
  for (const [re, product] of PRODUCT_HINTS) {
    if (re.test(raw)) return product;
  }
  return undefined;
}

function detectTopic(raw: string): Topic | undefined {
  for (const [re, topic] of TOPIC_HINTS) {
    if (re.test(raw)) return topic;
  }
  return undefined;
}

export function rewriteQuery(raw: string, table: SynonymTable): RewriteResult {
  const trimmed = raw.trim();
  const cleaned = stripNoise(trimmed.toLowerCase());
  const expansion = expandQuery(cleaned, table);
  const detectedLanguage = detectLanguage(trimmed);
  const detectedProduct = detectProduct(trimmed);
  const detectedTopic = detectTopic(trimmed);

  const expandedTerms: string[] = [];
  for (const group of expansion.expanded) expandedTerms.push(...group);

  const result: RewriteResult = {
    raw,
    cleaned: cleaned.length > 0 ? cleaned : trimmed.toLowerCase(),
    fts5: expansion.fts5,
    tokens: expansion.tokens,
    expandedTerms,
    ...(detectedLanguage !== undefined && { detectedLanguage }),
    ...(detectedProduct !== undefined && { detectedProduct }),
    ...(detectedTopic !== undefined && { detectedTopic }),
  };
  return result;
}

// Re-export for callers that want to do their own normalization downstream.
export { normalizeLang };
