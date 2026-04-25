import { describe, expect, it } from "vitest";
import { truncateBody } from "../../src/retrieval/assemble.js";

describe("truncateBody", () => {
  it("returns the body unchanged when under the cap", () => {
    expect(truncateBody("short body", 100)).toBe("short body");
  });

  it("truncates at the last paragraph boundary if it falls past 60% of the cap", () => {
    const body = "first para\n\nsecond para\n\nthird para that gets cut";
    const out = truncateBody(body, 30);
    expect(out).toContain("first para");
    expect(out).toContain("second para");
    expect(out).not.toContain("third para that gets cut");
  });

  it("falls back to a hard cut when no paragraph break exists late enough", () => {
    const body = "no paragraph breaks just one long line that exceeds the cap";
    const out = truncateBody(body, 20);
    expect(out.length).toBeLessThanOrEqual(20);
  });
});
