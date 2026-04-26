# @razorpay-docs/mcp

> Unofficial. Not affiliated with Razorpay Software Pvt. Ltd.

[![npm version](https://img.shields.io/npm/v/@razorpay-docs/mcp.svg)](https://www.npmjs.com/package/@razorpay-docs/mcp)
[![license](https://img.shields.io/npm/l/@razorpay-docs/mcp.svg)](./LICENSE)

A local-first MCP server for Razorpay's docs and SDKs. **Works with every major AI coding agent** that speaks the Model Context Protocol — they all gain three tools: `search_razorpay_docs`, `get_razorpay_doc`, and `validate_razorpay_code` (linter against ~30 Razorpay-specific integration rules).

Entirely on your machine. **No API keys. No rate limits. No telemetry.**

## Supported agents

Drop the same JSON snippet into any of these — wiring is identical because they all speak MCP over stdio:

| Agent | Config file | Status |
|---|---|---|
| **Claude Code** (CLI + desktop) | `~/.claude/mcp_servers.json` *or* `<project>/.mcp.json` | ✅ tested |
| **Cursor** | `<project>/.cursor/mcp.json` *or* `~/.cursor/mcp.json` | ✅ tested |
| **OpenAI Codex CLI** | `~/.codex/config.toml` (`[mcp_servers.razorpay-docs]`) | ✅ supported |
| **VS Code Copilot Chat** (MCP) | `<project>/.vscode/mcp.json` | ✅ supported |
| **Continue** | `~/.continue/config.yaml` (`mcpServers:`) | ✅ supported |
| **Cline** | settings panel → MCP servers → add | ✅ supported |
| **Windsurf** (Cascade) | `~/.codeium/windsurf/mcp_config.json` | ✅ supported |
| **Zed** | `~/.config/zed/settings.json` (`context_servers:`) | ✅ supported |
| **Any other MCP client** | wherever its `mcpServers` config lives | ✅ — it's just MCP |

## Quick start

```bash
npx -y @razorpay-docs/mcp@latest --version
```

Then drop the snippet for your editor below and restart the editor. The agent will call the tools whenever you ask a Razorpay-related question.

### Claude Code

`~/.claude/mcp_servers.json` (global) or `<project>/.mcp.json` (per-project):

```json
{
  "mcpServers": {
    "razorpay-docs": {
      "command": "npx",
      "args": ["-y", "@razorpay-docs/mcp@latest"]
    }
  }
}
```

### Cursor

`<project>/.cursor/mcp.json` (or `~/.cursor/mcp.json` for global):

```json
{
  "mcpServers": {
    "razorpay-docs": {
      "command": "npx",
      "args": ["-y", "@razorpay-docs/mcp@latest"]
    }
  }
}
```

### OpenAI Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.razorpay-docs]
command = "npx"
args = ["-y", "@razorpay-docs/mcp@latest"]
```

### VS Code Copilot Chat

`<project>/.vscode/mcp.json`:

```json
{
  "servers": {
    "razorpay-docs": {
      "command": "npx",
      "args": ["-y", "@razorpay-docs/mcp@latest"]
    }
  }
}
```

### Continue, Cline, Windsurf, Zed, anything else

Same JSON shape, different keys per host. The `command` is always `npx` and `args` is always `["-y", "@razorpay-docs/mcp@latest"]`. Refer to your editor's MCP-server documentation for where to put it.

### Streamable HTTP (deployed)

```bash
npx @razorpay-docs/mcp@latest --http --port=3030
```

Then point your client at `http://localhost:3030/`. Useful for shared deployments (Cloudflare Workers, Render, internal Docker, Smithery).

## What you get

| Tool | Purpose | Returns |
|---|---|---|
| `search_razorpay_docs` | Hybrid BM25 + dense retrieval over 2,200+ official docs | Ranked chunks with title, summary, body excerpt, code blocks filtered to your SDK, canonical URL |
| `get_razorpay_doc` | Fetch full content for a known route or URL | Whole markdown body + outgoing links |
| `validate_razorpay_code` | Lint a snippet against ~30 known Razorpay integration bugs | Issues with rule id, severity, fix suggestion, citation URL |

The validator is the killer feature: it catches bugs that retrieval can't (HMAC over `JSON.stringify(req.body)`, `===` comparison on signatures, hardcoded `rzp_live_*` keys, refunds without `Idempotency-Key`, …) and points the agent at the exact doc that explains the fix.

SDK auto-detect: if your project root has a `package.json` / `composer.json` / `requirements.txt` / `Gemfile` / `go.mod` / `pom.xml` listing Razorpay, results auto-prioritize code samples in that language.

## Why this beats Context7

Context7 is a generic docs MCP. We're Razorpay-specific:

- **2,200+ docs, refreshed nightly** — Razorpay's full official corpus, not a scraped subset
- **Code samples filtered to your SDK** — answer in your language, every time
- **Validator with curated rules** — 30 rules with citations to canonical docs; not a regex catalog
- **Local-first** — fast, free, private, no rate limits
- **Hybrid retrieval** — BM25 for identifier-heavy queries, dense vectors for synonyms, RRF fusion

[Eval comparison →](./eval/reports/decision.md)

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `RZP_MCP_EMBEDDER` | `small` | `none` / `small` / `base` / `large` / `m3` / `voyage` / `cohere` |
| `RZP_MCP_RERANKER` | `none` | `none` / `tiny` |
| `RZP_MCP_LOG_LEVEL` | `warn` | `error` / `warn` / `info` / `debug` (stderr only) |
| `RZP_MCP_INDEX_DIR` | `<install>/dist/index` | override path to index files |
| `RZP_MCP_AUTO_UPDATE` | `1` | `0` disables the daily upstream-update check |
| `VOYAGE_API_KEY` | — | required if `RZP_MCP_EMBEDDER=voyage` |
| `COHERE_API_KEY` | — | required if `RZP_MCP_EMBEDDER=cohere` |
| `RZP_MCP_VOYAGE_MODEL` | `voyage-3-lite` | override Voyage model |
| `RZP_MCP_COHERE_MODEL` | `embed-english-v3.0` | override Cohere model |

## BYO API keys (optional)

By default everything runs locally with `bge-small-en-v1.5` (32 MB, 384-dim) — good enough for ~80% recall@3 on our 80-query eval. If you want top-quality retrieval and don't mind a network round-trip per query, plug in Voyage or Cohere. You'll need to **rebuild the index** with the same embedder so query and document dims match:

```bash
VOYAGE_API_KEY=… RZP_MCP_EMBEDDER=voyage pnpm indexer:build --embedder=voyage
```

Then run the server with the same env vars set.

## Privacy

- All retrieval, embedding, reranking, and validation runs locally. The corpus + indexes ship in the npm package.
- The only network call is the daily "upstream docs updated?" check to `api.github.com/repos/razorpay/markdown-docs/commits/master` — no auth, no payload, just a SHA compare. Disable with `RZP_MCP_AUTO_UPDATE=0`.
- Zero telemetry. We don't phone home.

## Local dev / contributing

```bash
pnpm install
pnpm indexer:pull              # clone razorpay/markdown-docs
pnpm indexer:build             # ~1s for BM25, ~10 min for embeddings (one-time)
pnpm indexer:build --embedder=small   # rebuild vector index for a different embedder
pnpm exec tsx src/indexer/main.ts build:rules   # CI gate: every rule citation resolves
pnpm build                     # bundle dist/server.js
pnpm test                      # full suite
pnpm eval                      # retrieval gates: recall@3 ≥ 0.80, p95 ≤ 200ms
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for adding rules and queries.

## Architecture

[Architecture overview →](./docs/ARCHITECTURE.md)

[Validation rules catalog →](./docs/RULES.md) (auto-generated from `dist/index/rules.json`)

## License

MIT — see [`LICENSE`](LICENSE).

Documentation indexed by this project comes from [`razorpay/markdown-docs`](https://github.com/razorpay/markdown-docs) (also MIT). This project is unofficial and not affiliated with Razorpay Software Pvt. Ltd.
