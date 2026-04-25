import { describe, expect, it } from "vitest";
import { buildDocGraph, extractCrossLinks } from "../../src/indexer/extract-links.js";
import type { Chunk } from "../../src/indexer/types.js";

const RAW_PREFIX = "https://raw.githubusercontent.com/razorpay/markdown-docs/master/";

describe("extractCrossLinks", () => {
  it("extracts internal route slugs from raw GitHub URLs", () => {
    const md = `See [Webhooks](${RAW_PREFIX}webhooks/validate-test.md) and [Orders](${RAW_PREFIX}api/orders/create.md).`;
    const links = extractCrossLinks(md);
    expect(links.map((l) => l.route)).toEqual(["webhooks/validate-test", "api/orders/create"]);
  });

  it("captures section anchors when present", () => {
    const md = `[Test data](${RAW_PREFIX}payments/test-data.md#cards)`;
    const [link] = extractCrossLinks(md);
    expect(link?.route).toBe("payments/test-data");
    expect(link?.anchor).toBe("cards");
  });

  it("dedupes the same route + anchor", () => {
    const url = `${RAW_PREFIX}webhooks/validate-test.md`;
    const md = `[a](${url}) [b](${url}) [c](${url})`;
    expect(extractCrossLinks(md)).toHaveLength(1);
  });
});

function makeChunk(route: string, links: readonly string[]): Chunk {
  return {
    chunkId: 0,
    route,
    title: "",
    description: "",
    category: "",
    headingPath: "",
    body: "",
    nTokens: 0,
    chunkIndex: 0,
    codeBlocks: [],
    crossLinks: links.map((r) => ({ route: r, anchor: undefined })),
  };
}

describe("buildDocGraph", () => {
  it("builds outgoing edges per route, sorted and deduped", () => {
    const chunks: Chunk[] = [
      makeChunk("api/orders", ["webhooks/orders", "api/payments/capture"]),
      makeChunk("api/orders", ["webhooks/orders"]), // dup edge across chunks
      makeChunk("webhooks/orders", ["api/orders"]),
    ];
    const graph = buildDocGraph(chunks);
    expect(graph.edges["api/orders"]).toEqual(["api/payments/capture", "webhooks/orders"]);
    expect(graph.edges["webhooks/orders"]).toEqual(["api/orders"]);
  });

  it("drops self-edges", () => {
    const graph = buildDocGraph([makeChunk("api/orders", ["api/orders", "webhooks/orders"])]);
    expect(graph.edges["api/orders"]).toEqual(["webhooks/orders"]);
  });

  it("omits routes with no outgoing edges", () => {
    const graph = buildDocGraph([makeChunk("api/orders", [])]);
    expect(graph.edges).toEqual({});
  });
});
