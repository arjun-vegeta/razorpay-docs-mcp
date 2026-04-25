import { describe, expect, it } from "vitest";
import { fires } from "./_helpers.js";

describe("RZP005 — hardcoded live API key", () => {
  it("fires on rzp_live_… literal", () => {
    const code = `const razorpay = new Razorpay({ key_id: 'rzp_live_ABCDEFGH123456', key_secret: 's' });`;
    expect(fires(code, "RZP005")).toBe(true);
  });

  it("does not fire when key is read from env", () => {
    const code = `const razorpay = new Razorpay({ key_id: process.env.RZP_KEY_ID, key_secret: process.env.RZP_KEY_SECRET });`;
    expect(fires(code, "RZP005")).toBe(false);
  });

  it("does not fire when the key example is in a comment", () => {
    const code = `
      // example: rzp_live_ABCDEFGH123456
      const razorpay = new Razorpay({ key_id: process.env.RZP_KEY_ID, key_secret: process.env.RZP_KEY_SECRET });
    `;
    expect(fires(code, "RZP005")).toBe(false);
  });
});

describe("RZP006 — hardcoded test API key (info-level)", () => {
  it("fires on rzp_test_… literal", () => {
    const code = `const razorpay = new Razorpay({ key_id: 'rzp_test_ABCDEFGH123456', key_secret: 's' });`;
    expect(fires(code, "RZP006")).toBe(true);
  });

  it("does not fire when key is read from env", () => {
    const code = `const razorpay = new Razorpay({ key_id: process.env.RZP_KEY_ID, key_secret: process.env.RZP_KEY_SECRET });`;
    expect(fires(code, "RZP006")).toBe(false);
  });

  it("does not fire on a partial reference in a comment", () => {
    const code = `
      // your test key starts with rzp_test_ (followed by 14 chars)
      const razorpay = new Razorpay({ key_id: process.env.RZP_KEY_ID, key_secret: process.env.RZP_KEY_SECRET });
    `;
    expect(fires(code, "RZP006")).toBe(false);
  });
});

describe("RZP019 — test key with production env guard", () => {
  it("fires on rzp_test_ paired with NODE_ENV === 'production'", () => {
    const code = `
      if (process.env.NODE_ENV === 'production') {
        const razorpay = new Razorpay({ key_id: 'rzp_test_ABCDEFGH123456', key_secret: 's' });
      }
    `;
    expect(fires(code, "RZP019")).toBe(true);
  });

  it("does not fire on rzp_test_ in dev-only branch", () => {
    const code = `
      if (process.env.NODE_ENV === 'development') {
        const razorpay = new Razorpay({ key_id: 'rzp_test_ABCDEFGH123456', key_secret: 's' });
      }
    `;
    expect(fires(code, "RZP019")).toBe(false);
  });

  it("does not fire when both patterns are in a comment", () => {
    const code = `
      // wrong: NODE_ENV === 'production' alongside rzp_test_xyzxyzxyzxyzxy
      const razorpay = new Razorpay({ key_id: process.env.RZP_KEY_ID, key_secret: process.env.RZP_KEY_SECRET });
    `;
    expect(fires(code, "RZP019")).toBe(false);
  });
});

describe("RZP023 — key_secret in client code", () => {
  it("fires when key_secret appears in browser-flavored code", () => {
    const code = `
      "use client";
      import { useState } from 'react';
      export default function Pay() {
        const key_secret = 'shouldnotbehere';
        return <button>pay</button>;
      }
    `;
    expect(fires(code, "RZP023")).toBe(true);
  });

  it("does not fire when key_secret is server-side only", () => {
    const code = `
      const razorpay = new Razorpay({
        key_id: process.env.RZP_KEY_ID,
        key_secret: process.env.RZP_KEY_SECRET,
      });
      module.exports = { razorpay };
    `;
    expect(fires(code, "RZP023")).toBe(false);
  });

  it("does not fire when the leak warning is in a comment", () => {
    const code = `
      "use client";
      // do NOT reference key_secret here
      export default function Pay() { return <button>pay</button>; }
    `;
    expect(fires(code, "RZP023")).toBe(false);
  });
});
