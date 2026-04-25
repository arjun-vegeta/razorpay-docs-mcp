/**
 * Hydrates Candidate IDs into full SearchResult objects: pulls chunk body,
 * code blocks (filtered to requested language), canonical URL, and 1-3
 * related routes from the doc-graph.
 *
 * Token budgeting per plan.md §7:
 *   - body excerpt capped at BODY_TOKEN_CAP (~600 tokens ≈ 2400 chars)
 *   - code blocks: keep all matching language; if no match, return [] (chunk
 *     still carries useful prose)
 *   - related: max 3 per result
 */

import type { Database } from "better-sqlite3";
import { Lang, isSdkLang } from "../util/lang.js";
import { approxTokens } from "../util/markdown.js";
import type {
  Candidate,
  RelatedDoc,
  ResultCodeBlock,
  SearchResult,
} from "./types.js";

const BODY_TOKEN_CAP = 600;
const BODY_CHAR_CAP = BODY_TOKEN_CAP * 4;
const MAX_RELATED = 3;

interface ChunkRow {
  readonly chunk_id: number;
  readonly route: string;
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly heading_path: string | null;
  readonly body: string;
}

interface CodeRow {
  readonly chunk_id: number;
  readonly language: string;
  readonly label: string | null;
  readonly code: string;
  readonly ordinal: number;
}

interface RouteRow {
  readonly route: string;
  readonly title: string;
  readonly url: string;
}

export interface DocGraphEdges {
  readonly edges: Readonly<Record<string, readonly string[]>>;
}

/**
 * Truncates body at a heuristic boundary — prefers the last paragraph break
 * before the cap, falls back to the cap itself.
 */
export function truncateBody(body: string, charCap: number = BODY_CHAR_CAP): string {
  if (body.length <= charCap) return body;
  const window = body.slice(0, charCap);
  const lastBreak = window.lastIndexOf("\n\n");
  if (lastBreak > charCap * 0.6) return window.slice(0, lastBreak).trim();
  return window.trim();
}

export class ResultAssembler {
  private readonly chunkStmt;
  private readonly codeStmt;
  private readonly routeStmt;
  private readonly graphEdges: Readonly<Record<string, readonly string[]>>;

  public constructor(db: Database, graph: DocGraphEdges) {
    this.chunkStmt = db.prepare<[number], ChunkRow>(
      `SELECT chunk_id, route, title, description, category, heading_path, body
       FROM chunks WHERE chunk_id = ?`,
    );
    this.codeStmt = db.prepare<[number], CodeRow>(
      `SELECT chunk_id, language, label, code, ordinal
       FROM code_blocks WHERE chunk_id = ? ORDER BY ordinal`,
    );
    this.routeStmt = db.prepare<[string], RouteRow>(
      `SELECT route, title, url FROM routes WHERE route = ?`,
    );
    this.graphEdges = graph.edges;
  }

  public assemble(
    candidates: readonly Candidate[],
    language: Lang | undefined,
    k: number,
  ): readonly SearchResult[] {
    const out: SearchResult[] = [];
    // Dedupe by route: keep the highest-scoring chunk per route. Without this,
    // a long doc with N chunks can claim all top-K slots and crowd out other
    // canonical docs (eval recall@3 drops sharply).
    const seenRoutes = new Set<string>();
    for (const cand of candidates) {
      if (out.length >= k) break;
      const chunk = this.chunkStmt.get(cand.chunkId);
      if (chunk === undefined) continue;
      if (seenRoutes.has(chunk.route)) continue;
      seenRoutes.add(chunk.route);
      const codeBlocks = this.loadCodeBlocks(cand.chunkId, language);
      const routeMeta = this.routeStmt.get(chunk.route);
      const url = routeMeta?.url ?? `https://razorpay.com/docs/${chunk.route}/`;
      const related = this.buildRelated(chunk.route);
      const summary =
        (chunk.description ?? "").trim().length > 0
          ? (chunk.description ?? "")
          : firstParagraph(chunk.body);
      out.push({
        route: chunk.route,
        title: chunk.title,
        summary: summary.slice(0, 240),
        excerpt: truncateBody(chunk.body),
        headingPath: chunk.heading_path ?? "",
        codeBlocks,
        url,
        score: cand.score,
        related,
      });
    }
    return out;
  }

  private loadCodeBlocks(chunkId: number, language: Lang | undefined): readonly ResultCodeBlock[] {
    const rows = this.codeStmt.all(chunkId);
    const out: ResultCodeBlock[] = [];
    for (const r of rows) {
      const lang = r.language as Lang;
      if (language !== undefined && lang !== language) continue;
      // If no language filter, only return SDK languages — JSON / unknown
      // payloads are noise unless the agent specifically wants them.
      if (language === undefined && !isSdkLang(lang) && lang !== Lang.Json) continue;
      out.push({
        language: lang,
        label: r.label ?? "",
        code: r.code,
      });
    }
    return out;
  }

  private buildRelated(route: string): readonly RelatedDoc[] {
    const outgoing = this.graphEdges[route];
    if (outgoing === undefined) return [];
    const out: RelatedDoc[] = [];
    for (const r of outgoing) {
      if (out.length >= MAX_RELATED) break;
      const meta = this.routeStmt.get(r);
      if (meta === undefined) continue;
      out.push({ route: r, title: meta.title });
    }
    return out;
  }
}

function firstParagraph(body: string): string {
  const trimmed = body.trim();
  const idx = trimmed.indexOf("\n\n");
  if (idx < 0) return trimmed;
  return trimmed.slice(0, idx);
}

/** Total token estimate for a SearchResult set, used in eval bloat metric. */
export function estimateResponseTokens(results: readonly SearchResult[]): number {
  let total = 0;
  for (const r of results) {
    total += approxTokens(r.title);
    total += approxTokens(r.summary);
    total += approxTokens(r.excerpt);
    for (const cb of r.codeBlocks) total += approxTokens(cb.code);
  }
  return total;
}
