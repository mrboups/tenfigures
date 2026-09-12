export const VENUE_IDS = [
  "binance",
  "mexc",
  "gate",
  "bitget",
  "bybit",
  "kraken",
  "hyperliquid",
  "lighter",
  "paper",
] as const;

export type VenueId = (typeof VENUE_IDS)[number];

export type Side = "buy" | "sell";
export type EntryType = "limit" | "market" | "conditional" | "signal";
export type TpType = "limit" | "market";
export type SlType = "cond_limit" | "cond_market";
export type TradeKind = "smart" | "cover" | "simple";
export type TriggerDir = "lte" | "gte";
export type ClosedReason = "tp" | "sl" | "manual" | "detached";

export interface PendingAdd {
  id: string;
  price: string;
  baseAmount: string;
  quoteAmount: string;
  orderId: string | null;
  filled: boolean;
}

export interface TpTarget {
  id: string;
  price: string;
  percent: string | null;
  qtyPct: number;
  orderId: string | null;
  filled: boolean;
}
export type MarketType = "spot" | "swap";
export type MarginMode = "isolated" | "cross";

export const LEVERAGE_STEPS = [2, 3, 4, 5, 10, 25, 50] as const;
/** Product cap on the ticket. Exchange max still applies if it is lower. */
export const PANEL_MAX_LEVERAGE = 10;

export function allowedLeverageSteps(max: number): number[] {
  const cap = Math.floor(max);
  const steps = LEVERAGE_STEPS.filter((s) => s <= cap);
  return steps.length ? [...steps] : [Math.max(1, cap || 1)];
}

export function marketTypeLabel(t: MarketType | string | null | undefined): "spot" | "futures" {
  return t === "swap" ? "futures" : "spot";
}

export type TradeStatus =
  | "cold_start"
  | "waiting_trigger"
  | "entry_pending"
  | "in_position"
  | "closing"
  | "closed"
  | "cancelled"
  | "error";

export interface VenueInfo {
  id: VenueId;
  name: string;
  ccxtId: string;
  needsPassphrase: boolean;
  dex?: boolean;
  needsWallet?: boolean;
}

export interface ExchangeAccount {
  id: string;
  venue: VenueId;
  label: string;
  marketType: MarketType;
  createdAt: string;
  lastOkAt: string | null;
  lastError: string | null;
  apiKeyLast4: string | null;
}

export interface MarketInfo {
  symbol: string;
  base: string;
  quote: string;
  minAmount: number | null;
  minCost: number | null;
  amountPrecision: number | null;
  pricePrecision: number | null;
  active: boolean;
  maxLeverage: number | null;
}

export interface TickerInfo {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  percentage: number | null;
}

export interface BalanceInfo {
  totalUsd: number | null;
  byAsset: Record<string, { free: number; used: number; total: number }>;
}

export interface LeverageCaps {
  isolatedMax: number;
  crossMax: number;
}

export interface OpenPosition {
  symbol: string;
  side: Side;
  amount: number;
  entryPrice: number | null;
  leverage: number | null;
  marginMode: MarginMode | null;
  unrealizedPnl: number | null;
  liquidationPrice: number | null;
}

export interface SmartTrade {
  id: string;
  exchangeId: string;
  exchangeLabel: string;
  venue: VenueId;
  pair: string;
  base: string;
  quote: string;
  side: Side;
  kind: TradeKind;
  status: TradeStatus;
  amount: string;
  useExistingAssets: boolean;
  entryType: EntryType;
  entryPrice: string | null;
  signalIndicator: string | null;
  trailingEntryEnabled: boolean;
  trailingEntryPercent: string | null;
  tpEnabled: boolean;
  tpType: TpType | null;
  tpPrice: string | null;
  tpPercent: string | null;
  trailingTpEnabled: boolean;
  trailingTpPercent: string | null;
  slEnabled: boolean;
  slType: SlType | null;
  slTrigger: string;
  slPrice: string | null;
  slPercent: string | null;
  slTimeoutEnabled: boolean;
  slTimeoutSec: number | null;
  slTimeoutStartedAt: string | null;
  trailingSlEnabled: boolean;
  moveToBreakeven: boolean;
  note: string | null;
  entryOrderId: string | null;
  tpOrderId: string | null;
  slOrderId: string | null;
  exitOrderId: string | null;
  entryFilledPrice: string | null;
  entryFilledAmount: string | null;
  exitPrice: string | null;
  peakPrice: string | null;
  troughPrice: string | null;
  pnlQuote: string | null;
  pnlPercent: string | null;
  closedReason: ClosedReason | null;
  lastError: string | null;
  triggerDir: TriggerDir | null;
  lastPrice: string | null;
  initialAmount: string | null;
  initialQuote: string | null;
  leverage: number | null;
  marginMode: MarginMode | null;
  liquidationPrice: string | null;
  protectAmount: string | null;
  tpReduceOnly: boolean;
  slReduceOnly: boolean;
  tpTargets: TpTarget[];
  pendingAdds: PendingAdd[];
  createdAt: string;
  filledAt: string | null;
  closedAt: string | null;
}

export interface TradeStep {
  id: string;
  tradeId: string;
  side: Side;
  stepNo: number;
  price: string | null;
  baseAmount: string | null;
  quoteAmount: string | null;
  status: "finished" | "cancelled" | "error";
  error: string | null;
  orderId: string | null;
  createdAt: string;
}

export interface AssetSlice {
  asset: string;
  amount: number;
  usd: number;
  pct: number;
  change24h: number | null;
}

export interface SnapshotPoint {
  at: string;
  usd: number;
  btc: number | null;
}

export interface ExchangeCard {
  id: string;
  venue: VenueId;
  label: string;
  marketType: MarketType;
  lastError: string | null;
  apiKeyLast4: string | null;
  usd: number;
  btc: number | null;
  change24hUsd: number | null;
  change24hBtc: number | null;
  assets: AssetSlice[];
}

export interface DashboardData {
  exchangeCount: number;
  usd: number;
  btc: number | null;
  change24hUsd: number | null;
  change24hBtc: number | null;
  exchanges: ExchangeCard[];
  series: SnapshotPoint[];
}

export interface ExchangeDetails {
  exchange: ExchangeAccount;
  usd: number;
  btc: number | null;
  change24hUsd: number | null;
  change24hPct: number | null;
  assetCount: number;
  assets: AssetSlice[];
  realizedPnlUsd: number;
  monthPnlUsd: number;
  monthPnlPct: number | null;
  dayPnlUsd: number;
  dayPnlPct: number | null;
  sharpe: number | null;
  deviation: number | null;
  sortino: number | null;
  series: SnapshotPoint[];
  openOrders: OpenOrder[];
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: string;
  type: string;
  amount: number;
  price: number | null;
  status: string;
}

export interface CreateTradeBody {
  exchangeId: string;
  pair: string;
  side: Side;
  kind: TradeKind;
  amount: string;
  useExistingAssets: boolean;
  entryType: EntryType;
  entryPrice?: string | null;
  trailingEntryEnabled?: boolean;
  trailingEntryPercent?: string | null;
  tpEnabled: boolean;
  tpType?: TpType | null;
  tpPrice?: string | null;
  tpPercent?: string | null;
  trailingTpEnabled?: boolean;
  trailingTpPercent?: string | null;
  tpReduceOnly?: boolean;
  slEnabled: boolean;
  slType?: SlType | null;
  slTrigger?: string;
  slPrice?: string | null;
  slPercent?: string | null;
  slTimeoutEnabled?: boolean;
  slTimeoutSec?: number | null;
  trailingSlEnabled?: boolean;
  slReduceOnly?: boolean;
  moveToBreakeven?: boolean;
  note?: string | null;
  leverage?: number | null;
  marginMode?: MarginMode | null;
  tpTargets?: TpTarget[];
  coldStart?: boolean;
  signalIndicator?: string | null;
}

export interface ProtectTradeBody {
  tpEnabled: boolean;
  tpType?: TpType | null;
  tpPrice?: string | null;
  tpPercent?: string | null;
  slEnabled: boolean;
  slType?: SlType | null;
  slPrice?: string | null;
  slPercent?: string | null;
  exitAmount?: string | null;
  tpReduceOnly?: boolean;
  slReduceOnly?: boolean;
  tpTargets?: TpTarget[];
}

export interface CreateExchangeBody {
  venue: VenueId;
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string | null;
  marketType?: MarketType;
}

export interface SimpleOrderBody {
  exchangeId: string;
  pair: string;
  side: Side;
  type: "market" | "limit";
  amount: string;
  price?: string | null;
  leverage?: number | null;
  marginMode?: MarginMode | null;
}
