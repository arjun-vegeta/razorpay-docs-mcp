/**
 * Background check for upstream Razorpay docs updates.
 *
 * Fire-and-forget — never blocks startup. On wake-up:
 *   1. Read indexed source_sha from the BM25 meta table
 *   2. If we've already checked in the last 24 h, do nothing (rate-limit
 *      via timestamp file in ~/.cache/razorpay-docs-mcp/)
 *   3. Fetch GitHub's latest commit SHA on razorpay/markdown-docs:master
 *   4. If different, log a one-line stderr notice nudging the user to
 *      `npm i -g @razorpay-docs/mcp@latest`
 *
 * No data leaves the machine besides one anonymous `GET` to api.github.com.
 * Disabled entirely with `RZP_MCP_AUTO_UPDATE=0`.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { log } from "./log.js";

const RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 1 check / 24 h
const FETCH_TIMEOUT_MS = 5_000;
const REPO = "razorpay/markdown-docs";
const COMMITS_URL = `https://api.github.com/repos/${REPO}/commits/master`;

interface MetaRow {
  readonly value: string;
}

/**
 * Read the source_sha that was baked into the BM25 index at build time.
 * Returns `undefined` if the meta key is missing (pre-Phase-5 indexes).
 */
export function readIndexedSha(db: Database): string | undefined {
  try {
    const stmt = db.prepare<[], MetaRow>(
      `SELECT value FROM meta WHERE key = 'source_sha' LIMIT 1`,
    );
    const row = stmt.get();
    return row?.value;
  } catch (err) {
    log.debug("auto-update: meta lookup failed", err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

function timestampPath(): string {
  const dir = resolve(homedir(), ".cache", "razorpay-docs-mcp");
  mkdirSync(dir, { recursive: true });
  return resolve(dir, "last-update-check");
}

function withinRateLimit(now: number): boolean {
  const path = timestampPath();
  if (!existsSync(path)) return false;
  try {
    const mtime = statSync(path).mtimeMs;
    return now - mtime < RATE_LIMIT_MS;
  } catch {
    return false;
  }
}

function touchTimestamp(): void {
  try {
    writeFileSync(timestampPath(), String(Date.now()));
  } catch (err) {
    log.debug(
      "auto-update: timestamp write failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

interface CommitResponse {
  readonly sha?: string;
}

async function fetchUpstreamSha(): Promise<string | undefined> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(COMMITS_URL, {
      signal: ac.signal,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "razorpay-docs-mcp" },
    });
    if (!res.ok) {
      log.debug("auto-update: github returned", res.status);
      return undefined;
    }
    const json: unknown = await res.json();
    if (
      json !== null &&
      typeof json === "object" &&
      "sha" in json &&
      typeof (json as CommitResponse).sha === "string"
    ) {
      return (json as CommitResponse).sha;
    }
    return undefined;
  } catch (err) {
    log.debug(
      "auto-update: fetch failed",
      err instanceof Error ? err.message : String(err),
    );
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export interface AutoUpdateOptions {
  readonly db: Database;
  /** Override for tests; defaults to fetching from api.github.com. */
  readonly fetchSha?: () => Promise<string | undefined>;
  /** Skip the disk timestamp check; tests use this. */
  readonly bypassRateLimit?: boolean;
}

/**
 * Schedule the check on the next tick. Returns the promise so callers (tests)
 * can await; production code ignores the result.
 */
export function scheduleAutoUpdateCheck(opts: AutoUpdateOptions): Promise<void> {
  if (process.env["RZP_MCP_AUTO_UPDATE"] === "0") {
    log.debug("auto-update: disabled via RZP_MCP_AUTO_UPDATE=0");
    return Promise.resolve();
  }
  return Promise.resolve().then(async () => runAutoUpdateCheck(opts));
}

export async function runAutoUpdateCheck(opts: AutoUpdateOptions): Promise<void> {
  const now = Date.now();
  if (opts.bypassRateLimit !== true && withinRateLimit(now)) {
    log.debug("auto-update: skipped (within 24h rate-limit)");
    return;
  }

  const indexedSha = readIndexedSha(opts.db);
  if (indexedSha === undefined) {
    log.debug("auto-update: no indexed source_sha; skipping");
    return;
  }

  const upstreamSha = await (opts.fetchSha ?? fetchUpstreamSha)();
  touchTimestamp();
  if (upstreamSha === undefined) return;

  if (upstreamSha === indexedSha) {
    log.debug("auto-update: index up to date", indexedSha.slice(0, 7));
    return;
  }
  log.info(
    `Razorpay docs updated upstream (${indexedSha.slice(0, 7)} → ${upstreamSha.slice(0, 7)}). ` +
      `Run \`npm i -g @razorpay-docs/mcp@latest\` to refresh.`,
  );
}
