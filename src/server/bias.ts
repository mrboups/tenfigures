import {
  biasFromCandles,
  DEFAULT_INDICATOR,
  emptyTfBias,
  TF_FRAMES,
  type IndicatorId,
  type TfBias,
} from "../shared/demark.ts";
import type { Creds } from "./exchanges.ts";
import { fetchOhlcv } from "./exchanges.ts";
import type { MarketType, VenueId } from "../shared/types.ts";

type CandleRow = { o: number; h: number; l: number; c: number; v: number };

const candleCache = new Map<string, { at: number; candles: CandleRow[] | null }>();
const TTL = 20_000;

async function tfCandles(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  symbol: string,
  timeframe: string,
  marketType: MarketType,
): Promise<CandleRow[] | null> {
  const key = `${accountId}:${symbol}:${timeframe}:${marketType}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.candles;
  try {
    const candles = await fetchOhlcv(
      accountId,
      venue,
      creds,
      symbol,
      timeframe,
      180,
      marketType,
    );
    candleCache.set(key, { at: Date.now(), candles });
    return candles;
  } catch {
    candleCache.set(key, { at: Date.now(), candles: null });
    return null;
  }
}

export async function pairBiases(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  symbol: string,
  marketType: MarketType,
  indicators: IndicatorId[],
): Promise<Record<string, TfBias[]>> {
  const ids = indicators.length ? indicators : [DEFAULT_INDICATOR];
  const tfRows = await Promise.all(
    TF_FRAMES.map(async (f) => ({
      tf: f.id,
      candles: await tfCandles(accountId, venue, creds, symbol, f.ccxt, marketType),
    })),
  );
  const out: Record<string, TfBias[]> = {};
  for (const id of ids) {
    out[id] = tfRows.map(({ tf, candles }) => ({
      tf,
      color: candles ? biasFromCandles(candles, id) : null,
    }));
  }
  return out;
}

export async function pairBias(
  accountId: string,
  venue: VenueId,
  creds: Creds,
  symbol: string,
  marketType: MarketType,
  indicator: IndicatorId = DEFAULT_INDICATOR,
): Promise<TfBias[]> {
  const pack = await pairBiases(accountId, venue, creds, symbol, marketType, [indicator]);
  return pack[indicator] ?? emptyTfBias();
}

export async function manyPairBias(
  items: {
    accountId: string;
    venue: VenueId;
    creds: Creds;
    symbol: string;
    marketType: MarketType;
    indicators?: IndicatorId[];
  }[],
): Promise<Record<string, TfBias[]>[]> {
  const out: Record<string, TfBias[]>[] = new Array(items.length);
  let i = 0;
  const n = Math.min(3, items.length);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i;
        i += 1;
        const it = items[idx]!;
        const ids = it.indicators?.length ? it.indicators : [DEFAULT_INDICATOR];
        try {
          out[idx] = await pairBiases(
            it.accountId,
            it.venue,
            it.creds,
            it.symbol,
            it.marketType,
            ids,
          );
        } catch {
          out[idx] = Object.fromEntries(ids.map((id) => [id, emptyTfBias()]));
        }
      }
    }),
  );
  return out;
}
