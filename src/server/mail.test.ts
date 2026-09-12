import { describe, expect, it } from "vitest";
import { waitlistMail } from "./mail.ts";

describe("waitlist mail", () => {
  it("points at the demo and states the list", () => {
    const mail = waitlistMail("https://demo.example/app/");
    expect(mail.subject).toBe("You're on the Ten Figures list");
    expect(mail.text).toContain("First 100 get first month free and lock in 50% off subscription.");
    expect(mail.text).toContain("access information in the next few days");
    expect(mail.text).toContain("chat on the website");
    expect(mail.text).toContain("https://demo.example/app/");
    expect(mail.html).toContain("Open Demo");
    expect(mail.html).toContain("https://demo.example/app/");
    expect(mail.html).toContain("chat on the website");
  });
});
