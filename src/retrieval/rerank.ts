/**
 * Cross-encoder reranker skeleton. Phase 2 ships the interface + a Jina-tiny
 * implementation; Phase 3 wires it into the retrieval pipeline (re-scoring the
 * top-N candidates from BM25+vector RRF fusion).
 *
 * Cross-encoders score (query, doc) pairs jointly — much higher per-query
 * accuracy than the bi-encoder embedding model used for ANN, at a small
 * latency cost (~50ms over top-20).
 */

import { pipeline, type TextClassificationPipeline } from "@huggingface/transformers";
import { log } from "../util/log.js";

export interface Reranker {
  readonly modelId: string;
  rerank(query: string, docs: readonly string[]): Promise<RerankScore[]>;
}

export interface RerankScore {
  readonly index: number;
  readonly score: number;
}

export class JinaTinyReranker implements Reranker {
  public readonly modelId: string;
  private model: TextClassificationPipeline | undefined;
  private loadPromise: Promise<TextClassificationPipeline> | undefined;

  public constructor(modelId: string = "Xenova/jina-reranker-v1-tiny-en") {
    this.modelId = modelId;
  }

  public async rerank(query: string, docs: readonly string[]): Promise<RerankScore[]> {
    if (docs.length === 0) return [];
    const model = await this.ensureLoaded();
    const pairs = docs.map((doc) => ({ text: query, text_pair: doc }));
    // Pipeline types vary by task; treat the result as `unknown` and validate.
    const raw: unknown = await model(pairs as never, { top_k: 1 });
    const arr = Array.isArray(raw) ? (raw as unknown[]) : [raw];
    return arr.map((entry, i) => {
      const candidate = Array.isArray(entry) ? entry[0] : entry;
      const score =
        candidate !== null &&
        typeof candidate === "object" &&
        "score" in candidate &&
        typeof (candidate as { score: unknown }).score === "number"
          ? (candidate as { score: number }).score
          : 0;
      return { index: i, score };
    });
  }

  private ensureLoaded(): Promise<TextClassificationPipeline> {
    if (this.model !== undefined) return Promise.resolve(this.model);
    if (this.loadPromise !== undefined) return this.loadPromise;
    this.loadPromise = (async () => {
      log.info("loading reranker", this.modelId);
      const t0 = Date.now();
      const m = (await pipeline("text-classification", this.modelId, {
        dtype: "q8",
      })) as TextClassificationPipeline;
      this.model = m;
      log.info("reranker loaded", this.modelId, `${Date.now() - t0}ms`);
      return m;
    })();
    return this.loadPromise;
  }
}

export const RerankerSpec = {
  None: "none",
  Tiny: "tiny",
} as const;
export type RerankerSpec = (typeof RerankerSpec)[keyof typeof RerankerSpec];

export function loadReranker(spec: RerankerSpec): Reranker | undefined {
  switch (spec) {
    case "none":
      return undefined;
    case "tiny":
      return new JinaTinyReranker();
    default: {
      const _exhaustive: never = spec;
      throw new Error(`unknown reranker spec: ${String(_exhaustive)}`);
    }
  }
}
