/**
 * Zero-vector embedder. Used when retrieval runs BM25-only (no vector ANN).
 * The dim is configurable so tests can pin it without loading a real model.
 */

import type { Embedder } from "./types.js";

export class NoopEmbedder implements Embedder {
  public readonly modelId = "noop";
  public readonly contextLength = Infinity;

  public constructor(public readonly dim: number = 384) {}

  public embed(_text: string): Promise<Float32Array> {
    return Promise.resolve(new Float32Array(this.dim));
  }

  public embedBatch(texts: readonly string[]): Promise<Float32Array[]> {
    return Promise.resolve(texts.map(() => new Float32Array(this.dim)));
  }
}
