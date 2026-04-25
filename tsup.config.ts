import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    server: "src/server.ts",
    "indexer/main": "src/indexer/main.ts",
  },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  // clean: false — dist/index/ holds expensive-to-regen artifacts (vec
  // embedding ~10 min). Tsup's clean wipes the whole outDir even with glob
  // patterns, so we avoid it. Stale build artifacts should be removed
  // manually with `rm -rf dist/*.js dist/indexer dist/*.map` if needed.
  clean: false,
  dts: false,
  shims: false,
  banner: { js: "#!/usr/bin/env node" },
});
