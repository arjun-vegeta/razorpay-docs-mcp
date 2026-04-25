import { describe, expect, it } from "vitest";
import { fires } from "./_helpers.js";

describe("RZP007 — payment_capture: 0 with no follow-up capture", () => {
  it("fires on manual capture without follow-up", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR', payment_capture: 0 });`;
    expect(fires(code, "RZP007")).toBe(true);
  });

  it("does not fire when capture call follows", () => {
    const code = `
      const o = await razorpay.orders.create({ amount: 50000, currency: 'INR', payment_capture: 0 });
      await razorpay.payments.capture(paymentId, 50000, 'INR');
    `;
    expect(fires(code, "RZP007")).toBe(false);
  });

  it("does not fire when payment_capture is 1 (auto-capture)", () => {
    const code = `await razorpay.orders.create({ amount: 50000, currency: 'INR', payment_capture: 1 });`;
    expect(fires(code, "RZP007")).toBe(false);
  });
});

describe("RZP026 — capture past the 5-day auto-void window", () => {
  it("fires on setTimeout(... 5*24*60*60*1000, capture)", () => {
    const code = `
      setTimeout(async () => {
        await razorpay.payments.capture(paymentId, 50000, 'INR');
      }, 5 * 24 * 60 * 60 * 1000);
    `;
    expect(fires(code, "RZP026")).toBe(true);
  });

  it("does not fire when capture happens immediately", () => {
    const code = `
      app.post('/webhook', async (req, res) => {
        if (req.body.event === 'payment.authorized') {
          await razorpay.payments.capture(req.body.payload.payment.entity.id, 50000, 'INR');
        }
        res.status(200).end();
      });
    `;
    expect(fires(code, "RZP026")).toBe(false);
  });

  it("does not fire when the 5-day delay is in a comment", () => {
    const code = `
      // do not: capture 5 days later (auto-void)
      await razorpay.payments.capture(paymentId, 50000, 'INR');
    `;
    expect(fires(code, "RZP026")).toBe(false);
  });
});
