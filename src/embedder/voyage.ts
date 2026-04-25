/**
 * Voyage AI embedder — BYO API key. Higher quality than the local bge-small
 * default at the cost of (a) requiring an internet round-trip per query and
 * (b) re-indexing the corpus with this embedder so query/doc dims match.
 *
 * Auth: env var `VOYAGE_API_KEY`. Read once at construction; throws if missing.
 *
 * embed()      — query-side: input_type="query"
 * embedBatch() — doc-side:   input_type="document"
 *
 * Voyage's "lite" model is the cost/quality sweet spot for retrieval. Users
 * can override with `RZP_MCP_VOYAGE_MODEL`; we keep the model id internal so
 * the rest of the codebase stays embedder-agnostic.
 */

import type { Embedder } from "./types.js";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_MODEL = "voyage-3-lite";
const DEFAULT_DIM = 512;
const DEFAULT_CONTEXT = 16_000;

interface VoyageEmbeddingsResponse {
  readonly data: ReadonlyArray<{ readonly embedding: readonly number[] }>;
}

function isVoyageResponse(o: unknown): o is VoyageEmbeddingsResponse {
  return (
    o !== null &&
    typeof o === "object" &&
    "data" in o &&
    Array.isArray((o as VoyageEmbeddingsResponse).data)
  );
}

export class VoyageEmbedder implements Embedder {
  public readonly modelId: string;
  public readonly dim: number;
  public readonly contextLength: number;
  private readonly apiKey: string;

  public constructor(
    modelId: string = process.env["RZP_MCP_VOYAGE_MODEL"] ?? DEFAULT_MODEL,
    dim: number = DEFAULT_DIM,
    contextLength: number = DEFAULT_CONTEXT,
  ) {
    const key = process.env["VOYAGE_API_KEY"];
    if (key === undefined || key.length === 0) {
      throw new Error(
        "VOYAGE_API_KEY is not set. BYO Voyage embedder requires the env var to be present.",
      );
    }
    this.apiKey = key;
    this.modelId = modelId;
    this.dim = dim;
    this.contextLength = contextLength;
  }

  public async embed(text: string): Promise<Float32Array> {
    const [vec] = await this.callApi([text], "query");
    if (vec === undefined) throw new Error("Voyage returned no embedding for query");
    return vec;
  }

  public async embedBatch(
    texts: readonly string[],
    batchSize = 64,
  ): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      const vecs = await this.callApi(slice, "document");
      out.push(...vecs);
    }
    return out;
  }

  private async callApi(
    texts: readonly string[],
    inputType: "query" | "document",
  ): Promise<Float32Array[]> {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: this.modelId, input_type: inputType }),
    });
    if (!res.ok) {
      throw new Error(`Voyage HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const json: unknown = await res.json();
    if (!isVoyageResponse(json)) throw new Error("Voyage response missing 'data' array");
    return json.data.map((d) => Float32Array.from(d.embedding));
  }
}
