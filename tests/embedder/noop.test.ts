import { describe, expect, it } from "vitest";
import { NoopEmbedder } from "../../src/embedder/noop.js";

describe("NoopEmbedder", () => {
  it("returns zero vectors of the configured dimension", async () => {
    const e = new NoopEmbedder(384);
    const v = await e.embed("hello");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(384);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it("returns one vector per input text in batch mode", async () => {
    const e = new NoopEmbedder(8);
    const out = await e.embedBatch(["a", "b", "c"]);
    expect(out).toHaveLength(3);
    expect(out.every((v) => v.length === 8)).toBe(true);
  });

  it("preserves modelId === 'noop' for the seam check", () => {
    expect(new NoopEmbedder().modelId).toBe("noop");
  });
});
