import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_RULES } from "../../src/validator/rules/index.js";
import { ValidationRunner } from "../../src/validator/runner.js";
import {
  StaticCitationResolver,
  findUnresolvedCitations,
  manifestCitationResolver,
} from "../../src/validator/cite.js";
import { ManifestSchema } from "../../src/util/manifest.js";

const ROUTES = new Set<string>();
for (const r of ALL_RULES) ROUTES.add(r.citation.route);
const stub = new StaticCitationResolver(
  [...ROUTES].map((route) => [
    route,
    { url: `https://razorpay.com/docs/${route}`, title: route },
  ]),
);

function makeRunner(): ValidationRunner {
  const r = new ValidationRunner(stub);
  r.registerAll(ALL_RULES);
  return r;
}

const SLOPPY_WEBHOOK = `
const crypto = require('crypto');
const express = require('express');
const app = express();

app.post('/razorpay/webhook', (req, res) => {
  const expected = crypto
    .createHmac('sha256', process.env.RZP_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))    // <- RZP001
    .digest('hex');

  if (req.headers['x-razorpay-signature'] === expected) {  // <- RZP002
    const event = req.body;
    if (event.event === 'payment.captured') {
      fulfillOrder(event.payload.payment.entity);
      res.status(500).send('processed');                   // <- RZP020
    }
  }
});
`;

describe("validator — integration on a real-world sloppy webhook handler", () => {
  it("flags RZP001, RZP002, and RZP020 with resolvable citations", () => {
    const runner = makeRunner();
    const report = runner.validate({ code: SLOPPY_WEBHOOK, languageHint: "node" });
    const ids = report.issues.map((i) => i.ruleId);
    expect(ids).toContain("RZP001");
    expect(ids).toContain("RZP002");
    expect(ids).toContain("RZP020");
    for (const issue of report.issues) {
      expect(issue.citation.url).toMatch(/^https?:\/\//);
      expect(issue.citation.route.length).toBeGreaterThan(0);
    }
    expect(report.summary.languageDetected).toBe("node");
    expect(report.summary.bySeverity.error).toBeGreaterThanOrEqual(2);
  });

  it("returns a clean report on a correct webhook handler", () => {
    const goodHandler = `
      const crypto = require('crypto');
      app.post('/razorpay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
        const expected = crypto
          .createHmac('sha256', process.env.RZP_WEBHOOK_SECRET)
          .update(req.rawBody).digest('hex');
        const sig = Buffer.from(req.headers['x-razorpay-signature'] ?? '', 'hex');
        const exp = Buffer.from(expected, 'hex');
        if (sig.length !== exp.length || !crypto.timingSafeEqual(sig, exp)) {
          return res.status(400).end();
        }
        const event = JSON.parse(req.rawBody.toString('utf8'));
        const inserted = await db.events.insertIfMissing({ event_id: event.id });
        if (!inserted) return res.status(200).end();
        res.status(200).end();
      });
    `;
    const runner = makeRunner();
    const report = runner.validate({ code: goodHandler, languageHint: "node" });
    const errors = report.issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("validator — citation gate against the live manifest", () => {
  const manifestPath = resolve(__dirname, "..", "..", "source", "_manifest.json");

  it("every rule citation resolves to a real route in source/_manifest.json", () => {
    if (!existsSync(manifestPath)) {
      // Source corpus not available in this checkout — skip rather than fail.
      return;
    }
    const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    const manifest = ManifestSchema.parse(raw);
    const resolver = manifestCitationResolver(manifest);
    const unresolved = findUnresolvedCitations(ALL_RULES, resolver);
    expect(unresolved).toEqual([]);
  });
});
