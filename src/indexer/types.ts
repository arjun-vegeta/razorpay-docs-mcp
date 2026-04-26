/**
 * Shared types for the indexing pipeline. The persisted SQLite schema lives
 * in build-bm25.ts; this file is the in-memory shape produced by the chunker
 * and consumed by build-bm25 / build-vec.
 */

import type { Lang } from "../util/lang.js";

export interface RawCodeBlock {
  readonly rawLang: string;
  readonly language: Lang;
  readonly label: string;
  readonly code: string;
  readonly ordinal: number;
}

export interface CrossLink {
  readonly route: string;
  readonly anchor: string | undefined;
}

export interface Chunk {
  readonly chunkId: number;
  readonly route: string;
  readonly title: string; // from manifest
  readonly description: string; // from manifest, may be ""
  readonly category: string; // from manifest
  readonly headingPath: string; // e.g. "Create an Order > Request"
  readonly body: string;
  readonly nTokens: number;
  readonly chunkIndex: number; // 0-based ordinal within parent route
  readonly codeBlocks: readonly RawCodeBlock[];
  readonly crossLinks: readonly CrossLink[];
}

export interface DocGraph {
  /** route → outgoing route slugs (deduped, no self-edges) */
  readonly edges: Readonly<Record<string, readonly string[]>>;
}

export interface IndexMeta {
  readonly schemaVersion: number;
  readonly sourceSha: string;
  readonly builtAt: string;
  readonly nChunks: number;
  readonly nDocs: number;
  readonly nCodeBlocks: number;
}
