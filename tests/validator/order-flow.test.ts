import { describe, expect, it } from "vitest";
import { fires } from "./_helpers.js";

describe("RZP004 — payments.create without preceding orders.create", () => {
  it("fires when only payments.create exists", () => {
    const code = `
      const p = await razorpay.payments.create({ amount: 50000, currency: 'INR' });
    `;
    expect(fires(code, "RZP004")).toBe(true);
  });

  it("does not fire when orders.create precedes payments.create", () => {
    const code = `
      const o = await razorpay.orders.create({ amount: 50000, currency: 'INR' });
      const p = await razorpay.payments.create({ order_id: o.id });
    `;
    expect(fires(code, "RZP004")).toBe(false);
  });

  it("does not fire when payments.create is in a comment", () => {
    const code = `
      // legacy: razorpay.payments.create({ ... })
      const o = await razorpay.orders.create({ amount: 50000, currency: 'INR' });
    `;
    expect(fires(code, "RZP004")).toBe(false);
  });
});

describe("RZP018 — receipt exceeds 40 chars", () => {
  it("fires on a 60-char receipt", () => {
    const long = "r_" + "a".repeat(60);
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR', receipt: '${long}' });`;
    expect(fires(code, "RZP018")).toBe(true);
  });

  it("does not fire on a 30-char receipt", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR', receipt: 'r_short_42' });`;
    expect(fires(code, "RZP018")).toBe(false);
  });

  it("does not fire when the long receipt is in a comment", () => {
    const long = "r_" + "a".repeat(60);
    const code = `
      // example of a too-long receipt: ${long}
      await razorpay.orders.create({ amount: 50000, currency: 'INR', receipt: 'r_short_42' });
    `;
    expect(fires(code, "RZP018")).toBe(false);
  });
});

describe("RZP029 — receipt collision risk", () => {
  it("fires on receipt: Date.now() with no nonce", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR', receipt: \`\${Date.now()}\` });`;
    expect(fires(code, "RZP029")).toBe(true);
  });

  it("does not fire when a randomUUID is mixed in", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR', receipt: \`r_\${Date.now()}_\${crypto.randomUUID()}\` });`;
    expect(fires(code, "RZP029")).toBe(false);
  });

  it("does not fire when the bad pattern is in a comment", () => {
    const code = `
      // wrong: receipt: Date.now()
      await razorpay.orders.create({ amount: 50000, currency: 'INR', receipt: 'r_42' });
    `;
    expect(fires(code, "RZP029")).toBe(false);
  });
});
