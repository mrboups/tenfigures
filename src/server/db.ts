import pg from "pg";
import type { AppEnv } from "./env.ts";
import type {
  ClosedReason,
  EntryType,
  MarginMode,
  MarketType,
  Side,
  SlType,
  SmartTrade,
  TpType,
  TradeKind,
  TradeStatus,
  TriggerDir,
  VenueId,
} from "../shared/types.ts";
import { parseTpTargets } from "../shared/targets.ts";
import { parsePendingAdds } from "../shared/adds.ts";

const { Pool } = pg;

export type PoolClient = pg.Pool;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS exchanges (
  id TEXT PRIMARY KEY,
  venue TEXT NOT NULL,
  label TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  api_secret_enc TEXT NOT NULL,
  passphrase_enc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS smart_trades (
  id TEXT PRIMARY KEY,
  exchange_id TEXT NOT NULL REFERENCES exchanges(id) ON DELETE RESTRICT,
  pair TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  side TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'smart',
  status TEXT NOT NULL,
  amount TEXT NOT NULL,
  use_existing_assets BOOLEAN NOT NULL DEFAULT false,
  entry_type TEXT NOT NULL,
  entry_price TEXT,
  trailing_entry_enabled BOOLEAN NOT NULL DEFAULT false,
  trailing_entry_percent TEXT,
  tp_enabled BOOLEAN NOT NULL DEFAULT false,
  tp_type TEXT,
  tp_price TEXT,
  tp_percent TEXT,
  trailing_tp_enabled BOOLEAN NOT NULL DEFAULT false,
  trailing_tp_percent TEXT,
  sl_enabled BOOLEAN NOT NULL DEFAULT false,
  sl_type TEXT,
  sl_trigger TEXT NOT NULL DEFAULT 'last',
  sl_price TEXT,
  sl_percent TEXT,
  sl_timeout_enabled BOOLEAN NOT NULL DEFAULT false,
  sl_timeout_sec INTEGER,
  sl_timeout_started_at TIMESTAMPTZ,
  trailing_sl_enabled BOOLEAN NOT NULL DEFAULT false,
  move_to_breakeven BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  entry_order_id TEXT,
  tp_order_id TEXT,
  exit_order_id TEXT,
  entry_filled_price TEXT,
  entry_filled_amount TEXT,
  exit_price TEXT,
  peak_price TEXT,
  trough_price TEXT,
  pnl_quote TEXT,
  pnl_percent TEXT,
  closed_reason TEXT,
  last_error TEXT,
  trigger_dir TEXT,
  last_price TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  filled_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS smart_trades_status_idx ON smart_trades (status);
CREATE INDEX IF NOT EXISTS smart_trades_created_idx ON smart_trades (created_at DESC);

CREATE TABLE IF NOT EXISTS trade_steps (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL REFERENCES smart_trades(id) ON DELETE CASCADE,
  side TEXT NOT NULL,
  step_no INTEGER NOT NULL,
  price TEXT,
  base_amount TEXT,
  quote_amount TEXT,
  status TEXT NOT NULL,
  error TEXT,
  order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trade_steps_trade_idx ON trade_steps (trade_id, side, step_no);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id TEXT PRIMARY KEY,
  exchange_id TEXT,
  usd TEXT NOT NULL,
  btc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_snapshots_ex_idx
  ON portfolio_snapshots (exchange_id, created_at DESC);
`;

const MIGRATIONS = `
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS api_key_last4 TEXT;
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS market_type TEXT NOT NULL DEFAULT 'spot';
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS initial_amount TEXT;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS initial_quote TEXT;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS leverage INTEGER;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS margin_mode TEXT;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS liquidation_price TEXT;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS protect_amount TEXT;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS sl_order_id TEXT;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS tp_reduce_only BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS sl_reduce_only BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS tp_targets TEXT;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS signal_indicator TEXT;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS pending_adds TEXT;
ALTER TABLE smart_trades ADD COLUMN IF NOT EXISTS applied_order_ids TEXT;

CREATE TABLE IF NOT EXISTS paper_balances (
  exchange_id TEXT NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  free TEXT NOT NULL,
  used TEXT NOT NULL,
  PRIMARY KEY (exchange_id, asset)
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id TEXT PRIMARY KEY,
  exchange_id TEXT NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  amount TEXT NOT NULL,
  price TEXT,
  filled TEXT NOT NULL DEFAULT '0',
  average TEXT,
  status TEXT NOT NULL,
  reduce_only BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_orders_ex_idx
  ON paper_orders (exchange_id, status);

CREATE TABLE IF NOT EXISTS waitlist (
  email TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'waitlist',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export function createPool(env: AppEnv): pg.Pool {
  const url = new URL(env.databaseUrl);
  const ssl =
    env.isProd || url.searchParams.get("sslmode") === "require"
      ? { rejectUnauthorized: false }
      : undefined;
  return new Pool({
    connectionString: env.databaseUrl,
    ssl,
    max: 10,
  });
}

export async function initSchema(pool: pg.Pool): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query(MIGRATIONS);
}

export async function q<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function qOne<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(pool, text, params);
  return rows[0] ?? null;
}

export interface ExchangeRow {
  id: string;
  venue: VenueId;
  label: string;
  api_key_enc: string;
  api_secret_enc: string;
  passphrase_enc: string | null;
  created_at: Date;
  last_ok_at: Date | null;
  last_error: string | null;
  api_key_last4: string | null;
  market_type: MarketType;
}

export interface TradeRow {
  id: string;
  exchange_id: string;
  pair: string;
  base: string;
  quote: string;
  side: Side;
  kind: TradeKind;
  status: TradeStatus;
  amount: string;
  use_existing_assets: boolean;
  entry_type: EntryType;
  entry_price: string | null;
  signal_indicator: string | null;
  trailing_entry_enabled: boolean;
  trailing_entry_percent: string | null;
  tp_enabled: boolean;
  tp_type: TpType | null;
  tp_price: string | null;
  tp_percent: string | null;
  trailing_tp_enabled: boolean;
  trailing_tp_percent: string | null;
  sl_enabled: boolean;
  sl_type: SlType | null;
  sl_trigger: string;
  sl_price: string | null;
  sl_percent: string | null;
  sl_timeout_enabled: boolean;
  sl_timeout_sec: number | null;
  sl_timeout_started_at: Date | null;
  trailing_sl_enabled: boolean;
  move_to_breakeven: boolean;
  note: string | null;
  entry_order_id: string | null;
  tp_order_id: string | null;
  sl_order_id: string | null;
  exit_order_id: string | null;
  entry_filled_price: string | null;
  entry_filled_amount: string | null;
  exit_price: string | null;
  peak_price: string | null;
  trough_price: string | null;
  pnl_quote: string | null;
  pnl_percent: string | null;
  closed_reason: ClosedReason | null;
  last_error: string | null;
  trigger_dir: TriggerDir | null;
  last_price: string | null;
  initial_amount: string | null;
  initial_quote: string | null;
  leverage: number | null;
  margin_mode: MarginMode | null;
  liquidation_price: string | null;
  protect_amount: string | null;
  tp_reduce_only: boolean;
  sl_reduce_only: boolean;
  tp_targets: string | null;
  pending_adds: string | null;
  applied_order_ids: string | null;
  created_at: Date;
  filled_at: Date | null;
  closed_at: Date | null;
  exchange_label?: string;
  venue?: VenueId;
}

export function publicExchange(row: ExchangeRow) {
  return {
    id: row.id,
    venue: row.venue,
    label: row.label,
    marketType: (row.market_type === "swap" ? "swap" : "spot") as MarketType,
    createdAt: row.created_at.toISOString(),
    lastOkAt: row.last_ok_at ? row.last_ok_at.toISOString() : null,
    lastError: row.last_error,
    apiKeyLast4: row.api_key_last4 ?? null,
  };
}

export function publicTrade(row: TradeRow): SmartTrade {
  return {
    id: row.id,
    exchangeId: row.exchange_id,
    exchangeLabel: row.exchange_label ?? "",
    venue: (row.venue ?? "binance") as VenueId,
    pair: row.pair,
    base: row.base,
    quote: row.quote,
    side: row.side,
    kind: row.kind,
    status: row.status,
    amount: row.amount,
    useExistingAssets: row.use_existing_assets,
    entryType: row.entry_type,
    entryPrice: row.entry_price,
    signalIndicator: row.signal_indicator ?? null,
    trailingEntryEnabled: row.trailing_entry_enabled,
    trailingEntryPercent: row.trailing_entry_percent,
    tpEnabled: row.tp_enabled,
    tpType: row.tp_type,
    tpPrice: row.tp_price,
    tpPercent: row.tp_percent,
    trailingTpEnabled: row.trailing_tp_enabled,
    trailingTpPercent: row.trailing_tp_percent,
    slEnabled: row.sl_enabled,
    slType: row.sl_type,
    slTrigger: row.sl_trigger,
    slPrice: row.sl_price,
    slPercent: row.sl_percent,
    slTimeoutEnabled: row.sl_timeout_enabled,
    slTimeoutSec: row.sl_timeout_sec,
    slTimeoutStartedAt: row.sl_timeout_started_at
      ? row.sl_timeout_started_at.toISOString()
      : null,
    trailingSlEnabled: row.trailing_sl_enabled,
    moveToBreakeven: row.move_to_breakeven,
    note: row.note,
    entryOrderId: row.entry_order_id,
    tpOrderId: row.tp_order_id,
    slOrderId: row.sl_order_id,
    exitOrderId: row.exit_order_id,
    entryFilledPrice: row.entry_filled_price,
    entryFilledAmount: row.entry_filled_amount,
    exitPrice: row.exit_price,
    peakPrice: row.peak_price,
    troughPrice: row.trough_price,
    pnlQuote: row.pnl_quote,
    pnlPercent: row.pnl_percent,
    closedReason: row.closed_reason,
    lastError: row.last_error,
    triggerDir: row.trigger_dir,
    lastPrice: row.last_price,
    initialAmount: row.initial_amount ?? null,
    initialQuote: row.initial_quote ?? null,
    leverage: row.leverage ?? null,
    marginMode: row.margin_mode ?? null,
    liquidationPrice: row.liquidation_price ?? null,
    protectAmount: row.protect_amount ?? null,
    tpReduceOnly: row.tp_reduce_only !== false,
    slReduceOnly: row.sl_reduce_only !== false,
    tpTargets: parseTpTargets(row.tp_targets),
    pendingAdds: parsePendingAdds(row.pending_adds),
    createdAt: row.created_at.toISOString(),
    filledAt: row.filled_at ? row.filled_at.toISOString() : null,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
  };
}
