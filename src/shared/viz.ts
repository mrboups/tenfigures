export type Approach = { kind: "tp" | "sl" | "entry"; price: number };

/** Closest price that did not reach the target. Hidden when last is already there. */
export function nearestApproach(opts: {
  side: "buy" | "sell";
  entry: number;
  last: number;
  peak: number | null;
  trough: number | null;
  tp: number | null;
  sl: number | null;
  pendingEntry?: boolean;
}): Approach[] {
  const { side, entry, last } = opts;
  if (!(entry > 0) || !(last > 0)) return [];
  const peak = opts.peak != null && opts.peak > 0 ? opts.peak : last;
  const trough = opts.trough != null && opts.trough > 0 ? opts.trough : last;
  const eps = Math.max(Math.abs(entry), Math.abs(last)) * 1e-8;
  const away = (p: number) => Math.abs(p - last) > eps;
  const out: Approach[] = [];

  if (opts.pendingEntry) {
    if (side === "buy" && trough > entry + eps && trough < last - eps && away(trough)) {
      out.push({ kind: "entry", price: trough });
    }
    if (side === "sell" && peak < entry - eps && peak > last + eps && away(peak)) {
      out.push({ kind: "entry", price: peak });
    }
    return out;
  }

  const tp = opts.tp != null && opts.tp > 0 ? opts.tp : null;
  const sl = opts.sl != null && opts.sl > 0 ? opts.sl : null;

  if (side === "buy") {
    if (tp != null && peak < tp - eps && peak > entry + eps && away(peak)) {
      out.push({ kind: "tp", price: peak });
    }
    if (sl != null && trough > sl + eps && trough < entry - eps && away(trough)) {
      out.push({ kind: "sl", price: trough });
    }
  } else {
    if (tp != null && trough > tp + eps && trough < entry - eps && away(trough)) {
      out.push({ kind: "tp", price: trough });
    }
    if (sl != null && peak < sl - eps && peak > entry + eps && away(peak)) {
      out.push({ kind: "sl", price: peak });
    }
  }
  return out;
}
