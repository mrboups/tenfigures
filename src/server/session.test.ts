import { describe, expect, it } from "vitest";
import { readSession, signSession, verifySession } from "./session.ts";

describe("session", () => {
  const secret = "test-secret-for-hmac";

  it("round-trips a signed token", () => {
    const token = signSession("alice", secret);
    expect(verifySession(token, secret, "alice")).toBe("alice");
    expect(verifySession(token, secret, "bob")).toBeNull();
    expect(readSession(token, secret)).toBe("alice");
  });

  it("rejects a broken signature", () => {
    const token = signSession("alice", secret);
    expect(readSession(token.slice(0, -2) + "xx", secret)).toBeNull();
  });
});
