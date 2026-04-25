import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_BIN = resolve(__dirname, "..", "..", "dist", "server.js");
const HANDSHAKE_TIMEOUT_MS = 15_000;

interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

class StdioRpcClient {
  private readonly proc: ReturnType<typeof spawn>;
  private readonly buffer: string[] = [];
  private readonly listeners = new Map<number, (resp: RpcResponse) => void>();
  private leftover = "";

  public constructor(env: NodeJS.ProcessEnv) {
    this.proc = spawn(process.execPath, [SERVER_BIN], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout?.setEncoding("utf8");
    this.proc.stdout?.on("data", (chunk: string) => this.onChunk(chunk));
    this.proc.stderr?.setEncoding("utf8");
    this.proc.stderr?.on("data", () => {
      /* discard for tests; logger writes here */
    });
  }

  private onChunk(chunk: string): void {
    this.leftover += chunk;
    const lines = this.leftover.split("\n");
    this.leftover = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      this.buffer.push(trimmed);
      try {
        const obj = JSON.parse(trimmed) as Partial<RpcResponse> & {
          method?: string;
          params?: unknown;
        };
        if (typeof obj.id === "number") {
          const cb = this.listeners.get(obj.id);
          if (cb !== undefined) {
            this.listeners.delete(obj.id);
            cb(obj as RpcResponse);
          }
        }
      } catch {
        /* keep accumulating; not all stdout is JSON-RPC */
      }
    }
  }

  public send(id: number, method: string, params?: unknown): Promise<RpcResponse> {
    return new Promise((resolveFn, rejectFn) => {
      const timeout = setTimeout(() => {
        this.listeners.delete(id);
        rejectFn(new Error(`request ${id} (${method}) timed out`));
      }, HANDSHAKE_TIMEOUT_MS);
      this.listeners.set(id, (resp) => {
        clearTimeout(timeout);
        resolveFn(resp);
      });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.proc.stdin?.write(msg + "\n");
    });
  }

  public notify(method: string, params?: unknown): void {
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.proc.stdin?.write(msg + "\n");
  }

  public close(): void {
    this.proc.kill("SIGTERM");
  }
}

describe("MCP server stdio handshake", () => {
  let client: StdioRpcClient | undefined;

  beforeAll(() => {
    client = new StdioRpcClient({
      RZP_MCP_EMBEDDER: "none",
      RZP_MCP_RERANKER: "none",
      RZP_MCP_LOG_LEVEL: "error",
    });
  });

  afterAll(() => {
    client?.close();
  });

  it("handles initialize and lists two tools", { timeout: 20_000 }, async () => {
    const c = client;
    if (c === undefined) throw new Error("client not initialized");
    const init = await c.send(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0.0.0" },
    });
    expect(init.error).toBeUndefined();
    expect(init.result).toBeDefined();

    c.notify("notifications/initialized");

    const list = await c.send(2, "tools/list");
    expect(list.error).toBeUndefined();
    const result = list.result as { tools: { name: string }[] };
    const names = result.tools.map((t) => t.name);
    expect(names).toEqual(["search_razorpay_docs", "get_razorpay_doc"]);
  });

  it("returns structured JSON for search_razorpay_docs", { timeout: 20_000 }, async () => {
    const c = client;
    if (c === undefined) throw new Error("client not initialized");
    const resp = await c.send(3, "tools/call", {
      name: "search_razorpay_docs",
      arguments: { query: "create an order via api", k: 3 },
    });
    expect(resp.error).toBeUndefined();
    const result = resp.result as { content: { type: string; text: string }[] };
    expect(result.content[0]?.type).toBe("text");
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      results: { route: string }[];
    };
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results.map((r) => r.route)).toContain("api/orders/create");
  });

  it("returns an MCP error for unknown route in get_razorpay_doc", { timeout: 20_000 }, async () => {
    const c = client;
    if (c === undefined) throw new Error("client not initialized");
    const resp = await c.send(4, "tools/call", {
      name: "get_razorpay_doc",
      arguments: { route_or_url: "this/does/not/exist" },
    });
    expect(resp.error).toBeUndefined();
    const result = resp.result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Route not found");
  });

  it("returns full content for a known route", { timeout: 20_000 }, async () => {
    const c = client;
    if (c === undefined) throw new Error("client not initialized");
    const resp = await c.send(5, "tools/call", {
      name: "get_razorpay_doc",
      arguments: { route_or_url: "api/orders/create" },
    });
    expect(resp.error).toBeUndefined();
    const result = resp.result as { content: { text: string }[] };
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      route: string;
      title: string;
      content: string;
      url: string;
    };
    expect(payload.route).toBe("api/orders/create");
    expect(payload.url).toContain("razorpay.com");
    expect(payload.content.length).toBeGreaterThan(0);
  });
});
