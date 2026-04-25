import { describe, expect, it } from "vitest";
import { extractCodeBlocks } from "../../src/indexer/extract-code.js";

describe("extractCodeBlocks", () => {
  it("normalizes Razorpay's `lang: Label` fence convention", () => {
    const md = [
      "```node: Node.js",
      "const r = razorpay.orders.create({});",
      "```",
      "",
      "```python: Python",
      "razorpay.order.create({})",
      "```",
      "",
      "```json: Response",
      '{"id":"order_xyz"}',
      "```",
    ].join("\n");
    const blocks = extractCodeBlocks(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ language: "node", label: "Node.js", ordinal: 0 });
    expect(blocks[1]).toMatchObject({ language: "python", label: "Python", ordinal: 1 });
    expect(blocks[2]).toMatchObject({ language: "json", label: "Response", ordinal: 2 });
  });

  it("normalizes alternate language spellings to canonical Lang values", () => {
    const md = [
      "```javascript: Node.js",
      "x",
      "```",
      "```nodejs: Node.js",
      "y",
      "```",
      "```cURL: Request",
      "z",
      "```",
      "```c: .NET",
      "w",
      "```",
    ].join("\n");
    const blocks = extractCodeBlocks(md);
    expect(blocks.map((b) => b.language)).toEqual(["node", "node", "curl", "dotnet"]);
  });

  it("returns an empty list for a chunk with no fences", () => {
    expect(extractCodeBlocks("just prose, no code here.")).toHaveLength(0);
  });

  it("preserves the raw lang token even when normalized", () => {
    const md = "```cURL: Curl\nx\n```";
    const [block] = extractCodeBlocks(md);
    expect(block?.rawLang).toBe("cURL");
    expect(block?.language).toBe("curl");
  });
});
