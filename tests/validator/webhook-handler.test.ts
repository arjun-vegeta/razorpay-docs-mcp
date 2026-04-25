import { describe, expect, it } from "vitest";
import { fires } from "./_helpers.js";

describe("RZP011 — webhook URL on a non-standard port", () => {
  it("fires on http://example.com:8080/webhook", () => {
    const code = `const url = 'https://example.com:8080/razorpay/webhook';`;
    expect(fires(code, "RZP011")).toBe(true);
  });

  it("does not fire on default 443", () => {
    const code = `const url = 'https://example.com/razorpay/webhook';`;
    expect(fires(code, "RZP011")).toBe(false);
  });

  it("does not fire when the suspect URL is in a comment", () => {
    const code = `
      // legacy: 'https://example.com:8080/webhook'
      const url = 'https://example.com/razorpay/webhook';
    `;
    expect(fires(code, "RZP011")).toBe(false);
  });
});

describe("RZP020 — webhook handler returns non-2xx on success", () => {
  it("fires on res.status(500).send in a webhook success path", () => {
    const code = `
      app.post('/webhook', (req, res) => {
        const event = req.body;
        if (event.event === 'payment.captured') {
          fulfillOrder(event);
          res.status(500).send('processed');
        }
      });
    `;
    expect(fires(code, "RZP020")).toBe(true);
  });

  it("does not fire when the handler returns 200", () => {
    const code = `
      app.post('/webhook', (req, res) => {
        const event = req.body;
        if (event.event === 'payment.captured') {
          fulfillOrder(event);
        }
        res.status(200).end();
      });
    `;
    expect(fires(code, "RZP020")).toBe(false);
  });

  it("does not fire on 4xx returned in an explicit error/invalid branch", () => {
    const code = `
      app.post('/webhook', (req, res) => {
        if (!verifySignature(req)) {
          return res.status(400).send('invalid signature');
        }
        const event = req.body;
        fulfillOrder(event);
        res.status(200).end();
      });
    `;
    expect(fires(code, "RZP020")).toBe(false);
  });
});
