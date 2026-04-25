/**
 * Domain-aware filters and score boosts. Applied AFTER RRF fusion (and AFTER
 * optional rerank), BEFORE result assembly.
 *
 * Behaviors:
 *   - Hard product filter when explicitly requested (caller passes `product`)
 *   - Soft product boost when only inferred from query (×1.20)
 *   - Topic boost (×1.15) when category aligns with requested topic
 *   - Recency boost (×1.10) for `category=announcements` chunks built from
 *     manifest entries within the last 90 days (we approximate "recent" via
 *     the route name conventions Razorpay uses)
 */

import type { Candidate, ProductSpec, TopicSpec } from "./types.js";

const PRODUCT_PREFIX_MAP: Record<ProductSpec, readonly string[]> = {
  payments: ["payments/", "api/payments/", "api/orders/", "api/refunds/", "webhooks/"],
  x: ["x/", "api/x/", "webhooks/payouts"],
  payroll: ["payroll/"],
  pos: ["pos/"],
  partners: ["partners/", "api/partners/"],
  "magic-checkout": [
    "payments/cod-magic-checkout",
    "payments/magic-checkout",
  ],
  subscriptions: [
    "api/payments/subscriptions/",
    "payments/subscriptions",
    "announcements/rbi-card-mandate-guidelines/subscriptions",
  ],
};

const TOPIC_PREFIX_MAP: Record<TopicSpec, readonly string[]> = {
  api: ["api/"],
  webhooks: ["webhooks/", "api/payments/recurring-payments/webhooks"],
  integration: ["payments/server-integration/", "payments/payment-gateway/"],
  errors: ["errors/", "api/partners/errors"],
  security: ["security/"],
  testing: ["api/sandbox-setup", "payments/test"],
};

export const SOFT_BOOST = 1.2;
// Topic boost is a strong, explicit signal — the user told us "this is an
// API question" or "this is a webhooks question". Use it aggressively.
export const TOPIC_BOOST = 1.6;
export const RECENCY_BOOST = 1.1;

function matchesAny(route: string | undefined, prefixes: readonly string[]): boolean {
  if (route === undefined) return false;
  for (const p of prefixes) if (route.startsWith(p)) return true;
  return false;
}

/**
 * Hard restrict to candidates whose route matches the product. Returns a new
 * array — does not mutate inputs.
 */
export function applyHardProductFilter(
  candidates: readonly Candidate[],
  product: ProductSpec,
): readonly Candidate[] {
  const prefixes = PRODUCT_PREFIX_MAP[product];
  return candidates.filter((c) => matchesAny(c.route, prefixes));
}

/**
 * Soft boost: ×SOFT_BOOST for candidates that match the (inferred) product,
 * pass-through otherwise. Doesn't drop anything.
 */
export function applySoftProductBoost(
  candidates: readonly Candidate[],
  product: ProductSpec,
): readonly Candidate[] {
  const prefixes = PRODUCT_PREFIX_MAP[product];
  return candidates.map((c) => (matchesAny(c.route, prefixes) ? { ...c, score: c.score * SOFT_BOOST } : c));
}

export function applyTopicBoost(
  candidates: readonly Candidate[],
  topic: TopicSpec,
): readonly Candidate[] {
  const prefixes = TOPIC_PREFIX_MAP[topic];
  return candidates.map((c) =>
    matchesAny(c.route, prefixes) ? { ...c, score: c.score * TOPIC_BOOST } : c,
  );
}

export function applyRecencyBoost(candidates: readonly Candidate[]): readonly Candidate[] {
  return candidates.map((c) =>
    c.category === "announcements" ? { ...c, score: c.score * RECENCY_BOOST } : c,
  );
}

export function reSortByScore(candidates: readonly Candidate[]): readonly Candidate[] {
  const sorted = [...candidates];
  sorted.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.chunkId - b.chunkId;
  });
  return sorted;
}
