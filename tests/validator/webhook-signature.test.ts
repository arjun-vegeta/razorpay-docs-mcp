import { describe, expect, it } from "vitest";
import { fires } from "./_helpers.js";

describe("RZP001 — webhook HMAC over JSON.stringify(body)", () => {
  it("fires on createHmac().update(JSON.stringify(req.body))", () => {
    const code = `
      const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body)).digest('hex');
    `;
    expect(fires(code, "RZP001")).toBe(true);
  });

  it("does not fire when hashing the raw body", () => {
    const code = `
      const expected = crypto.createHmac('sha256', secret)
        .update(req.rawBody).digest('hex');
    `;
    expect(fires(code, "RZP001")).toBe(false);
  });

  it("does not fire on the pattern inside a comment", () => {
    const code = `
      // do NOT do: crypto.createHmac('sha256', s).update(JSON.stringify(req.body))
      const expected = crypto.createHmac('sha256', s).update(req.rawBody).digest('hex');
    `;
    expect(fires(code, "RZP001")).toBe(false);
  });
});

describe("RZP002 — signature compared with `===` instead of timing-safe equal", () => {
  it("fires when signature is compared with ===", () => {
    const code = `
      const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
      if (req.headers['x-razorpay-signature'] === expected) { res.status(200).end(); }
    `;
    expect(fires(code, "RZP002")).toBe(true);
  });

  it("does not fire when timingSafeEqual is used", () => {
    const code = `
      const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
      const sig = Buffer.from(req.headers['x-razorpay-signature'] ?? '', 'hex');
      const exp = Buffer.from(expected, 'hex');
      if (sig.length === exp.length && crypto.timingSafeEqual(sig, exp)) { res.status(200).end(); }
    `;
    expect(fires(code, "RZP002")).toBe(false);
  });

  it("does not fire on the pattern inside a string literal", () => {
    const code = `
      const note = "if (signature === expected) is wrong — use timingSafeEqual";
      const expected = crypto.createHmac('sha256', s).update(req.rawBody).digest('hex');
      if (crypto.timingSafeEqual(Buffer.from(req.headers['x-razorpay-signature'] ?? ''), Buffer.from(expected))) {}
    `;
    expect(fires(code, "RZP002")).toBe(false);
  });
});

describe("RZP016 — payment signature concat in the wrong order", () => {
  it("fires on payment_id|order_id concat", () => {
    const code = `
      const body = razorpay_payment_id + '|' + razorpay_order_id;
      const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    `;
    expect(fires(code, "RZP016")).toBe(true);
  });

  it("does not fire on canonical order_id|payment_id concat", () => {
    const code = `
      const body = razorpay_order_id + '|' + razorpay_payment_id;
      const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    `;
    expect(fires(code, "RZP016")).toBe(false);
  });

  it("does not fire when the wrong order is in a comment", () => {
    const code = `
      // wrong: razorpay_payment_id + '|' + razorpay_order_id
      const body = razorpay_order_id + '|' + razorpay_payment_id;
    `;
    expect(fires(code, "RZP016")).toBe(false);
  });
});

describe("RZP028 — webhook secret read from request input", () => {
  it("fires when secret is read from req.headers", () => {
    const code = `
      const secret = req.headers['x-razorpay-secret'];
      const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    `;
    expect(fires(code, "RZP028")).toBe(true);
  });

  it("does not fire when secret comes from environment", () => {
    const code = `
      const secret = process.env.RZP_WEBHOOK_SECRET;
      const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    `;
    expect(fires(code, "RZP028")).toBe(false);
  });

  it("does not fire when the bad pattern is in a comment", () => {
    const code = `
      // anti-pattern: secret = req.headers['x-razorpay-secret']
      const secret = process.env.RZP_WEBHOOK_SECRET;
    `;
    expect(fires(code, "RZP028")).toBe(false);
  });
});
