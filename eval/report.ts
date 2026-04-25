/**
 * A/B comparison between two eval reports. Reads two markdown reports
 * produced by `pnpm eval --report ...` and prints a side-by-side diff
 * on the headline metrics.
 *
 * Run: pnpm exec tsx eval/report.ts <baseline.md> <candidate.md>
 */

import { readFileSync } from "node:fs";

interface Metrics {
  readonly recall1: number;
  readonly recall3: number;
  readonly recall10: number;
  readonly mrr: number;
  readonly p50: number;
  readonly p95: number;
  readonly tokens: number;
  readonly nQueries: number;
}

const NUMERIC_METRICS: ReadonlyArray<readonly [keyof Metrics, RegExp, "pct" | "num"]> = [
  ["recall1", /\| recall@1 \| ([\d.]+)%/, "pct"],
  ["recall3", /\| recall@3 \| ([\d.]+)%/, "pct"],
  ["recall10", /\| recall@10 \| ([\d.]+)%/, "pct"],
  ["mrr", /\| MRR \| ([\d.]+) \|/, "num"],
  ["p50", /\| p50 latency \| (\d+) ms/, "num"],
  ["p95", /\| p95 latency \| (\d+) ms/, "num"],
  ["tokens", /\| avg tokens \| (\d+)/, "num"],
  ["nQueries", /\*\*queries:\*\* (\d+)/, "num"],
];

function parse(path: string): Metrics {
  const md = readFileSync(path, "utf8");
  const out: Record<string, number> = {};
  for (const [key, re] of NUMERIC_METRICS) {
    const m = re.exec(md);
    if (m === null || m[1] === undefined) {
      throw new Error(`failed to parse '${key}' from ${path}`);
    }
    out[key] = Number.parseFloat(m[1]);
  }
  return out as unknown as Metrics;
}

function delta(a: number, b: number, kind: "pct" | "num"): string {
  const d = b - a;
  const sign = d > 0 ? "+" : "";
  if (kind === "pct") return `${sign}${d.toFixed(1)}pp`;
  return `${sign}${d.toFixed(2)}`;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("usage: tsx eval/report.ts <baseline.md> <candidate.md>");
    process.exit(2);
  }
  const baselinePath = args[0]!;
  const candidatePath = args[1]!;
  const baseline = parse(baselinePath);
  const candidate = parse(candidatePath);

  console.log(`baseline:  ${baselinePath}`);
  console.log(`candidate: ${candidatePath}`);
  console.log("");
  console.log("metric        baseline    candidate   delta");
  console.log("---           ---         ---         ---");
  console.log(`recall@1      ${baseline.recall1.toFixed(1)}%       ${candidate.recall1.toFixed(1)}%       ${delta(baseline.recall1, candidate.recall1, "pct")}`);
  console.log(`recall@3      ${baseline.recall3.toFixed(1)}%       ${candidate.recall3.toFixed(1)}%       ${delta(baseline.recall3, candidate.recall3, "pct")}`);
  console.log(`recall@10     ${baseline.recall10.toFixed(1)}%       ${candidate.recall10.toFixed(1)}%       ${delta(baseline.recall10, candidate.recall10, "pct")}`);
  console.log(`MRR           ${baseline.mrr.toFixed(3)}       ${candidate.mrr.toFixed(3)}       ${delta(baseline.mrr, candidate.mrr, "num")}`);
  console.log(`p50 latency   ${baseline.p50}ms        ${candidate.p50}ms        ${delta(baseline.p50, candidate.p50, "num")}ms`);
  console.log(`p95 latency   ${baseline.p95}ms        ${candidate.p95}ms        ${delta(baseline.p95, candidate.p95, "num")}ms`);
  console.log(`avg tokens    ${baseline.tokens}         ${candidate.tokens}         ${delta(baseline.tokens, candidate.tokens, "num")}`);
}

main();
