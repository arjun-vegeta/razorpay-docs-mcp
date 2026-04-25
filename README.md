# @razorpay-docs/mcp

> Unofficial. Not affiliated with Razorpay Software Pvt. Ltd.

Local-first MCP server for Razorpay documentation. Search 2,200+ official Razorpay docs and (Phase 4+) validate user code against known Razorpay integration bug patterns — entirely on the user's machine, no API keys, no rate limits.

**Status:** in development.

## Build status

```
Phase 1  Foundation & corpus       done
Phase 2  Indexing pipeline         done
Phase 3  Retrieval + 2 MCP tools   in progress
Phase 4  Validator + 30 rules      pending
Phase 5  Quality, polish, ship     pending
```

## Local dogfood (Phase 3)

```bash
pnpm install
pnpm exec tsx src/indexer/main.ts pull          # clone razorpay/markdown-docs
pnpm exec tsx src/indexer/main.ts build:bm25    # ~1s
pnpm exec tsx src/indexer/main.ts build:vec --embedder=small  # ~10 min, one-time
pnpm build                                       # bundle dist/server.js
```

Wire into Claude Code (`~/.claude/mcp_servers.json` or per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "razorpay-docs": {
      "command": "node",
      "args": ["/abs/path/to/razorpay-docs/dist/server.js"]
    }
  }
}
```

Or for Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "razorpay-docs": {
      "command": "node",
      "args": ["/abs/path/to/razorpay-docs/dist/server.js"]
    }
  }
}
```

Restart the editor and ask a Razorpay question — the agent should call `search_razorpay_docs`.

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `RZP_MCP_EMBEDDER` | `small` | `none` / `small` / `base` / `large` / `m3` |
| `RZP_MCP_RERANKER` | `none` | `none` / `tiny` |
| `RZP_MCP_LOG_LEVEL` | `warn` | `error` / `warn` / `info` / `debug` (stderr) |
| `RZP_MCP_INDEX_DIR` | `dist/index` | override path to index files |

## Eval harness

```bash
pnpm eval                                          # default config
pnpm eval --reranker=tiny --report eval/reports/with-rerank.md
pnpm eval --validate-routes-only                   # CI route-resolution gate
```

Pass criteria: recall@3 ≥ 0.80, p95 latency ≤ 200 ms.

## Tools (MCP)

- **`search_razorpay_docs(query, language?, product?, topic?, k?)`** — hybrid BM25 + vector retrieval, returns ≤10 chunks with code samples filtered to your SDK language.
- **`get_razorpay_doc(route_or_url, language?, format?)`** — fetch full content for a known route.
- **`validate_razorpay_code(code, language?, concern?)`** — *(Phase 4)* — detects ~30 known Razorpay integration bugs.

## License

MIT — see [`LICENSE`](LICENSE).

Documentation indexed by this project comes from [`razorpay/markdown-docs`](https://github.com/razorpay/markdown-docs) (also MIT). This project is unofficial and not affiliated with Razorpay.
