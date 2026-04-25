/**
 * `get_razorpay_doc` MCP tool — wraps RetrievalPipeline.getDoc.
 */

import type { RetrievalPipeline } from "../retrieval/pipeline.js";
import {
  GetDocInputSchema,
  GetDocOutputSchema,
  type GetDocInput,
  type GetDocOutput,
} from "./schemas.js";

export const GET_DOC_TOOL_NAME = "get_razorpay_doc";

export const GET_DOC_TOOL_DESCRIPTION = `Fetch the full text of a specific Razorpay doc by its route slug or URL.

Use this when:
- You already know the canonical route (e.g. from a prior search_razorpay_docs result) and need the complete content
- You need the full code samples / parameter tables from a single doc
- You're following a cross-reference link

Returns the assembled markdown content (capped at ~8k tokens; sets truncated=true if cut), the doc title and description, the canonical razorpay.com URL, and outgoing cross-links from this doc.

For exploratory queries when you don't know the route, prefer search_razorpay_docs.`.trim();

export interface GetDocToolDeps {
  readonly pipeline: RetrievalPipeline;
}

function toGetDocOptions(input: GetDocInput): {
  routeOrUrl: string;
  language?: GetDocInput["language"];
  format: NonNullable<GetDocInput["format"]>;
} {
  return {
    routeOrUrl: input.route_or_url,
    ...(input.language !== undefined && { language: input.language }),
    format: input.format,
  };
}

export function runGetDocTool(deps: GetDocToolDeps, rawInput: unknown): GetDocOutput {
  const input = GetDocInputSchema.parse(rawInput);
  const opts = toGetDocOptions(input);
  const response = deps.pipeline.getDoc({
    routeOrUrl: opts.routeOrUrl,
    ...(opts.language !== undefined && { language: opts.language }),
    format: opts.format,
  });
  const output: GetDocOutput = {
    route: response.route,
    title: response.title,
    description: response.description,
    url: response.url,
    content: response.content,
    outgoing_links: response.outgoingLinks.map((l) => ({ route: l.route, title: l.title })),
    truncated: response.truncated,
  };
  return GetDocOutputSchema.parse(output);
}
