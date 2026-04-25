import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../util/log.js";

const REPO_URL = "https://github.com/razorpay/markdown-docs.git";
const BRANCH = "master";

export interface PullResult {
  readonly sourceDir: string;
  readonly sha: string;
  readonly action: "cloned" | "updated" | "unchanged";
}

function run(cmd: string, args: readonly string[], cwd?: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readSha(sourceDir: string): string {
  return run("git", ["rev-parse", "HEAD"], sourceDir);
}

function isGitRepo(dir: string): boolean {
  try {
    const stat = statSync(resolve(dir, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

export function pullSource(repoRoot: string): PullResult {
  const sourceDir = resolve(repoRoot, "source");

  if (!existsSync(sourceDir)) {
    mkdirSync(sourceDir, { recursive: true });
  }

  if (!isGitRepo(sourceDir)) {
    log.info("cloning razorpay/markdown-docs into", sourceDir);
    run("git", ["clone", "--depth=1", "--branch", BRANCH, REPO_URL, sourceDir]);
    const sha = readSha(sourceDir);
    writeFileSync(resolve(sourceDir, ".sha"), sha + "\n", "utf8");
    log.info("cloned at", sha);
    return { sourceDir, sha, action: "cloned" };
  }

  const before = readSha(sourceDir);
  log.info("updating razorpay/markdown-docs at", sourceDir);
  run("git", ["fetch", "--depth=1", "origin", BRANCH], sourceDir);
  run("git", ["reset", "--hard", `origin/${BRANCH}`], sourceDir);
  const after = readSha(sourceDir);
  writeFileSync(resolve(sourceDir, ".sha"), after + "\n", "utf8");
  if (before === after) {
    log.info("already up to date at", after);
    return { sourceDir, sha: after, action: "unchanged" };
  }
  log.info("updated", before, "→", after);
  return { sourceDir, sha: after, action: "updated" };
}
