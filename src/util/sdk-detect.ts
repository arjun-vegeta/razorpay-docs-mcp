/**
 * Detect the user's Razorpay SDK by looking for manifest files in the
 * working directory (or any parent up to the filesystem root).
 *
 * Used by `search_razorpay_docs` to default the `language` filter when the
 * caller didn't specify one — improves first-result quality at zero cost.
 *
 * The check is deliberately conservative: we only return a language if a
 * manifest BOTH exists AND lists a Razorpay-flavored dependency. A bare
 * package.json without `razorpay` in dependencies returns `undefined`.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Lang } from "./lang.js";

interface ManifestProbe {
  readonly file: string;
  readonly lang: Lang;
  /** Returns true if file content indicates a Razorpay SDK is in use. */
  readonly matches: (content: string) => boolean;
}

const PROBES: readonly ManifestProbe[] = [
  {
    file: "package.json",
    lang: Lang.Node,
    matches: (c) => /"razorpay"\s*:/.test(c),
  },
  {
    file: "requirements.txt",
    lang: Lang.Python,
    matches: (c) => /(?:^|\n)\s*razorpay\b/i.test(c),
  },
  {
    file: "pyproject.toml",
    lang: Lang.Python,
    matches: (c) => /\brazorpay\b/.test(c),
  },
  {
    file: "Pipfile",
    lang: Lang.Python,
    matches: (c) => /\brazorpay\b/i.test(c),
  },
  {
    file: "composer.json",
    lang: Lang.Php,
    matches: (c) => /"razorpay\/razorpay"/.test(c),
  },
  {
    file: "Gemfile",
    lang: Lang.Ruby,
    matches: (c) => /(?:^|\n)\s*gem\s+["']razorpay["']/.test(c),
  },
  {
    file: "go.mod",
    lang: Lang.Go,
    matches: (c) => /razorpay\/razorpay-go/i.test(c),
  },
  {
    file: "pom.xml",
    lang: Lang.Java,
    matches: (c) => /<groupId>com\.razorpay<\/groupId>/.test(c),
  },
  {
    file: "build.gradle",
    lang: Lang.Java,
    matches: (c) => /com\.razorpay/.test(c),
  },
  {
    file: "build.gradle.kts",
    lang: Lang.Kotlin,
    matches: (c) => /com\.razorpay/.test(c),
  },
];

const MAX_DEPTH = 6;

export function detectSdk(cwd: string = process.cwd()): Lang | undefined {
  let dir = resolve(cwd);
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    for (const probe of PROBES) {
      const path = resolve(dir, probe.file);
      if (!existsSync(path)) continue;
      try {
        if (statSync(path).size > 1_000_000) continue; // skip absurdly large manifests
        const content = readFileSync(path, "utf8");
        if (probe.matches(content)) return probe.lang;
      } catch {
        // ignore unreadable files
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
