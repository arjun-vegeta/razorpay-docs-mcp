# Contributing

Thanks for considering a contribution. The bar is high but the surface area is small — most useful work falls into one of three buckets:

1. **Add a validation rule** (most impactful)
2. **Add an eval query** (catches retrieval regressions)
3. **Refine a heuristic** that misfires on real code

## Local setup

```bash
pnpm install
pnpm indexer:pull
pnpm indexer:build --embedder=small
pnpm test       # 175+ tests, < 2 s
pnpm eval       # retrieval gates
pnpm build      # produces dist/server.js
```

Node 20+ required. Tests run with vitest, lint with eslint, types with tsc strict.

## Add a validation rule

1. Pick the next free ID (`RZP031`, `RZP032`, …).
2. Pick the rule file that owns the concern: `src/validator/rules/{webhook-signature,amount,order-flow,idempotency,key-safety,pci,webhook-handler,capture,methods}.ts`. If none fit, add a new file and register it in `src/validator/rules/index.ts`.
3. Write the rule object: `id`, `title`, `severity` (`error|warning|info`), `concern`, `languages` (`["*"]` for any), `detector` (`{ kind: "regex", pattern: /…/ }` or `{ kind: "heuristic", fn: (ctx) => Hit[] }`), `citation` (`{ route, excerpt }` — route MUST exist in the manifest), `fix` (`{ explanation, correctPattern }`).
4. Write a test in `tests/validator/<rule-file>.test.ts` with three cases:
   - **Positive:** snippet that should trigger the rule
   - **Negative:** similar-shaped snippet that's correct
   - **Comment:** the bad pattern wrapped in a comment — should NOT fire

Run `pnpm exec tsx src/indexer/main.ts build:rules` to verify the citation route resolves; build fails if it doesn't.

### Detector picking guide

| If the bug is… | Use detector kind | Notes |
|---|---|---|
| A literal pattern (hardcoded key, currency code, port number) | `regex` | Goes through automatic comment masking |
| A relationship (call A without call B nearby) | `heuristic` | Inspect `ctx.code` / `ctx.stripped` / `ctx.lines` |
| Scope-aware (variable bound here, used there) | `heuristic` | v1; will revisit with tree-sitter when it pays off |

## Add an eval query

Edit `eval/queries.jsonl`. Each line:

```jsonl
{"id":"q081","query":"how do i set up upi recurring tokens","expected_routes":["api/payments/recurring-payments/custom/upi/tokens"],"acceptable_routes":["api/payments/recurring-payments/custom/upi"]}
```

`expected_routes` is the canonical doc; `acceptable_routes` are also-correct neighbors that count as a hit. Keep IDs sequential.

`pnpm eval` runs the new query immediately. CI fails if the suite-wide recall@3 drops more than 1pt vs `main`.

## Refine a heuristic

If a rule misfires on real code, open a PR with:
- The exact snippet (positive or negative)
- The expected behavior (fire / don't fire)
- A test in `tests/validator/<rule-file>.test.ts` capturing it

Then refine the detector. Heuristics often have proximity windows or suppression idioms that need tuning.

## Pull request checklist

- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm cspell:check` clean (add words to `cspell.json` if needed)
- [ ] `pnpm test` green
- [ ] `pnpm eval` recall@3 not regressed by > 1pt
- [ ] If a rule was added: `pnpm exec tsx src/indexer/main.ts build:rules` succeeds (citation gate)
- [ ] Conventional commit message (`feat:`, `fix:`, `docs:`, `perf:`, `refactor:`, `test:`, `chore:`)

## Code style

PRs are reviewed against the bar below. Pre-commit hooks catch most of it; the rest comes up in review.

### TypeScript

- **`strict: true`** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`. Don't relax these.
- **Never `any`.** No `as any`, no `// @ts-ignore` / `@ts-expect-error` without a `// REASON:` comment.
- **`unknown` at every boundary** (file contents, parsed JSON, env vars, MCP inputs, network responses) — narrow with a zod schema or type guard.
- **No magic strings or numbers.** Use named constants or `as const` enums. Exceptions: `0`, `1`, `-1`, `true`, `false` in obvious contexts; numeric literals in tests.
- **Discriminated unions over optional fields.** `{ kind: "regex"; pattern } | { kind: "ast"; query }`, not `{ pattern?; query? }`.
- **Branded types for IDs.** `RuleId`, `Route`, `ChunkId` shouldn't be assignable to each other.
- **`readonly` by default** on params and class fields. Prefer `ReadonlyArray<T>` in public types.
- **No `null`** — TypeScript handles `undefined` natively. Convert at the boundary.
- **No classes** unless there's genuine state across method calls or a lifecycle (open → query → close).

### Identifier naming

| Kind | Convention |
|---|---|
| Variables, functions, methods | `camelCase` |
| Types, interfaces, classes, enums | `PascalCase` |
| Module-level immutable constants | `SCREAMING_SNAKE_CASE` |
| Enum members | `PascalCase` |
| Files | `kebab-case.ts` |
| Acronyms in names | Treat as a word (`BM25Index`, not `BM25Index` — i.e., `parseHttpHeader`, `BgeEmbedder`) |

Names must reveal intent. Reject `data`, `obj`, `tmp`, `helper`, `manager`, `util`, `process`, `handle`. Use the specific noun: `chunkBatch`, `manifestRoute`, `rerankedCandidates`.

### Module boundaries (hard rejects on review)

```
indexer/   → writes dist/index/*; never imports retrieval/, tools/, validator/
retrieval/ → reads dist/index/*; never imports indexer/, tools/, validator/
validator/ → pure; never imports indexer/ or retrieval/
tools/     → wraps retrieval + validator behind MCP contracts; never imports indexer/
embedder/  → owns model_id and dim; nothing outside knows them
```

Crossing a seam in the wrong direction is an automatic reject. ESLint's `import/no-restricted-paths` enforces this.

### Embedder isolation

`model_id` and `dim` live inside `src/embedder/` only. Any string literal `"bge-small"`, numeric literal `384`/`1024`/`768`, or model identifier outside that directory is a hard reject. The whole point is that swapping embedders is a one-line change in `registry.ts`.

### MCP discipline

- **Three tools, locked.** Don't add a fourth. Each tool definition costs the agent ~550–1,400 tokens of context.
- **Tool descriptions tell the agent WHEN to use them**, not just what they do — describe the use case AND the tradeoff vs other tools.
- **Stdout is sacred** for stdio transport — MCP uses it for JSON-RPC. All logs go to stderr. `console.log` anywhere in production code is a hard reject; use `src/util/log.ts`.
- **Schemas are zod, validated on entry, validated on exit.** Errors at the boundary become MCP error responses with the field path.
- **Structured JSON content blocks**, not narrative prose. The agent parses JSON better than text.
- **Idempotent tools** — same input must yield the same output. No hidden state, no time-dependent logic.
- **Error responses are actionable.** `Invalid 'language' value 'kotlin2'. Allowed: node, python, ...`, not `Invalid input`.
- **Lazy-load expensive resources.** Embedder, reranker, tree-sitter grammars all load on the first call that needs them — not at server startup.

### Errors & logging

- **`Result<T, E>` at fallible boundaries** (file not found, network timeout). Throw only for genuinely unexpected programmer errors.
- **Errors carry context** — define error classes in the module that owns the failure (`ManifestRouteNotFoundError`, `CitationGateFailure`).
- **Never swallow errors.** `try { risky(); } catch (_) {}` is rejected. Either handle or propagate.
- **Never log + throw.** Pick one — duplicates show up twice in user output.
- **Never log secrets, full user code, or PII.** Hash + size for code submitted to validate; categories for telemetry.

### Tests

- **Vitest**, mirror `src/` layout under `tests/`.
- **Per-rule tests:** positive + negative + comment-suppression case for every validator rule.
- **Module that touches I/O:** unit test with I/O mocked + one integration test using a fixture.
- **MCP tool:** unit test of underlying logic + integration test through the MCP server.
- **No `Math.random()`** — seed all randomness; tests must be deterministic.
- **No real network**, no real HuggingFace fetches; mock the model loader.
- **No `setTimeout` waits** — use a promise barrier.
- **No shared mutable state** between tests.

### Comments

Default to **no comments**. Add one only when the *why* is non-obvious — a hidden constraint, a subtle invariant, a workaround for a specific bug. If removing the comment wouldn't confuse a future reader, don't write it. Don't restate the code; well-named identifiers do that. Don't reference current-task context (`// added because of issue #42`) — that belongs in the PR description and rots as the codebase evolves.

### Performance budgets (CI-gated)

| Metric | Budget |
|---|---|
| Cold-start (server spawn → first response) | < 2 s |
| Warm `search` p95 | < 200 ms |
| Warm `validate` p95 (≤ 500 LOC) | < 300 ms |
| Index build (BM25 only) | < 5 s |
| Steady-state RSS | < 250 MB |
| Tarball size | < 100 MB |

PRs that regress these fail CI.

## License

By contributing you agree your changes are licensed under MIT.
