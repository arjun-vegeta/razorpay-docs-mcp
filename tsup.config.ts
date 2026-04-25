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
  clean: true,
  dts: false,
  shims: false,
  banner: { js: "#!/usr/bin/env node" },
});
