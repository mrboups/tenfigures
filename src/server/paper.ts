import { AsyncLocalStorage } from "node:async_hooks";
import { encrypt } from "./crypto.ts";
import { q, qOne, type PoolClient } from "./db.ts";
import type { AppEnv } from "./env.ts";
import type { Side } from "../shared/types.ts";

const PAPER_FEED = "paper-public";
const demoAls = new AsyncLocalStorage<{ visitorId: string }>();

let paperPool: PoolClient | null = null;
let paperEnv: AppEnv | null = null;

export type PaperWallet = Record<string, { free: number; used: number }>;

export function attachPaper(pool: PoolClient, env: AppEnv): void {
  paperPool = pool;
  paperEnv = env;
}

function db(): PoolClient {
  if (!paperPool) throw new Error("Paper store not attached");
  return paperPool;
}

function envOf(): AppEnv {
  if (!paperEnv) throw new Error("Paper store not attached");
  return paperEnv;
}

export function demoVisitorId(): string | null {
  return demoAls.getStore()?.visitorId ?? null;
}

export async function withDemoVisitor<T>(
  id: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  return await demoAls.run({ visitorId: id }, fn);
}

export function splitPair(symbol: string): { base: string; quote: string } {
  const core = symbol.replace(/:.*$/, "");
  const [base, quote] = core.split("/");
  if (!base || !quote) throw new Error(`Bad pair ${symbol}`);
  return { base, quote };
}

export function limitWouldFill(
  side: Side,
  last: number,
  price: number,
): boolean {
  if (!(last > 0) || !(price > 0)) return false;
  return side === "buy" ? last <= price : last >= price;
}

function asset(w: PaperWallet, name: string): { free: number; used: number } {
  return w[name] ?? { free: 0, used: 0 };
}

function cloneWallet(w: PaperWallet): PaperWallet {
  const next: PaperWallet = {};
  for (const [k, v] of Object.entries(w)) {
    next[k] = { free: v.free, used: v.used };
  }
  return next;
}

export function lockForLimit(
  w: PaperWallet,
  side: Side,
  amount: number,
  price: number,
  base: string,
  quote: string,
): PaperWallet {
  const next = cloneWallet(w);
  next[base] = { ...asset(next, base) };
  next[quote] = { ...asset(next, quote) };
  if (side === "buy") {
    const cost = amount * price;
    if (next[quote].free + 1e-12 < cost) {
      throw new Error(`Not enough demo ${quote}`);
    }
    next[quote].free -= cost;
    next[quote].used += cost;
  } else {
    if (next[base].free + 1e-12 < amount) {
      throw new Error(`Not enough demo ${base}`);
    }
    next[base].free -= amount;
    next[base].used += amount;
  }
  return next;
}

export function unlockLimit(
  w: PaperWallet,
  side: Side,
  amount: number,
  price: number,
  base: string,
  quote: string,
): PaperWallet {
  const next = cloneWallet(w);
  next[base] = { ...asset(next, base) };
  next[quote] = { ...asset(next, quote) };
  if (side === "buy") {
    const cost = amount * price;
    const used = Math.min(next[quote].used, cost);
    next[quote].used -= used;
    next[quote].free += used;
  } else {
    const used = Math.min(next[base].used, amount);
    next[base].used -= used;
    next[base].free += used;
  }
  return next;
}

export function settleFill(
  w: PaperWallet,
  side: Side,
  amount: number,
  price: number,
  base: string,
  quote: string,
  fromLock: boolean,
): PaperWallet {
  const next = cloneWallet(w);
  next[base] = { ...asset(next, base) };
  next[quote] = { ...asset(next, quote) };
  const cost = amount * price;
  if (side === "buy") {
    if (fromLock) {
      const used = Math.min(next[quote].used, cost);
      next[quote].used -= used;
      if (used + 1e-8 < cost) {
        const rest = cost - used;
        if (next[quote].free + 1e-12 < rest) {
          throw new Error(`Not enough demo ${quote}`);
        }
        next[quote].free -= rest;
      }
    } else {
      if (next[quote].free + 1e-12 < cost) {
        throw new Error(`Not enough demo ${quote}`);
      }
      next[quote].free -= cost;
    }
    next[base].free += amount;
  } else {
    if (fromLock) {
      const used = Math.min(next[base].used, amount);
      next[base].used -= used;
      if (used + 1e-8 < amount) {
        const rest = amount - used;
        if (next[base].free + 1e-12 < rest) {
          throw new Error(`Not enough demo ${base}`);
        }
        next[base].free -= rest;
      }
    } else {
      if (next[base].free + 1e-12 < amount) {
        throw new Error(`Not enough demo ${base}`);
      }
      next[base].free -= amount;
    }
    next[quote].free += cost;
  }
  return next;
}

export const DEMO_SEEDS = [
  {
    slug: "btc",
    pair: "BTC/USDT",
    base: "BTC",
    entry: 59000,
    quote: 10000,
    note: null,
  },
  {
    slug: "eth",
    pair: "ETH/USDT",
    base: "ETH",
    entry: 1600,
    quote: 5000,
    note: null,
  },
  {
    slug: "xrp",
    pair: "XRP/USDT",
    base: "XRP",
    entry: 1,
    quote: 2500,
    note: null,
  },
] as const;

export const DEMO_BTC_ENTRY = DEMO_SEEDS[0].entry;
export const DEMO_BTC_QUOTE = DEMO_SEEDS[0].quote;
export const DEMO_BTC_AMOUNT = DEMO_BTC_QUOTE / DEMO_BTC_ENTRY;
export const DEMO_BTC_PAIR = DEMO_SEEDS[0].pair;

export function demoSeedId(visitorId: string, slug: string): string {
  return `demo-${slug}-${visitorId}`;
}

/** Positions list: BTC, then ETH, then XRP, then anything else. */
export function demoSeedListRank(id: string): number {
  if (id.startsWith("demo-btc-")) return 0;
  if (id.startsWith("demo-eth-")) return 1;
  if (id.startsWith("demo-xrp-")) return 2;
  return 3;
}

/** Seed showcase trades stay open per visitor; do not rewrite live last price. */
export function shouldReseedDemoTrade(status: string | undefined): boolean {
  return status !== "in_position";
}

export async function ensurePaperWallet(visitorId: string): Promise<void> {
  const pool = db();
  const env = envOf();
  const start = env.paperStartUsdt;
  await pool.query(
    `INSERT INTO exchanges (
       id, venue, label, api_key_enc, api_secret_enc, passphrase_enc,
       last_ok_at, api_key_last4, market_type
     ) VALUES ($1,'paper','Demo Account',$2,$3,NULL, now(), 'demo', 'spot')
     ON CONFLICT (id) DO NOTHING`,
    [
      visitorId,
      encrypt("paper", env.keySecret),
      encrypt("paper", env.keySecret),
    ],
  );
  await pool.query(
    `UPDATE exchanges SET label = 'Demo Account' WHERE id = $1 AND venue = 'paper' AND label <> 'Demo Account'`,
    [visitorId],
  );
  await pool.query(
    `INSERT INTO paper_balances (exchange_id, asset, free, used)
     VALUES ($1, 'USDT', $2, '0')
     ON CONFLICT (exchange_id, asset) DO NOTHING`,
    [visitorId, String(start)],
  );
  const usdt = await qOne<{ free: string; used: string }>(
    pool,
    `SELECT free, used FROM paper_balances WHERE exchange_id = $1 AND asset = 'USDT'`,
    [visitorId],
  );
  const used = Number(usdt?.used ?? 0);
  const free = Number(usdt?.free ?? 0);
  if (free + used < start) {
    await pool.query(
      `UPDATE paper_balances SET free = $2 WHERE exchange_id = $1 AND asset = 'USDT'`,
      [visitorId, String(start - used)],
    );
  }
  const ids = DEMO_SEEDS.map((s) => demoSeedId(visitorId, s.slug));
  const rows = await q<{ id: string; status: string }>(
    pool,
    `SELECT id, status FROM smart_trades WHERE id = ANY($1::text[])`,
    [ids],
  );
  const statusBy = new Map(rows.map((r) => [r.id, r.status]));
  for (let i = 0; i < DEMO_SEEDS.length; i++) {
    const seed = DEMO_SEEDS[i]!;
    const id = demoSeedId(visitorId, seed.slug);
    if (shouldReseedDemoTrade(statusBy.get(id))) {
      await seedDemoTrade(visitorId, seed, i);
    } else {
      await resizeDemoTrade(visitorId, seed);
    }
  }
}

async function resizeDemoTrade(
  visitorId: string,
  seed: (typeof DEMO_SEEDS)[number],
): Promise<void> {
  const pool = db();
  const id = demoSeedId(visitorId, seed.slug);
  const amount = String(seed.quote / seed.entry);
  const quote = String(seed.quote);
  await pool.query(
    `UPDATE smart_trades
        SET amount = $2,
            entry_filled_amount = $2,
            initial_amount = $2,
            initial_quote = $3
      WHERE id = $1 AND status = 'in_position'`,
    [id, amount, quote],
  );
  await pool.query(
    `INSERT INTO paper_balances (exchange_id, asset, free, used)
     VALUES ($1, $2, $3, '0')
     ON CONFLICT (exchange_id, asset)
     DO UPDATE SET free = EXCLUDED.free`,
    [visitorId, seed.base, amount],
  );
}

async function seedDemoTrade(
  visitorId: string,
  seed: (typeof DEMO_SEEDS)[number],
  rank: number,
): Promise<void> {
  const pool = db();
  const id = demoSeedId(visitorId, seed.slug);
  const amount = String(seed.quote / seed.entry);
  const entry = String(seed.entry);
  const quote = String(seed.quote);
  await pool.query(
    `INSERT INTO smart_trades (
       id, exchange_id, pair, base, quote, side, kind, status, amount,
       use_existing_assets, entry_type, entry_price,
       tp_enabled, sl_enabled, sl_trigger, note,
       entry_filled_price, entry_filled_amount, peak_price, trough_price,
       last_price, initial_amount, initial_quote, filled_at, created_at
     ) VALUES (
       $1,$2,$3,$8,'USDT','buy','smart','in_position',$4,
       true,'market',$5,
       false,false,'last',$6,
       $5,$4,$5,$5,
       $5,$4,$7, now() - ($9::int * interval '1 second'),
       now() - ($9::int * interval '1 second')
     )
     ON CONFLICT (id) DO UPDATE SET
       status = 'in_position',
       closed_at = NULL,
       closed_reason = NULL,
       last_error = NULL,
       exit_price = NULL,
       exit_order_id = NULL,
       pnl_quote = NULL,
       pnl_percent = NULL,
       amount = EXCLUDED.amount,
       entry_price = EXCLUDED.entry_price,
       entry_filled_price = EXCLUDED.entry_filled_price,
       entry_filled_amount = EXCLUDED.entry_filled_amount,
       peak_price = EXCLUDED.peak_price,
       trough_price = EXCLUDED.trough_price,
       last_price = EXCLUDED.last_price,
       initial_amount = EXCLUDED.initial_amount,
       initial_quote = EXCLUDED.initial_quote,
       note = EXCLUDED.note,
       created_at = EXCLUDED.created_at,
       filled_at = EXCLUDED.filled_at`,
    [id, visitorId, seed.pair, amount, entry, seed.note, quote, seed.base, rank],
  );
  await pool.query(
    `INSERT INTO paper_balances (exchange_id, asset, free, used)
     VALUES ($1, $2, $3, '0')
     ON CONFLICT (exchange_id, asset)
     DO UPDATE SET free = EXCLUDED.free`,
    [visitorId, seed.base, amount],
  );
}

async function loadWallet(exchangeId: string): Promise<PaperWallet> {
  const rows = await q<{ asset: string; free: string; used: string }>(
    db(),
    `SELECT asset, free, used FROM paper_balances WHERE exchange_id = $1`,
    [exchangeId],
  );
  const w: PaperWallet = {};
  for (const r of rows) {
    w[r.asset] = { free: Number(r.free) || 0, used: Number(r.used) || 0 };
  }
  return w;
}

async function saveWallet(exchangeId: string, w: PaperWallet): Promise<void> {
  const pool = db();
  for (const [assetName, v] of Object.entries(w)) {
    await pool.query(
      `INSERT INTO paper_balances (exchange_id, asset, free, used)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (exchange_id, asset)
       DO UPDATE SET free = $3, used = $4`,
      [exchangeId, assetName, String(v.free), String(v.used)],
    );
  }
}

type PaperOrderRow = {
  id: string;
  exchange_id: string;
  symbol: string;
  side: Side;
  type: string;
  amount: string;
  price: string | null;
  filled: string;
  average: string | null;
  status: string;
  reduce_only: boolean;
};

function snapOf(row: PaperOrderRow): {
  id: string;
  status: "open" | "closed" | "canceled" | "rejected" | "expired";
  filled: number;
  average: number | null;
} {
  const st = row.status;
  const status =
    st === "closed" || st === "canceled" || st === "rejected" || st === "expired"
      ? st
      : "open";
  return {
    id: row.id,
    status,
    filled: Number(row.filled) || 0,
    average: row.average != null ? Number(row.average) : null,
  };
}

async function fillOpenOrder(row: PaperOrderRow, last: number): Promise<PaperOrderRow> {
  const amount = Number(row.amount);
  const price = Number(row.price ?? last);
  const { base, quote } = splitPair(row.symbol);
  const w = settleFill(
    await loadWallet(row.exchange_id),
    row.side,
    amount,
    price,
    base,
    quote,
    true,
  );
  await saveWallet(row.exchange_id, w);
  await db().query(
    `UPDATE paper_orders
        SET status = 'closed', filled = $2, average = $3
      WHERE id = $1`,
    [row.id, String(amount), String(price)],
  );
  return {
    ...row,
    status: "closed",
    filled: String(amount),
    average: String(price),
  };
}

export async function paperPlaceOrder(
  exchangeId: string,
  opts: {
    symbol: string;
    side: Side;
    type: "market" | "limit";
    amount: number;
    price?: number;
    reduceOnly?: boolean;
  },
  last: number,
): Promise<{ id: string; filled: number; average: number | null; status: string }> {
  if (!(opts.amount > 0)) throw new Error("Amount must be greater than 0");
  if (!(last > 0)) throw new Error("No public price for this pair");
  const { base, quote } = splitPair(opts.symbol);
  const id = `p-${crypto.randomUUID()}`;
  const isMarket = opts.type === "market";
  const px = isMarket ? last : Number(opts.price);
  if (!(px > 0)) throw new Error("Limit order requires a price");
  const immediate = isMarket || limitWouldFill(opts.side, last, px);
  let w = await loadWallet(exchangeId);
  if (immediate) {
    w = settleFill(w, opts.side, opts.amount, isMarket ? last : px, base, quote, false);
  } else {
    w = lockForLimit(w, opts.side, opts.amount, px, base, quote);
  }
  await saveWallet(exchangeId, w);
  const fillPx = isMarket ? last : px;
  await db().query(
    `INSERT INTO paper_orders (
       id, exchange_id, symbol, side, type, amount, price, filled, average, status, reduce_only
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      exchangeId,
      opts.symbol,
      opts.side,
      opts.type,
      String(opts.amount),
      String(px),
      immediate ? String(opts.amount) : "0",
      immediate ? String(fillPx) : null,
      immediate ? "closed" : "open",
      Boolean(opts.reduceOnly),
    ],
  );
  return {
    id,
    filled: immediate ? opts.amount : 0,
    average: immediate ? fillPx : null,
    status: immediate ? "closed" : "open",
  };
}

export async function paperFetchOrder(
  exchangeId: string,
  orderId: string,
  last: number,
): Promise<{
  id: string;
  status: "open" | "closed" | "canceled" | "rejected" | "expired";
  filled: number;
  average: number | null;
} | null> {
  if (!orderId || orderId === "placing") return null;
  const row = await qOne<PaperOrderRow>(
    db(),
    `SELECT * FROM paper_orders WHERE id = $1 AND exchange_id = $2`,
    [orderId, exchangeId],
  );
  if (!row) return null;
  if (row.status === "open" && last > 0) {
    const px = Number(row.price ?? 0);
    if (limitWouldFill(row.side, last, px)) {
      return snapOf(await fillOpenOrder(row, last));
    }
  }
  return snapOf(row);
}

export async function paperCancelOrder(
  exchangeId: string,
  orderId: string,
): Promise<void> {
  if (!orderId || orderId === "placing") return;
  const row = await qOne<PaperOrderRow>(
    db(),
    `SELECT * FROM paper_orders WHERE id = $1 AND exchange_id = $2`,
    [orderId, exchangeId],
  );
  if (!row || row.status !== "open") return;
  const { base, quote } = splitPair(row.symbol);
  const w = unlockLimit(
    await loadWallet(exchangeId),
    row.side,
    Number(row.amount),
    Number(row.price ?? 0),
    base,
    quote,
  );
  await saveWallet(exchangeId, w);
  await db().query(
    `UPDATE paper_orders SET status = 'canceled' WHERE id = $1`,
    [orderId],
  );
}

export async function paperAmendOrder(
  exchangeId: string,
  orderId: string,
  price: number,
  last: number,
): Promise<string> {
  const row = await qOne<PaperOrderRow>(
    db(),
    `SELECT * FROM paper_orders WHERE id = $1 AND exchange_id = $2`,
    [orderId, exchangeId],
  );
  if (!row || row.status !== "open") {
    throw new Error("Paper order is not open");
  }
  const { base, quote } = splitPair(row.symbol);
  const amount = Number(row.amount);
  const oldPx = Number(row.price ?? 0);
  let w = unlockLimit(await loadWallet(exchangeId), row.side, amount, oldPx, base, quote);
  if (limitWouldFill(row.side, last, price)) {
    w = settleFill(w, row.side, amount, price, base, quote, false);
    await saveWallet(exchangeId, w);
    await db().query(
      `UPDATE paper_orders
          SET price = $2, filled = $3, average = $2, status = 'closed'
        WHERE id = $1`,
      [orderId, String(price), String(amount)],
    );
    return orderId;
  }
  w = lockForLimit(w, row.side, amount, price, base, quote);
  await saveWallet(exchangeId, w);
  await db().query(`UPDATE paper_orders SET price = $2 WHERE id = $1`, [
    orderId,
    String(price),
  ]);
  return orderId;
}

export async function paperBalanceMap(
  exchangeId: string,
): Promise<Record<string, { free: number; used: number; total: number }>> {
  const w = await loadWallet(exchangeId);
  const out: Record<string, { free: number; used: number; total: number }> = {};
  for (const [assetName, v] of Object.entries(w)) {
    const total = v.free + v.used;
    if (total === 0 && v.free === 0 && v.used === 0) continue;
    out[assetName] = { free: v.free, used: v.used, total };
  }
  return out;
}

export async function paperOpenOrders(
  exchangeId: string,
  symbol?: string,
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
  const rows = symbol
    ? await q<PaperOrderRow>(
        db(),
        `SELECT * FROM paper_orders
          WHERE exchange_id = $1 AND status = 'open' AND symbol = $2
          ORDER BY created_at ASC`,
        [exchangeId, symbol],
      )
    : await q<PaperOrderRow>(
        db(),
        `SELECT * FROM paper_orders
          WHERE exchange_id = $1 AND status = 'open'
          ORDER BY created_at ASC`,
        [exchangeId],
      );
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    side: r.side,
    type: r.type,
    amount: Number(r.amount) || 0,
    price: r.price != null ? Number(r.price) : null,
    status: r.status,
  }));
}

export { PAPER_FEED };
