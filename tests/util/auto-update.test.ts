import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAutoUpdateCheck } from "../../src/util/auto-update.js";

let db: ReturnType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
});
afterEach(() => {
  db.close();
});

function seedSha(sha: string): void {
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run("source_sha", sha);
}

describe("auto-update", () => {
  it("logs nothing when upstream sha matches indexed sha", async () => {
    seedSha("abc1234567890");
    const fetchSha = vi.fn(async () => "abc1234567890");
    await runAutoUpdateCheck({ db, fetchSha, bypassRateLimit: true });
    expect(fetchSha).toHaveBeenCalledOnce();
  });

  it("logs an upgrade nudge when upstream sha differs", async () => {
    seedSha("abc1234567890");
    const fetchSha = vi.fn(async () => "def9876543210");
    const stderrWrites: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        stderrWrites.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    process.env["RZP_MCP_LOG_LEVEL"] = "info";
    try {
      await runAutoUpdateCheck({ db, fetchSha, bypassRateLimit: true });
    } finally {
      spy.mockRestore();
      void orig;
      delete process.env["RZP_MCP_LOG_LEVEL"];
    }
    const joined = stderrWrites.join("");
    expect(joined).toMatch(/Razorpay docs updated upstream/);
    expect(joined).toMatch(/abc1234/);
    expect(joined).toMatch(/def9876/);
  });

  it("skips silently when index has no source_sha", async () => {
    const fetchSha = vi.fn(async () => "abc1234567890");
    await runAutoUpdateCheck({ db, fetchSha, bypassRateLimit: true });
    expect(fetchSha).not.toHaveBeenCalled();
  });

  it("skips silently when fetchSha returns undefined (network error)", async () => {
    seedSha("abc1234567890");
    const fetchSha = vi.fn(async () => undefined);
    await runAutoUpdateCheck({ db, fetchSha, bypassRateLimit: true });
    expect(fetchSha).toHaveBeenCalledOnce();
  });
});
