/**
 * Validator types — Rule schema, Issue/Report shapes, severity/concern enums.
 *
 * Each `Rule` ships a `Detector` (regex / ast / heuristic). The `ast` variant
 * is reserved for a future tree-sitter backend; v1 ships regex + heuristic.
 *
 * Citations point to a route slug; the runner resolves slug → canonical URL
 * via a `CitationResolver` so the validator stays independent of retrieval.
 */

import type { Lang } from "../util/lang.js";

export type RuleId = string & { readonly __brand: "RuleId" };

export const Severity = {
  Error: "error",
  Warning: "warning",
  Info: "info",
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const Concern = {
  WebhookSignature: "webhook_signature",
  AmountHandling: "amount_handling",
  OrderFlow: "order_flow",
  Idempotency: "idempotency",
  KeySafety: "key_safety",
  PciCompliance: "pci_compliance",
  Currency: "currency",
  Capture: "capture",
  WebhookHandler: "webhook_handler",
  PaymentMethods: "payment_methods",
  All: "all",
} as const;
export type Concern = (typeof Concern)[keyof typeof Concern];

export interface Citation {
  readonly route: string;
  readonly section?: string;
  readonly excerpt: string;
}

export interface ResolvedCitation extends Citation {
  readonly url: string;
}

/**
 * Hit from a detector before runner-level dedup/citation enrichment.
 */
export interface DetectorHit {
  readonly line?: number;
  readonly column?: number;
  readonly snippet: string;
}

export interface DetectorContext {
  readonly code: string;
  readonly lang: Lang;
  /** Pre-split lines (1-indexed via lines[i-1]). */
  readonly lines: readonly string[];
  /** Code with comments + string literals masked to spaces (preserves layout). */
  readonly stripped: string;
}

export type Detector =
  | { readonly kind: "regex"; readonly pattern: RegExp }
  | { readonly kind: "heuristic"; readonly fn: (ctx: DetectorContext) => readonly DetectorHit[] }
  | { readonly kind: "ast"; readonly query: string; readonly lang: Lang };

export interface Rule {
  readonly id: RuleId;
  readonly title: string;
  readonly severity: Severity;
  readonly concern: Concern;
  /** "*" means any language. */
  readonly languages: readonly (Lang | "*")[];
  readonly detector: Detector;
  readonly citation: Citation;
  readonly fix: {
    readonly explanation: string;
    readonly correctPattern: string;
    readonly references?: readonly string[];
  };
  /** Glob-ish file path patterns to ignore (matched as substring; tests use this). */
  readonly excludes?: readonly string[];
}

export interface Issue {
  readonly ruleId: RuleId;
  readonly severity: Severity;
  readonly title: string;
  readonly line?: number;
  readonly column?: number;
  readonly snippet: string;
  readonly explanation: string;
  readonly fixSuggestion: string;
  readonly citation: ResolvedCitation;
}

export interface ValidationReport {
  readonly issues: readonly Issue[];
  readonly summary: {
    readonly total: number;
    readonly bySeverity: Readonly<Record<Severity, number>>;
    readonly rulesEvaluated: number;
    readonly languageDetected: Lang;
  };
}

export interface CitationResolver {
  resolve(route: string, section?: string): ResolvedCitation | undefined;
}

export class CitationUnresolvedError extends Error {
  public override readonly name = "CitationUnresolvedError";
  public constructor(
    message: string,
    public readonly route: string,
  ) {
    super(message);
  }
}

export function asRuleId(s: string): RuleId {
  if (!/^RZP\d{3}$/.test(s)) {
    throw new Error(`invalid rule id '${s}' — expected RZPNNN`);
  }
  return s as RuleId;
}
