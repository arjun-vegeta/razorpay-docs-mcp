/**
 * Vector index builder. Reads chunks back from index-bm25.db (no re-chunking),
 * embeds the composed text, writes to dist/index/index-vec-{model-slug}.db
 * via sqlite-vec.
 *
 * Per buildplan §2.7, embedding text = "{title}\n{heading_path}\n{body[:2048 chars]}".
 * (The model truncates at its own context length; we cap at ~2048 chars to
 *  avoid sending obviously oversized inputs to the tokenizer.)
 */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { embedderFileSlug, loadEmbedder, type EmbedderSpec } from "../embedder/registry.js";
import type { Embedder } from "../embedder/types.js";
import { log } from "../util/log.js";

const BODY_CHAR_CAP = 2048;
const EMBED_BATCH_SIZE = 32;

export interface BuildVecOptions {
  readonly repoRoot: string;
  readonly outputDir?: string | undefined;
  readonly embedder: EmbedderSpec;
}

export interface BuildVecResult {
  readonly vecDbPath: string;
  readonly modelId: string;
  readonly dim: number;
  readonly nVectors: number;
  readonly elapsedMs: number;
}

interface ChunkRow {
  readonly chunk_id: number;
  readonly title: string;
  readonly heading_path: string;
  readonly body: string;
}

function composeEmbeddingText(row: ChunkRow): string {
  const head = `${row.title}\n${row.heading_path}\n`;
  const body = row.body.length > BODY_CHAR_CAP ? row.body.slice(0, BODY_CHAR_CAP) : row.body;
  return head + body;
}

function bufferFromFloats(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function progress(done: number, total: number): string {
  const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
  return `${done}/${total} (${pct}%)`;
}

export async function buildVecIndex(options: BuildVecOptions): Promise<BuildVecResult> {
  const { repoRoot } = options;
  const outputDir = options.outputDir ?? resolve(repoRoot, "dist", "index");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const bm25Path = resolve(outputDir, "index-bm25.db");
  if (!existsSync(bm25Path)) {
    throw new Error(`bm25 index missing: ${bm25Path}. Run \`pnpm indexer:build\` first.`);
  }

  const embedder: Embedder = loadEmbedder(options.embedder);
  if (embedder.modelId === "noop") {
    throw new Error("cannot build vec index with noop embedder; pass --embedder=small or larger");
  }
  const slug = embedderFileSlug(embedder.modelId);
  const vecPath = resolve(outputDir, `index-vec-${slug}.db`);
  if (existsSync(vecPath)) unlinkSync(vecPath);

  const t0 = Date.now();

  // Read all chunks from BM25 db (read-only).
  const bm25 = new Database(bm25Path, { readonly: true });
  const rows = bm25
    .prepare<[], ChunkRow>(
      `SELECT chunk_id, title, COALESCE(heading_path, '') AS heading_path, body FROM chunks ORDER BY chunk_id`,
    )
    .all();
  bm25.close();
  log.info("loaded chunks", rows.length, "from", bm25Path);

  // Open vec db (write).
  const vec = new Database(vecPath);
  sqliteVec.load(vec);
  vec.pragma("journal_mode = WAL");
  vec.pragma("synchronous = NORMAL");
  vec.exec(
    `CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${embedder.dim}])`,
  );
  vec.exec(`CREATE TABLE vec_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const insertVec = vec.prepare(`INSERT INTO vec_chunks(chunk_id, embedding) VALUES (?, ?)`);
  const insertMeta = vec.prepare(`INSERT INTO vec_meta(key, value) VALUES (?, ?)`);

  // Embed in batches; persist each batch in a transaction.
  const persistBatch = vec.transaction(
    (ids: readonly number[], vectors: readonly Float32Array[]): void => {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const v = vectors[i];
        if (id === undefined || v === undefined) continue;
        insertVec.run(BigInt(id), bufferFromFloats(v));
      }
    },
  );

  let done = 0;
  let lastReportedPct = -5;
  log.info("embedding", progress(0, rows.length));
  for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
    const batch = rows.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map(composeEmbeddingText);
    const vectors = await embedder.embedBatch(texts, EMBED_BATCH_SIZE);
    persistBatch(
      batch.map((b) => b.chunk_id),
      vectors,
    );
    done += batch.length;
    const pct = rows.length === 0 ? 100 : Math.floor((done / rows.length) * 100);
    if (pct - lastReportedPct >= 5 || done === rows.length) {
      log.info("embedding", progress(done, rows.length));
      lastReportedPct = pct;
    }
  }

  const builtAt = new Date().toISOString();
  insertMeta.run("model_id", embedder.modelId);
  insertMeta.run("dim", String(embedder.dim));
  insertMeta.run("quantization", "int8");
  insertMeta.run("built_at", builtAt);
  insertMeta.run("n_vectors", String(rows.length));

  vec.exec("VACUUM");
  vec.close();

  const elapsedMs = Date.now() - t0;
  log.info("vec build complete", { path: vecPath, elapsedMs, vectors: rows.length });

  return {
    vecDbPath: vecPath,
    modelId: embedder.modelId,
    dim: embedder.dim,
    nVectors: rows.length,
    elapsedMs,
  };
}
