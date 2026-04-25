import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { Bm25Retriever, escapeFtsQuery, quoteFtsTerm } from "../../src/retrieval/bm25.js";

describe("quoteFtsTerm", () => {
  it("leaves bare alphanumerics unquoted", () => {
    expect(quoteFtsTerm("webhook")).toBe("webhook");
    expect(quoteFtsTerm("razorpay")).toBe("razorpay");
  });

  it("quotes terms with hyphens", () => {
    expect(quoteFtsTerm("razorpay-x")).toBe('"razorpay-x"');
  });

  it("escapes inner double quotes by doubling", () => {
    expect(quoteFtsTerm('say "hi"')).toBe('"say ""hi"""');
  });
});

describe("escapeFtsQuery", () => {
  it("returns empty for input with no extractable tokens", () => {
    expect(escapeFtsQuery("!@#")).toBe("");
  });

  it("space-joins quoted tokens (FTS5 implicit AND)", () => {
    expect(escapeFtsQuery("razorpay-x payout")).toBe('"razorpay-x" payout');
  });
});

function buildFixtureDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chunks (
      chunk_id INTEGER PRIMARY KEY,
      route TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      heading_path TEXT,
      body TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE docs USING fts5(
      title, description, category, route, heading_path, body,
      content='chunks', content_rowid='chunk_id',
      tokenize='porter unicode61 remove_diacritics 2'
    );
  `);
  const insertChunk = db.prepare(
    "INSERT INTO chunks(chunk_id, route, title, description, category, heading_path, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDoc = db.prepare(
    "INSERT INTO docs(rowid, title, description, category, route, heading_path, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const rows = [
    [1, "webhooks/validate-test", "Validate webhook", "Verify HMAC signature on Razorpay webhooks", "webhooks", "Validate Webhooks", "Use HMAC SHA256 to validate the X-Razorpay-Signature header."],
    [2, "api/orders/create", "Create an Order", "Create an order via API", "api", "Create an Order", "POST to /v1/orders to create a new order with amount and currency."],
    [3, "api/x/payouts", "RazorpayX Payouts", "Make payouts via RazorpayX", "x", "Payouts", "RazorpayX lets you create payouts to bank accounts and VPAs."],
  ];
  for (const r of rows) {
    insertChunk.run(...r);
    insertDoc.run(...r);
  }
  return db;
}

describe("Bm25Retriever", () => {
  it("returns the canonical chunk for a precise query", () => {
    const db = buildFixtureDb();
    const ret = new Bm25Retriever(db);
    const hits = ret.search("webhook signature", 5);
    expect(hits[0]?.route).toBe("webhooks/validate-test");
    db.close();
  });

  it("returns empty for an FTS5 syntax error rather than throwing", () => {
    const db = buildFixtureDb();
    const ret = new Bm25Retriever(db);
    expect(ret.search("(", 5)).toEqual([]);
    db.close();
  });

  it("returns empty for whitespace-only queries", () => {
    const db = buildFixtureDb();
    const ret = new Bm25Retriever(db);
    expect(ret.search("   ", 5)).toEqual([]);
    db.close();
  });

  it("respects k limit", () => {
    const db = buildFixtureDb();
    const ret = new Bm25Retriever(db);
    expect(ret.search("razorpay", 1)).toHaveLength(1);
    expect(ret.search("razorpay", 5).length).toBeLessThanOrEqual(3);
    db.close();
  });
});
