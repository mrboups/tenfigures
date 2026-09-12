import type { AppEnv } from "./env.ts";
import type { AssetSlice, ExchangeCard, SnapshotPoint, VenueId } from "../shared/types.ts";
import {
  type ExchangeRow,
  type PoolClient,
  q,
} from "./db.ts";
import {
  type Creds,
  fetchBalanceMap,
  marketTypeOf,
  publicTicker,
} from "./exchanges.ts";
import { dailyReturns, sharpe, sortino, stdev } from "./stats.ts";
import { credsOf } from "./creds.ts";

const STABLES = new Set(["USDT", "USD", "USDC", "BUSD", "DAI", "FDUSD"]);
const tickerCache = new Map<string, { last: number; percentage: number | null }>();

function cacheKey(venue: VenueId, symbol: string) {
  return `${venue}:${symbol}`;
}

async function tickerUsd(
  venue: VenueId,
  accountId: string | null,
  creds: Creds | null,
  asset: string,
): Promise<{ last: number; percentage: number | null } | null> {
  if (STABLES.has(asset)) return { last: 1, percentage: 0 };
  const symbols = [`${asset}/USDT`, `${asset}/USDC`, `${asset}/USD`];
  for (const symbol of symbols) {
    const key = cacheKey(venue, symbol);
    const hit = tickerCache.get(key);
    if (hit) return hit;
    try {
      const t = await publicTicker(venue, symbol);
      if (t && t.last > 0) {
        const val = { last: t.last, percentage: t.percentage };
        tickerCache.set(key, val);
        return val;
      }
    } catch {
      /* next quote */
    }
  }
  if (asset !== "BTC") {
    const btc = await tickerUsd(venue, accountId, creds, "BTC");
    const rel = tickerCache.get(cacheKey(venue, `${asset}/BTC`));
    if (btc && rel) return { last: rel.last * btc.last, percentage: rel.percentage };
  }
  return null;
}

export interface Valued {
  usd: number;
  btc: number | null;
  change24hUsd: number | null;
  btcChange: number | null;
  assets: AssetSlice[];
}

export async function valueBalances(
  venue: VenueId,
  accountId: string | null,
  creds: Creds | null,
  byAsset: Record<string, { total: number }>,
): Promise<Valued> {
  const slices: AssetSlice[] = [];
  let usd = 0;
  let changeUsd = 0;
  let hasChange = false;
  for (const [asset, bal] of Object.entries(byAsset)) {
    if (!(bal.total > 0)) continue;
    const t = await tickerUsd(venue, accountId, creds, asset);
    const px = t?.last ?? 0;
    const value = bal.total * px;
    if (!(value > 0)) continue;
    usd += value;
    const ch = t?.percentage ?? null;
    if (ch != null) {
      changeUsd += value * (ch / 100);
      hasChange = true;
    }
    slices.push({
      asset,
      amount: bal.total,
      usd: value,
      pct: 0,
      change24h: ch,
    });
  }
  slices.sort((a, b) => b.usd - a.usd);
  for (const s of slices) s.pct = usd > 0 ? (s.usd / usd) * 100 : 0;
  const btcT = await tickerUsd(venue, accountId, creds, "BTC");
  const btc = btcT && btcT.last > 0 ? usd / btcT.last : null;
  return {
    usd,
    btc,
    change24hUsd: hasChange ? changeUsd : null,
    btcChange: btcT?.percentage ?? null,
    assets: slices,
  };
}

export async function loadSnapshots(
  pool: PoolClient,
  exchangeId: string | null,
  days = 40,
): Promise<SnapshotPoint[]> {
  const rows = await q<{ usd: string; btc: string | null; created_at: Date }>(
    pool,
    exchangeId
      ? `SELECT usd, btc, created_at FROM portfolio_snapshots
          WHERE exchange_id = $1 AND created_at > now() - ($2 || ' days')::interval
          ORDER BY created_at ASC`
      : `SELECT usd, btc, created_at FROM portfolio_snapshots
          WHERE exchange_id IS NULL AND created_at > now() - ($1 || ' days')::interval
          ORDER BY created_at ASC`,
    exchangeId ? [exchangeId, String(days)] : [String(days)],
  );
  return rows.map((r) => ({
    at: r.created_at.toISOString(),
    usd: Number(r.usd),
    btc: r.btc == null ? null : Number(r.btc),
  }));
}

export async function insertSnapshot(
  pool: PoolClient,
  exchangeId: string | null,
  usd: number,
  btc: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO portfolio_snapshots (id, exchange_id, usd, btc)
     VALUES ($1,$2,$3,$4)`,
    [crypto.randomUUID(), exchangeId, String(usd), btc == null ? null : String(btc)],
  );
}

let lastSnap = 0;

export async function maybeSnapshotAll(
  pool: PoolClient,
  env: AppEnv,
): Promise<void> {
  if (Date.now() - lastSnap < 5 * 60 * 1000) return;
  lastSnap = Date.now();
  tickerCache.clear();
  const exchanges = await q<ExchangeRow>(pool, `SELECT * FROM exchanges`);
  let totalUsd = 0;
  let totalBtc = 0;
  let hasBtc = false;
  for (const ex of exchanges) {
    try {
      const creds = credsOf(ex, env.keySecret);
      const bal = await fetchBalanceMap(
        ex.id,
        ex.venue as VenueId,
        creds,
        marketTypeOf(ex),
      );
      const valued = await valueBalances(ex.venue as VenueId, ex.id, creds, bal);
      await insertSnapshot(pool, ex.id, valued.usd, valued.btc);
      totalUsd += valued.usd;
      if (valued.btc != null) {
        totalBtc += valued.btc;
        hasBtc = true;
      }
    } catch {
      /* skip this venue this round */
    }
  }
  await insertSnapshot(pool, null, totalUsd, hasBtc ? totalBtc : null);
}

export async function realizedPnlUsd(
  pool: PoolClient,
  exchangeId: string,
  since?: Date,
): Promise<number> {
  const rows = await q<{ pnl_quote: string | null; quote: string }>(
    pool,
    `SELECT pnl_quote, quote FROM smart_trades
      WHERE exchange_id = $1 AND status = 'closed'
        AND ($2::timestamptz IS NULL OR closed_at >= $2)`,
    [exchangeId, since ?? null],
  );
  let usd = 0;
  for (const r of rows) {
    const pnl = Number(r.pnl_quote ?? 0);
    if (!Number.isFinite(pnl)) continue;
    if (STABLES.has(r.quote) || r.quote === "USDT") usd += pnl;
    else usd += pnl;
  }
  return usd;
}

export function seriesStats(series: SnapshotPoint[]) {
  const pts = series.map((s) => ({ at: new Date(s.at), usd: s.usd }));
  const rets = dailyReturns(pts);
  return {
    sharpe: sharpe(rets),
    sortino: sortino(rets),
    deviation: rets.length >= 2 ? stdev(rets) : null,
  };
}

export async function cardForExchange(
  pool: PoolClient,
  env: AppEnv,
  ex: ExchangeRow,
): Promise<ExchangeCard> {
  const creds = credsOf(ex, env.keySecret);
  const bal = await fetchBalanceMap(
    ex.id,
    ex.venue as VenueId,
    creds,
    marketTypeOf(ex),
  );
  const valued = await valueBalances(ex.venue as VenueId, ex.id, creds, bal);
  const changePct = valued.usd > 0 && valued.change24hUsd != null
    ? (valued.change24hUsd / valued.usd) * 100
    : null;
  const btcCh = valued.btcChange;
  return {
    id: ex.id,
    venue: ex.venue as VenueId,
    label: ex.label,
    marketType: marketTypeOf(ex),
    lastError: ex.last_error,
    apiKeyLast4: ex.api_key_last4 ?? null,
    usd: valued.usd,
    btc: valued.btc,
    change24hUsd: changePct,
    change24hBtc: btcCh,
    assets: valued.assets,
  };
}

export { tickerCache };
