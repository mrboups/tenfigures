export function stripTrailingZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

export function formatNum(n: number, d = 8): string {
  if (!Number.isFinite(n)) return "—";
  return stripTrailingZeros(n.toFixed(d));
}

export function priceFromPercent(entry: number, percent: number): number {
  return entry * (1 + percent / 100);
}

export function percentFromPrices(entry: number, price: number): number {
  if (!entry) return 0;
  return ((price - entry) / entry) * 100;
}

/** Profit % above (long) / below (short). Stop % the other way. Percents are absolute. */
export function protectForSide(
  side: "buy" | "sell",
  fill: number,
  tpPct: number | null,
  slPct: number | null,
): {
  tpPrice: number | null;
  slPrice: number | null;
  tpPercent: number | null;
  slPercent: number | null;
} {
  const tpAbs = tpPct == null || !Number.isFinite(tpPct) ? null : Math.abs(tpPct);
  const slAbs = slPct == null || !Number.isFinite(slPct) ? null : Math.abs(slPct);
  if (side === "buy") {
    return {
      tpPrice: tpAbs ? priceFromPercent(fill, tpAbs) : null,
      slPrice: slAbs ? priceFromPercent(fill, -slAbs) : null,
      tpPercent: tpAbs,
      slPercent: slAbs != null ? -slAbs : null,
    };
  }
  return {
    tpPrice: tpAbs ? priceFromPercent(fill, -tpAbs) : null,
    slPrice: slAbs ? priceFromPercent(fill, slAbs) : null,
    tpPercent: tpAbs != null ? -tpAbs : null,
    slPercent: slAbs,
  };
}

export function pnl(
  side: "buy" | "sell",
  entry: number,
  last: number,
  amount: number,
): { quote: number; percent: number } {
  const diff = side === "buy" ? last - entry : entry - last;
  return {
    quote: diff * amount,
    percent: entry ? (diff / entry) * 100 : 0,
  };
}

export function formatSignedQuote(n: number, quote: string): string {
  if (!Number.isFinite(n)) return "—";
  const d = Math.abs(n) >= 1 ? 2 : 4;
  const body = formatNum(n, d);
  return `${n > 0 ? "+" : ""}${body} ${quote}`;
}

/** Compact dollar P/L for viz: $100k, -$10k */
export function formatCompactUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  let body: string;
  if (a >= 1_000_000_000) body = `${compactScale(a / 1e9)}b`;
  else if (a >= 1_000_000) body = `${compactScale(a / 1e6)}m`;
  else if (a >= 1_000) body = `${compactScale(a / 1e3)}k`;
  else body = formatNum(a, a >= 1 ? 0 : 2);
  return `${sign}$${body}`;
}

function compactScale(x: number): string {
  const d = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return stripTrailingZeros(x.toFixed(d));
}

export function mergeFill(
  oldAmt: number,
  oldPx: number,
  fillAmt: number,
  fillPx: number,
): { amount: number; price: number } {
  const a = Math.max(0, oldAmt);
  const f = Math.max(0, fillAmt);
  const amount = a + f;
  if (!(amount > 0)) return { amount: 0, price: fillPx };
  const price = a > 0 && oldPx > 0 ? (a * oldPx + f * fillPx) / amount : fillPx;
  return { amount, price };
}

export function leftoverAddNotional(opts: {
  quoteFree: number;
  plannedBase: number;
  price: number;
  leverage: number;
  futures: boolean;
  reservedOnExchange: boolean;
  extraNotional?: number;
}): { leftoverQuote: number; addNotional: number; plannedMargin: number } {
  const lev = Math.max(1, opts.leverage || 1);
  const plannedNotional =
    Math.max(0, opts.plannedBase) * Math.max(0, opts.price) +
    Math.max(0, opts.extraNotional ?? 0);
  const plannedMargin = opts.futures ? plannedNotional / lev : plannedNotional;
  const leftoverQuote = Math.max(
    0,
    opts.quoteFree - (opts.reservedOnExchange ? 0 : plannedMargin),
  );
  return {
    leftoverQuote,
    addNotional: leftoverQuote * (opts.futures ? lev : 1),
    plannedMargin,
  };
}
