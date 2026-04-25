import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectSdk } from "../../src/util/sdk-detect.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "rzp-sdk-detect-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(filename: string, content: string): void {
  writeFileSync(resolve(dir, filename), content);
}

describe("detectSdk", () => {
  it("returns undefined when no manifest file is present", () => {
    expect(detectSdk(dir)).toBeUndefined();
  });

  it("returns undefined for a package.json without razorpay dep", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    expect(detectSdk(dir)).toBeUndefined();
  });

  it("returns 'node' for a package.json that lists razorpay", () => {
    write("package.json", JSON.stringify({ dependencies: { razorpay: "^2.9.0" } }));
    expect(detectSdk(dir)).toBe("node");
  });

  it("returns 'python' for a requirements.txt with razorpay", () => {
    write("requirements.txt", "razorpay==1.4.0\nrequests==2.31.0\n");
    expect(detectSdk(dir)).toBe("python");
  });

  it("returns 'php' for composer.json with razorpay/razorpay", () => {
    write("composer.json", JSON.stringify({ require: { "razorpay/razorpay": "^2.0" } }));
    expect(detectSdk(dir)).toBe("php");
  });

  it("returns 'ruby' for Gemfile with razorpay", () => {
    write("Gemfile", "source 'https://rubygems.org'\ngem 'razorpay', '~> 3.0'\n");
    expect(detectSdk(dir)).toBe("ruby");
  });

  it("returns 'go' for go.mod with razorpay-go", () => {
    write(
      "go.mod",
      "module example.com/foo\n\nrequire github.com/razorpay/razorpay-go v1.2.3\n",
    );
    expect(detectSdk(dir)).toBe("go");
  });
});
