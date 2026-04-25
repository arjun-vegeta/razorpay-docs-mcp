/**
 * BM25 / FTS5 index builder. Reads source/<route>.md for every route in the
 * manifest, chunks it, extracts code blocks + cross-links, writes to
 * dist/index/index-bm25.db and dist/index/doc-graph.json.
 *
 * Schema per plan.md §8.2 (external-content FTS5 over `chunks`).
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { log } from "../util/log.js";
import { loadManifest } from "../util/manifest.js";
import { routeToCanonicalUrl } from "../util/url-map.js";
import { chunkDoc } from "./chunk.js";
import { buildDocGraph } from "./extract-links.js";
import type { Chunk, IndexMeta } from "./types.js";

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
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
CREATE INDEX idx_chunks_route ON chunks(route);
CREATE INDEX idx_chunks_category ON chunks(category);

CREATE TABLE code_blocks (
  block_id  INTEGER PRIMARY KEY,
  chunk_id  INTEGER NOT NULL,
  language  TEXT NOT NULL,
  label     TEXT,
  code      TEXT NOT NULL,
  ordinal   INTEGER
);
CREATE INDEX idx_code_chunk ON code_blocks(chunk_id);
CREATE INDEX idx_code_lang ON code_blocks(language);

CREATE TABLE routes (
  route       TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  url         TEXT NOT NULL,
  raw_url     TEXT NOT NULL
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE docs USING fts5(
  title, description, category, route, heading_path, body,
  content='chunks',
  content_rowid='chunk_id',
  tokenize='porter unicode61 remove_diacritics 2'
);
`;

export interface BuildBm25Options {
  readonly repoRoot: string;
  readonly outputDir?: string | undefined;
  readonly sourceSha?: string | undefined;
}

export interface BuildBm25Result {
  readonly bm25DbPath: string;
  readonly graphPath: string;
  readonly meta: IndexMeta;
}

interface CrossLinkRow {
  readonly fromRoute: string;
  readonly toRoute: string;
}

function readSourceSha(sourceDir: string): string {
  const shaPath = resolve(sourceDir, ".sha");
  if (!existsSync(shaPath)) return "unknown";
  return readFileSync(shaPath, "utf8").trim();
}

export function buildBm25Index(options: BuildBm25Options): BuildBm25Result {
  const { repoRoot } = options;
  const sourceDir = resolve(repoRoot, "source");
  const outputDir = options.outputDir ?? resolve(repoRoot, "dist", "index");
  const dbPath = resolve(outputDir, "index-bm25.db");
  const graphPath = resolve(outputDir, "doc-graph.json");

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  // Fresh build every time — index files are immutable artifacts.
  if (existsSync(dbPath)) unlinkSync(dbPath);

  const manifest = loadManifest(sourceDir);
  const sourceSha = options.sourceSha ?? readSourceSha(sourceDir);
  log.info("loaded manifest", { routes: Object.keys(manifest.routes).length, sourceSha });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA_SQL);

  const insertChunk = db.prepare(
    `INSERT INTO chunks (chunk_id, route, title, description, category, heading_path, body, n_tokens, chunk_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDoc = db.prepare(
    `INSERT INTO docs (rowid, title, description, category, route, heading_path, body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCode = db.prepare(
    `INSERT INTO code_blocks (chunk_id, language, label, code, ordinal)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertRoute = db.prepare(
    `INSERT INTO routes (route, title, description, category, url, raw_url) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertMeta = db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`);

  const allChunks: Chunk[] = [];
  let nextChunkId = 1;
  let nCodeBlocks = 0;
  let nDocsProcessed = 0;
  let nDocsMissing = 0;

  const ingest = db.transaction(() => {
    for (const [route, entry] of Object.entries(manifest.routes)) {
      const mdPath = resolve(sourceDir, route + ".md");
      if (!existsSync(mdPath)) {
        nDocsMissing++;
        continue;
      }
      const md = readFileSync(mdPath, "utf8");
      const result = chunkDoc({
        route,
        title: entry.title,
        description: entry.description ?? "",
        category: entry.category,
        markdown: md,
        nextChunkId,
      });
      nextChunkId = result.nextChunkId;
      for (const chunk of result.chunks) {
        insertChunk.run(
          chunk.chunkId,
          chunk.route,
          chunk.title,
          chunk.description,
          chunk.category,
          chunk.headingPath,
          chunk.body,
          chunk.nTokens,
          chunk.chunkIndex,
        );
        insertDoc.run(
          chunk.chunkId,
          chunk.title,
          chunk.description,
          chunk.category,
          chunk.route,
          chunk.headingPath,
          chunk.body,
        );
        for (const block of chunk.codeBlocks) {
          insertCode.run(chunk.chunkId, block.language, block.label, block.code, block.ordinal);
          nCodeBlocks++;
        }
        allChunks.push(chunk);
      }
      insertRoute.run(
        route,
        entry.title,
        entry.description ?? "",
        entry.category,
        routeToCanonicalUrl(route),
        entry.url,
      );
      nDocsProcessed++;
    }

    const builtAt = new Date().toISOString();
    insertMeta.run("schema_version", String(SCHEMA_VERSION));
    insertMeta.run("source_sha", sourceSha);
    insertMeta.run("built_at", builtAt);
    insertMeta.run("n_chunks", String(allChunks.length));
    insertMeta.run("n_docs", String(nDocsProcessed));
    insertMeta.run("n_code_blocks", String(nCodeBlocks));
  });

  ingest();

  log.info("ingested", { docs: nDocsProcessed, missing: nDocsMissing, chunks: allChunks.length });

  // Compress the FTS5 index.
  db.exec("INSERT INTO docs(docs) VALUES('optimize')");
  // Reclaim space — VACUUM cannot run inside a transaction.
  db.exec("VACUUM");
  db.close();

  // Doc-graph emitted alongside the BM25 db so retrieval can co-locate it.
  const graph = buildDocGraph(allChunks);
  writeFileSync(graphPath, JSON.stringify(graph, null, 0), "utf8");

  return {
    bm25DbPath: dbPath,
    graphPath,
    meta: {
      schemaVersion: SCHEMA_VERSION,
      sourceSha,
      builtAt: new Date().toISOString(),
      nChunks: allChunks.length,
      nDocs: nDocsProcessed,
      nCodeBlocks,
    },
  };
}
