import { createHmac, timingSafeEqual } from "node:crypto";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function signSession(
  username: string,
  secret: string,
  ttlMs = WEEK_MS,
): string {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + ttlMs }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readSession(token: string, secret: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { u: string; exp: number };
    if (typeof data.u !== "string" || typeof data.exp !== "number") return null;
    if (data.exp < Date.now()) return null;
    return data.u;
  } catch {
    return null;
  }
}

export function verifySession(
  token: string,
  secret: string,
  expectedUser: string,
): string | null {
  const u = readSession(token, secret);
  if (u == null || u !== expectedUser) return null;
  return u;
}
