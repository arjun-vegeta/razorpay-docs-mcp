/**
 * `search_razorpay_docs` MCP tool — wraps RetrievalPipeline.search.
 *
 * Tool description tells the agent WHEN to use it (per CLAUDE.md §9.2),
 * not just what it does. Output is structured JSON inside a single text
 * content block (per CLAUDE.md §9.4).
 */

import type { RetrievalPipeline } from "../retrieval/pipeline.js";
import type { SearchOptions, SearchResponse } from "../retrieval/types.js";
import {
  SearchInputSchema,
  SearchOutputSchema,
  type SearchInput,
  type SearchOutput,
} from "./schemas.js";

export const SEARCH_TOOL_NAME = "search_razorpay_docs";

export const SEARCH_TOOL_DESCRIPTION = `Search Razorpay's official documentation and return ranked excerpts with code samples in the user's SDK language.

Use this when you need to:
- Look up how a Razorpay API works (orders, payments, refunds, webhooks, payouts, etc.)
- Find integration steps for a Razorpay product (Payment Gateway, RazorpayX, Subscriptions, Magic Checkout, POS, Payroll)
- Locate the canonical doc for a specific concept

Returns 1-5 chunks; each carries a title, 1-line summary, body excerpt (~600 tokens cap), code blocks filtered to your language, the canonical razorpay.com URL, and 1-3 related-doc hints.

Prefer this tool over get_razorpay_doc when you don't already know the route. The response is razor-targeted (~1-3k tokens) — much cheaper than fetching a full doc.`.trim();

export interface SearchToolDeps {
  readonly pipeline: RetrievalPipeline;
}

/** Convert MCP input → pipeline options. */
function toSearchOptions(input: SearchInput): SearchOptions {
  return {
    query: input.query,
    ...(input.language !== undefined && { language: input.language }),
    ...(input.product !== undefined && { product: input.product }),
    ...(input.topic !== undefined && { topic: input.topic }),
    k: input.k,
  };
}

/** Convert pipeline response → MCP output (snake_case + serializable). */
export function toSearchOutput(response: SearchResponse): SearchOutput {
  return {
    results: response.results.map((r) => ({
      route: r.route,
      title: r.title,
      summary: r.summary,
      excerpt: r.excerpt,
      heading_path: r.headingPath,
      code_blocks: r.codeBlocks.map((c) => ({
        language: c.language,
        label: c.label,
        code: c.code,
      })),
      url: r.url,
      score: r.score,
      related: r.related.map((rel) => ({ route: rel.route, title: rel.title })),
    })),
    query_interpretation: {
      ...(response.queryInterpretation.detectedLanguage !== undefined && {
        detected_language: response.queryInterpretation.detectedLanguage,
      }),
      ...(response.queryInterpretation.detectedProduct !== undefined && {
        detected_product: response.queryInterpretation.detectedProduct,
      }),
      expanded_terms: [...response.queryInterpretation.expandedTerms],
      tokens: [...response.queryInterpretation.tokens],
    },
    latency_ms: response.latencyMs,
    retriever: {
      embedder: response.retrieverConfig.embedderId,
      ...(response.retrieverConfig.rerankerId !== undefined && {
        reranker: response.retrieverConfig.rerankerId,
      }),
    },
  };
}

export async function runSearchTool(
  deps: SearchToolDeps,
  rawInput: unknown,
): Promise<SearchOutput> {
  const input = SearchInputSchema.parse(rawInput);
  const response = await deps.pipeline.search(toSearchOptions(input));
  const output = toSearchOutput(response);
  return SearchOutputSchema.parse(output);
}
