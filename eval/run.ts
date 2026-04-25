/**
 * Eval harness. Runs every query in `queries.jsonl` through the real
 * retrieval pipeline, computes recall@1/3/10 + MRR + p50/p95 latency +
 * response token bloat. Used both interactively and as a CI gate.
 *
 * Run:
 *   pnpm eval                                  default (small embedder)
 *   pnpm eval --embedder=large                 try a bigger embedder
 *   pnpm eval --reranker=tiny                  add cross-encoder rerank
 *   pnpm eval --report eval/reports/foo.md     write report file
 *   pnpm eval --validate-routes-only           Phase 1's manifest-route check
 *
 * Acceptance gate (per buildplan §3): recall@3 ≥ 0.80, p95 < 200 ms.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  isEmbedderSpec,
  EmbedderSpec,
  type EmbedderSpec as EmbedderSpecType,
} from "../src/embedder/registry.js";
import {
  loadPipelineConfig,
  RetrievalPipeline,
} from "../src/retrieval/pipeline.js";
import { RerankerSpec, type RerankerSpec as RerankerSpecType } from "../src/retrieval/rerank.js";
import { LangSchema, ProductSpecSchema, TopicSpecSchema } from "../src/retrieval/types.js";
import { loadManifest, listRoutes } from "../src/util/manifest.js";

const QuerySchema = z.object({
  id: z.string().regex(/^q\d{3}$/),
  query: z.string().min(3).max(256),
  language: LangSchema.optional(),
  product: ProductSpecSchema.optional(),
  topic: TopicSpecSchema.optional(),
  expected_routes: z.array(z.string()).min(1),
  acceptable_routes: z.array(z.string()).optional(),
});
type Query = z.infer<typeof QuerySchema>;

interface QueryOutcome {
  readonly id: string;
  readonly query: string;
  readonly expected: readonly string[];
  readonly acceptable: readonly string[];
  readonly returned: readonly string[];
  readonly rank: number; // 1-indexed; 0 if no match in returned
  readonly latencyMs: number;
  readonly tokenEstimate: number;
}

interface EvalReport {
  readonly config: string;
  readonly nQueries: number;
  readonly recall1: number;
  readonly recall3: number;
  readonly recall10: number;
  readonly mrr: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly avgTokens: number;
  readonly outcomes: readonly QueryOutcome[];
}

const PASS_RECALL_AT_3 = 0.8;
const PASS_P95_LATENCY_MS = 200;

const repoRoot = process.cwd();
const queriesPath = resolve(repoRoot, "eval/queries.jsonl");

function readQueries(path: string): Query[] {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    try {
      return QuerySchema.parse(JSON.parse(line));
    } catch (err) {
      throw new Error(`invalid eval query at line ${i + 1}: ${stringifyErr(err)}`);
    }
  });
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

interface ParsedFlags {
  readonly embedderSpec: EmbedderSpecType | undefined;
  readonly rerankerSpec: RerankerSpecType | undefined;
  readonly reportPath: string | undefined;
  readonly validateRoutesOnly: boolean;
  readonly limit: number | undefined;
}

function parseFlags(argv: readonly string[]): ParsedFlags {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags.set(arg.slice(2), "true");
      } else {
        flags.set(arg.slice(2), next);
        i++;
      }
    }
  }
  const rawEmbedder = flags.get("embedder");
  const rawReranker = flags.get("reranker");
  const limitRaw = flags.get("limit");
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined;
  return {
    embedderSpec: rawEmbedder !== undefined && isEmbedderSpec(rawEmbedder) ? rawEmbedder : undefined,
    rerankerSpec:
      rawReranker === RerankerSpec.Tiny || rawReranker === RerankerSpec.None
        ? rawReranker
        : undefined,
    reportPath: flags.get("report"),
    validateRoutesOnly: flags.get("validate-routes-only") === "true",
    limit: limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit : undefined,
  };
}

function validateExpectedRoutes(queries: readonly Query[]): boolean {
  const sourceDir = resolve(repoRoot, "source");
  const manifest = loadManifest(sourceDir);
  const routes = new Set(listRoutes(manifest));
  let ok = true;
  for (const q of queries) {
    const targets = [...q.expected_routes, ...(q.acceptable_routes ?? [])];
    const missing = targets.filter((r) => !routes.has(r));
    if (missing.length > 0) {
      console.error(`FAIL ${q.id}: missing routes ${missing.join(", ")}`);
      ok = false;
    }
  }
  if (ok) console.error(`OK: all ${queries.length} eval queries reference valid manifest routes`);
  return ok;
}

function findRank(returned: readonly string[], targets: readonly string[]): number {
  for (let i = 0; i < returned.length; i++) {
    if (targets.includes(returned[i] ?? "")) return i + 1;
  }
  return 0;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx] ?? 0;
}

function average(nums: readonly number[]): number {
  if (nums.length === 0) return 0;
  let total = 0;
  for (const n of nums) total += n;
  return total / nums.length;
}

async function run(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  const queriesAll = readQueries(queriesPath);
  const queries = flags.limit !== undefined ? queriesAll.slice(0, flags.limit) : queriesAll;
  console.error(`loaded ${queries.length} eval queries`);

  if (flags.validateRoutesOnly) {
    return validateExpectedRoutes(queries) ? 0 : 1;
  }
  if (!validateExpectedRoutes(queries)) return 1;

  const baseConfig = loadPipelineConfig(repoRoot);
  const config = {
    ...baseConfig,
    embedderSpec: flags.embedderSpec ?? baseConfig.embedderSpec,
    rerankerSpec: flags.rerankerSpec ?? baseConfig.rerankerSpec,
  };
  const pipeline = new RetrievalPipeline(config);

  const outcomes: QueryOutcome[] = [];
  let progress = 0;
  for (const q of queries) {
    const t0 = Date.now();
    const opts: Parameters<typeof pipeline.search>[0] = {
      query: q.query,
      ...(q.language !== undefined && { language: q.language }),
      ...(q.product !== undefined && { product: q.product }),
      ...(q.topic !== undefined && { topic: q.topic }),
      k: 10,
    };
    const response = await pipeline.search(opts);
    const latencyMs = Date.now() - t0;
    const returned = response.results.map((r) => r.route);
    const targets = [...q.expected_routes, ...(q.acceptable_routes ?? [])];
    outcomes.push({
      id: q.id,
      query: q.query,
      expected: q.expected_routes,
      acceptable: q.acceptable_routes ?? [],
      returned,
      rank: findRank(returned, targets),
      latencyMs,
      tokenEstimate: pipeline.estimateResponseTokens(response),
    });
    progress++;
    if (progress % 10 === 0) console.error(`  progress ${progress}/${queries.length}`);
  }
  pipeline.close();

  const recall1 = outcomes.filter((o) => o.rank > 0 && o.rank <= 1).length / outcomes.length;
  const recall3 = outcomes.filter((o) => o.rank > 0 && o.rank <= 3).length / outcomes.length;
  const recall10 = outcomes.filter((o) => o.rank > 0 && o.rank <= 10).length / outcomes.length;
  const mrr =
    outcomes.reduce((acc, o) => acc + (o.rank > 0 ? 1 / o.rank : 0), 0) / outcomes.length;
  const sortedLatency = [...outcomes.map((o) => o.latencyMs)].sort((a, b) => a - b);
  const avgTokens = average(outcomes.map((o) => o.tokenEstimate));

  const report: EvalReport = {
    config: `embedder=${config.embedderSpec} reranker=${config.rerankerSpec} indexDir=${config.indexDir}`,
    nQueries: outcomes.length,
    recall1,
    recall3,
    recall10,
    mrr,
    p50LatencyMs: percentile(sortedLatency, 50),
    p95LatencyMs: percentile(sortedLatency, 95),
    avgTokens,
    outcomes,
  };

  printReport(report);
  if (flags.reportPath !== undefined) writeReportMarkdown(report, flags.reportPath);

  const passed =
    report.recall3 >= PASS_RECALL_AT_3 && report.p95LatencyMs <= PASS_P95_LATENCY_MS;
  if (!passed) {
    console.error(
      `\nFAIL: recall@3=${(report.recall3 * 100).toFixed(1)}% (need ≥ ${PASS_RECALL_AT_3 * 100}%) p95=${report.p95LatencyMs}ms (need ≤ ${PASS_P95_LATENCY_MS})`,
    );
    return 1;
  }
  console.error("\nPASS");
  return 0;
}

function printReport(r: EvalReport): void {
  console.error("\n=== EVAL REPORT ===");
  console.error("config:        ", r.config);
  console.error(`queries:        ${r.nQueries}`);
  console.error(`recall@1:       ${(r.recall1 * 100).toFixed(1)}%`);
  console.error(`recall@3:       ${(r.recall3 * 100).toFixed(1)}%`);
  console.error(`recall@10:      ${(r.recall10 * 100).toFixed(1)}%`);
  console.error(`MRR:            ${r.mrr.toFixed(3)}`);
  console.error(`p50 latency:    ${r.p50LatencyMs} ms`);
  console.error(`p95 latency:    ${r.p95LatencyMs} ms`);
  console.error(`avg tokens:     ${r.avgTokens.toFixed(0)}`);
  const misses = r.outcomes.filter((o) => o.rank === 0).slice(0, 10);
  if (misses.length > 0) {
    console.error(`\nmisses (top ${misses.length}):`);
    for (const m of misses) {
      console.error(`  ${m.id}  rank=0  expected=${m.expected.join(",")}`);
      console.error(`        query: ${m.query}`);
      console.error(`        got:   ${m.returned.slice(0, 3).join(", ")}`);
    }
  }
}

function writeReportMarkdown(r: EvalReport, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines: string[] = [
    `# Eval report`,
    ``,
    `**config:** ${r.config}`,
    `**queries:** ${r.nQueries}`,
    ``,
    `| metric | value |`,
    `|---|---|`,
    `| recall@1 | ${(r.recall1 * 100).toFixed(1)}% |`,
    `| recall@3 | ${(r.recall3 * 100).toFixed(1)}% |`,
    `| recall@10 | ${(r.recall10 * 100).toFixed(1)}% |`,
    `| MRR | ${r.mrr.toFixed(3)} |`,
    `| p50 latency | ${r.p50LatencyMs} ms |`,
    `| p95 latency | ${r.p95LatencyMs} ms |`,
    `| avg tokens | ${r.avgTokens.toFixed(0)} |`,
    ``,
    `## Per-query outcomes`,
    ``,
    `| id | rank | latency | query | top result |`,
    `|---|---|---|---|---|`,
  ];
  for (const o of r.outcomes) {
    lines.push(
      `| ${o.id} | ${o.rank === 0 ? "miss" : o.rank} | ${o.latencyMs}ms | ${o.query.slice(0, 60)} | ${o.returned[0] ?? "-"} |`,
    );
  }
  writeFileSync(path, lines.join("\n") + "\n", "utf8");
  console.error(`report written: ${path}`);
}

void (async (): Promise<void> => {
  try {
    process.exitCode = await run();
  } catch (err) {
    console.error("eval failed:", stringifyErr(err));
    process.exitCode = 1;
  }
})();

// Suppress unused param warning for EmbedderSpec import shape.
void EmbedderSpec;
