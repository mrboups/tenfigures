import {
  DEFAULT_INDICATOR,
  parseIndicator,
  parseIndicators,
  type IndicatorId,
} from "../shared/demark.ts";

const KEY = "tradr.indicator";
const KEYS = "tradr.indicators";
const EVT = "tradr:indicator";

export function readIndicators(): IndicatorId[] {
  try {
    const multi = localStorage.getItem(KEYS);
    if (multi) {
      const parsed = JSON.parse(multi) as unknown;
      if (Array.isArray(parsed) && parsed.length === 0) return [];
      return parseIndicators(parsed);
    }
    const one = localStorage.getItem(KEY);
    if (one) return parseIndicators([one]);
  } catch {
    /* ignore */
  }
  return [DEFAULT_INDICATOR];
}

export function readIndicator(): IndicatorId {
  return readIndicators()[0] ?? DEFAULT_INDICATOR;
}

export function writeIndicators(ids: IndicatorId[]): void {
  const next = ids.length ? parseIndicators(ids) : [];
  try {
    localStorage.setItem(KEYS, JSON.stringify(next));
    if (next[0]) localStorage.setItem(KEY, next[0]);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

export function writeIndicator(id: IndicatorId): void {
  writeIndicators([parseIndicator(id)]);
}

/** Toggle on/off. Turning the last one off leaves the strip as ticker-only. */
export function toggleIndicator(id: IndicatorId): IndicatorId[] {
  const cur = readIndicators();
  const next = cur.includes(id)
    ? cur.filter((x) => x !== id)
    : parseIndicators([...cur, id]);
  writeIndicators(next);
  return next;
}

export function clearIndicators(): IndicatorId[] {
  writeIndicators([]);
  return [];
}

export function onIndicatorChange(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}
