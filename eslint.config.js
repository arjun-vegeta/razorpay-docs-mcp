// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "source/**", "coverage/**", ".cache/**", "site/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      // floating-promises + no-misused-promises require type info; left to typecheck
      // and `await void` discipline rather than re-enabling project-aware lint.
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-console": "error",
      "prefer-const": "error",
      "eqeqeq": ["error", "always"],
    },
  },
  {
    files: ["eval/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "no-console": "off",
      // Tests routinely assert array bounds via `arr[0]!` after a `length` check;
      // forcing destructuring or guards would obscure the assertion intent.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
