import type { PoolClient } from "./db.ts";
import { q, qOne } from "./db.ts";

export const WAITLIST_CAP = 100;

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return null;
  return email;
}

export async function waitlistCount(pool: PoolClient): Promise<number> {
  const row = await qOne<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM waitlist`,
  );
  return Number(row?.n ?? 0);
}

export async function addWaitlist(
  pool: PoolClient,
  email: string,
): Promise<{ already: boolean; remaining: number; full: boolean }> {
  const n = await waitlistCount(pool);
  const remaining = Math.max(0, WAITLIST_CAP - n);
  const existing = await qOne<{ email: string }>(
    pool,
    `SELECT email FROM waitlist WHERE email = $1`,
    [email],
  );
  if (existing) {
    return { already: true, remaining, full: false };
  }
  if (n >= WAITLIST_CAP) {
    return { already: false, remaining: 0, full: true };
  }
  await pool.query(`INSERT INTO waitlist (email, kind) VALUES ($1, 'waitlist')`, [
    email,
  ]);
  return { already: false, remaining: remaining - 1, full: false };
}

export async function listWaitlist(pool: PoolClient) {
  return q<{ email: string; created_at: Date; kind: string }>(
    pool,
    `SELECT email, created_at, kind FROM waitlist ORDER BY created_at ASC`,
  );
}
