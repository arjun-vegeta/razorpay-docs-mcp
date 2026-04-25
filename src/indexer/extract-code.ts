/**
 * Adapter over `extractFencedBlocks` that tags each block with an ordinal
 * within its parent chunk. Languages are already normalized by the markdown
 * utility (see plan.md §3 for the fence convention used in razorpay/markdown-docs).
 */

import { extractFencedBlocks } from "../util/markdown.js";
import type { RawCodeBlock } from "./types.js";

export function extractCodeBlocks(chunkBody: string): readonly RawCodeBlock[] {
  const blocks = extractFencedBlocks(chunkBody);
  return blocks.map((b, i) => ({
    rawLang: b.rawLang,
    language: b.lang,
    label: b.label,
    code: b.code,
    ordinal: i,
  }));
}
