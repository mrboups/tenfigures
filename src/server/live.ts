import type { Exchange } from "ccxt";
import type { TickerInfo, VenueId, MarketType } from "../shared/types.ts";
import { pnl } from "./engine.ts";
import {
  fetchTicker,
  getProClient,
  hasWatchTicker,
  tickerFromRaw,
  type Creds,
} from "./exchanges.ts";

export type LiveQuote = {
  id: string;
  lastPrice: string;
  pnlQuote: string;
  pnlPercent: string;
  liquidationPrice?: string | null;
  amount?: string;
  entryFilledAmount?: string;
  entryFilledPrice?: string;
  peakPrice?: string;
  troughPrice?: string;
};

type Handler = (msg: LiveMsg) => void;
export type LiveMsg =
  | { kind: "ticker"; accountId: string; symbol: string; ticker: TickerInfo }
  | { kind: "quote"; quote: LiveQuote }
  | { kind: "reload" };

type Need = {
  accountId: string;
  venue: VenueId;
  creds: Creds;
  symbol: string;
  marketType: MarketType;
};

const listeners = new Set<Handler>();
const tickers = new Map<string, { ticker: TickerInfo; at: number }>();
const watches = new Map<string, { stop: () => void }>();
let workerNeeded: Need[] = [];
const clientNeeded = new Map<string, { need: Need; refs: number }>();
const liveTrades = new Map<
  string,
  { id: string; side: "buy" | "sell"; entry: number; amount: number; liq: string | null }[]
>();
const lastQuoteAt = new Map<string, number>();

export function tickerKey(accountId: string, symbol: string): string {
  return `${accountId}:${symbol}`;
}

export function listenLive(handler: Handler): () => void {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function emit(msg: LiveMsg) {
  for (const h of listeners) {
    try {
      h(msg);
    } catch {
      /* ignore */
    }
  }
}

export function peekTicker(accountId: string, symbol: string): TickerInfo | null {
  return tickers.get(tickerKey(accountId, symbol))?.ticker ?? null;
}

export function rememberTicker(accountId: string, symbol: string, ticker: TickerInfo) {
  tickers.set(tickerKey(accountId, symbol), { ticker, at: Date.now() });
  emit({ kind: "ticker", accountId, symbol, ticker });
  const rows = liveTrades.get(tickerKey(accountId, symbol)) ?? [];
  const now = Date.now();
  for (const row of rows) {
    const prev = lastQuoteAt.get(row.id) ?? 0;
    if (now - prev < 200) continue;
    lastQuoteAt.set(row.id, now);
    emitQuote(
      quoteFromTicker(row.id, row.side, row.entry, row.amount, ticker.last, row.liq),
    );
  }
}

export function trackLiveTrade(
  accountId: string,
  symbol: string,
  row: { id: string; side: "buy" | "sell"; entry: number; amount: number; liq: string | null },
) {
  const key = tickerKey(accountId, symbol);
  const list = (liveTrades.get(key) ?? []).filter((t) => t.id !== row.id);
  list.push(row);
  liveTrades.set(key, list);
}

export function dropLiveTrade(accountId: string, symbol: string, id: string) {
  const key = tickerKey(accountId, symbol);
  const list = (liveTrades.get(key) ?? []).filter((t) => t.id !== id);
  if (list.length) liveTrades.set(key, list);
  else liveTrades.delete(key);
}

export function emitQuote(quote: LiveQuote) {
  emit({ kind: "quote", quote });
}

export function emitReload() {
  emit({ kind: "reload" });
}

export async function resolveTicker(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  symbol: string,
  marketType: MarketType,
  force = false,
): Promise<TickerInfo> {
  const cached = tickers.get(tickerKey(accountId, symbol));
  if (!force && cached && Date.now() - cached.at < 2500) return cached.ticker;
  const ticker = await fetchTicker(accountId, venue, creds, symbol, marketType);
  rememberTicker(accountId, symbol, ticker);
  return ticker;
}

export function syncTickerWatches(needed: Need[]) {
  workerNeeded = needed;
  applyWatches();
}

export function retainTickerWatch(need: Need): () => void {
  const key = tickerKey(need.accountId, need.symbol);
  const cur = clientNeeded.get(key);
  if (cur) cur.refs += 1;
  else clientNeeded.set(key, { need, refs: 1 });
  applyWatches();
  return () => {
    const row = clientNeeded.get(key);
    if (!row) return;
    row.refs -= 1;
    if (row.refs <= 0) clientNeeded.delete(key);
    applyWatches();
  };
}

function applyWatches() {
  const want = new Map<string, Need>();
  for (const n of workerNeeded) want.set(tickerKey(n.accountId, n.symbol), n);
  for (const [key, row] of clientNeeded) want.set(key, row.need);
  for (const key of [...watches.keys()]) {
    if (!want.has(key)) {
      watches.get(key)?.stop();
      watches.delete(key);
    }
  }
  for (const [key, n] of want) {
    if (watches.has(key)) continue;
    watches.set(key, { stop: startWatch(n) });
  }
}

function startWatch(n: {
  accountId: string;
  venue: VenueId;
  creds: Creds;
  symbol: string;
  marketType: MarketType;
}): () => void {
  let stop = false;
  const pro = getProClient(n.accountId, n.venue, n.creds, n.marketType);
  const useWs = hasWatchTicker(pro);
  const run = async () => {
    while (!stop) {
      try {
        if (useWs && pro) {
          const raw = await (
            pro as Exchange & {
              watchTicker: (symbol: string) => Promise<{
                last?: unknown;
                close?: unknown;
                bid?: unknown;
                ask?: unknown;
                percentage?: unknown;
              }>;
            }
          ).watchTicker(n.symbol);
          if (stop) return;
          rememberTicker(n.accountId, n.symbol, tickerFromRaw(n.symbol, raw));
        } else {
          const ticker = await fetchTicker(
            n.accountId,
            n.venue,
            n.creds,
            n.symbol,
            n.marketType,
          );
          if (stop) return;
          rememberTicker(n.accountId, n.symbol, ticker);
          await sleep(1000);
        }
      } catch {
        if (stop) return;
        await sleep(2000);
      }
    }
  };
  void run();
  return () => {
    stop = true;
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function quoteFromTicker(
  id: string,
  side: "buy" | "sell",
  entry: number,
  amount: number,
  last: number,
  liquidationPrice?: string | null,
  extremes?: { peak?: number; trough?: number },
): LiveQuote {
  const { quote, percent } = pnl(side, entry, last, amount);
  return {
    id,
    lastPrice: String(last),
    pnlQuote: String(quote),
    pnlPercent: String(percent),
    liquidationPrice,
    amount: String(amount),
    entryFilledAmount: String(amount),
    entryFilledPrice: String(entry),
    peakPrice: extremes?.peak != null ? String(extremes.peak) : undefined,
    troughPrice: extremes?.trough != null ? String(extremes.trough) : undefined,
  };
}
