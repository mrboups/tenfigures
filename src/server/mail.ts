import type { AppEnv } from "./env.ts";

export function waitlistMail(demoHref: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "You're on the Ten Figures list";
  const text = [
    "You're on the Ten Figures early access list.",
    "First 100 get first month free and lock in 50% off subscription.",
    "You will receive access information in the next few days.",
    "If you have questions, contact us on the chat on the website.",
    `Open Demo: ${demoHref}`,
  ].join("\n\n");
  const html = `<p>You're on the Ten Figures early access list.</p>
<p>First 100 get first month free and lock in 50% off subscription.</p>
<p>You will receive access information in the next few days.</p>
<p>If you have questions, contact us on the chat on the website.</p>
<p><a href="${esc(demoHref)}">Open Demo</a></p>`;
  return { subject, text, html };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendWaitlistMail(
  env: AppEnv,
  to: string,
  demoHref: string,
): Promise<void> {
  if (!env.resendApiKey) return;
  const mail = waitlistMail(demoHref);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "content-type": "application/json",
      "User-Agent": "TenFigures/1.0",
    },
    body: JSON.stringify({
      from: env.resendFrom,
      to: [to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`resend ${res.status}${detail ? ` ${detail.slice(0, 180)}` : ""}`);
  }
}
