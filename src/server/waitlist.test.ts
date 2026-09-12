import { describe, expect, it } from "vitest";
import { normalizeEmail, WAITLIST_CAP } from "./waitlist.ts";

describe("waitlist email", () => {
  it("normalizes and rejects junk", () => {
    expect(normalizeEmail("  A@B.co  ")).toBe("a@b.co");
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });

  it("caps at 100", () => {
    expect(WAITLIST_CAP).toBe(100);
  });
});
