import { isEmbedderSpec, type EmbedderSpec } from "../embedder/registry.js";
import { log } from "../util/log.js";
import { buildBm25Index } from "./build-bm25.js";
import { buildRulesIndex, CitationGateFailure } from "./build-rules.js";
import { buildVecIndex } from "./build-vec.js";
import { pullSource } from "./pull-source.js";

// Indexer is a one-shot CLI; default to info-level so progress lines
// (e.g. embedding 5%, 10%, ...) appear in CI logs and local runs without
// the user having to set RZP_MCP_LOG_LEVEL by hand. Server keeps `warn`.
if (process.env["RZP_MCP_LOG_LEVEL"] === undefined) {
  process.env["RZP_MCP_LOG_LEVEL"] = "info";
}

interface ParsedArgs {
  readonly subcommand: string;
  readonly flags: ReadonlyMap<string, string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new Error("missing subcommand. usage: indexer <pull|build|build:bm25|build:vec|build:rules>");
  }
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      const next = rest[i + 1];
      flags.set(arg.slice(2), next ?? "true");
      if (next !== undefined && !next.startsWith("--")) i++;
    }
  }
  return { subcommand, flags };
}

function readEmbedderFlag(flags: ReadonlyMap<string, string>): EmbedderSpec {
  const raw = flags.get("embedder") ?? "small";
  if (!isEmbedderSpec(raw)) {
    throw new Error(`invalid --embedder=${raw}. expected: none | small | base | large | m3`);
  }
  return raw;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  switch (args.subcommand) {
    case "pull": {
      const result = pullSource(repoRoot);
      log.info("pull complete", { sha: result.sha, action: result.action });
      return;
    }
    case "build:bm25": {
      const result = buildBm25Index({ repoRoot });
      log.info("bm25 build complete", {
        path: result.bm25DbPath,
        chunks: result.meta.nChunks,
        docs: result.meta.nDocs,
        codeBlocks: result.meta.nCodeBlocks,
        sourceSha: result.meta.sourceSha,
      });
      return;
    }
    case "build:vec": {
      const spec = readEmbedderFlag(args.flags);
      const result = await buildVecIndex({ repoRoot, embedder: spec });
      log.info("vec build complete", {
        path: result.vecDbPath,
        modelId: result.modelId,
        dim: result.dim,
        vectors: result.nVectors,
        elapsedMs: result.elapsedMs,
      });
      return;
    }
    case "build": {
      const spec = readEmbedderFlag(args.flags);
      const bm25 = buildBm25Index({ repoRoot });
      log.info("bm25 build complete", {
        chunks: bm25.meta.nChunks,
        docs: bm25.meta.nDocs,
        codeBlocks: bm25.meta.nCodeBlocks,
      });
      if (spec === "none") {
        log.info("--embedder=none: skipping vector index");
        return;
      }
      const vec = await buildVecIndex({ repoRoot, embedder: spec });
      log.info("vec build complete", {
        modelId: vec.modelId,
        dim: vec.dim,
        vectors: vec.nVectors,
        elapsedMs: vec.elapsedMs,
      });
      return;
    }
    case "build:rules": {
      try {
        const result = buildRulesIndex({ repoRoot });
        log.info("rules build complete", {
          path: result.outPath,
          rules: result.rulesEmitted,
        });
      } catch (err) {
        if (err instanceof CitationGateFailure) {
          log.error("citation gate failed:");
          log.error(err.message);
          process.exitCode = 2;
          return;
        }
        throw err;
      }
      return;
    }
    default: {
      throw new Error(
        `unknown subcommand '${args.subcommand}'. expected: pull | build | build:bm25 | build:vec | build:rules`,
      );
    }
  }
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (err) {
    log.error(err instanceof Error ? err : String(err));
    process.exitCode = 1;
  }
})();
