const KEY = "tradr.stars";
const EVT = "tradr:stars";
export const OPEN_TRADE = "tradr:open-trade";
const MAX = 20;

export type Star = { exchangeId: string; symbol: string };

export function labelPair(symbol: string): string {
  return symbol.replace(/:.*$/, "");
}

export function quoteFromSymbol(symbol: string): string {
  return labelPair(symbol).split("/")[1] ?? "";
}

export function readStars(): Star[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as Star[];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (s) => s && typeof s.exchangeId === "string" && typeof s.symbol === "string",
    );
  } catch {
    return [];
  }
}

function save(stars: Star[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stars));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

export function isStarred(exchangeId: string, symbol: string): boolean {
  return readStars().some((s) => s.exchangeId === exchangeId && s.symbol === symbol);
}

export function moveStar(from: number, to: number): Star[] {
  const cur = readStars();
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= cur.length ||
    to >= cur.length
  ) {
    return cur;
  }
  const next = cur.slice();
  const [item] = next.splice(from, 1);
  if (!item) return cur;
  next.splice(to, 0, item);
  save(next);
  return next;
}

export function toggleStar(exchangeId: string, symbol: string): Star[] {
  const cur = readStars();
  const exists = cur.some((s) => s.exchangeId === exchangeId && s.symbol === symbol);
  const next = exists
    ? cur.filter((s) => !(s.exchangeId === exchangeId && s.symbol === symbol))
    : [{ exchangeId, symbol }, ...cur].slice(0, MAX);
  save(next);
  return next;
}

export function onStarsChange(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function openStarredTrade(star: Star) {
  const quote = quoteFromSymbol(star.symbol);
  try {
    const prev = JSON.parse(sessionStorage.getItem("tradr.trade") || "{}") as Record<
      string,
      string
    >;
    sessionStorage.setItem(
      "tradr.trade",
      JSON.stringify({ ...prev, exchangeId: star.exchangeId, quote, pair: star.symbol }),
    );
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(OPEN_TRADE, { detail: star }));
}
