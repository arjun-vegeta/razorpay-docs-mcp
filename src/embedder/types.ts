/**
 * Pluggable embedder interface. model_id and dim live behind this interface
 * so a small→large swap stays contained inside `src/embedder/`.
 */

export interface Embedder {
  readonly modelId: string;
  readonly dim: number;
  readonly contextLength: number;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: readonly string[], batchSize?: number): Promise<Float32Array[]>;
}
