# Architecture

How `@razorpay-docs/mcp` is built, end to end. Skim the section headings if you just want the shape; dive in if you're contributing.

## Table of contents

- [The high-level flow](#the-high-level-flow)
- [Module seams](#module-seams)
- [Indexer pipeline](#indexer-pipeline)
- [Retrieval pipeline](#retrieval-pipeline)
- [Validator](#validator)
- [MCP server](#mcp-server)
- [Embedder isolation](#embedder-isolation)
- [Storage layout](#storage-layout)
- [Performance budgets](#performance-budgets)
- [What's intentionally simple](#whats-intentionally-simple)

---

## The high-level flow

```
                          ┌─────────────────────────────────────────────┐
                          │   AI agent (Claude Code, Cursor, Codex,…)  │
                          └────────────────────┬────────────────────────┘
                                               │ JSON-RPC over stdio
                                               ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │                   @razorpay-docs/mcp  (this package)               │
   │                                                                     │
   │   ┌─────────────────────┐   ┌──────────────────┐  ┌──────────────┐│
   │   │ search_razorpay_docs│   │ get_razorpay_doc │  │ validate_…   ││
   │   └──────────┬──────────┘   └────────┬─────────┘  └──────┬───────┘│
   │              │                       │                    │        │
   │              ▼                       ▼                    ▼        │
   │     ┌────────────────────────────────────┐   ┌────────────────┐   │
   │     │      retrieval pipeline            │   │   validator    │   │
   │     │  (BM25 + vec + RRF + rerank)       │   │  (~30 rules)   │   │
   │     └─────────────────┬──────────────────┘   └────────┬───────┘   │
   │                       │                                │           │
   │                       ▼                                ▼           │
   │            ┌──────────────────────┐         ┌──────────────────┐  │
   │            │   dist/index/*.db    │         │ rule definitions │  │
   │            │  (BM25 + vec + JSON) │         │  (in-process)    │  │
   │            └──────────────────────┘         └──────────────────┘  │
   └───────────────────────────────────────────────────────────────────┘

   Indexer (offline, runs in CI / on `pnpm indexer:build`)
   ────────────────────────────────────────────────────────
   razorpay/markdown-docs  →  chunk → embed → write SQLite + JSON
```

Key design choices that follow from this picture:

1. **Local-first.** All retrieval, embedding, reranking, and validation runs in-process on the user's machine. No remote API calls during a tool invocation.
2. **Read-only at runtime.** The indexer is the only writer; the MCP server opens every SQLite handle with `SQLITE_OPEN_READONLY`.
3. **Index lives in the npm tarball.** Users get a working MCP server from `npx @razorpay-docs/mcp` with zero post-install setup. The 32 MB compressed payload (BM25 + vec + doc-graph + rules) is the cost.

---

## Module seams

Five hard boundaries enforced by ESLint's `import/no-restricted-paths`:

```
indexer/    ──▶ writes dist/index/*; never imports retrieval/, tools/, validator/
retrieval/  ──▶ reads dist/index/*; never imports indexer/, tools/, validator/
validator/  ──▶ pure; takes code in, returns issues; never imports indexer/, retrieval/
tools/      ──▶ wraps retrieval + validator behind MCP contracts; never imports indexer/
embedder/   ──▶ owns model_id and dim; nothing outside knows them
util/       ──▶ leaf utilities, no upward deps
```

A code-review reject if any import line crosses these seams in the wrong direction. The seams are what make the small→large embedder swap a one-line change in `registry.ts` instead of a refactor.

### Why this matters

- **`indexer/` writes; `retrieval/` reads.** Two completely separate code paths. The MCP server never accidentally mutates the index.
- **`validator/` is pure.** No I/O beyond the citation resolver lookup. Easy to test, easy to reason about.
- **`embedder/` is opaque from outside.** Nothing in `retrieval/`, `tools/`, or `validator/` knows which embedder is loaded — they only see the `Embedder` interface. Adding Voyage was 80 lines in `voyage.ts` + one line in `registry.ts`.

---

## Indexer pipeline

Runs offline. Outputs are committed to the npm tarball (not git).

```
razorpay/markdown-docs (cloned to source/)
  └── _manifest.json + ~2,200 markdown files
       │
       ├── pull-source.ts        git clone --depth=1 --branch master
       │                         capture HEAD SHA → source_sha (used for
       │                         the runtime auto-update check)
       │
       ├── chunk.ts              H2-primary split, H3 sub-split when a
       │                         section exceeds 800 tokens, preamble
       │                         (text before first H2) preserved as its
       │                         own chunk. Result: ~16k chunks from ~2.2k docs.
       │
       ├── extract-code.ts       parse ```<lang>: <label> fences inside each
       │                         chunk; normalize lang (nodejs/js/javascript
       │                         → node, c/csharp → dotnet, cURL → curl)
       │
       ├── extract-links.ts      raw.githubusercontent.com refs → outgoing
       │                         doc adjacency for the doc-graph
       │
       ├── build-bm25.ts         SQLite FTS5 external-content table. Fields:
       │                           title=8.0  description=4.0  category=1.0
       │                           route=2.0  heading_path=3.0  body=1.0
       │                         (titles dominate, headings matter, body is
       │                         the fallback)
       │
       ├── build-vec.ts          sqlite-vec virtual table (vec0). Embeddings
       │                         int8-quantized, 384-dim by default
       │                         (bge-small-en-v1.5). Persisted as one DB
       │                         per (slugified) model id.
       │
       ├── build-rules.ts        Citation gate: every validator rule's
       │                         citation route must exist in the manifest.
       │                         Build fails on any miss. Emits a metadata
       │                         snapshot to dist/index/rules.json.
       │
       └── doc-graph.json        adjacency map: route → [related routes]
                                 used to fill in "related" hints in search
                                 responses.
```

Rebuild paths:
- **Full**: `pnpm indexer:build` (~10 min, embedding is the bottleneck)
- **BM25 only**: `pnpm exec tsx src/indexer/main.ts build:bm25` (~5 s)
- **Different embedder**: `--embedder=base` etc. — produces a separate `index-vec-<slug>.db`

CI's nightly-rebuild workflow does this whenever upstream `razorpay/markdown-docs` HEAD changes; if SHAs match, the workflow exits in ~30 seconds.

---

## Retrieval pipeline

Lives in `src/retrieval/`. The `RetrievalPipeline` class orchestrates:

```
query
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ rewrite.ts                                              │
│   - strip stopwords, normalize whitespace               │
│   - expand domain synonyms (opt-in: precision over recall)│
│   - detect language hint, product hint, topic hint      │
│   - emit two views:                                     │
│       cleaned  → for vector embedding                   │
│       fts5     → for BM25 (escapes hyphens / quotes)    │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────────────────────────┐
│ parallel:                                                         │
│   bm25.ts   ─→  FTS5 MATCH with field-weighted bm25() scoring     │
│                  k=BM25_DEFAULT_K (60) candidates                 │
│   vector.ts ─→  embed query (lazy-load embedder), ANN over        │
│                  sqlite-vec, similarity = 1/(1+distance)          │
│                  k=VECTOR_DEFAULT_K (60) candidates               │
└──────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ rrf.ts                                                  │
│   reciprocal-rank fusion, k=60                          │
│   score(d) = Σ 1 / (k + rank_i(d))                      │
│   ties broken by chunk_id ASC for determinism           │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ filter.ts                                               │
│   - hard product filter when explicitly passed          │
│   - soft boost: matching topic (1.6×), recency (1.1×)   │
│   - re-sort                                             │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ rerank.ts (optional, default off)                       │
│   MS-MARCO MiniLM cross-encoder over top-N              │
│   raw-logit scoring (NOT softmax — saturates on         │
│   single-output cross-encoders and hurts recall)        │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ assemble.ts                                             │
│   - per-route dedupe (long docs can't claim every slot) │
│   - hydrate chunk body + code blocks (filtered to lang) │
│   - paragraph-boundary truncation at ~600 tokens        │
│   - up to 3 related-doc hints from doc-graph            │
└─────────────────────────────────────────────────────────┘
  │
  ▼
SearchResponse
```

### Why hybrid

Razorpay docs are **identifier-heavy**: queries like "create order razorpay" need exact-token matches against `orders.create` in titles. BM25 nails those. But "how do I refund a payment" wants semantic matches against `api/refunds/normal-refunds-idempotent` — that's vector territory. RRF fuses both rankings without needing to compare incompatible score scales.

### Why BM25 wins on this corpus

The shootout in `eval/reports/decision.md` measured `bge-small-en-v1.5` vs `bge-large-en-v1.5`. Large was **−5.0 pts on recall@3**, despite being 6× more compute. The reason: large is more semantic, less keyword-y, and on a corpus full of canonical names ("verify razorpay webhook signature" → `webhooks/validate-test`), keyword-locking is the feature.

So we ship small. The actual unlocks for v1.x are synonym expansion, route-level boosting, and a domain-tuned reranker — not a bigger embedder.

### Key files

| File | Role |
|---|---|
| `src/retrieval/pipeline.ts` | `RetrievalPipeline` class — owns the SQLite handles, orchestrates the steps above |
| `src/retrieval/rewrite.ts` | query → tokens, FTS5-escaped query, hints |
| `src/retrieval/bm25.ts` | FTS5 `bm25()` with field weights |
| `src/retrieval/vector.ts` | sqlite-vec ANN |
| `src/retrieval/rrf.ts` | rank fusion |
| `src/retrieval/filter.ts` | product/topic/recency boosts |
| `src/retrieval/rerank.ts` | optional cross-encoder rerank |
| `src/retrieval/assemble.ts` | dedupe, hydrate, truncate |

---

## Validator

Lives in `src/validator/`. Pure module — takes code in, returns `ValidationReport`.

```
input code
  │
  ▼
┌────────────────────────────────────────────────────┐
│ parse.ts: detect language                          │
│   - filename hint takes priority                   │
│   - else: keyword scoring across 10 SDK signatures │
│   - mask comments (preserves length+newlines)      │
│     so detectors don't false-positive on commented- │
│     out code                                       │
└────────────────────────────────────────────────────┘
  │
  ▼
┌────────────────────────────────────────────────────┐
│ runner.ts: ValidationRunner                        │
│   for each registered Rule (filtered by concern    │
│   + lang):                                         │
│     - run detector with 50 ms wall-clock budget    │
│     - regex: collect all matches                   │
│     - heuristic: invoke detector fn(ctx)           │
│     - errors caught + logged, never propagated     │
│     - dedupe on (rule_id, line)                    │
│     - resolve citation route → URL via             │
│       SqliteCitationResolver (shares the BM25 db's │
│       routes table)                                │
└────────────────────────────────────────────────────┘
  │
  ▼
ValidationReport { issues[], summary }
```

### Rule shape

Every rule is a `Rule` object with this skeleton:

```ts
{
  id: "RZP001" as RuleId,
  title: "Webhook signature computed over JSON.stringify(req.body)",
  severity: "error",
  concern: "webhook_signature",
  languages: ["*"],         // or [Lang.Node, Lang.Php, …]
  detector: { kind: "regex", pattern: /…/ },  // OR { kind: "heuristic", fn }
  citation: {
    route: "webhooks/validate-test",
    excerpt: "Compute the HMAC over the raw request body bytes…"
  },
  fix: {
    explanation: "Razorpay signs the exact bytes it sent. JSON.stringify…",
    correctPattern: "const expected = crypto.createHmac(…)…"
  }
}
```

The `Detector` schema reserves `kind: "ast"` for a future tree-sitter backend. v1 ships regex + heuristic; the 30 current rules don't need scope-aware AST queries.

### Rule files

Grouped by concern:

| File | Rules |
|---|---|
| `webhook-signature.ts` | RZP001 (HMAC on JSON.stringify), RZP002 (=== compare), RZP016 (param order), RZP028 (secret from request) |
| `amount.ts` | RZP003 (rupees not paise), RZP012 (currency mismatch), RZP022 (lowercase ISO) |
| `order-flow.ts` | RZP004 (payment without order), RZP018 (receipt > 40), RZP029 (receipt collision) |
| `idempotency.ts` | RZP008 (refund no idempotency), RZP021 (webhook no dedup) |
| `key-safety.ts` | RZP005/006 (hardcoded keys), RZP019 (test key in prod), RZP023 (key_secret in client) |
| `pci.ts` | RZP009 (CVV stored), RZP010 (PAN stored) |
| `webhook-handler.ts` | RZP011 (non-standard port), RZP020 (4xx on success) |
| `capture.ts` | RZP007 (no capture call), RZP026 (late capture) |
| `methods.ts` | RZP013–017, RZP024–025, RZP027, RZP030 |

Catalog with examples, severity, fix snippets, and citation URLs lives in [`docs/RULES.md`](./RULES.md) (auto-generated).

### Citation resolution

Two implementations of `CitationResolver`:

- **`SqliteCitationResolver`** (production): queries the BM25 db's `routes` table. No separate manifest dependency at runtime.
- **`StaticCitationResolver`** (tests): pre-seeded `Map<route, {url, title}>`.

Tests also load `source/_manifest.json` and run `findUnresolvedCitations(ALL_RULES, manifestResolver)` as a CI gate — every rule's citation MUST resolve to a real route, or the build fails.

---

## MCP server

`src/server.ts`. Three tools registered statically:

```ts
search_razorpay_docs   →  RetrievalPipeline.search(opts)
get_razorpay_doc       →  RetrievalPipeline.getDoc(opts)
validate_razorpay_code →  ValidationRunner.validate(input)
```

### Two transports

```
                ┌────────────────────────────────────────────┐
                │              MCP Server                    │
                └────────────────────┬───────────────────────┘
                                     │
                  ┌──────────────────┴────────────────────┐
                  ▼                                       ▼
        ┌─────────────────┐                   ┌────────────────────────┐
        │ stdio (default) │                   │ Streamable HTTP        │
        │                 │                   │ --http --port=N        │
        │ for editors:    │                   │                        │
        │ Claude Code,    │                   │ for shared deploys:    │
        │ Cursor, Codex,  │                   │ Cloudflare, Render,    │
        │ Continue, etc.  │                   │ Smithery, Docker       │
        └─────────────────┘                   └────────────────────────┘
```

Stdio is the default: editors spawn the binary, talk JSON-RPC over stdin/stdout. Stdout is reserved for protocol traffic — every log line goes to stderr.

### Startup

`createServer()` does the eager work:

1. Open the BM25 db (10 ms — cheap)
2. Open the vec db (10 ms — also cheap)
3. Load the doc graph
4. Register 30 validator rules + verify their citations resolve
5. Detect SDK from cwd manifests (`package.json`, `composer.json`, `requirements.txt`, `Gemfile`, `go.mod`, etc.)
6. Schedule the auto-update check (fire-and-forget)

The embedder + reranker are NOT loaded at startup. They lazy-load on the first call that needs them — keeps cold-start under 2 s.

### Request flow

```
JSON-RPC initialize
  ▼
tools/list   →  returns the three tool descriptors
  ▼
tools/call name="search_razorpay_docs" arguments={…}
  ▼
zod validate input
  ▼
RetrievalPipeline.search(opts)
  ▼
zod validate output
  ▼
return { content: [{ type: "text", text: JSON.stringify(out) }] }
```

Errors at any boundary become MCP error responses with actionable messages — `"Invalid 'language' value: 'kotlin2'. Allowed: node, python, php, java, ruby, go, dotnet, kotlin, curl."`, never a stack trace.

### Auto-update

`src/util/auto-update.ts`. On startup:

1. Read `source_sha` from the BM25 db's `meta` table
2. Check `~/.cache/razorpay-docs-mcp/last-update-check` — skip if checked in last 24 h
3. Fetch upstream HEAD SHA from `api.github.com/repos/razorpay/markdown-docs/commits/master` (5 s timeout, no auth)
4. If different: log a one-line stderr nudge — `Razorpay docs updated upstream (abc1234 → def5678). Run \`npm i -g @razorpay-docs/mcp@latest\` to refresh.`

Disabled with `RZP_MCP_AUTO_UPDATE=0`. Tests always set this.

---

## Embedder isolation

`src/embedder/` owns model selection. The rest of the codebase references embedders by spec name only — `model_id` and `dim` never leak past this seam.

```ts
// src/embedder/registry.ts
const FACTORIES: Record<EmbedderSpec, () => Embedder> = {
  none:   () => new NoopEmbedder(),
  small:  () => new HfEmbedder("Xenova/bge-small-en-v1.5", 384, 512),
  base:   () => new HfEmbedder("Xenova/bge-base-en-v1.5",  768, 512),
  large:  () => new HfEmbedder("Xenova/bge-large-en-v1.5", 1024, 512),
  m3:     () => new HfEmbedder("Xenova/bge-m3",            1024, 8192),
  voyage: () => new VoyageEmbedder(),
  cohere: () => new CohereEmbedder(),
};
```

| Spec | Source | Dim | Cost |
|---|---|---|---|
| `none` | NoopEmbedder | — | BM25-only mode (testing, low-resource hosts) |
| **`small`** (default) | `bge-small-en-v1.5` | 384 | local, ~32 MB |
| `base` | `bge-base-en-v1.5` | 768 | local, ~110 MB |
| `large` | `bge-large-en-v1.5` | 1024 | local, ~440 MB; **empirically worse on this corpus** |
| `m3` | `bge-m3` | 1024 | local, ~2.2 GB; multilingual, opt-in |
| `voyage` | Voyage `voyage-3-lite` | 512 | API, BYO `VOYAGE_API_KEY` |
| `cohere` | Cohere `embed-english-v3.0` | 1024 | API, BYO `COHERE_API_KEY` |

BYO embedders are read+write side: the user rebuilds the index with the same embedder so query and document dims match. The infra is shipped; whether users actually want to use them is their call.

---

## Storage layout

```
dist/index/
├── index-bm25.db                       43 MB   FTS5 + meta + routes + code_blocks
├── index-vec-bge-small-en-v1.5.db      26 MB   sqlite-vec, int8-quantized
├── doc-graph.json                     0.5 MB   adjacency: route → [related routes]
└── rules.json                       < 0.1 MB   metadata snapshot of all rules
```

Total: ~70 MB unpacked. Tarball is 32 MB compressed. Well under npm's effective ceiling for a self-contained docs+search package.

The `meta` table inside `index-bm25.db` carries:
- `source_sha` — upstream razorpay/markdown-docs HEAD when this index was built
- `built_at` — ISO 8601 timestamp
- `n_chunks`, `n_docs`, `n_code_blocks`

Auto-update reads `source_sha`. The same `meta` table is what the citation resolver queries.

---

## Performance budgets

| Metric | Budget | Where measured | Status |
|---|---|---|---|
| Cold-start (server spawn → first response) | < 2 s | manual | ✅ ~1 s typical |
| Warm `search` p95 | < 200 ms | eval harness | ✅ 32 ms |
| Warm `search` p50 | < 50 ms | eval harness | ✅ 10 ms |
| Warm `validate` p95 (≤ 500 LOC) | < 300 ms | inline timing | ✅ ~5 ms |
| Avg response tokens (search) | < 2,500 | eval harness | ✅ 2,435 |
| Steady-state RSS | < 250 MB | manual probe | ✅ ~150 MB w/o reranker |
| Index build (BM25 only) | < 5 s | indexer log | ✅ ~1 s |
| Index build (with bge-small embeddings) | < 10 min | local | ✅ ~10 min on Mac |
| Tarball size | < 100 MB | `npm pack --dry-run` | ✅ 32.3 MB compressed |
| Eval recall@3 (Phase 3 gate) | ≥ 0.80 | `pnpm eval` | ✅ 0.80 |

PRs that regress these in CI fail the workflow.

---

## What's intentionally simple

- **No tree-sitter (yet).** All 30 validator rules are regex/heuristic. The `Detector` schema reserves `kind: "ast"` for a future backend; we'll add it when a real rule needs scope-awareness regex can't fake (`payments.create` in the same function as `orders.create`, etc.).
- **No telemetry.** Off by default; we don't ship a server-side endpoint. Even with `RZP_MCP_TELEMETRY=1` the data is local-only category counters.
- **No code execution.** The validator parses (will parse, with tree-sitter) — never runs user code. No `eval()`, no `Function()`, no `vm.runInNewContext`, no `child_process` with user input as command.
- **No remote inference.** All embedding, reranking, and validation runs in-process. BYO Voyage/Cohere is the explicit opt-in escape hatch for users who want it.
- **No background workers.** The 50 ms per-rule timeout is soft (we check elapsed time after the fact, not a hard kill). Hard timeouts would require workers; cost > benefit at v1.
- **No cross-version migration.** When the index schema changes, we bump `schema_version` in meta and the server refuses to start with a clear error pointing at `npm i -g @razorpay-docs/mcp@latest`. No silent migrations.
