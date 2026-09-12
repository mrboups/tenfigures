export const TF_FRAMES = [
  { id: "1D", ccxt: "1d" },
  { id: "4H", ccxt: "4h" },
  { id: "1H", ccxt: "1h" },
  { id: "15M", ccxt: "15m" },
  { id: "5M", ccxt: "5m" },
] as const;

export type TfId = (typeof TF_FRAMES)[number]["id"];
export type TfColor = "green" | "red";

export interface TfBias {
  tf: TfId;
  color: TfColor | null;
}

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const MFI_LEN = 14;
export const TDPR_LEN = 20;
export const TDPR_OS = 25;
export const TDPR_OB = 75;

export const DONCHIAN_LEN = 20;

export const INDICATOR_IDS = ["tdpr", "tdpr-cross", "donchian"] as const;
export type IndicatorId = (typeof INDICATOR_IDS)[number];

export const DEFAULT_INDICATOR: IndicatorId = "tdpr";

export const INDICATORS: {
  id: IndicatorId;
  label: string;
  short: string;
  hint: string;
  title: string;
}[] = [
  {
    id: "tdpr",
    label: "TDPR",
    short: "TDPR",
    hint: "From the bottom 25, from the top 75",
    title: "TDPR — green from the bottom (25), red from the top (75)",
  },
  {
    id: "tdpr-cross",
    label: "TDPR cross",
    short: "Cross",
    hint: "MF crosses TDPR",
    title: "TDPR — green when MF crosses up, red when it crosses down",
  },
  {
    id: "donchian",
    label: "Donchian Trend",
    short: "Donchian",
    hint: "Break of the 20-bar channel",
    title: "Donchian Trend — green after a break above, red after a break below",
  },
];

export function parseIndicator(v: unknown): IndicatorId {
  return INDICATOR_IDS.includes(v as IndicatorId)
    ? (v as IndicatorId)
    : DEFAULT_INDICATOR;
}

/** Unique selected indicators in catalog order. Empty or junk → [tdpr]. */
export function parseIndicators(v: unknown): IndicatorId[] {
  let raw: unknown[] = [];
  if (Array.isArray(v)) raw = v;
  else if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("[")) {
      try {
        const p = JSON.parse(s) as unknown;
        if (Array.isArray(p)) raw = p;
      } catch {
        raw = [];
      }
    } else if (s) {
      raw = [s];
    }
  }
  const set = new Set<IndicatorId>();
  for (const x of raw) {
    if (INDICATOR_IDS.includes(x as IndicatorId)) set.add(x as IndicatorId);
  }
  const out = INDICATOR_IDS.filter((id) => set.has(id));
  return out.length ? out : [DEFAULT_INDICATOR];
}

export function indicatorTitle(id: IndicatorId): string {
  return INDICATORS.find((x) => x.id === id)?.title ?? INDICATORS[0]!.title;
}

export function indicatorShort(id: IndicatorId): string {
  return INDICATORS.find((x) => x.id === id)?.short ?? INDICATORS[0]!.short;
}

export function emptyTfBias(): TfBias[] {
  return TF_FRAMES.map((f) => ({ tf: f.id, color: null }));
}

/** All five timeframes the same color, else null. */
export function alignedTfColor(frames: TfBias[]): TfColor | null {
  const colors = TF_FRAMES.map(
    (f) => frames.find((x) => x.tf === f.id)?.color ?? null,
  );
  if (colors.some((c) => c == null) || colors.length < TF_FRAMES.length) return null;
  const first = colors[0];
  if (first == null) return null;
  return colors.every((c) => c === first) ? first : null;
}

/** Green across the board → buy/long. Red → sell/short. Mixed or incomplete → null. */
export function signalSide(frames: TfBias[]): "buy" | "sell" | null {
  const c = alignedTfColor(frames);
  if (c === "green") return "buy";
  if (c === "red") return "sell";
  return null;
}

function typical(c: Candle): number {
  return (c.h + c.l + c.c) / 3;
}

function mfiRsi(upper: number, lower: number): number {
  if (lower === 0) return 100;
  if (upper === 0) return 0;
  return 100 - 100 / (1 + upper / lower);
}

/** Money Flow (Pine `mf`) over `length` bars of hlc3 × volume. */
export function mfi(candles: Candle[], length = MFI_LEN): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(Number.NaN);
  if (n < length + 1) return out;
  const up = new Array<number>(n).fill(0);
  const dn = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const src = typical(candles[i]!);
    const prev = typical(candles[i - 1]!);
    const ch = src - prev;
    const flow = src * (candles[i]!.v || 0);
    if (ch > 0) up[i] = flow;
    else if (ch < 0) dn[i] = flow;
  }
  for (let i = length; i < n; i++) {
    let upper = 0;
    let lower = 0;
    for (let j = i - length + 1; j <= i; j++) {
      upper += up[j]!;
      lower += dn[j]!;
    }
    out[i] = mfiRsi(upper, lower);
  }
  return out;
}

/**
 * TDPR `pres` over the last `len` bars inclusive (`for i = 0 to len`).
 * Buy pressure on up candles, sell pressure on down candles, 50 if none.
 */
export function tdpr(candles: Candle[], len = TDPR_LEN): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(Number.NaN);
  if (n < len + 1) return out;
  for (let i = len; i < n; i++) {
    let buypres = 0;
    let sellpres = 0;
    for (let k = 0; k <= len; k++) {
      const bar = candles[i - k]!;
      const delta = bar.c - bar.o;
      const range = bar.h - bar.l;
      if (!(range > 0)) continue;
      const vol = bar.v || 0;
      if (delta > 0) buypres += (delta / range) * vol;
      else if (delta < 0) sellpres += (delta / range) * vol;
    }
    const dom = buypres + Math.abs(sellpres);
    out[i] = dom !== 0 ? 100 * (buypres / dom) : 50;
  }
  return out;
}

/** Last oversold vs last overbought: green from the bottom, red from the top. */
export function fromEndsBias(
  values: number[],
  os = TDPR_OS,
  ob = TDPR_OB,
): TfColor | null {
  const series = values.filter(Number.isFinite);
  if (!series.length) return null;
  let lastOs = -1;
  let lastOb = -1;
  for (let i = 0; i < series.length; i++) {
    const v = series[i]!;
    if (v <= os) lastOs = i;
    if (v >= ob) lastOb = i;
  }
  if (lastOs < 0 && lastOb < 0) {
    if (series.length < 2) return "green";
    return series[series.length - 1]! >= series[series.length - 2]! ? "green" : "red";
  }
  return lastOs >= lastOb ? "green" : "red";
}

/** Last MF×TDPR crossover: up = green, down = red. Else MF vs TDPR. */
export function lastCrossBias(mf: number[], pres: number[]): TfColor | null {
  const n = Math.min(mf.length, pres.length);
  let last: TfColor | null = null;
  for (let i = 1; i < n; i++) {
    const a0 = mf[i - 1]!;
    const b0 = pres[i - 1]!;
    const a1 = mf[i]!;
    const b1 = pres[i]!;
    if (![a0, b0, a1, b1].every(Number.isFinite)) continue;
    if (a0 <= b0 && a1 > b1) last = "green";
    else if (a0 >= b0 && a1 < b1) last = "red";
  }
  if (last) return last;
  for (let i = n - 1; i >= 0; i--) {
    const a = mf[i]!;
    const b = pres[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > b) return "green";
    if (a < b) return "red";
    if (b > 50) return "green";
    if (b < 50) return "red";
    return null;
  }
  return null;
}

/**
 * Pine Donchian Trend: close vs previous highest/lowest(len).
 * 1 = last break was up, -1 = last break was down, 0 = none yet.
 */
export function donchianTrend(candles: Candle[], len = DONCHIAN_LEN): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(0);
  if (n < len + 1) return out;
  let trend = 0;
  for (let i = len; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - len; j < i; j++) {
      hh = Math.max(hh, candles[j]!.h);
      ll = Math.min(ll, candles[j]!.l);
    }
    const c = candles[i]!.c;
    if (c > hh) trend = 1;
    else if (c < ll) trend = -1;
    out[i] = trend;
  }
  return out;
}

/** Last Donchian flip: red→green is green, green→red is red. */
export function donchianBias(candles: Candle[], len = DONCHIAN_LEN): TfColor | null {
  const t = donchianTrend(candles, len);
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === 1) return "green";
    if (t[i] === -1) return "red";
  }
  return null;
}

export function biasFromCandles(
  candles: Candle[],
  indicator: IndicatorId = DEFAULT_INDICATOR,
): TfColor | null {
  if (indicator === "tdpr-cross") {
    return lastCrossBias(mfi(candles), tdpr(candles));
  }
  if (indicator === "donchian") {
    return donchianBias(candles);
  }
  return fromEndsBias(tdpr(candles));
}
