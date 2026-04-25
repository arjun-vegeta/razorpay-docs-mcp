import { resolve } from "node:path";
import { log } from "../util/log.js";
import { pullSource } from "./pull-source.js";

interface ParsedArgs {
  readonly subcommand: string;
  readonly flags: ReadonlyMap<string, string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new Error("missing subcommand. usage: indexer <pull|build>");
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  switch (args.subcommand) {
    case "pull": {
      const result = pullSource(repoRoot);
      log.info("pull complete", { sha: result.sha, action: result.action });
      break;
    }
    case "build": {
      // Implemented in Phase 2.
      log.info("build: not yet implemented (Phase 2)");
      process.exitCode = 0;
      break;
    }
    default: {
      throw new Error(`unknown subcommand '${args.subcommand}'. expected: pull | build`);
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

// Reference to silence unused import warnings under strict flags.
void resolve;
