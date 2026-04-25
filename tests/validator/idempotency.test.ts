import { describe, expect, it } from "vitest";
import { fires } from "./_helpers.js";

describe("RZP008 — refund missing Idempotency-Key", () => {
  it("fires on refund without an idempotency header", () => {
    const code = `await razorpay.payments.refund(paymentId, { amount: 10000 });`;
    expect(fires(code, "RZP008")).toBe(true);
  });

  it("does not fire when Idempotency-Key is set", () => {
    const code = `
      await razorpay.payments.refund(paymentId, { amount: 10000 }, {
        headers: { 'Idempotency-Key': crypto.randomUUID() }
      });
    `;
    expect(fires(code, "RZP008")).toBe(false);
  });

  it("does not fire when the refund call is in a comment", () => {
    const code = `
      // legacy: razorpay.payments.refund(paymentId, { amount: 10000 })
      await razorpay.payments.refund(paymentId, { amount: 10000 }, { headers: { 'Idempotency-Key': uuid() } });
    `;
    expect(fires(code, "RZP008")).toBe(false);
  });
});

describe("RZP021 — webhook handler not idempotent", () => {
  it("fires when handler has no event-id dedup", () => {
    const code = `
      app.post('/webhook', (req, res) => {
        const event = req.body;
        if (event.event === 'payment.captured') {
          fulfillOrder(event.payload.payment.entity.order_id);
        }
        res.status(200).end();
      });
    `;
    expect(fires(code, "RZP021")).toBe(true);
  });

  it("does not fire when handler dedups by event.id", () => {
    const code = `
      app.post('/webhook', async (req, res) => {
        const event = req.body;
        const inserted = await db.events.insertIfMissing({ event_id: event.id });
        if (!inserted) return res.status(200).end();
        await processEvent(event);
        res.status(200).end();
      });
    `;
    expect(fires(code, "RZP021")).toBe(false);
  });

  it("does not fire when the handler is non-Razorpay", () => {
    const code = `
      app.post('/health', (req, res) => res.status(200).end());
    `;
    expect(fires(code, "RZP021")).toBe(false);
  });
});
