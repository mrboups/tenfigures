import type { Side, TpTarget } from "./types.ts";
import { percentFromPrices, priceFromPercent } from "./money.ts";

export type { TpTarget };

export const MAX_TP_TARGETS = 5;

export function parseTpTargets(raw: unknown): TpTarget[] {
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
  const out: TpTarget[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const price = String(r.price ?? "");
    const qty = Number(r.qtyPct);
    if (!(Number(price) > 0) || !(qty > 0)) continue;
    out.push({
      id: String(r.id ?? crypto.randomUUID()),
      price,
      percent: r.percent == null || r.percent === "" ? null : String(r.percent),
      qtyPct: Math.min(100, qty),
      orderId: r.orderId == null || r.orderId === "" ? null : String(r.orderId),
      filled: r.filled === true,
    });
    if (out.length >= MAX_TP_TARGETS) break;
  }
  return out;
}

export function allocatedPct(targets: TpTarget[]): number {
  return targets.filter((t) => !t.filled).reduce((s, t) => s + t.qtyPct, 0);
}

export function availablePct(targets: TpTarget[]): number {
  return Math.max(0, 100 - allocatedPct(targets));
}

export function stringifyTpTargets(targets: TpTarget[]): string | null {
  const live = targets.filter((t) => Number(t.price) > 0 && t.qtyPct > 0);
  return live.length ? JSON.stringify(live) : null;
}

/** Rewrite target prices for the side that a signal just picked. */
export function reorientTargets(
  side: Side,
  fill: number,
  targets: TpTarget[],
  fromEntry: number,
): TpTarget[] {
  return targets.map((t) => {
    let pct =
      t.percent != null && t.percent !== "" ? Math.abs(Number(t.percent)) : NaN;
    if (!(pct > 0) && fromEntry > 0 && Number(t.price) > 0) {
      pct = Math.abs(percentFromPrices(fromEntry, Number(t.price)));
    }
    if (!(pct > 0) || !(fill > 0)) return t;
    const signed = side === "buy" ? pct : -pct;
    return {
      ...t,
      percent: String(signed),
      price: String(priceFromPercent(fill, signed)),
      orderId: null,
    };
  });
}
