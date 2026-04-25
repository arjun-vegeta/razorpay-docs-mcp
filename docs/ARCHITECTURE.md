# Architecture

A short tour of the moving parts. The full design lives in `plan.md` (gitignored, internal).

## Module seams

```
indexer/    → writes dist/index/*.db + .json; never imports retrieval/, tools/, validator/
retrieval/  → reads dist/index/*; never imports indexer/, tools/, validator/
validator/  → pure; takes code in, returns issues; never imports indexer/, retrieval/
tools/      → wraps retrieval + validator behind MCP tool contracts; never imports indexer/
embedder/   → owns model_id and dim; nothing outside knows them
util/       → leaf utilities, no upward deps
```

A code-review reject if any import line crosses these seams in the wrong direction.

## Indexer pipeline

```
razorpay/markdown-docs (cloned to source/)
  └── _manifest.json + ~2,200 markdown files
       │
       ├── chunk          → H2/H3 boundaries, 800-token soft cap, preamble preserved
       ├── extract code   → ```<lang>: <label> blocks per chunk
       ├── extract links  → raw.githubusercontent.com cross-refs
       ├── build BM25     → SQLite FTS5 external-content table, field-weighted (title=8, desc=4, headingPath=3)
       ├── build vectors  → sqlite-vec int8-quantized, 384-dim by default (bge-small-en-v1.5)
       ├── build rules    → validates citation routes vs manifest; emits dist/index/rules.json
       └── doc graph      → JSON adjacency for related-doc hints
```

Output: `dist/index/{index-bm25.db, index-vec-<model>.db, doc-graph.json, rules.json}`.

## Retrieval pipeline

```
query
  ├── rewrite            → strip stopwords, expand synonyms (opt-in), detect language/product/topic
  ├── parallel(BM25, vec) → BM25 over FTS5; vector over sqlite-vec ANN
  ├── RRF fusion         → reciprocal-rank with k=60, deterministic chunk-id tiebreak
  ├── filters            → hard product filter when explicit; soft boosts for topic + recency
  ├── (optional) rerank  → MS-MARCO MiniLM cross-encoder, raw-logit scoring (no softmax)
  ├── per-route dedupe   → keep best chunk per route; long docs can't claim every slot
  └── assemble           → hydrate full body, code blocks filtered to language, related links

response
```

Lazy-loads embedder and reranker on first call. Both DBs open `SQLITE_OPEN_READONLY` at startup.

## Validator

```
input code
  ├── detect language    → filename extension > content keyword scoring
  ├── mask comments      → preserves length+newlines; strings left intact
  ├── for each rule (filtered by concern + lang):
  │     ├── regex/heuristic detector with 50ms budget
  │     ├── catch errors, log, continue
  │     └── dedupe on (rule_id, line)
  └── resolve citations  → SqliteCitationResolver against the BM25 routes table

ValidationReport { issues, summary }
```

30 rules ship in v1. Each has positive + negative + comment-suppression tests. The `Detector` schema reserves `kind: "ast"` for a future tree-sitter backend.

## MCP server

Three tools, registered statically:
- `search_razorpay_docs` — wraps `RetrievalPipeline.search`
- `get_razorpay_doc` — wraps `RetrievalPipeline.getDoc`
- `validate_razorpay_code` — wraps `ValidationRunner.validate`

Two transports:
- **stdio** (default) — agents spawn the binary and talk JSON-RPC over stdio
- **streamable HTTP** (`--http --port=N`) — for shared deployments

On startup the server detects the user's SDK from cwd manifests (`package.json`, `composer.json`, …) and uses it as the default `language` filter when the agent doesn't specify one. Auto-update fires a fire-and-forget GitHub commits-API check at most once per 24 h to detect upstream doc changes.

## Embedder isolation

`src/embedder/` owns model selection. The rest of the codebase references embedders by spec name only (`small`, `large`, `voyage`, …); `model_id` and `dim` never leak past this seam. Adding an embedder is one line in `registry.ts`.

| Spec | Source | Dim | Cost |
|---|---|---|---|
| `none` | NoopEmbedder | 0 | BM25-only mode |
| `small` (default) | bge-small-en-v1.5 (HF, ONNX) | 384 | local, ~32 MB |
| `base` | bge-base-en-v1.5 | 768 | local, ~110 MB |
| `large` | bge-large-en-v1.5 | 1024 | local, ~440 MB |
| `m3` | bge-m3 (multilingual) | 1024 | local, ~2.2 GB |
| `voyage` | Voyage `voyage-3-lite` | 512 | API, BYO key |
| `cohere` | Cohere `embed-english-v3.0` | 1024 | API, BYO key |

## Performance budgets

| Metric | Budget | Where measured |
|---|---|---|
| Cold-start | < 2 s | `node dist/server.js` to first response |
| Warm `search` p95 | < 200 ms | eval harness |
| Warm `validate` p95 (≤ 500 LOC) | < 300 ms | inline timing |
| Steady-state RSS | < 250 MB | manual probe |
| Index build (BM25 only) | < 5 s | indexer log |
| Index build (with embeddings) | < 10 min | depends on embedder |

## What's intentionally simple

- **No tree-sitter.** All 30 rules are regex/heuristic. The detector schema reserves `kind: "ast"` for a future backend; we'll add it when a real rule needs scope-awareness regex can't fake.
- **No telemetry.** Off by default; we don't ship a server-side endpoint.
- **No code execution.** Tree-sitter, when added, parses to AST — never runs user code.
