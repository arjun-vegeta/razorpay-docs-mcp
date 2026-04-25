/**
 * Cohere embedder — BYO API key. Mirror of voyage.ts.
 *
 * Auth: env var `COHERE_API_KEY`. Throws on construction if missing.
 *
 * embed()      — query-side: input_type="search_query"
 * embedBatch() — doc-side:   input_type="search_document"
 *
 * Default model is `embed-english-v3.0` (1024-dim). Override with
 * `RZP_MCP_COHERE_MODEL`. Multilingual workloads should use
 * `embed-multilingual-v3.0`.
 */

import type { Embedder } from "./types.js";

const COHERE_URL = "https://api.cohere.com/v1/embed";
const DEFAULT_MODEL = "embed-english-v3.0";
const DEFAULT_DIM = 1024;
const DEFAULT_CONTEXT = 512;

interface CohereEmbeddingsResponse {
  readonly embeddings: readonly (readonly number[])[];
}

function isCohereResponse(o: unknown): o is CohereEmbeddingsResponse {
  return (
    o !== null &&
    typeof o === "object" &&
    "embeddings" in o &&
    Array.isArray((o as CohereEmbeddingsResponse).embeddings)
  );
}

export class CohereEmbedder implements Embedder {
  public readonly modelId: string;
  public readonly dim: number;
  public readonly contextLength: number;
  private readonly apiKey: string;

  public constructor(
    modelId: string = process.env["RZP_MCP_COHERE_MODEL"] ?? DEFAULT_MODEL,
    dim: number = DEFAULT_DIM,
    contextLength: number = DEFAULT_CONTEXT,
  ) {
    const key = process.env["COHERE_API_KEY"];
    if (key === undefined || key.length === 0) {
      throw new Error(
        "COHERE_API_KEY is not set. BYO Cohere embedder requires the env var to be present.",
      );
    }
    this.apiKey = key;
    this.modelId = modelId;
    this.dim = dim;
    this.contextLength = contextLength;
  }

  public async embed(text: string): Promise<Float32Array> {
    const [vec] = await this.callApi([text], "search_query");
    if (vec === undefined) throw new Error("Cohere returned no embedding for query");
    return vec;
  }

  public async embedBatch(
    texts: readonly string[],
    batchSize = 96,
  ): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      const vecs = await this.callApi(slice, "search_document");
      out.push(...vecs);
    }
    return out;
  }

  private async callApi(
    texts: readonly string[],
    inputType: "search_query" | "search_document",
  ): Promise<Float32Array[]> {
    const res = await fetch(COHERE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        texts: [...texts],
        model: this.modelId,
        input_type: inputType,
        embedding_types: ["float"],
      }),
    });
    if (!res.ok) {
      throw new Error(`Cohere HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const json: unknown = await res.json();
    if (!isCohereResponse(json)) throw new Error("Cohere response missing 'embeddings' array");
    return json.embeddings.map((e) => Float32Array.from(e));
  }
}
