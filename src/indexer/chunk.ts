/**
 * Markdown → chunks. Section-bounded (H2 primary, H3 sub-split when section
 * exceeds the soft token cap). Code blocks stay attached to the heading they
 * appear under because we split on headings, not on lines.
 *
 * See plan.md §6.1.
 */

import { approxTokens, parseDoc, splitByHeadingLevel } from "../util/markdown.js";
import { extractCodeBlocks } from "./extract-code.js";
import { extractCrossLinks } from "./extract-links.js";
import type { Chunk } from "./types.js";

const MAX_CHUNK_TOKENS = 800;

export interface ChunkInputs {
  readonly route: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly markdown: string;
  /** Monotonic counter from the caller; we increment locally and return next. */
  readonly nextChunkId: number;
}

export interface ChunkResult {
  readonly chunks: readonly Chunk[];
  readonly nextChunkId: number;
}

interface RawSection {
  readonly h2Heading: string;
  readonly h3Heading: string;
  readonly content: string;
}

function buildHeadingPath(h2: string, h3: string): string {
  if (h2 === "" && h3 === "") return "";
  if (h2 === "") return h3;
  if (h3 === "") return h2;
  return `${h2} > ${h3}`;
}

/**
 * Splits a doc body into raw section descriptors. We split by H2 first; any
 * H2 section over the soft token cap is sub-split by H3 with the H2 heading
 * carried into the heading path of every child.
 */
function buildRawSections(body: string): RawSection[] {
  const out: RawSection[] = [];
  const h2Sections = splitByHeadingLevel(body, 2);
  for (const h2 of h2Sections) {
    if (approxTokens(h2.content) <= MAX_CHUNK_TOKENS) {
      out.push({ h2Heading: h2.heading, h3Heading: "", content: h2.content });
      continue;
    }
    const h3Sections = splitByHeadingLevel(h2.content, 3);
    if (h3Sections.length === 0) {
      // No H3s and section is large — keep as single chunk anyway.
      out.push({ h2Heading: h2.heading, h3Heading: "", content: h2.content });
      continue;
    }
    for (const h3 of h3Sections) {
      out.push({
        h2Heading: h2.heading,
        h3Heading: h3.heading,
        content: h3.content,
      });
    }
  }
  return out;
}

export function chunkDoc(input: ChunkInputs): ChunkResult {
  const { route, title, description, category, markdown } = input;
  let nextChunkId = input.nextChunkId;

  const { body } = parseDoc(markdown);
  const sections = buildRawSections(body);

  if (sections.length === 0) {
    return { chunks: [], nextChunkId };
  }

  const chunks: Chunk[] = [];
  let chunkIndex = 0;
  for (const section of sections) {
    const trimmedContent = section.content.trim();
    if (trimmedContent.length === 0) continue;

    const codeBlocks = extractCodeBlocks(trimmedContent);
    const crossLinks = extractCrossLinks(trimmedContent);
    const headingPath = buildHeadingPath(section.h2Heading, section.h3Heading);

    chunks.push({
      chunkId: nextChunkId++,
      route,
      title,
      description,
      category,
      headingPath,
      body: trimmedContent,
      nTokens: approxTokens(trimmedContent),
      chunkIndex: chunkIndex++,
      codeBlocks,
      crossLinks,
    });
  }

  return { chunks, nextChunkId };
}
