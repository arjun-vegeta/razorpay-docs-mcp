/**
 * Citation resolvers — translate a rule's `route` slug into a `ResolvedCitation`
 * with a canonical razorpay.com URL.
 *
 * Two implementations:
 *   - `SqliteCitationResolver`     production: shares the BM25 index used by
 *                                  retrieval, so we never load source/ at
 *                                  runtime.
 *   - `StaticCitationResolver`     tests: pre-seeded Map<route, {url, title}>.
 *
 * Both must validate that every rule's `route` resolves; the runner asserts
 * this on registration.
 */

import type { Database } from "better-sqlite3";
import type { Manifest } from "../util/manifest.js";
import type { Citation, CitationResolver, ResolvedCitation, Rule } from "./types.js";

export class StaticCitationResolver implements CitationResolver {
  private readonly map: ReadonlyMap<string, { url: string; title: string }>;

  public constructor(entries: Iterable<readonly [string, { url: string; title: string }]>) {
    this.map = new Map(entries);
  }

  public resolve(route: string, section?: string): ResolvedCitation | undefined {
    const hit = this.map.get(route);
    if (hit === undefined) return undefined;
    const url = section !== undefined ? `${hit.url}#${section}` : hit.url;
    return {
      route,
      ...(section !== undefined && { section }),
      url,
      excerpt: "",
    };
  }
}

interface RouteRow {
  readonly url: string;
  readonly title: string;
}

/**
 * Resolves citations by querying the BM25 index `routes` table. Cached in
 * memory after first hit per route — the working set is tiny.
 */
export class SqliteCitationResolver implements CitationResolver {
  private readonly stmt;
  private readonly cache = new Map<string, RouteRow | null>();

  public constructor(db: Database) {
    this.stmt = db.prepare<[string], RouteRow>(
      `SELECT url, title FROM routes WHERE route = ? LIMIT 1`,
    );
  }

  public resolve(route: string, section?: string): ResolvedCitation | undefined {
    let row = this.cache.get(route);
    if (row === undefined) {
      row = this.stmt.get(route) ?? null;
      this.cache.set(route, row);
    }
    if (row === null) return undefined;
    const url = section !== undefined ? `${row.url}#${section}` : row.url;
    return {
      route,
      ...(section !== undefined && { section }),
      url,
      excerpt: "",
    };
  }
}

/** Build a citation resolver from a parsed manifest (used by tests + CI). */
export function manifestCitationResolver(manifest: Manifest): CitationResolver {
  const entries: Array<readonly [string, { url: string; title: string }]> = [];
  for (const [route, entry] of Object.entries(manifest.routes)) {
    entries.push([route, { url: entry.url, title: entry.title }]);
  }
  return new StaticCitationResolver(entries);
}

/**
 * Verify every rule's citation route resolves. Returns the list of unresolved
 * routes (empty = all good). Callers (CI gate, test) decide how to react.
 */
export function findUnresolvedCitations(
  rules: readonly Rule[],
  resolver: CitationResolver,
): readonly { ruleId: string; citation: Citation }[] {
  const unresolved: { ruleId: string; citation: Citation }[] = [];
  for (const rule of rules) {
    const hit = resolver.resolve(rule.citation.route, rule.citation.section);
    if (hit === undefined) {
      unresolved.push({ ruleId: rule.id, citation: rule.citation });
    }
  }
  return unresolved;
}
