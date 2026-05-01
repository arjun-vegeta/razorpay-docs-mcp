import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildVecIndex } from "../../src/indexer/build-vec.js";
import type { Embedder } from "../../src/embedder/types.js";

interface SeedChunk {
  readonly chunkId: number;
  readonly title: string;
  readonly headingPath: string;
  readonly body: string;
}

const SCHEMA = `
CREATE TABLE chunks (
  chunk_id      INTEGER PRIMARY KEY,
  route         TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  heading_path  TEXT,
  body          TEXT NOT NULL,
  n_tokens      INTEGER,
  chunk_index   INTEGER
);
`;

function seedBm25(repoRoot: string, chunks: readonly SeedChunk[]): void {
  const dbPath = resolve(repoRoot, "dist", "index", "index-bm25.db");
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  const insert = db.prepare(
    `INSERT INTO chunks(chunk_id, route, title, description, category, heading_path, body, n_tokens, chunk_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of chunks) {
    insert.run(c.chunkId, "r/" + c.chunkId, c.title, null, "api", c.headingPath, c.body, 1, 0);
  }
  db.close();
}

class CountingEmbedder implements Embedder {
  public readonly modelId = "test/fake-embedder";
  public readonly dim = 8;
  public readonly contextLength = 512;
  public callCount = 0;
  public textsSeen: string[] = [];

  public embed(text: string): Promise<Float32Array> {
    this.callCount++;
    this.textsSeen.push(text);
    return Promise.resolve(this.vectorFor(text));
  }

  public embedBatch(texts: readonly string[]): Promise<Float32Array[]> {
    this.callCount += texts.length;
    this.textsSeen.push(...texts);
    return Promise.resolve(texts.map((t) => this.vectorFor(t)));
  }

  private vectorFor(text: string): Float32Array {
    // Deterministic per-text vector so reused-vs-recomputed is verifiable.
    const v = new Float32Array(this.dim);
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    for (let i = 0; i < this.dim; i++) v[i] = ((h >>> (i * 4)) & 0xff) / 255;
    return v;
  }
}

describe("buildVecIndex incremental cache", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), "rzp-vec-cache-"));
    // buildVecIndex hardcodes outputDir = repoRoot/dist/index when not provided;
    // we pass outputDir explicitly, but BM25 lookup still resolves from repoRoot.
    // Place BM25 in repoRoot/dist/index and reuse the same path as outputDir.
    const dir = resolve(tmp, "dist", "index");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("first build embeds every chunk; second build with no changes reuses all", async () => {
    seedBm25(tmp, [
      { chunkId: 1, title: "A", headingPath: "a", body: "alpha body" },
      { chunkId: 2, title: "B", headingPath: "b", body: "beta body" },
      { chunkId: 3, title: "C", headingPath: "c", body: "gamma body" },
    ]);

    const e1 = new CountingEmbedder();
    const r1 = await buildVecIndex({ repoRoot: tmp, embedder: e1 });
    expect(r1.nVectors).toBe(3);
    expect(r1.nEmbedded).toBe(3);
    expect(r1.nReused).toBe(0);
    expect(e1.callCount).toBe(3);
    expect(existsSync(r1.vecDbPath)).toBe(true);

    const e2 = new CountingEmbedder();
    const r2 = await buildVecIndex({ repoRoot: tmp, embedder: e2 });
    expect(r2.nVectors).toBe(3);
    expect(r2.nEmbedded).toBe(0);
    expect(r2.nReused).toBe(3);
    expect(e2.callCount).toBe(0);
  });

  it("only re-embeds chunks whose body changed", async () => {
    seedBm25(tmp, [
      { chunkId: 1, title: "A", headingPath: "a", body: "alpha body" },
      { chunkId: 2, title: "B", headingPath: "b", body: "beta body" },
      { chunkId: 3, title: "C", headingPath: "c", body: "gamma body" },
    ]);

    const e1 = new CountingEmbedder();
    await buildVecIndex({ repoRoot: tmp, embedder: e1 });

    // Mutate one chunk's body, leave the others alone, rebuild.
    rmSync(resolve(tmp, "dist", "index", "index-bm25.db"));
    rmSync(resolve(tmp, "dist", "index", "index-bm25.db-shm"), { force: true });
    rmSync(resolve(tmp, "dist", "index", "index-bm25.db-wal"), { force: true });
    seedBm25(tmp, [
      { chunkId: 1, title: "A", headingPath: "a", body: "alpha body" },
      { chunkId: 2, title: "B", headingPath: "b", body: "beta body MUTATED" },
      { chunkId: 3, title: "C", headingPath: "c", body: "gamma body" },
    ]);

    const e2 = new CountingEmbedder();
    const r2 = await buildVecIndex({ repoRoot: tmp, embedder: e2 });
    expect(r2.nVectors).toBe(3);
    expect(r2.nEmbedded).toBe(1);
    expect(r2.nReused).toBe(2);
    expect(e2.callCount).toBe(1);
    expect(e2.textsSeen[0]).toContain("MUTATED");
  });

  it("rebuilds from scratch when previous DB has no chunk_hash sidecar", async () => {
    seedBm25(tmp, [{ chunkId: 1, title: "A", headingPath: "a", body: "alpha" }]);
    const e1 = new CountingEmbedder();
    const r1 = await buildVecIndex({ repoRoot: tmp, embedder: e1 });

    // Drop the chunk_hash sidecar to simulate a pre-cache vec DB.
    const drop = new Database(r1.vecDbPath);
    drop.exec("DROP TABLE chunk_hash");
    drop.close();

    const e2 = new CountingEmbedder();
    const r2 = await buildVecIndex({ repoRoot: tmp, embedder: e2 });
    expect(r2.nReused).toBe(0);
    expect(r2.nEmbedded).toBe(1);
  });
});
