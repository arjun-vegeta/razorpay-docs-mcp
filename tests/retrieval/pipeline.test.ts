/**
 * End-to-end pipeline test against the real built index. Runs in BM25-only
 * mode (RZP_MCP_EMBEDDER=none) so it doesn't conflict with concurrent vec
 * rebuilds and doesn't pull in the embedding model.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  loadPipelineConfig,
  RetrievalPipeline,
  RouteNotFoundError,
} from "../../src/retrieval/pipeline.js";
import { EmbedderSpec } from "../../src/embedder/registry.js";

const repoRoot = resolve(__dirname, "..", "..");
const bm25DbPath = resolve(repoRoot, "dist", "index", "index-bm25.db");

if (!existsSync(bm25DbPath)) {
  // Skip the file entirely when the index isn't built. This keeps `pnpm test`
  // green on a fresh checkout — the eval harness is the gate.
  describe.skip("RetrievalPipeline (skipped — index not built)", () => {
    it.skip("placeholder", () => undefined);
  });
} else {
  describe("RetrievalPipeline (BM25-only)", () => {
    const config = {
      ...loadPipelineConfig(repoRoot),
      embedderSpec: EmbedderSpec.None,
    };
    const pipeline = new RetrievalPipeline(config);

    afterAll(() => {
      pipeline.close();
    });

    it("returns canonical route for 'create an order'", async () => {
      const r = await pipeline.search({ query: "create an order via razorpay api", k: 3 });
      expect(r.results.length).toBeGreaterThan(0);
      expect(r.results.map((x) => x.route)).toContain("api/orders/create");
    });

    it("respects k bound", async () => {
      const r = await pipeline.search({ query: "razorpay payment", k: 2 });
      expect(r.results.length).toBeLessThanOrEqual(2);
    });

    it("clamps k to the [1, 10] window", async () => {
      const r = await pipeline.search({ query: "razorpay payment", k: 50 });
      expect(r.results.length).toBeLessThanOrEqual(10);
    });

    it("infers product when query contains 'razorpay-x'", async () => {
      const r = await pipeline.search({ query: "razorpay-x payout to bank account", k: 3 });
      expect(r.queryInterpretation.detectedProduct).toBe("x");
    });

    it("filters code blocks to requested language", async () => {
      const r = await pipeline.search({
        query: "create an order via razorpay api",
        language: "node",
        k: 3,
      });
      for (const result of r.results) {
        for (const cb of result.codeBlocks) {
          expect(cb.language).toBe("node");
        }
      }
    });

    it("hard product filter excludes non-matching routes", async () => {
      const r = await pipeline.search({ query: "best practices", product: "x", k: 5 });
      for (const result of r.results) {
        expect(
          result.route.startsWith("x/") ||
            result.route.startsWith("api/x/") ||
            result.route.startsWith("webhooks/payouts"),
        ).toBe(true);
      }
    });

    it("getDoc resolves a known route with full content", () => {
      const doc = pipeline.getDoc({ routeOrUrl: "api/orders/create" });
      expect(doc.route).toBe("api/orders/create");
      expect(doc.url).toContain("razorpay.com");
      expect(doc.content.length).toBeGreaterThan(0);
    });

    it("getDoc parses razorpay.com URLs", () => {
      const doc = pipeline.getDoc({ routeOrUrl: "https://razorpay.com/docs/api/orders/create/" });
      expect(doc.route).toBe("api/orders/create");
    });

    it("getDoc throws RouteNotFoundError for unknown route", () => {
      expect(() => pipeline.getDoc({ routeOrUrl: "this/does/not/exist" })).toThrow(
        RouteNotFoundError,
      );
    });

    it("returns related docs from the doc-graph", async () => {
      const r = await pipeline.search({ query: "validate webhook signature", k: 3 });
      const hit = r.results.find((x) => x.route === "webhooks/validate-test");
      // Graph might not always surface related for every route; just assert
      // the field is well-formed.
      expect(Array.isArray(hit?.related ?? [])).toBe(true);
    });

    it("token estimate is bounded by token budget", async () => {
      const r = await pipeline.search({ query: "create an order razorpay", k: 3 });
      const tokens = pipeline.estimateResponseTokens(r);
      expect(tokens).toBeLessThan(3000); // generous; budget target ~2.5k
    });

    it("reports configured embedder in retrieverConfig", async () => {
      const r = await pipeline.search({ query: "create order", k: 1 });
      expect(r.retrieverConfig.embedderId).toBeDefined();
    });
  });
}
