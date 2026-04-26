/**
 * HuggingFace transformers.js embedder. Loads ONNX models on demand into
 * `~/.cache/huggingface/`. BGE family uses mean-pool + L2 normalize.
 *
 * `modelId` and `dim` are deliberately bounded to `src/embedder/`. Nothing
 * outside this module knows which embedder is loaded — that's the seam that
 * makes a small→large swap a 30-min change.
 */

import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { log } from "../util/log.js";
import type { Embedder } from "./types.js";

const DEFAULT_BATCH_SIZE = 32;

export class HfEmbedder implements Embedder {
  private extractor: FeatureExtractionPipeline | undefined;
  private loadPromise: Promise<FeatureExtractionPipeline> | undefined;

  public constructor(
    public readonly modelId: string,
    public readonly dim: number,
    public readonly contextLength: number,
  ) {}

  public async embed(text: string): Promise<Float32Array> {
    const [vec] = await this.embedBatch([text]);
    if (vec === undefined) throw new Error("embed() returned no vectors");
    return vec;
  }

  public async embedBatch(
    texts: readonly string[],
    batchSize: number = DEFAULT_BATCH_SIZE,
  ): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extractor = await this.ensureLoaded();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      // Pipeline returns a Tensor of shape [batch, dim] when pooling is set.
      const tensor = await extractor(batch as string[], { pooling: "mean", normalize: true });
      const flat = tensor.data;
      if (!(flat instanceof Float32Array)) {
        throw new Error(`expected Float32Array from pipeline, got ${typeof flat}`);
      }
      const expected = batch.length * this.dim;
      if (flat.length !== expected) {
        throw new Error(
          `embedding shape mismatch: got ${flat.length} floats, expected ${expected} (batch=${batch.length}, dim=${this.dim})`,
        );
      }
      for (let j = 0; j < batch.length; j++) {
        out.push(flat.slice(j * this.dim, (j + 1) * this.dim));
      }
    }
    return out;
  }

  private ensureLoaded(): Promise<FeatureExtractionPipeline> {
    if (this.extractor !== undefined) return Promise.resolve(this.extractor);
    if (this.loadPromise !== undefined) return this.loadPromise;
    this.loadPromise = (async () => {
      log.info("loading embedder", this.modelId);
      const t0 = Date.now();
      const ext = (await pipeline("feature-extraction", this.modelId, {
        dtype: "q8",
      })) as FeatureExtractionPipeline;
      this.extractor = ext;
      log.info("embedder loaded", this.modelId, `${Date.now() - t0}ms`);
      return ext;
    })();
    return this.loadPromise;
  }
}
