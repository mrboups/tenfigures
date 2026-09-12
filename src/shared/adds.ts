import type { PendingAdd } from "./types.ts";

export type { PendingAdd };

export function parsePendingAdds(raw: unknown): PendingAdd[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      list = JSON.parse(s) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: PendingAdd[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const price = String(r.price ?? "");
    const baseAmount = String(r.baseAmount ?? "");
    if (!(Number(price) > 0) || !(Number(baseAmount) > 0)) continue;
    out.push({
      id: String(r.id ?? crypto.randomUUID()),
      price,
      baseAmount,
      quoteAmount: String(r.quoteAmount ?? Number(price) * Number(baseAmount)),
      orderId: r.orderId == null || r.orderId === "" ? null : String(r.orderId),
      filled: r.filled === true,
    });
  }
  return out;
}

export function stringifyPendingAdds(adds: PendingAdd[]): string | null {
  return adds.length ? JSON.stringify(adds) : null;
}

export function pendingAddNotional(adds: PendingAdd[]): number {
  return adds
    .filter((a) => !a.filled)
    .reduce((s, a) => s + Math.max(0, Number(a.quoteAmount) || 0), 0);
}

export function parseAppliedIds(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      list = JSON.parse(s) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is string => typeof x === "string" && x.length > 0);
}

export function stringifyAppliedIds(ids: string[]): string | null {
  return ids.length ? JSON.stringify(ids) : null;
}
