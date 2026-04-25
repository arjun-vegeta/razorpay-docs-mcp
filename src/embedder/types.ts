/**
 * Pluggable embedder interface. Per CLAUDE.md §10.2 and plan.md §10.4,
 * model_id and dim live behind this interface so a small→large swap is
 * a 30-min change with no impact outside `src/embedder/`.
 */

export interface Embedder {
  readonly modelId: string;
  readonly dim: number;
  readonly contextLength: number;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: readonly string[], batchSize?: number): Promise<Float32Array[]>;
}
