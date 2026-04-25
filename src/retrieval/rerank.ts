/**
 * Cross-encoder reranker skeleton. Phase 2 ships the interface + a Jina-tiny
 * implementation; Phase 3 wires it into the retrieval pipeline (re-scoring the
 * top-N candidates from BM25+vector RRF fusion).
 *
 * Cross-encoders score (query, doc) pairs jointly — much higher per-query
 * accuracy than the bi-encoder embedding model used for ANN, at a small
 * latency cost (~50ms over top-20).
 */

import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";
import { log } from "../util/log.js";

export interface Reranker {
  readonly modelId: string;
  rerank(query: string, docs: readonly string[]): Promise<RerankScore[]>;
}

export interface RerankScore {
  readonly index: number;
  readonly score: number;
}

interface ReadyModel {
  readonly tokenizer: PreTrainedTokenizer;
  readonly model: PreTrainedModel;
}

interface LogitsOutput {
  readonly logits: { readonly data: Float32Array; readonly dims: readonly number[] };
}

function isLogitsOutput(o: unknown): o is LogitsOutput {
  return (
    o !== null &&
    typeof o === "object" &&
    "logits" in o &&
    (o as { logits: unknown }).logits !== null &&
    typeof (o as { logits: unknown }).logits === "object"
  );
}

export class MiniLmReranker implements Reranker {
  public readonly modelId: string;
  private ready: ReadyModel | undefined;
  private loadPromise: Promise<ReadyModel> | undefined;

  public constructor(modelId: string = "Xenova/ms-marco-MiniLM-L-6-v2") {
    this.modelId = modelId;
  }

  public async rerank(query: string, docs: readonly string[]): Promise<RerankScore[]> {
    if (docs.length === 0) return [];
    const { tokenizer, model } = await this.ensureLoaded();

    // Cross-encoder inputs: tokenize each (query, doc) pair as a sentence
    // pair. We batch the call so we get one forward pass for all candidates.
    const queries = docs.map(() => query);
    const passages = [...docs];
    const inputs = tokenizer(queries, {
      text_pair: passages,
      padding: true,
      truncation: true,
      max_length: 512,
      return_tensors: "pt",
    } as never) as never;

    const out: unknown = await model(inputs);
    if (!isLogitsOutput(out)) {
      throw new Error("reranker output missing 'logits'");
    }
    // For a single-output cross-encoder, dims = [batch, 1]. The raw logit
    // IS the relevance score; higher = more relevant. We return as-is.
    const data = out.logits.data;
    return docs.map((_, i) => ({ index: i, score: data[i] ?? 0 }));
  }

  private ensureLoaded(): Promise<ReadyModel> {
    if (this.ready !== undefined) return Promise.resolve(this.ready);
    if (this.loadPromise !== undefined) return this.loadPromise;
    this.loadPromise = (async () => {
      log.info("loading reranker", this.modelId);
      const t0 = Date.now();
      const tokenizer = (await AutoTokenizer.from_pretrained(this.modelId)) as PreTrainedTokenizer;
      const model = (await AutoModelForSequenceClassification.from_pretrained(this.modelId, {
        dtype: "q8",
      })) as PreTrainedModel;
      this.ready = { tokenizer, model };
      log.info("reranker loaded", this.modelId, `${Date.now() - t0}ms`);
      return this.ready;
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
      return new MiniLmReranker();
    default: {
      const _exhaustive: never = spec;
      throw new Error(`unknown reranker spec: ${String(_exhaustive)}`);
    }
  }
}
