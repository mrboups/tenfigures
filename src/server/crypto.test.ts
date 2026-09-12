import { describe, expect, it } from "vitest";
import { decrypt, encrypt, passwordsMatch } from "./crypto.ts";
import { signSession, verifySession } from "./session.ts";

const KEY = "a".repeat(64);

describe("encrypt", () => {
  it("round-trips a secret", () => {
    const packed = encrypt("binance-secret", KEY);
    expect(packed).not.toContain("binance-secret");
    expect(decrypt(packed, KEY)).toBe("binance-secret");
  });

  it("rejects a short key", () => {
    expect(() => encrypt("x", "abcd")).toThrow(/64 hex/);
  });
});

describe("passwordsMatch", () => {
  it("accepts the exact password and rejects a miss", () => {
    expect(passwordsMatch("hunter2", "hunter2")).toBe(true);
    expect(passwordsMatch("hunter2", "hunter3")).toBe(false);
    expect(passwordsMatch("short", "longerpass")).toBe(false);
  });
});

describe("session", () => {
  it("signs and verifies", () => {
    const token = signSession("nico", "session-secret");
    expect(verifySession(token, "session-secret", "nico")).toBe("nico");
    expect(verifySession(token, "wrong", "nico")).toBeNull();
    expect(verifySession(token, "session-secret", "other")).toBeNull();
  });
});
