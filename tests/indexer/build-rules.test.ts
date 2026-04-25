import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRulesIndex } from "../../src/indexer/build-rules.js";
import { ALL_RULES } from "../../src/validator/rules/index.js";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SOURCE_MANIFEST = resolve(REPO_ROOT, "source", "_manifest.json");

describe("indexer build:rules", () => {
  it("emits dist/index/rules.json with all 30 rules and resolved citations", () => {
    if (!existsSync(SOURCE_MANIFEST)) {
      // Source corpus not pulled in this checkout — skip.
      return;
    }
    const outPath = resolve(REPO_ROOT, "dist", "index", "rules.test.json");
    rmSync(outPath, { force: true });
    const result = buildRulesIndex({ repoRoot: REPO_ROOT, outPath });
    expect(result.rulesEmitted).toBe(ALL_RULES.length);
    expect(result.unresolved).toEqual([]);
    expect(existsSync(outPath)).toBe(true);
    const payload = JSON.parse(readFileSync(outPath, "utf8")) as {
      total: number;
      rules: { id: string; citation: { route: string } }[];
    };
    expect(payload.total).toBe(ALL_RULES.length);
    const ids = payload.rules.map((r) => r.id).sort();
    expect(ids).toContain("RZP001");
    expect(ids).toContain("RZP030");
    rmSync(outPath, { force: true });
  });
});
