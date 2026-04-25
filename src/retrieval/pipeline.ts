/**
 * RetrievalPipeline orchestrates the §7.1 flow:
 *
 *   query  →  rewrite  →  parallel(BM25, vector)  →  RRF
 *          →  optional rerank  →  filters  →  assemble  →  SearchResponse
 *
 * Lifecycle: open SQLite handles eagerly (cheap); load embedder/reranker
 * lazily on first call. Close releases everything.
 *
 * Configuration is read once from env vars at construction:
 *   RZP_MCP_INDEX_DIR     override path to dist/index/
 *   RZP_MCP_EMBEDDER      none | small | base | large | m3   (default: small)
 *   RZP_MCP_RERANKER      none | tiny                        (default: none)
 *
 * If the configured vec db is missing we fall back to BM25-only mode and warn.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database, { type Database as DbType } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import {
  embedderFileSlug,
  isEmbedderSpec,
  loadEmbedder,
  EmbedderSpec,
  type EmbedderSpec as EmbedderSpecType,
} from "../embedder/registry.js";
import type { Embedder } from "../embedder/types.js";
import { loadSynonyms, type SynonymTable } from "../indexer/synonyms.js";
import {
  loadReranker,
  RerankerSpec,
  type Reranker,
  type RerankerSpec as RerankerSpecType,
} from "./rerank.js";
import { Bm25Retriever, BM25_DEFAULT_K } from "./bm25.js";
import { VectorRetriever, VECTOR_DEFAULT_K } from "./vector.js";
import { rrf } from "./rrf.js";
import { rewriteQuery } from "./rewrite.js";
import {
  applyHardProductFilter,
  applySoftProductBoost,
  applyTopicBoost,
  applyRecencyBoost,
  reSortByScore,
} from "./filter.js";
import { ResultAssembler, type DocGraphEdges, estimateResponseTokens } from "./assemble.js";
import { log } from "../util/log.js";
import type {
  Candidate,
  GetDocOptions,
  GetDocResponse,
  RelatedDoc,
  SearchOptions,
  SearchResponse,
} from "./types.js";

const DEFAULT_K = 3;
const MAX_K = 10;
const RERANK_TOP_N = 20;
const FUSED_TOP_N = 20;
const GET_DOC_TOKEN_CAP = 8000;
const GET_DOC_CHAR_CAP = GET_DOC_TOKEN_CAP * 4;

export interface PipelineConfig {
  readonly indexDir: string;
  readonly embedderSpec: EmbedderSpecType;
  readonly rerankerSpec: RerankerSpecType;
}

interface AssembledChunkRow {
  readonly chunk_id: number;
  readonly chunk_index: number;
  readonly heading_path: string | null;
  readonly body: string;
}

interface RouteMetaRow {
  readonly route: string;
  readonly title: string;
  readonly description: string | null;
  readonly url: string;
}

export function loadPipelineConfig(repoRoot: string): PipelineConfig {
  const indexDir = process.env["RZP_MCP_INDEX_DIR"] ?? resolve(repoRoot, "dist", "index");
  const rawEmbedder = process.env["RZP_MCP_EMBEDDER"] ?? EmbedderSpec.Small;
  const embedderSpec: EmbedderSpecType = isEmbedderSpec(rawEmbedder) ? rawEmbedder : EmbedderSpec.Small;
  const rawReranker = process.env["RZP_MCP_RERANKER"] ?? RerankerSpec.None;
  const rerankerSpec: RerankerSpecType =
    rawReranker === RerankerSpec.Tiny ? RerankerSpec.Tiny : RerankerSpec.None;
  return { indexDir, embedderSpec, rerankerSpec };
}

export class RetrievalPipeline {
  public readonly config: PipelineConfig;

  private readonly bm25Db: DbType;
  private readonly bm25: Bm25Retriever;

  private readonly synonyms: SynonymTable;
  private readonly assembler: ResultAssembler;

  private readonly vectorDb: DbType | undefined;
  private readonly vector: VectorRetriever | undefined;

  /** Lazy resources — loaded on first call that needs them. */
  private embedderInstance: Embedder | undefined;
  private rerankerInstance: Reranker | undefined | null;

  public constructor(config: PipelineConfig) {
    this.config = config;

    const bm25Path = resolve(config.indexDir, "index-bm25.db");
    if (!existsSync(bm25Path)) {
      throw new Error(`BM25 index missing: ${bm25Path}. Run \`pnpm indexer:build\`.`);
    }
    this.bm25Db = new Database(bm25Path, { readonly: true });
    this.bm25 = new Bm25Retriever(this.bm25Db);

    const graphPath = resolve(config.indexDir, "doc-graph.json");
    let graph: DocGraphEdges = { edges: {} };
    if (existsSync(graphPath)) {
      const raw: unknown = JSON.parse(readFileSync(graphPath, "utf8"));
      if (typeof raw === "object" && raw !== null && "edges" in raw) {
        graph = raw as DocGraphEdges;
      }
    } else {
      log.warn("doc-graph.json missing; related-doc hints disabled");
    }
    this.assembler = new ResultAssembler(this.bm25Db, graph);

    this.synonyms = loadSynonyms();

    const { vectorDb, vector } = openVectorDb(config);
    this.vectorDb = vectorDb;
    this.vector = vector;
  }

  public close(): void {
    this.bm25Db.close();
    this.vectorDb?.close();
  }

  public async search(options: SearchOptions): Promise<SearchResponse> {
    const t0 = Date.now();
    const k = clampK(options.k);
    const rewritten = rewriteQuery(options.query, this.synonyms);

    // Choose effective product/topic — explicit args win, then inferred.
    // Topic is NOT auto-inferred from the query: empirically the keyword-based
    // topic detection (api/webhook/error etc.) over-fires and pulls precision
    // down. The detection is computed in `rewrite` so callers can surface it
    // for transparency, but we only apply the topic boost when the caller set
    // it explicitly.
    const product = options.product ?? rewritten.detectedProduct;
    const productIsExplicit = options.product !== undefined;
    const language = options.language ?? rewritten.detectedLanguage;
    const topic = options.topic;

    // The vec embedding gets the post-tokenization (stopwords removed) text
    // so noise tokens like "razorpay" / "how" don't pollute the embedding
    // direction. BM25 sees the FTS5-formatted version. Reranker sees a
    // "natural" form (cleaned) since cross-encoders prefer fluent input.
    const vecText = rewritten.tokens.length > 0 ? rewritten.tokens.join(" ") : rewritten.cleaned;
    const [bm25Hits, vectorHits] = await Promise.all([
      Promise.resolve(this.bm25.search(rewritten.fts5, BM25_DEFAULT_K)),
      this.maybeVectorSearch(vecText),
    ]);

    let fused: readonly Candidate[] = rrf([bm25Hits, vectorHits]).slice(0, FUSED_TOP_N);
    fused = await this.maybeRerank(rewritten.cleaned, fused);
    if (product !== undefined && productIsExplicit) fused = applyHardProductFilter(fused, product);
    if (product !== undefined && !productIsExplicit) fused = applySoftProductBoost(fused, product);
    if (topic !== undefined) fused = applyTopicBoost(fused, topic);
    fused = applyRecencyBoost(fused);
    fused = reSortByScore(fused);

    const results = this.assembler.assemble(fused, language, k);
    const latencyMs = Date.now() - t0;

    const queryInterpretation: SearchResponse["queryInterpretation"] = {
      tokens: rewritten.tokens,
      expandedTerms: rewritten.expandedTerms,
      ...(rewritten.detectedLanguage !== undefined && {
        detectedLanguage: rewritten.detectedLanguage,
      }),
      ...(rewritten.detectedProduct !== undefined && {
        detectedProduct: rewritten.detectedProduct,
      }),
    };

    return {
      results,
      queryInterpretation,
      latencyMs,
      retrieverConfig: {
        embedderId: this.embedderInstance?.modelId ?? this.config.embedderSpec,
        rerankerId: this.rerankerInstance?.modelId,
      },
    };
  }

  public getDoc(options: GetDocOptions): GetDocResponse {
    const route = parseRoute(options.routeOrUrl);
    const meta = this.bm25Db
      .prepare<[string], RouteMetaRow>(
        `SELECT route, title, description, url FROM routes WHERE route = ?`,
      )
      .get(route);
    if (meta === undefined) {
      throw new RouteNotFoundError(`route '${route}' not found in index`, route);
    }

    const chunks = this.bm25Db
      .prepare<[string], AssembledChunkRow>(
        `SELECT chunk_id, chunk_index, heading_path, body
         FROM chunks WHERE route = ? ORDER BY chunk_index`,
      )
      .all(route);

    const sections = chunks.map((c) => c.body).join("\n\n");
    const truncated = sections.length > GET_DOC_CHAR_CAP;
    const content = truncated ? sections.slice(0, GET_DOC_CHAR_CAP) : sections;

    const outgoing = this.collectOutgoing(route);

    return {
      route,
      title: meta.title,
      description: meta.description ?? "",
      url: meta.url,
      content,
      outgoingLinks: outgoing,
      truncated,
    };
  }

  /** Token estimate for the assembled response — used by eval bloat metric. */
  public estimateResponseTokens(response: SearchResponse): number {
    return estimateResponseTokens(response.results);
  }

  private async maybeVectorSearch(query: string): Promise<readonly Candidate[]> {
    if (this.vector === undefined) return [];
    if (this.config.embedderSpec === EmbedderSpec.None) return [];
    const embedder = await this.ensureEmbedder();
    if (embedder.modelId === "noop") return [];
    const [vec] = await embedder.embedBatch([query]);
    if (vec === undefined) return [];
    return this.vector.search(vec, VECTOR_DEFAULT_K);
  }

  private async maybeRerank(
    query: string,
    candidates: readonly Candidate[],
  ): Promise<readonly Candidate[]> {
    if (candidates.length === 0) return candidates;
    if (this.config.rerankerSpec === RerankerSpec.None) return candidates;
    const reranker = await this.ensureReranker();
    if (reranker === null) return candidates;
    const top = candidates.slice(0, RERANK_TOP_N);
    const docs = top.map((c) => {
      const row = this.bm25Db
        .prepare<[number], { title: string; body: string }>(
          `SELECT title, body FROM chunks WHERE chunk_id = ?`,
        )
        .get(c.chunkId);
      return row !== undefined ? `${row.title}\n${row.body.slice(0, 600)}` : "";
    });
    try {
      const scores = await reranker.rerank(query, docs);
      const reranked: Candidate[] = scores.map((s) => {
        const cand = top[s.index];
        if (cand === undefined) {
          throw new Error(`reranker returned out-of-range index ${s.index}`);
        }
        return { ...cand, score: s.score, kind: "rerank" as const };
      });
      reranked.sort((a, b) => b.score - a.score);
      return [...reranked, ...candidates.slice(RERANK_TOP_N)];
    } catch (err) {
      log.warn("rerank failed; falling back to RRF order", err);
      return candidates;
    }
  }

  private collectOutgoing(route: string): readonly RelatedDoc[] {
    const r = this.assembler;
    // Reuse assembler's graph + route stmt for consistency
    type LookupFn = (route: string) => readonly RelatedDoc[];
    const lookup = (r as unknown as { buildRelated: LookupFn }).buildRelated.bind(r);
    return lookup(route);
  }

  private async ensureEmbedder(): Promise<Embedder> {
    if (this.embedderInstance !== undefined) return this.embedderInstance;
    this.embedderInstance = loadEmbedder(this.config.embedderSpec);
    return this.embedderInstance;
  }

  private async ensureReranker(): Promise<Reranker | null> {
    if (this.rerankerInstance !== undefined) return this.rerankerInstance;
    const r = loadReranker(this.config.rerankerSpec);
    this.rerankerInstance = r ?? null;
    return this.rerankerInstance;
  }
}

function clampK(k: number | undefined): number {
  if (k === undefined) return DEFAULT_K;
  if (k < 1) return 1;
  if (k > MAX_K) return MAX_K;
  return Math.floor(k);
}

function openVectorDb(config: PipelineConfig): {
  vectorDb: DbType | undefined;
  vector: VectorRetriever | undefined;
} {
  if (config.embedderSpec === EmbedderSpec.None) {
    return { vectorDb: undefined, vector: undefined };
  }
  const factory = loadEmbedder(config.embedderSpec);
  const slug = embedderFileSlug(factory.modelId);
  const path = resolve(config.indexDir, `index-vec-${slug}.db`);
  if (!existsSync(path)) {
    log.warn(`vec db missing: ${path}; falling back to BM25-only`);
    return { vectorDb: undefined, vector: undefined };
  }
  const db = new Database(path, { readonly: true });
  sqliteVec.load(db);
  return { vectorDb: db, vector: new VectorRetriever(db) };
}

function parseRoute(routeOrUrl: string): string {
  const trimmed = routeOrUrl.trim();
  if (trimmed.startsWith("http")) {
    // razorpay.com/docs/<route>/  or  raw.githubusercontent.com/.../master/<route>.md
    const docsMatch = /\/docs\/([^?#]+?)\/?$/.exec(trimmed);
    if (docsMatch !== null && docsMatch[1] !== undefined) return docsMatch[1];
    const rawMatch = /master\/([^?#]+?)\.md(?:[?#]|$)/.exec(trimmed);
    if (rawMatch !== null && rawMatch[1] !== undefined) return rawMatch[1];
    throw new Error(`unrecognized URL form: ${routeOrUrl}`);
  }
  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
}

export class RouteNotFoundError extends Error {
  public override readonly name = "RouteNotFoundError";
  public constructor(message: string, public readonly route: string) {
    super(message);
  }
}

