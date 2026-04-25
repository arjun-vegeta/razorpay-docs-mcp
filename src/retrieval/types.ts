/**
 * Shared types for the retrieval layer. Tool I/O schemas (MCP-facing) live in
 * `src/tools/types.ts`; this file is internal to retrieval.
 *
 * See plan.md §5 (tool surface) and §7 (retrieval pipeline).
 */

import { z } from "zod";
import { Lang } from "../util/lang.js";

// -- Filter dimensions ------------------------------------------------------

export const ProductSpec = {
  Payments: "payments",
  X: "x",
  Payroll: "payroll",
  Pos: "pos",
  Partners: "partners",
  MagicCheckout: "magic-checkout",
  Subscriptions: "subscriptions",
} as const;
export type ProductSpec = (typeof ProductSpec)[keyof typeof ProductSpec];
export const ProductSpecSchema = z.enum([
  ProductSpec.Payments,
  ProductSpec.X,
  ProductSpec.Payroll,
  ProductSpec.Pos,
  ProductSpec.Partners,
  ProductSpec.MagicCheckout,
  ProductSpec.Subscriptions,
]);

export const TopicSpec = {
  Api: "api",
  Webhooks: "webhooks",
  Integration: "integration",
  Errors: "errors",
  Security: "security",
  Testing: "testing",
} as const;
export type TopicSpec = (typeof TopicSpec)[keyof typeof TopicSpec];
export const TopicSpecSchema = z.enum([
  TopicSpec.Api,
  TopicSpec.Webhooks,
  TopicSpec.Integration,
  TopicSpec.Errors,
  TopicSpec.Security,
  TopicSpec.Testing,
]);

export const LangSchema = z.enum([
  Lang.Node,
  Lang.Python,
  Lang.Php,
  Lang.Java,
  Lang.Ruby,
  Lang.Go,
  Lang.Dotnet,
  Lang.Kotlin,
  Lang.Curl,
]);

// -- Search options ---------------------------------------------------------

export interface SearchOptions {
  readonly query: string;
  readonly language?: Lang | undefined;
  readonly product?: ProductSpec | undefined;
  readonly topic?: TopicSpec | undefined;
  readonly k?: number | undefined;
}

// -- Internal candidate (shared between BM25, vec, RRF, rerank, filter) ----

/**
 * A candidate is a (chunk_id, score) pair traveling through the pipeline.
 * Different retrievers normalize differently — see `kind` for the raw source.
 *
 * Score interpretation:
 *   bm25:   higher = better (FTS5 returns negative bm25; we negate)
 *   vector: higher = better (we convert distance to similarity = 1 - distance)
 *   rrf:    higher = better
 *   rerank: higher = better
 */
export interface Candidate {
  readonly chunkId: number;
  readonly score: number;
  readonly kind: "bm25" | "vector" | "rrf" | "rerank";
  /** Set when the retriever returns a route directly (BM25 join), used for filtering. */
  readonly route?: string;
  readonly category?: string;
}

// -- Hydrated result (pre-MCP serialization) -------------------------------

export interface RelatedDoc {
  readonly route: string;
  readonly title: string;
}

export interface ResultCodeBlock {
  readonly language: Lang;
  readonly label: string;
  readonly code: string;
}

export interface SearchResult {
  readonly route: string;
  readonly title: string;
  readonly summary: string; // 1-line, from manifest description or fallback
  readonly excerpt: string; // body, capped at BODY_TOKEN_CAP
  readonly headingPath: string;
  readonly codeBlocks: readonly ResultCodeBlock[];
  readonly url: string;
  readonly score: number;
  readonly related: readonly RelatedDoc[];
}

export interface QueryInterpretation {
  readonly detectedLanguage?: Lang;
  readonly detectedProduct?: ProductSpec;
  readonly expandedTerms: readonly string[];
  readonly tokens: readonly string[];
}

export interface SearchResponse {
  readonly results: readonly SearchResult[];
  readonly queryInterpretation: QueryInterpretation;
  readonly latencyMs: number;
  readonly retrieverConfig: {
    readonly embedderId: string;
    readonly rerankerId: string | undefined;
  };
}

// -- get_razorpay_doc -------------------------------------------------------

export interface GetDocOptions {
  readonly routeOrUrl: string;
  readonly language?: Lang | undefined;
  readonly format?: "markdown" | "structured";
}

export interface GetDocResponse {
  readonly route: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly content: string;
  readonly outgoingLinks: readonly RelatedDoc[];
  readonly truncated: boolean;
}
