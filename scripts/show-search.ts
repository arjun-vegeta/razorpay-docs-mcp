/**
 * Run a single search against the local (improved) pipeline and pretty-print
 * the response in the same shape the MCP tool returns.
 */

import { RetrievalPipeline, loadPipelineConfig } from "../src/retrieval/pipeline.js";

const query = process.argv[2] ?? "UPI test mode VPA success failure";
const topicArg = process.argv[3];
const topic = topicArg && topicArg.length > 0 ? topicArg : undefined;
const k = Number(process.argv[4] ?? 3);

const cfg = loadPipelineConfig(process.cwd());
const pipe = new RetrievalPipeline(cfg);
const r = await pipe.search({
  query,
  k,
  ...(topic !== undefined && { topic: topic as never }),
});

console.log(JSON.stringify(
  {
    results: r.results.map((res) => ({
      route: res.route,
      title: res.title,
      summary: res.summary,
      excerpt: res.excerpt.slice(0, 350) + (res.excerpt.length > 350 ? "..." : ""),
      heading_path: res.headingPath,
      url: res.url,
      score: res.score,
      related: res.related.map((rd) => ({ route: rd.route, title: rd.title })).slice(0, 3),
    })),
    query_interpretation: {
      tokens: r.queryInterpretation.tokens,
      expanded_terms: r.queryInterpretation.expandedTerms,
      detected_language: r.queryInterpretation.detectedLanguage,
      detected_product: r.queryInterpretation.detectedProduct,
    },
    latency_ms: r.latencyMs,
    retriever: { embedder: r.retrieverConfig.embedderId },
  },
  null,
  2,
));
pipe.close();
