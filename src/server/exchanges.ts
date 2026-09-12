import ccxt, { type Exchange } from "ccxt";
import type {
  LeverageCaps,
  MarginMode,
  MarketInfo,
  MarketType,
  OpenPosition,
  Side,
  TickerInfo,
  VenueId,
} from "../shared/types.ts";
import path from "node:path";
import { VENUES, isDexVenue, isPaperVenue } from "./venues.ts";
import {
  PAPER_FEED,
  paperAmendOrder,
  paperBalanceMap,
  paperCancelOrder,
  paperFetchOrder,
  paperOpenOrders,
  paperPlaceOrder,
} from "./paper.ts";

function lighterSignerPaths() {
  const root = process.cwd();
  return {
    libraryPath: path.join(root, "vendor", "lighter", "lighter.wasm"),
    wasmExecPath: path.join(root, "vendor", "lighter", "wasm_exec.js"),
  };
}

function hex0x(v: string): string {
  const t = v.trim();
  if (!t) return t;
  return t.startsWith("0x") || t.startsWith("0X") ? t : `0x${t}`;
}

export function marketTypeOf(ex: { market_type?: string | null }): MarketType {
  return ex.market_type === "swap" ? "swap" : "spot";
}

function ccxtCtorName(venue: VenueId, marketType: MarketType): string {
  if (isDexVenue(venue)) return VENUES[venue].ccxtId;
  if (marketType === "swap" && venue === "kraken") return "krakenfutures";
  return VENUES[venue].ccxtId;
}

function defaultType(venue: VenueId, marketType: MarketType): string {
  if (isDexVenue(venue)) return "swap";
  if (marketType === "spot") return "spot";
  if (venue === "binance") return "future";
  return "swap";
}

export interface Creds {
  apiKey: string;
  secret: string;
  passphrase?: string | null;
}

export const PAPER_EMPTY_CREDS: Creds = { apiKey: "", secret: "" };

export function feedOf(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  marketType: MarketType = "spot",
): { accountId: string; venue: VenueId; creds: Creds; marketType: MarketType } {
  if (isPaperVenue(venue)) {
    return {
      accountId: PAPER_FEED,
      venue: "binance",
      creds: PAPER_EMPTY_CREDS,
      marketType: "spot",
    };
  }
  return { accountId, venue, creds, marketType };
}

const clients = new Map<string, Exchange>();
const proClients = new Map<string, Exchange>();
const marketsCache = new Map<
  string,
  { at: number; markets: MarketInfo[] }
>();
const MARKETS_TTL = 10 * 60 * 1000;
const leverageCache = new Map<string, { at: number; caps: LeverageCaps }>();
const LEVERAGE_TTL = 5 * 60 * 1000;

export function forgetClient(accountId: string): void {
  const ex = clients.get(accountId);
  if (ex) {
    try {
      ex.close?.();
    } catch {
      /* ignore */
    }
    clients.delete(accountId);
  }
  const pro = proClients.get(accountId);
  if (pro) {
    try {
      void pro.close?.();
    } catch {
      /* ignore */
    }
    proClients.delete(accountId);
  }
  marketsCache.delete(accountId);
  for (const key of [...leverageCache.keys()]) {
    if (key.startsWith(`${accountId}:`)) leverageCache.delete(key);
  }
}

export function getClient(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  marketType: MarketType = "spot",
): Exchange {
  const feed = feedOf(accountId, venue, creds, marketType);
  accountId = feed.accountId;
  venue = feed.venue;
  creds = feed.creds;
  marketType = feed.marketType;
  const existing = clients.get(accountId);
  if (existing) return existing;
  const ctorName = ccxtCtorName(venue, marketType);
  const Ctor = (ccxt as unknown as Record<string, new (opts: object) => Exchange>)[
    ctorName
  ];
  if (!Ctor) throw new Error(`Unsupported venue ${venue}`);
  const ex = new Ctor(clientOpts(venue, creds, marketType));
  clients.set(accountId, ex);
  return ex;
}

function clientOpts(venue: VenueId, creds: Creds, marketType: MarketType) {
  const type = defaultType(venue, marketType);
  if (venue === "hyperliquid") {
    return {
      walletAddress: hex0x(creds.apiKey),
      privateKey: hex0x(creds.secret),
      enableRateLimit: true,
      timeout: 20000,
      options: { defaultType: "swap", builderFee: false },
    };
  }
  if (venue === "lighter") {
    const signer = lighterSignerPaths();
    return {
      walletAddress: creds.apiKey ? hex0x(creds.apiKey) : undefined,
      privateKey: hex0x(creds.secret),
      enableRateLimit: true,
      timeout: 25000,
      options: {
        defaultType: "swap",
        builderFee: false,
        libraryPath: signer.libraryPath,
        wasmExecPath: signer.wasmExecPath,
      },
    };
  }
  return {
    apiKey: creds.apiKey,
    secret: creds.secret,
    password: creds.passphrase ?? undefined,
    enableRateLimit: true,
    timeout: 20000,
    options: {
      defaultType: type,
      defaultSubType: "linear",
      adjustForTimeDifference: true,
      ...(venue === "binance" && marketType === "swap"
        ? { fetchMarkets: ["linear"] }
        : {}),
    },
  };
}

export function getProClient(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  marketType: MarketType = "spot",
): Exchange | null {
  const feed = feedOf(accountId, venue, creds, marketType);
  accountId = feed.accountId;
  venue = feed.venue;
  creds = feed.creds;
  marketType = feed.marketType;
  const existing = proClients.get(accountId);
  if (existing) return existing;
  const ctorName = ccxtCtorName(venue, marketType);
  const pro = (ccxt as unknown as { pro?: Record<string, new (opts: object) => Exchange> }).pro;
  const Ctor = pro?.[ctorName];
  if (!Ctor) return null;
  const ex = new Ctor(clientOpts(venue, creds, marketType));
  proClients.set(accountId, ex);
  return ex;
}

export function hasWatchTicker(ex: Exchange | null): boolean {
  return Boolean(ex?.has?.["watchTicker"]);
}

export async function testCreds(
  venue: VenueId,
  creds: Creds,
  marketType: MarketType = "spot",
): Promise<void> {
  const mt = isDexVenue(venue) ? "swap" : marketType;
  const id = `probe-${venue}-${mt}-${Date.now()}`;
  const ex = getClient(id, venue, creds, mt);
  try {
    await ex.fetchBalance();
  } finally {
    forgetClient(id);
  }
}

export async function loadMarkets(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  marketType: MarketType = "spot",
): Promise<MarketInfo[]> {
  const feed = feedOf(accountId, venue, creds, marketType);
  accountId = feed.accountId;
  venue = feed.venue;
  creds = feed.creds;
  marketType = feed.marketType;
  const cached = marketsCache.get(accountId);
  if (cached && Date.now() - cached.at < MARKETS_TTL) return cached.markets;
  const ex = getClient(accountId, venue, creds, marketType);
  const raw = await ex.loadMarkets(true);
  const markets: MarketInfo[] = [];
  for (const m of Object.values(raw)) {
    if (!m?.symbol || !m.base || !m.quote) continue;
    if (m.active === false) continue;
    if (marketType === "spot") {
      if (m.spot === false || m.swap) continue;
    } else {
      if (!m.swap) continue;
      if (!isDexVenue(venue) && m.linear === false) continue;
    }
    const maxLev = num(m.limits?.leverage?.max);
    markets.push({
      symbol: m.symbol,
      base: m.base,
      quote: m.quote,
      minAmount: m.limits?.amount?.min ?? null,
      minCost: m.limits?.cost?.min ?? null,
      amountPrecision:
        typeof m.precision?.amount === "number" ? m.precision.amount : null,
      pricePrecision:
        typeof m.precision?.price === "number" ? m.precision.price : null,
      active: true,
      maxLeverage: maxLev != null && maxLev >= 1 ? maxLev : marketType === "swap" ? 50 : null,
    });
  }
  markets.sort((a, b) => a.symbol.localeCompare(b.symbol));
  marketsCache.set(accountId, { at: Date.now(), markets });
  return markets;
}

function maxFromTiers(tiers: unknown): number | null {
  if (!Array.isArray(tiers) || !tiers.length) return null;
  let max = 0;
  for (const t of tiers) {
    const row = t as { maxLeverage?: number };
    const v = num(row.maxLeverage);
    if (v != null && v > max) max = v;
  }
  return max >= 1 ? max : null;
}

export async function fetchLeverageCaps(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  symbol: string,
  marketType: MarketType = "spot",
): Promise<LeverageCaps> {
  if (isPaperVenue(venue)) {
    return { isolatedMax: 1, crossMax: 1 };
  }
  const key = `${accountId}:${symbol}`;
  const hit = leverageCache.get(key);
  if (hit && Date.now() - hit.at < LEVERAGE_TTL) return hit.caps;
  const markets = await loadMarkets(accountId, venue, creds, marketType);
  const market = markets.find((m) => m.symbol === symbol);
  const fallback = Math.floor(market?.maxLeverage ?? 50);
  let isolatedMax = fallback;
  let crossMax = fallback;
  if (marketType === "swap") {
    const ex = getClient(accountId, venue, creds, marketType);
    if (ex.has["fetchLeverage"]) {
      try {
        const lev = await ex.fetchLeverage(symbol);
        const v = num(lev.longLeverage) ?? num(lev.shortLeverage);
        if (v != null && v >= 1) {
          isolatedMax = Math.floor(v);
          crossMax = Math.floor(v);
        }
      } catch {
        /* keep fallback */
      }
    }
    if (ex.has["fetchMarketLeverageTiers"]) {
      try {
        const iso = maxFromTiers(
          await ex.fetchMarketLeverageTiers(symbol, { marginMode: "isolated" }),
        );
        if (iso != null) isolatedMax = Math.floor(iso);
      } catch {
        /* keep */
      }
      try {
        const cr = maxFromTiers(
          await ex.fetchMarketLeverageTiers(symbol, { marginMode: "cross" }),
        );
        if (cr != null) crossMax = Math.floor(cr);
      } catch {
        try {
          const any = maxFromTiers(await ex.fetchMarketLeverageTiers(symbol));
          if (any != null) {
            isolatedMax = Math.max(isolatedMax, Math.floor(any));
            crossMax = Math.max(crossMax, Math.floor(any));
          }
        } catch {
          /* keep */
        }
      }
    } else if (ex.has["fetchLeverageTiers"]) {
      try {
        const all = await ex.fetchLeverageTiers([symbol]);
        const tiers = (all as Record<string, unknown[]>)[symbol];
        const m = maxFromTiers(tiers);
        if (m != null) {
          isolatedMax = Math.floor(m);
          crossMax = Math.floor(m);
        }
      } catch {
        /* keep */
      }
    }
  }
  const caps: LeverageCaps = {
    isolatedMax: Math.max(1, isolatedMax),
    crossMax: Math.max(1, crossMax),
  };
  leverageCache.set(key, { at: Date.now(), caps });
  return caps;
}

export async function fetchTicker(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  symbol: string,
  marketType: MarketType = "spot",
): Promise<TickerInfo> {
  const feed = feedOf(accountId, venue, creds, marketType);
  accountId = feed.accountId;
  venue = feed.venue;
  creds = feed.creds;
  marketType = feed.marketType;
  await loadMarkets(accountId, venue, creds, marketType);
  const ex = getClient(accountId, venue, creds, marketType);
  if (!ex.markets?.[symbol]) {
    throw new Error(`Unknown pair ${symbol} on ${venue} ${marketType === "swap" ? "futures" : "spot"}`);
  }
  const t = await ex.fetchTicker(symbol);
  return tickerFromRaw(symbol, t);
}

export function tickerFromRaw(
  symbol: string,
  t: {
    last?: unknown;
    close?: unknown;
    bid?: unknown;
    ask?: unknown;
    mark?: unknown;
    index?: unknown;
    percentage?: unknown;
    info?: Record<string, unknown>;
  },
): TickerInfo {
  const info = t.info ?? {};
  const mark =
    num(t.mark) ??
    num(t.index) ??
    num(info.markPrice) ??
    num(info.mark) ??
    num(info.indexPrice);
  const last = mark ?? num(t.last) ?? num(t.close) ?? num(t.bid) ?? 0;
  return {
    symbol,
    last,
    bid: num(t.bid) ?? last,
    ask: num(t.ask) ?? last,
    percentage: num(t.percentage),
  };
}

export async function fetchOhlcv(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  symbol: string,
  timeframe: string,
  limit = 120,
  marketType: MarketType = "spot",
): Promise<{ t: number; o: number; h: number; l: number; c: number; v: number }[]> {
  const feed = feedOf(accountId, venue, creds, marketType);
  accountId = feed.accountId;
  venue = feed.venue;
  creds = feed.creds;
  marketType = feed.marketType;
  await loadMarkets(accountId, venue, creds, marketType);
  const ex = getClient(accountId, venue, creds, marketType);
  const rows = await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
  return rows
    .map((row) => ({
      t: num(row[0]) ?? 0,
      o: num(row[1]) ?? 0,
      h: num(row[2]) ?? 0,
      l: num(row[3]) ?? 0,
      c: num(row[4]) ?? 0,
      v: num(row[5]) ?? 0,
    }))
    .filter((c) => c.h > 0 && c.l > 0);
}

export async function publicTicker(
  venue: VenueId,
  symbol: string,
): Promise<TickerInfo | null> {
  try {
    const feed = feedOf(`public-${venue}`, venue, PAPER_EMPTY_CREDS);
    return await fetchTicker(
      feed.accountId,
      feed.venue,
      feed.creds,
      symbol,
      isDexVenue(feed.venue) ? "swap" : feed.marketType,
    );
  } catch {
    return null;
  }
}

export async function fetchOpenOrders(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  symbol?: string,
  marketType: MarketType = "spot",
): Promise<
  {
    id: string;
    symbol: string;
    side: string;
    type: string;
    amount: number;
    price: number | null;
    status: string;
  }[]
> {
  if (isPaperVenue(venue)) return paperOpenOrders(accountId, symbol);
  const ex = getClient(accountId, venue, creds, marketType);
  try {
    const orders = symbol
      ? await ex.fetchOpenOrders(symbol)
      : await ex.fetchOpenOrders();
    return orders.map((o) => ({
      id: String(o.id),
      symbol: String(o.symbol ?? symbol ?? ""),
      side: String(o.side ?? ""),
      type: String(o.type ?? ""),
      amount: num(o.amount) ?? 0,
      price: num(o.price),
      status: String(o.status ?? "open"),
    }));
  } catch {
    return [];
  }
}

export async function fetchBalanceMap(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  marketType: MarketType = "spot",
): Promise<Record<string, { free: number; used: number; total: number }>> {
  if (isPaperVenue(venue)) return paperBalanceMap(accountId);
  const ex = getClient(accountId, venue, creds, marketType);
  const bal = await ex.fetchBalance();
  const out: Record<string, { free: number; used: number; total: number }> = {};
  const totals = (bal.total ?? {}) as Record<string, number>;
  for (const [asset, total] of Object.entries(totals)) {
    const t = num(total) ?? 0;
    if (t === 0) continue;
    const free = num((bal.free as Record<string, number> | undefined)?.[asset]) ?? 0;
    const used = num((bal.used as Record<string, number> | undefined)?.[asset]) ?? 0;
    out[asset] = { free, used, total: t };
  }
  return out;
}

export function estimateLiquidation(
  side: Side,
  entry: number | null | undefined,
  leverage: number | null | undefined,
): number | null {
  if (!(entry != null && entry > 0) || !(leverage != null && leverage > 1)) return null;
  const move = 1 / leverage;
  const px = side === "buy" ? entry * (1 - move) : entry * (1 + move);
  return px > 0 ? px : null;
}

export function samePair(a: string, b: string): boolean {
  if (a === b) return true;
  const n = (s: string) => s.replace(/:.*$/, "").toUpperCase();
  return n(a) === n(b);
}

export function baseAmountFromPosition(pos: {
  contracts?: number | null;
  contractSize?: number | null;
  amount?: number | null;
  info?: Record<string, unknown>;
}): number {
  const size = Number(pos.contractSize);
  const cs = Number.isFinite(size) && size > 0 ? size : 1;
  const contracts = Math.abs(Number(pos.contracts) || 0);
  const fromContracts = contracts * cs;
  if (fromContracts > 0) return fromContracts;
  const fromAmount = Math.abs(Number(pos.amount) || 0);
  if (fromAmount > 0) return fromAmount;
  const fromInfo = Math.abs(Number(pos.info?.size) || 0);
  return fromInfo > 0 ? fromInfo * cs : 0;
}

function marginModeOf(pos: {
  marginMode?: string | null;
  marginType?: string | null;
}): MarginMode | null {
  const raw = String(pos.marginMode ?? pos.marginType ?? "").toLowerCase();
  if (raw === "cross") return "cross";
  if (raw === "isolated") return "isolated";
  return null;
}

export async function fetchOpenPosition(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  symbol: string,
  marketType: MarketType = "spot",
): Promise<OpenPosition | null> {
  const markets = await loadMarkets(accountId, venue, creds, marketType);
  const market = markets.find((m) => m.symbol === symbol);
  if (!market) return null;
  if (marketType === "spot") {
    const bal = await fetchBalanceMap(accountId, venue, creds, marketType);
    const amount = bal[market.base]?.total ?? 0;
    if (!(amount > 0)) return null;
    return {
      symbol,
      side: "buy",
      amount,
      entryPrice: null,
      leverage: null,
      marginMode: null,
      unrealizedPnl: null,
      liquidationPrice: null,
    };
  }
  const ex = getClient(accountId, venue, creds, marketType);
  type PosRow = {
    symbol?: string;
    contracts?: number;
    contractSize?: number;
    amount?: number;
    entryPrice?: number;
    side?: string;
    leverage?: number;
    marginMode?: string;
    marginType?: string;
    unrealizedPnl?: number;
    liquidationPrice?: number;
    info?: Record<string, unknown>;
  };
  const pick = (list: PosRow[]) =>
    list.find((p) => samePair(String(p.symbol ?? ""), symbol) && baseAmountFromPosition(p) > 0) ??
    null;
  let pos: PosRow | null = null;
  try {
    if (ex.has["fetchPosition"]) {
      const one = await ex.fetchPosition(symbol);
      if (one) pos = pick([one]);
    }
  } catch {
    pos = null;
  }
  if (!pos && ex.has["fetchPositions"]) {
    try {
      pos = pick(await ex.fetchPositions([symbol]));
    } catch {
      pos = null;
    }
  }
  if (!pos && ex.has["fetchPositions"]) {
    try {
      pos = pick(await ex.fetchPositions());
    } catch {
      pos = null;
    }
  }
  if (!pos) return null;
  const amount = baseAmountFromPosition(pos);
  const side: Side = pos.side === "short" || pos.side === "sell" ? "sell" : "buy";
  const lev = num(pos.leverage);
  const info = pos.info ?? {};
  const entry = num(pos.entryPrice);
  const liq =
    num(pos.liquidationPrice) ??
    num(info.liquidationPrice) ??
    num(info.liqPrice) ??
    num(info.liquidation_price) ??
    num(info.abortPrice) ??
    estimateLiquidation(side, entry, lev);
  return {
    symbol,
    side,
    amount,
    entryPrice: entry,
    leverage: lev != null && lev >= 1 ? lev : null,
    marginMode: marginModeOf(pos),
    unrealizedPnl: num(pos.unrealizedPnl),
    liquidationPrice: liq != null && liq > 0 ? liq : null,
  };
}

export function usdEstimate(
  byAsset: Record<string, { total: number }>,
): number | null {
  const stables = ["USDT", "USD", "USDC", "BUSD", "DAI", "FDUSD"];
  let sum = 0;
  let found = false;
  for (const s of stables) {
    if (byAsset[s]) {
      sum += byAsset[s].total;
      found = true;
    }
  }
  return found ? sum : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v && Number.isFinite(Number(v))) return Number(v);
  return null;
}

async function applyLeverage(
  ex: Exchange,
  symbol: string,
  leverage: number,
  marginMode: MarginMode,
): Promise<void> {
  try {
    if (ex.has["setMarginMode"]) {
      await ex.setMarginMode(marginMode, symbol);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already|no change|not modified|margin mode/i.test(msg)) {
      /* isolated/cross already set is common */
    }
  }
  if (!ex.has["setLeverage"]) return;
  try {
    await ex.setLeverage(leverage, symbol);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already|no change|not modified|same leverage/i.test(msg)) return;
    throw err;
  }
}

function applyReduceOnly(
  params: Record<string, unknown>,
  on: boolean | undefined,
): void {
  if (!on) return;
  params["reduceOnly"] = true;
  params["reduce_only"] = true;
}

export async function placeOrder(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  opts: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    amount: number;
    price?: number;
    clientOrderId?: string;
    marketType?: MarketType;
    leverage?: number | null;
    marginMode?: MarginMode | null;
    reduceOnly?: boolean;
    trigger?: "tp" | "sl";
    triggerSignal?: string;
  },
): Promise<{ id: string; filled: number; average: number | null; status: string }> {
  const marketType = opts.marketType ?? "spot";
  if (isPaperVenue(venue)) {
    const t = await fetchTicker(
      PAPER_FEED,
      "binance",
      PAPER_EMPTY_CREDS,
      opts.symbol,
      "spot",
    );
    return paperPlaceOrder(
      accountId,
      {
        symbol: opts.symbol,
        side: opts.side,
        type: opts.type,
        amount: opts.amount,
        price: opts.price,
        reduceOnly: opts.reduceOnly,
      },
      t.last,
    );
  }
  const ex = getClient(accountId, venue, creds, marketType);
  const amount = Number(ex.amountToPrecision(opts.symbol, opts.amount));
  const params: Record<string, unknown> = {};
  if (opts.clientOrderId) params["clientOrderId"] = opts.clientOrderId;
  applyReduceOnly(params, opts.reduceOnly);
  if (opts.trigger === "tp" && opts.price != null) {
    params["takeProfitPrice"] = opts.price;
    params["triggerSignal"] = opts.triggerSignal ?? "mark";
  }
  if (opts.trigger === "sl" && opts.price != null) {
    params["stopLossPrice"] = opts.price;
    params["triggerSignal"] = opts.triggerSignal ?? "mark";
  }
  if (venue === "bybit" && marketType === "swap") params["positionIdx"] = 0;

  if (
    marketType === "swap" &&
    !opts.reduceOnly &&
    opts.leverage != null &&
    opts.leverage >= 1
  ) {
    await applyLeverage(
      ex,
      opts.symbol,
      Math.round(opts.leverage),
      opts.marginMode === "cross" ? "cross" : "isolated",
    );
    params["leverage"] = Math.round(opts.leverage);
  }

  const futures = marketType === "swap";
  let order;
  if (
    !futures &&
    opts.type === "market" &&
    opts.side === "buy" &&
    ex.has["createMarketBuyOrderWithCost"] &&
    opts.price
  ) {
    const cost = Number(
      ex.costToPrecision?.(opts.symbol, amount * opts.price) ?? amount * opts.price,
    );
    order = await ex.createMarketBuyOrderWithCost(opts.symbol, cost, params);
  } else if (opts.type === "limit") {
    if (opts.price == null) throw new Error("Limit order requires a price");
    const price = Number(ex.priceToPrecision(opts.symbol, opts.price));
    order = await ex.createOrder(
      opts.symbol,
      "limit",
      opts.side,
      amount,
      price,
      params,
    );
  } else {
    order = await ex.createOrder(
      opts.symbol,
      "market",
      opts.side,
      amount,
      undefined,
      params,
    );
  }

  return {
    id: String(order.id),
    filled: num(order.filled) ?? 0,
    average: num(order.average),
    status: String(order.status ?? "open"),
  };
}

export async function fetchOrderSnap(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  orderId: string,
  symbol: string,
  marketType: MarketType = "spot",
): Promise<{
  id: string;
  status: "open" | "closed" | "canceled" | "rejected" | "expired";
  filled: number;
  average: number | null;
} | null> {
  if (!orderId || orderId === "placing") return null;
  if (isPaperVenue(venue)) {
    const t = await fetchTicker(
      PAPER_FEED,
      "binance",
      PAPER_EMPTY_CREDS,
      symbol,
      "spot",
    );
    return paperFetchOrder(accountId, orderId, t.last);
  }
  const ex = getClient(accountId, venue, creds, marketType);
  try {
    const o = await ex.fetchOrder(orderId, symbol);
    const st = String(o.status ?? "open");
    const status =
      st === "closed" || st === "canceled" || st === "rejected" || st === "expired"
        ? st
        : "open";
    return {
      id: String(o.id),
      status,
      filled: num(o.filled) ?? 0,
      average: num(o.average) ?? num(o.price),
    };
  } catch {
    return null;
  }
}

export async function cancelOrderSafe(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  orderId: string,
  symbol: string,
  marketType: MarketType = "spot",
): Promise<void> {
  if (!orderId || orderId === "placing") return;
  if (isPaperVenue(venue)) {
    await paperCancelOrder(accountId, orderId);
    return;
  }
  const ex = getClient(accountId, venue, creds, marketType);
  try {
    await ex.cancelOrder(orderId, symbol);
  } catch {
    /* already gone */
  }
}

export async function amendLimitPrice(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  orderId: string,
  symbol: string,
  side: "buy" | "sell",
  amount: number,
  price: number,
  marketType: MarketType = "spot",
  extra?: { reduceOnly?: boolean; trigger?: "tp" | "sl"; type?: "market" | "limit" },
): Promise<string> {
  if (isPaperVenue(venue)) {
    const t = await fetchTicker(
      PAPER_FEED,
      "binance",
      PAPER_EMPTY_CREDS,
      symbol,
      "spot",
    );
    return paperAmendOrder(accountId, orderId, price, t.last);
  }
  const reduceOnly = extra?.reduceOnly ?? marketType === "swap";
  const trigger = extra?.trigger;
  if (trigger) {
    await cancelOrderSafe(accountId, venue, creds, orderId, symbol, marketType);
    const created = await placeOrder(accountId, venue, creds, {
      symbol,
      side,
      type: extra.type ?? "market",
      amount,
      price,
      marketType,
      reduceOnly,
      trigger,
    });
    return created.id;
  }
  const ex = getClient(accountId, venue, creds, marketType);
  const px = Number(ex.priceToPrecision(symbol, price));
  const amt = Number(ex.amountToPrecision(symbol, amount));
  const params: Record<string, unknown> = {};
  applyReduceOnly(params, reduceOnly);
  if (ex.has["editOrder"]) {
    const edited = await ex.editOrder(orderId, symbol, "limit", side, amt, px, params);
    return String(edited.id ?? orderId);
  }
  await cancelOrderSafe(accountId, venue, creds, orderId, symbol, marketType);
  const created = await placeOrder(accountId, venue, creds, {
    symbol,
    side,
    type: "limit",
    amount: amt,
    price: px,
    marketType,
    reduceOnly,
  });
  return created.id;
}
