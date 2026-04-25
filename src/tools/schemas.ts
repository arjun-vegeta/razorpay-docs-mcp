/**
 * Zod schemas for the MCP tool inputs/outputs. These are the agent-facing
 * contracts; per CLAUDE.md §9.7 they're semver-stable and changes here imply
 * a major version bump.
 */

import { z } from "zod";
import { LangSchema, ProductSpecSchema, TopicSpecSchema } from "../retrieval/types.js";

// -- search_razorpay_docs --------------------------------------------------

export const SearchInputSchema = z.object({
  query: z.string().min(3).max(256).describe("Free-text search query."),
  language: LangSchema.optional().describe("Filter code blocks to one SDK language."),
  product: ProductSpecSchema.optional().describe(
    "Restrict to a Razorpay product line (payments, x, payroll, pos, partners, magic-checkout, subscriptions).",
  ),
  topic: TopicSpecSchema.optional().describe("Bias toward a topic (api, webhooks, integration, errors, security, testing)."),
  k: z.number().int().min(1).max(10).default(3).describe("Number of results to return (1-10)."),
});
export type SearchInput = z.infer<typeof SearchInputSchema>;

export const RelatedDocSchema = z.object({
  route: z.string(),
  title: z.string(),
});

export const ResultCodeBlockSchema = z.object({
  language: z.string(),
  label: z.string(),
  code: z.string(),
});

export const SearchResultSchema = z.object({
  route: z.string(),
  title: z.string(),
  summary: z.string(),
  excerpt: z.string(),
  heading_path: z.string(),
  code_blocks: z.array(ResultCodeBlockSchema),
  url: z.string().url(),
  score: z.number(),
  related: z.array(RelatedDocSchema),
});

export const SearchOutputSchema = z.object({
  results: z.array(SearchResultSchema),
  query_interpretation: z.object({
    detected_language: z.string().optional(),
    detected_product: z.string().optional(),
    expanded_terms: z.array(z.string()),
    tokens: z.array(z.string()),
  }),
  latency_ms: z.number(),
  retriever: z.object({
    embedder: z.string(),
    reranker: z.string().optional(),
  }),
});
export type SearchOutput = z.infer<typeof SearchOutputSchema>;

// -- get_razorpay_doc -------------------------------------------------------

export const GetDocInputSchema = z.object({
  route_or_url: z
    .string()
    .min(1)
    .max(512)
    .describe(
      "Route slug like 'api/orders/create' OR full razorpay.com docs URL OR raw GitHub URL.",
    ),
  language: LangSchema.optional().describe("Currently informational; full doc is returned regardless."),
  format: z.enum(["markdown", "structured"]).default("markdown"),
});
export type GetDocInput = z.infer<typeof GetDocInputSchema>;

export const GetDocOutputSchema = z.object({
  route: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string().url(),
  content: z.string(),
  outgoing_links: z.array(RelatedDocSchema),
  truncated: z.boolean(),
});
export type GetDocOutput = z.infer<typeof GetDocOutputSchema>;
