/**
 * Cross-link extraction + doc-graph builder. Adapter over the markdown utility
 * plus an aggregator that produces `dist/index/doc-graph.json`.
 *
 * Razorpay docs reference each other via raw.githubusercontent.com URLs;
 * `extractCrossLinks` resolves those to internal route slugs. We dedupe within
 * a chunk and remove self-edges (route === sameRoute) when building the graph.
 */

import { extractCrossLinks as extractFromBody } from "../util/markdown.js";
import type { Chunk, CrossLink, DocGraph } from "./types.js";

export function extractCrossLinks(chunkBody: string): readonly CrossLink[] {
  return extractFromBody(chunkBody);
}

export function buildDocGraph(chunks: readonly Chunk[]): DocGraph {
  const edges = new Map<string, Set<string>>();
  for (const chunk of chunks) {
    let outgoing = edges.get(chunk.route);
    if (outgoing === undefined) {
      outgoing = new Set<string>();
      edges.set(chunk.route, outgoing);
    }
    for (const link of chunk.crossLinks) {
      if (link.route === chunk.route) continue; // no self-edges
      outgoing.add(link.route);
    }
  }
  const out: Record<string, readonly string[]> = {};
  for (const [route, dests] of edges) {
    if (dests.size === 0) continue;
    out[route] = [...dests].sort();
  }
  return { edges: out };
}
