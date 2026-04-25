import { describe, expect, it } from "vitest";
import { fires } from "./_helpers.js";

describe("RZP013 — subscription addons without validation", () => {
  it("fires when subscriptions.create has addons but no validation", () => {
    const code = `
      await razorpay.subscriptions.create({
        plan_id: 'plan_x',
        total_count: 12,
        addons: rawAddonsFromUser,
      });
    `;
    expect(fires(code, "RZP013")).toBe(true);
  });

  it("does not fire when addons are validated via zod", () => {
    const code = `
      const addons = AddonSchema.array().parse(rawAddons);
      await razorpay.subscriptions.create({ plan_id, addons, total_count });
    `;
    expect(fires(code, "RZP013")).toBe(false);
  });

  it("does not fire when subscriptions.create has no addons", () => {
    const code = `await razorpay.subscriptions.create({ plan_id: 'plan_x', total_count: 12 });`;
    expect(fires(code, "RZP013")).toBe(false);
  });
});

describe("RZP014 — UPI intent without callback_url", () => {
  it("fires on UPI intent without callback_url", () => {
    const code = `await razorpay.payments.create({ method: 'upi', flow: 'intent', amount: 50000 });`;
    expect(fires(code, "RZP014")).toBe(true);
  });

  it("does not fire when callback_url is set", () => {
    const code = `await razorpay.payments.create({ method: 'upi', flow: 'intent', amount: 50000, callback_url: 'https://x.com/return' });`;
    expect(fires(code, "RZP014")).toBe(false);
  });

  it("does not fire when the intent flow is in a comment", () => {
    const code = `
      // earlier: method: 'upi', flow: 'intent'
      await razorpay.payments.create({ method: 'card', amount: 50000 });
    `;
    expect(fires(code, "RZP014")).toBe(false);
  });
});

describe("RZP015 — Payment Link without expire_by", () => {
  it("fires when paymentLink.create has no expire_by", () => {
    const code = `await razorpay.paymentLink.create({ amount: 50000, currency: 'INR' });`;
    expect(fires(code, "RZP015")).toBe(true);
  });

  it("does not fire when expire_by is set", () => {
    const code = `
      await razorpay.paymentLink.create({
        amount: 50000, currency: 'INR',
        expire_by: Math.floor(Date.now() / 1000) + 86400,
      });
    `;
    expect(fires(code, "RZP015")).toBe(false);
  });

  it("does not fire when the paymentLink.create call is in a comment", () => {
    const code = `
      // legacy: razorpay.paymentLink.create({ amount, currency: 'INR' })
      await razorpay.paymentLink.create({ amount: 50000, currency: 'INR', expire_by: 1700000000 });
    `;
    expect(fires(code, "RZP015")).toBe(false);
  });
});

describe("RZP017 — notes value too long", () => {
  it("fires when a notes value exceeds 256 chars", () => {
    const long = "x".repeat(280);
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR', notes: { ref: '${long}' } });`;
    expect(fires(code, "RZP017")).toBe(true);
  });

  it("does not fire on short notes values", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR', notes: { ref: 'order_42' } });`;
    expect(fires(code, "RZP017")).toBe(false);
  });

  it("does not fire when no notes object is present", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR' });`;
    expect(fires(code, "RZP017")).toBe(false);
  });
});

describe("RZP024 — partner missing X-Razorpay-Account header", () => {
  it("fires on partner-flavored code without the header", () => {
    const code = `
      const subMerchantId = req.body.account;
      const order = await razorpay.orders.create({ amount, currency: 'INR' });
    `;
    expect(fires(code, "RZP024")).toBe(true);
  });

  it("does not fire when X-Razorpay-Account is set", () => {
    const code = `
      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'X-Razorpay-Account': 'acc_' + subMerchantId },
        body: JSON.stringify({ amount, currency: 'INR' }),
      });
    `;
    expect(fires(code, "RZP024")).toBe(false);
  });

  it("does not fire on non-partner code", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR' });`;
    expect(fires(code, "RZP024")).toBe(false);
  });
});

describe("RZP025 — recurring auth amount above ₹15000", () => {
  it("fires on auth_amount: 1600000 with recurring: 'preferred'", () => {
    const code = `
      await razorpay.orders.create({
        amount: 50000, currency: 'INR',
        recurring: 'preferred',
        auth_amount: 1600000,
      });
    `;
    expect(fires(code, "RZP025")).toBe(true);
  });

  it("does not fire on auth_amount: 100 (token charge)", () => {
    const code = `
      await razorpay.orders.create({
        amount: 50000, currency: 'INR',
        recurring: 'preferred',
        auth_amount: 100,
      });
    `;
    expect(fires(code, "RZP025")).toBe(false);
  });

  it("does not fire when recurring is not 'preferred'", () => {
    const code = `
      await razorpay.orders.create({
        amount: 50000, currency: 'INR',
        auth_amount: 1600000,
      });
    `;
    expect(fires(code, "RZP025")).toBe(false);
  });
});

describe("RZP027 — refund without speed", () => {
  it("fires on refund without speed", () => {
    const code = `await razorpay.payments.refund(paymentId, { amount: 10000 });`;
    expect(fires(code, "RZP027")).toBe(true);
  });

  it("does not fire when speed is set", () => {
    const code = `await razorpay.payments.refund(paymentId, { amount: 10000, speed: 'optimum' });`;
    expect(fires(code, "RZP027")).toBe(false);
  });

  it("does not fire when refund is in a comment", () => {
    const code = `
      // refunds.create({ amount }) used to default to normal
      await razorpay.payments.refund(paymentId, { amount: 10000, speed: 'normal' });
    `;
    expect(fires(code, "RZP027")).toBe(false);
  });
});

describe("RZP030 — outdated SDK version", () => {
  it("fires on \"razorpay\": \"^1.x.x\" in package.json", () => {
    const code = `{ "dependencies": { "razorpay": "^1.4.0" } }`;
    expect(fires(code, "RZP030")).toBe(true);
  });

  it("does not fire on the current major", () => {
    const code = `{ "dependencies": { "razorpay": "^2.9.0" } }`;
    expect(fires(code, "RZP030")).toBe(false);
  });

  it("does not fire when no razorpay dependency is declared", () => {
    const code = `{ "dependencies": { "express": "^4.19.0" } }`;
    expect(fires(code, "RZP030")).toBe(false);
  });
});
