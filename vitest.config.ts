import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      include: ["src/**/*.ts"],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
});
