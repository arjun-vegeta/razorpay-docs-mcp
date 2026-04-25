import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CohereEmbedder } from "../../src/embedder/cohere.js";
import { VoyageEmbedder } from "../../src/embedder/voyage.js";

const ORIG_FETCH = globalThis.fetch;
const ORIG_VOYAGE = process.env["VOYAGE_API_KEY"];
const ORIG_COHERE = process.env["COHERE_API_KEY"];

beforeEach(() => {
  process.env["VOYAGE_API_KEY"] = "test-voyage";
  process.env["COHERE_API_KEY"] = "test-cohere";
});

afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
  if (ORIG_VOYAGE === undefined) delete process.env["VOYAGE_API_KEY"];
  else process.env["VOYAGE_API_KEY"] = ORIG_VOYAGE;
  if (ORIG_COHERE === undefined) delete process.env["COHERE_API_KEY"];
  else process.env["COHERE_API_KEY"] = ORIG_COHERE;
});

function mockJson(body: unknown): typeof globalThis.fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof globalThis.fetch;
}

describe("VoyageEmbedder", () => {
  it("throws if VOYAGE_API_KEY is missing", () => {
    delete process.env["VOYAGE_API_KEY"];
    expect(() => new VoyageEmbedder()).toThrow(/VOYAGE_API_KEY/);
  });

  it("embeds a single query and returns Float32Array of correct dim", async () => {
    const fetchMock = mockJson({ data: [{ embedding: new Array(512).fill(0.1) }] });
    globalThis.fetch = fetchMock;
    const e = new VoyageEmbedder();
    const v = await e.embed("create an order");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(512);
    const call = (fetchMock as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://api.voyageai.com/v1/embeddings");
    const body = JSON.parse(String(call?.[1]?.body)) as { input_type: string; input: string[] };
    expect(body.input_type).toBe("query");
    expect(body.input).toEqual(["create an order"]);
  });

  it("embeds documents in batches with input_type='document'", async () => {
    const fetchMock = mockJson({
      data: Array.from({ length: 3 }, () => ({ embedding: new Array(512).fill(0.05) })),
    });
    globalThis.fetch = fetchMock;
    const e = new VoyageEmbedder();
    const vecs = await e.embedBatch(["a", "b", "c"], 64);
    expect(vecs.length).toBe(3);
    const body = JSON.parse(
      String(
        (fetchMock as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0]?.[1]?.body,
      ),
    ) as { input_type: string };
    expect(body.input_type).toBe("document");
  });

  it("propagates a non-200 response as an error", async () => {
    globalThis.fetch = vi.fn(async () => new Response("rate limited", { status: 429 })) as unknown as typeof globalThis.fetch;
    const e = new VoyageEmbedder();
    await expect(e.embed("q")).rejects.toThrow(/Voyage HTTP 429/);
  });
});

describe("CohereEmbedder", () => {
  it("throws if COHERE_API_KEY is missing", () => {
    delete process.env["COHERE_API_KEY"];
    expect(() => new CohereEmbedder()).toThrow(/COHERE_API_KEY/);
  });

  it("embeds a query with input_type='search_query' and 1024-dim default", async () => {
    const fetchMock = mockJson({ embeddings: [new Array(1024).fill(0.2)] });
    globalThis.fetch = fetchMock;
    const e = new CohereEmbedder();
    const v = await e.embed("refund created");
    expect(v.length).toBe(1024);
    const body = JSON.parse(
      String(
        (fetchMock as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0]?.[1]?.body,
      ),
    ) as { input_type: string };
    expect(body.input_type).toBe("search_query");
  });

  it("embeds documents in batches with input_type='search_document'", async () => {
    const fetchMock = mockJson({
      embeddings: Array.from({ length: 2 }, () => new Array(1024).fill(0.3)),
    });
    globalThis.fetch = fetchMock;
    const e = new CohereEmbedder();
    const vecs = await e.embedBatch(["doc1", "doc2"]);
    expect(vecs.length).toBe(2);
    const body = JSON.parse(
      String(
        (fetchMock as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0]?.[1]?.body,
      ),
    ) as { input_type: string };
    expect(body.input_type).toBe("search_document");
  });
});
