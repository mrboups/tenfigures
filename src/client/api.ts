import type {
  BalanceInfo,
  CreateExchangeBody,
  CreateTradeBody,
  DashboardData,
  ProtectTradeBody,
  ExchangeAccount,
  ExchangeDetails,
  MarketInfo,
  LeverageCaps,
  OpenPosition,
  SimpleOrderBody,
  SmartTrade,
  TickerInfo,
  TradeStep,
  VenueInfo,
} from "../shared/types.ts";
import type { IndicatorId, TfBias } from "../shared/demark.ts";
import { appPath, routePath } from "./base.ts";

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { credentials: "include", ...opts, headers });
  const text = await res.text();
  let data: { error?: string } | T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as { error?: string } & T;
    } catch {
      throw new Error(text.replace(/<[^>]+>/g, " ").trim().slice(0, 240) || res.statusText);
    }
  }
  if (res.status === 401 && routePath() !== "/login") {
    location.href = appPath("/login");
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    throw new Error((data as { error?: string } | null)?.error || res.statusText);
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    req<{ ok: boolean }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => req("/api/logout", { method: "POST" }),
  me: () => req<{ username: string; demo?: boolean; gofundmeUrl?: string }>("/api/me"),
  waitlist: () => req<{ remaining: number }>("/api/waitlist"),
  joinWaitlist: (email: string) =>
    req<{ ok: boolean; already?: boolean; remaining?: number }>("/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  venues: () => req<{ venues: VenueInfo[] }>("/api/venues"),
  exchanges: () => req<{ exchanges: ExchangeAccount[] }>("/api/exchanges"),
  createExchange: (body: CreateExchangeBody) =>
    req<{ exchange: ExchangeAccount }>("/api/exchanges", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteExchange: (id: string) =>
    req(`/api/exchanges/${id}`, { method: "DELETE" }),
  balance: (id: string) =>
    req<BalanceInfo>(`/api/exchanges/${id}/balance`),
  markets: (id: string, quote?: string) =>
    req<{ markets: MarketInfo[]; quotes: string[] }>(
      `/api/exchanges/${id}/markets${quote ? `?quote=${encodeURIComponent(quote)}` : ""}`,
    ),
  ticker: (id: string, symbol: string) =>
    req<{ ticker: TickerInfo }>(
      `/api/exchanges/${id}/ticker?symbol=${encodeURIComponent(symbol)}`,
    ),
  bias: (id: string, symbol: string, indicator?: IndicatorId) =>
    req<{ frames: TfBias[] }>(
      `/api/exchanges/${id}/bias?symbol=${encodeURIComponent(symbol)}${indicator ? `&indicator=${encodeURIComponent(indicator)}` : ""}`,
    ),
  biasMany: (
    items: { exchangeId: string; symbol: string }[],
    indicators?: IndicatorId | IndicatorId[],
  ) =>
    req<{
      results: {
        exchangeId: string;
        symbol: string;
        frames: TfBias[];
        byIndicator?: Partial<Record<IndicatorId, TfBias[]>>;
      }[];
    }>("/api/bias", {
      method: "POST",
      body: JSON.stringify({
        items,
        indicators: Array.isArray(indicators)
          ? indicators
          : indicators
            ? [indicators]
            : undefined,
      }),
    }),
  candles: (id: string, symbol: string, timeframe = "15m", limit = 80) =>
    req<{ candles: { t: number; o: number; h: number; l: number; c: number; v?: number }[] }>(
      `/api/exchanges/${id}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`,
    ),
  position: (id: string, symbol: string) =>
    req<{ position: OpenPosition | null }>(
      `/api/exchanges/${id}/position?symbol=${encodeURIComponent(symbol)}`,
    ),
  leverage: (id: string, symbol: string) =>
    req<{ caps: LeverageCaps }>(
      `/api/exchanges/${id}/leverage?symbol=${encodeURIComponent(symbol)}`,
    ),
  trades: (scope?: "open" | "history" | "all") =>
    req<{ trades: SmartTrade[] }>(
      `/api/trades${scope && scope !== "all" ? `?scope=${scope}` : ""}`,
    ),
  tradeSteps: (id: string) =>
    req<{ steps: TradeStep[] }>(`/api/trades/${id}/steps`),
  addFunds: (
    id: string,
    body: { quoteAmount: string; type: "market" | "limit"; price?: string | null },
  ) =>
    req(`/api/trades/${id}/add-funds`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reduceFunds: (
    id: string,
    body: { baseAmount: string; type: "market" | "limit"; price?: string | null },
  ) =>
    req(`/api/trades/${id}/reduce-funds`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  dashboard: () => req<DashboardData>("/api/dashboard"),
  exchangeDetails: (id: string) =>
    req<{ details: ExchangeDetails }>(`/api/exchanges/${id}/details`),
  createTrade: (body: CreateTradeBody) =>
    req<{ trade: SmartTrade }>("/api/trades", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  simpleOrder: (body: SimpleOrderBody) =>
    req<{ trade: SmartTrade }>("/api/orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  setNote: (id: string, note: string) =>
    req<{ trade: SmartTrade }>(`/api/trades/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    }),
  setProtect: (id: string, body: ProtectTradeBody) =>
    req<{ trade: SmartTrade }>(`/api/trades/${id}/protect`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  refreshTrade: (id: string) =>
    req<{ trade: SmartTrade }>(`/api/trades/${id}/refresh`, { method: "POST" }),
  cancelTrade: (id: string) =>
    req(`/api/trades/${id}/cancel`, { method: "POST" }),
  closeTrade: (id: string) =>
    req(`/api/trades/${id}/close`, { method: "POST" }),
  fireUp: (id: string) =>
    req<{ trade: SmartTrade }>(`/api/trades/${id}/fire-up`, { method: "POST" }),
  enterPosition: (id: string, type: "limit" | "market") =>
    req<{ trade: SmartTrade }>(`/api/trades/${id}/enter`, {
      method: "POST",
      body: JSON.stringify({ type }),
    }),
};
