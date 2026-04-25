import { describe, expect, it } from "vitest";
import { fires } from "./_helpers.js";

describe("RZP003 — amount looks like rupees, not paise", () => {
  it("fires on `amount: 100, currency: 'INR'`", () => {
    const code = `await razorpay.orders.create({ amount: 100, currency: 'INR' });`;
    expect(fires(code, "RZP003")).toBe(true);
  });

  it("does not fire when *100 multiplier is in scope", () => {
    const code = `await razorpay.orders.create({ amount: rupees * 100, currency: 'INR' });`;
    expect(fires(code, "RZP003")).toBe(false);
  });

  it("does not fire when amount is large (already paise)", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR' });`;
    expect(fires(code, "RZP003")).toBe(false);
  });

  it("does not fire when the suspect line is in a comment", () => {
    const code = `
      // example: amount: 100, currency: 'INR' (wrong if you mean ₹100)
      await razorpay.orders.create({ amount: 50000, currency: 'INR' });
    `;
    expect(fires(code, "RZP003")).toBe(false);
  });
});

describe("RZP012 — order/payment currency mismatch", () => {
  it("fires when both INR and USD appear", () => {
    const code = `
      await razorpay.orders.create({ amount: 50000, currency: 'INR' });
      await razorpay.payments.transfer({ amount: 600, currency: 'USD' });
    `;
    expect(fires(code, "RZP012")).toBe(true);
  });

  it("does not fire on a single consistent currency", () => {
    const code = `
      await razorpay.orders.create({ amount: 50000, currency: 'INR' });
      await razorpay.payments.fetch(paymentId);
    `;
    expect(fires(code, "RZP012")).toBe(false);
  });

  it("does not fire when the second currency is in a comment", () => {
    const code = `
      // we used to also pass currency: 'USD' here, removed in 2025
      await razorpay.orders.create({ amount: 50000, currency: 'INR' });
    `;
    expect(fires(code, "RZP012")).toBe(false);
  });
});

describe("RZP022 — currency code lowercase", () => {
  it("fires on `currency: 'inr'`", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'inr' });`;
    expect(fires(code, "RZP022")).toBe(true);
  });

  it("does not fire on uppercase ISO 4217", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR' });`;
    expect(fires(code, "RZP022")).toBe(false);
  });

  it("does not fire when the lowercase form is in a comment", () => {
    const code = `
      // wrong: currency: 'inr'
      await razorpay.orders.create({ amount: 50000, currency: 'INR' });
    `;
    expect(fires(code, "RZP022")).toBe(false);
  });
});
