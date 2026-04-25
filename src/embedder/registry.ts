/**
 * Embedder factory. Adding a new model = one line here. Per CLAUDE.md §10.2,
 * model IDs and dimensions live behind this seam — callers reference embedders
 * by spec name only ("small", "large", "m3", ...).
 */

import { HfEmbedder } from "./hf.js";
import { NoopEmbedder } from "./noop.js";
import type { Embedder } from "./types.js";

export const EmbedderSpec = {
  None: "none",
  Small: "small",
  Base: "base",
  Large: "large",
  M3: "m3",
} as const;
export type EmbedderSpec = (typeof EmbedderSpec)[keyof typeof EmbedderSpec];

const FACTORIES: Record<EmbedderSpec, () => Embedder> = {
  none: () => new NoopEmbedder(),
  small: () => new HfEmbedder("Xenova/bge-small-en-v1.5", 384, 512),
  base: () => new HfEmbedder("Xenova/bge-base-en-v1.5", 768, 512),
  large: () => new HfEmbedder("Xenova/bge-large-en-v1.5", 1024, 512),
  m3: () => new HfEmbedder("Xenova/bge-m3", 1024, 8192),
};

export function isEmbedderSpec(s: string): s is EmbedderSpec {
  return Object.values(EmbedderSpec).includes(s as EmbedderSpec);
}

export function loadEmbedder(spec: EmbedderSpec): Embedder {
  return FACTORIES[spec]();
}

/** Slug used in the per-model vector index filename. */
export function embedderFileSlug(modelId: string): string {
  // "Xenova/bge-small-en-v1.5" → "bge-small-en-v1.5"
  return modelId.split("/").pop() ?? modelId;
}
