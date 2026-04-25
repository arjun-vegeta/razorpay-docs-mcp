import { describe, expect, it } from "vitest";
import { fires } from "./_helpers.js";

describe("RZP009 — CVV stored server-side", () => {
  it("fires when cvv is written to a DB", () => {
    const code = `
      await db.cards.insert({ user_id, card_number: '4111111111111111', cvv: req.body.cvv });
    `;
    expect(fires(code, "RZP009")).toBe(true);
  });

  it("does not fire when cvv is only passed to Razorpay (not persisted)", () => {
    const code = `
      const token = await razorpay.tokens.create({ cvv: req.body.cvv });
      await db.cards.insert({ user_id, token_id: token.id });
    `;
    expect(fires(code, "RZP009")).toBe(false);
  });

  it("does not fire when the violation is in a comment", () => {
    const code = `
      // do not: db.cards.insert({ cvv: req.body.cvv })
      const token = await razorpay.tokens.create({ cvv: req.body.cvv });
    `;
    expect(fires(code, "RZP009")).toBe(false);
  });
});

describe("RZP010 — full PAN stored server-side", () => {
  it("fires on a literal Visa PAN being written", () => {
    const code = `await db.cards.insert({ user_id, card_number: '4111111111111111' });`;
    expect(fires(code, "RZP010")).toBe(true);
  });

  it("does not fire when storing only the token id", () => {
    const code = `await db.cards.insert({ user_id, token_id: token.id });`;
    expect(fires(code, "RZP010")).toBe(false);
  });

  it("does not fire when the PAN appears in a comment", () => {
    const code = `
      // example PAN: 4111111111111111
      await db.cards.insert({ user_id, token_id: token.id });
    `;
    expect(fires(code, "RZP010")).toBe(false);
  });
});
