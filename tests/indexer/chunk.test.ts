import { describe, expect, it } from "vitest";
import { chunkDoc } from "../../src/indexer/chunk.js";

const TWO_H2 = `---
title: "Two"
description: "two sections"
---

## Section A

Some content here.

## Section B

More content with a code block:

\`\`\`node: Node.js
const x = 1;
\`\`\`
`;

const WITH_PREAMBLE = `---
title: "Pre"
---

# Heading One

Intro paragraph that lives before the first H2.

## Section A

Body of A.
`;

const LARGE_H2 = `---
title: "Large"
---

## One Big Section

${"This is a long paragraph repeated to exceed the soft chunk cap.\n".repeat(120)}

### Subsection One

content one

### Subsection Two

content two
`;

describe("chunkDoc", () => {
  it("emits one chunk per H2 section", () => {
    const result = chunkDoc({
      route: "x/two",
      title: "Two",
      description: "two sections",
      category: "x",
      markdown: TWO_H2,
      nextChunkId: 1,
    });
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]?.headingPath).toBe("Section A");
    expect(result.chunks[1]?.headingPath).toBe("Section B");
    expect(result.nextChunkId).toBe(3);
  });

  it("preserves preamble content (text before first H2) as its own chunk", () => {
    const result = chunkDoc({
      route: "x/preamble",
      title: "Pre",
      description: "",
      category: "x",
      markdown: WITH_PREAMBLE,
      nextChunkId: 1,
    });
    expect(result.chunks).toHaveLength(2);
    // The preamble has no H2 heading; headingPath is empty.
    expect(result.chunks[0]?.headingPath).toBe("");
    expect(result.chunks[0]?.body).toContain("Intro paragraph");
    expect(result.chunks[1]?.headingPath).toBe("Section A");
  });

  it("subsplits an oversized H2 by H3 and carries the H2 in the heading path", () => {
    const result = chunkDoc({
      route: "x/large",
      title: "Large",
      description: "",
      category: "x",
      markdown: LARGE_H2,
      nextChunkId: 100,
    });
    expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    const headings = result.chunks.map((c) => c.headingPath);
    expect(headings).toContain("One Big Section > Subsection One");
    expect(headings).toContain("One Big Section > Subsection Two");
  });

  it("attaches code blocks to their parent chunk", () => {
    const result = chunkDoc({
      route: "x/two",
      title: "Two",
      description: "",
      category: "x",
      markdown: TWO_H2,
      nextChunkId: 1,
    });
    const sectionB = result.chunks[1];
    expect(sectionB?.codeBlocks).toHaveLength(1);
    expect(sectionB?.codeBlocks[0]?.language).toBe("node");
    expect(sectionB?.codeBlocks[0]?.code).toContain("const x = 1");
  });

  it("returns no chunks for an empty body", () => {
    const result = chunkDoc({
      route: "x/empty",
      title: "Empty",
      description: "",
      category: "x",
      markdown: "---\ntitle: Empty\n---\n",
      nextChunkId: 1,
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.nextChunkId).toBe(1);
  });

  it("monotonically increments chunk ids", () => {
    const result = chunkDoc({
      route: "x/two",
      title: "Two",
      description: "",
      category: "x",
      markdown: TWO_H2,
      nextChunkId: 50,
    });
    expect(result.chunks.map((c) => c.chunkId)).toEqual([50, 51]);
  });
});
