import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { AppEnv } from "./env.ts";
import { passwordsMatch, encrypt } from "./crypto.ts";
import { readSession, signSession, verifySession } from "./session.ts";
import {
  type ExchangeRow,
  type TradeRow,
  publicExchange,
  publicTrade,
  q,
  qOne,
  type PoolClient,
} from "./db.ts";
import { VENUES, isPaperVenue, publicVenues } from "./venues.ts";
import {
  demoSeedListRank,
  demoVisitorId,
  ensurePaperWallet,
  withDemoVisitor,
} from "./paper.ts";
import { WAITLIST_CAP, addWaitlist, normalizeEmail, waitlistCount } from "./waitlist.ts";
import { sendWaitlistMail } from "./mail.ts";
import {
  amendLimitPrice,
  cancelOrderSafe,
  fetchBalanceMap,
  fetchOpenOrders,
  fetchLeverageCaps,
  fetchOpenPosition,
  fetchOhlcv,
  feedOf,
  fetchTicker,
  forgetClient,
  loadMarkets,
  marketTypeOf,
  placeOrder,
  testCreds,
  usdEstimate,
} from "./exchanges.ts";
import { credsOf } from "./creds.ts";
import { addStep, ensureInitialStep, listSteps } from "./steps.ts";
import {
  cardForExchange,
  insertSnapshot,
  loadSnapshots,
  realizedPnlUsd,
  seriesStats,
  valueBalances,
} from "./portfolio.ts";
import { PANEL_MAX_LEVERAGE, type ExchangeDetails } from "../shared/types.ts";
import { friendlyExchangeError } from "./errors.ts";
import { getOutboundIp } from "./egress.ts";
import {
  initialTriggerDir,
  percentFromPrices,
  validateSize,
} from "./engine.ts";
import { leftoverAddNotional } from "../shared/money.ts";
import {
  parsePendingAdds,
  pendingAddNotional,
  stringifyPendingAdds,
} from "../shared/adds.ts";
import type { VenueId } from "../shared/types.ts";
import { manyPairBias, pairBias } from "./bias.ts";
import { INDICATOR_IDS, parseIndicator, parseIndicators } from "../shared/demark.ts";
import { parseTpTargets, stringifyTpTargets } from "../shared/targets.ts";
import {
  applyScaleFill,
  enterAtMarket,
  maybeFireSignal,
  syncTradeQuote,
} from "./worker.ts";
import {
  emitReload,
  listenLive,
  peekTicker,
  retainTickerWatch,
} from "./live.ts";

const venueId = z.enum([
  "binance",
  "mexc",
  "gate",
  "bitget",
  "bybit",
  "kraken",
  "hyperliquid",
  "lighter",
  "paper",
]);

const COOKIE = "tradr_session";
const DEMO_COOKIE = "tradr_demo";

function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

const tpTargetZ = z.object({
  id: z.string().min(1),
  price: z.string().min(1),
  percent: z.string().nullable().optional(),
  qtyPct: z.number().gt(0).lte(100),
  orderId: z.string().nullable().optional(),
  filled: z.boolean().optional(),
});

function marketFillPrice(
  ticker: { last: number; bid: number; ask: number },
  side: "buy" | "sell",
  type: "market" | "limit",
  limitPrice?: string | null,
): number {
  if (type === "limit") {
    const p = Number(limitPrice ?? ticker.last);
    return Number.isFinite(p) && p > 0 ? p : ticker.last;
  }
  return (side === "buy" ? ticker.ask : ticker.bid) || ticker.last;
}

async function markEntryFilled(
  pool: PoolClient,
  row: TradeRow,
  fill: number,
  filledAmt: number,
  orderId: string,
): Promise<void> {
  const tpPx = row.tp_price != null ? Number(row.tp_price) : null;
  const slPx = row.sl_price != null ? Number(row.sl_price) : null;
  await pool.query(
    `UPDATE smart_trades
        SET status = 'in_position',
            entry_price = $1,
            entry_filled_price = $1,
            entry_filled_amount = $2,
            peak_price = $1,
            trough_price = $1,
            initial_amount = $2,
            initial_quote = $4,
            tp_percent = $5,
            sl_percent = $6,
            filled_at = now()
      WHERE id = $3`,
    [
      String(fill),
      String(filledAmt),
      row.id,
      String(filledAmt * Number(fill)),
      tpPx != null && fill > 0 ? String(percentFromPrices(fill, tpPx)) : row.tp_percent,
      slPx != null && fill > 0 ? String(percentFromPrices(fill, slPx)) : row.sl_percent,
    ],
  );
  await addStep(pool, {
    tradeId: row.id,
    side: row.side,
    price: fill,
    baseAmount: filledAmt,
    quoteAmount: filledAmt * Number(fill),
    status: "finished",
    orderId,
  });
}

async function dropProtectOrders(
  pool: PoolClient,
  env: AppEnv,
  row: TradeRow,
  ex: ExchangeRow,
): Promise<void> {
  if (marketTypeOf(ex) !== "swap") return;
  const creds = credsOf(ex, env.keySecret);
  const kind = marketTypeOf(ex);
  if (row.tp_order_id) {
    await cancelOrderSafe(
      ex.id,
      ex.venue as VenueId,
      creds,
      row.tp_order_id,
      row.pair,
      kind,
    );
  }
  if (row.sl_order_id) {
    await cancelOrderSafe(
      ex.id,
      ex.venue as VenueId,
      creds,
      row.sl_order_id,
      row.pair,
      kind,
    );
  }
  for (const t of parseTpTargets(row.tp_targets)) {
    if (t.orderId && t.orderId !== row.tp_order_id) {
      await cancelOrderSafe(
        ex.id,
        ex.venue as VenueId,
        creds,
        t.orderId,
        row.pair,
        kind,
      );
    }
  }
  const cleared = parseTpTargets(row.tp_targets).map((t) => ({ ...t, orderId: null }));
  if (row.tp_order_id || row.sl_order_id || cleared.length) {
    await pool.query(
      `UPDATE smart_trades
          SET tp_order_id = NULL,
              sl_order_id = NULL,
              tp_targets = $2
        WHERE id = $1`,
      [row.id, stringifyTpTargets(cleared)],
    );
  }
}

function requestOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

export function createApp(pool: PoolClient, env: AppEnv) {
  const app = new Hono();

  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    return c.json({ error: message }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  if (env.demo) {
    app.get("/api/waitlist", async (c) => {
      const count = await waitlistCount(pool);
      return c.json({
        count,
        cap: WAITLIST_CAP,
        remaining: Math.max(0, WAITLIST_CAP - count),
      });
    });
    app.post("/api/waitlist", async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const email = normalizeEmail(String(body.email ?? ""));
      if (!email) return c.json({ error: "Valid email required" }, 400);
      const result = await addWaitlist(pool, email);
      if (result.full) {
        return c.json({ error: "The first 100 are full", remaining: 0 }, 409);
      }
      if (!result.already) {
        const origin = requestOrigin(c.req.raw);
        const demoHref = `${origin}${env.publicBase}/`;
        try {
          await sendWaitlistMail(env, email, demoHref);
        } catch (err) {
          console.error("waitlist mail failed");
          console.error(err instanceof Error ? err.message : "send failed");
        }
      }
      return c.json({
        ok: true,
        already: result.already,
        remaining: result.remaining,
      });
    });
  }

  app.post("/api/login", async (c) => {
    if (env.demo) return c.json({ error: "Demo has no login" }, 400);
    const body = await c.req.json().catch(() => ({}));
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");
    const userOk = passwordsMatch(username, env.authUsername);
    const passOk = passwordsMatch(password, env.authPassword);
    if (!userOk || !passOk) {
      return c.json({ error: "Invalid username or password" }, 401);
    }
    const token = signSession(username, env.sessionSecret);
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: env.isProd,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return c.json({ ok: true, username });
  });

  app.post("/api/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/login" || c.req.path === "/api/waitlist") return next();
    if (env.demo) {
      let id = readSession(getCookie(c, DEMO_COOKIE) ?? "", env.sessionSecret);
      if (!id) {
        id = crypto.randomUUID();
        setCookie(c, DEMO_COOKIE, signSession(id, env.sessionSecret), {
          httpOnly: true,
          sameSite: "Lax",
          secure: env.isProd,
          path: "/",
          maxAge: 60 * 60 * 24 * 7,
        });
      }
      await ensurePaperWallet(id);
      await withDemoVisitor(id, () => next());
      return;
    }
    const token = getCookie(c, COOKIE) ?? "";
    const user = verifySession(token, env.sessionSecret, env.authUsername);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    c.set("user" as never, user as never);
    await next();
  });

  app.get("/api/me", (c) =>
    c.json({
      username: env.demo ? "demo" : env.authUsername,
      demo: env.demo,
      gofundmeUrl: env.gofundmeUrl || undefined,
    }),
  );

  app.get("/api/venues", (c) => c.json({ venues: publicVenues(env.demo) }));

  app.get("/api/exchanges", async (c) => {
    const vid = demoVisitorId();
    const rows = env.demo
      ? vid
        ? await q<ExchangeRow>(
            pool,
            `SELECT * FROM exchanges WHERE id = $1`,
            [vid],
          )
        : []
      : await q<ExchangeRow>(
          pool,
          `SELECT * FROM exchanges ORDER BY created_at ASC`,
        );
    return c.json({ exchanges: rows.map(publicExchange) });
  });

  app.post("/api/exchanges", async (c) => {
    if (env.demo) {
      return c.json({ error: "Demo cannot connect an exchange" }, 403);
    }
    const parsed = z
      .object({
        venue: venueId,
        label: z.string().min(1).max(80),
        apiKey: z.string().optional().default(""),
        apiSecret: z.string().min(1),
        passphrase: z.string().optional().nullable(),
        marketType: z.enum(["spot", "swap"]).optional().default("spot"),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "Invalid exchange payload" }, 400);
    }
    const body = parsed.data;
    if (isPaperVenue(body.venue)) {
      return c.json({ error: "Paper is only available on the demo" }, 400);
    }
    const venueMeta = VENUES[body.venue];
    const marketType = venueMeta.dex ? "swap" : body.marketType;
    if (venueMeta.needsPassphrase && !body.passphrase) {
      return c.json({ error: "This exchange needs a passphrase" }, 400);
    }
    if (venueMeta.needsWallet && !body.apiKey.trim()) {
      return c.json({ error: "This DEX needs a wallet address" }, 400);
    }
    try {
      await testCreds(
        body.venue,
        {
          apiKey: body.apiKey,
          secret: body.apiSecret,
          passphrase: body.passphrase,
        },
        marketType,
      );
    } catch (err) {
      const ip = await getOutboundIp();
      return c.json(
        {
          error: `Could not connect: ${friendlyExchangeError(body.venue, err, ip)}`,
        },
        400,
      );
    }
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO exchanges (id, venue, label, api_key_enc, api_secret_enc, passphrase_enc, last_ok_at, api_key_last4, market_type)
       VALUES ($1,$2,$3,$4,$5,$6, now(), $7, $8)`,
      [
        id,
        body.venue,
        body.label.trim(),
        encrypt(body.apiKey, env.keySecret),
        encrypt(body.apiSecret, env.keySecret),
        body.passphrase ? encrypt(body.passphrase, env.keySecret) : null,
        (body.apiKey || body.apiSecret).replace(/^0x/i, "").slice(-4),
        marketType,
      ],
    );
    const row = await qOne<ExchangeRow>(
      pool,
      `SELECT * FROM exchanges WHERE id = $1`,
      [id],
    );
    return c.json({ exchange: publicExchange(row!) }, 201);
  });

  app.delete("/api/exchanges/:id", async (c) => {
    if (env.demo) {
      return c.json({ error: "Demo cannot remove this wallet" }, 403);
    }
    const id = c.req.param("id");
    const open = await qOne<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM smart_trades
        WHERE exchange_id = $1 AND status NOT IN ('closed','cancelled')`,
      [id],
    );
    if (Number(open?.n ?? 0) > 0) {
      return c.json(
        { error: "Close or cancel open trades on this account first" },
        400,
      );
    }
    forgetClient(id);
    await pool.query(`DELETE FROM exchanges WHERE id = $1`, [id]);
    return c.json({ ok: true });
  });

  async function requireExchange(id: string): Promise<ExchangeRow | null> {
    const row = await qOne<ExchangeRow>(
      pool,
      `SELECT * FROM exchanges WHERE id = $1`,
      [id],
    );
    if (!row) return null;
    if (env.demo) {
      const vid = demoVisitorId();
      if (!vid || row.id !== vid || !isPaperVenue(row.venue)) return null;
    }
    return row;
  }

  app.get("/api/exchanges/:id/balance", async (c) => {
    const ex = await requireExchange(c.req.param("id"));
    if (!ex) return c.json({ error: "Exchange not found" }, 404);
    try {
      const creds = credsOf(ex, env.keySecret);
      const byAsset = await fetchBalanceMap(
        ex.id,
        ex.venue as VenueId,
        creds,
        marketTypeOf(ex),
      );
      await pool.query(
        `UPDATE exchanges SET last_ok_at = now(), last_error = NULL WHERE id = $1`,
        [ex.id],
      );
      return c.json({
        totalUsd: usdEstimate(byAsset),
        byAsset,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE exchanges SET last_error = $1 WHERE id = $2`,
        [message.slice(0, 500), ex.id],
      );
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/exchanges/:id/markets", async (c) => {
    const ex = await requireExchange(c.req.param("id"));
    if (!ex) return c.json({ error: "Exchange not found" }, 404);
    const quote = c.req.query("quote");
    const creds = credsOf(ex, env.keySecret);
    try {
      let markets = await loadMarkets(
        ex.id,
        ex.venue as VenueId,
        creds,
        marketTypeOf(ex),
      );
      if (quote) {
        markets = markets.filter((m) => m.quote === quote);
      }
      const quotes = [...new Set(markets.map((m) => m.quote))].sort();
      return c.json({ markets, quotes });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/exchanges/:id/ticker", async (c) => {
    const ex = await requireExchange(c.req.param("id"));
    if (!ex) return c.json({ error: "Exchange not found" }, 404);
    const symbol = c.req.query("symbol");
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    const creds = credsOf(ex, env.keySecret);
    try {
      const ticker = await fetchTicker(
        ex.id,
        ex.venue as VenueId,
        creds,
        symbol,
        marketTypeOf(ex),
      );
      return c.json({ ticker });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/exchanges/:id/position", async (c) => {
    const ex = await requireExchange(c.req.param("id"));
    if (!ex) return c.json({ error: "Exchange not found" }, 404);
    const symbol = c.req.query("symbol");
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    const creds = credsOf(ex, env.keySecret);
    try {
      const position = await fetchOpenPosition(
        ex.id,
        ex.venue as VenueId,
        creds,
        symbol,
        marketTypeOf(ex),
      );
      return c.json({ position });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/exchanges/:id/candles", async (c) => {
    const ex = await requireExchange(c.req.param("id"));
    if (!ex) return c.json({ error: "Exchange not found" }, 404);
    const symbol = c.req.query("symbol");
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    const timeframe = c.req.query("timeframe") || "15m";
    const limitRaw = Number(c.req.query("limit") || 80);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(500, Math.max(20, Math.floor(limitRaw)))
      : 80;
    const creds = credsOf(ex, env.keySecret);
    try {
      const candles = await fetchOhlcv(
        ex.id,
        ex.venue as VenueId,
        creds,
        symbol,
        timeframe,
        limit,
        marketTypeOf(ex),
      );
      return c.json({ candles });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/exchanges/:id/bias", async (c) => {
    const ex = await requireExchange(c.req.param("id"));
    if (!ex) return c.json({ error: "Exchange not found" }, 404);
    const symbol = c.req.query("symbol");
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    const indicator = parseIndicator(c.req.query("indicator"));
    const creds = credsOf(ex, env.keySecret);
    try {
      const frames = await pairBias(
        ex.id,
        ex.venue as VenueId,
        creds,
        symbol,
        marketTypeOf(ex),
        indicator,
      );
      return c.json({ frames });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.post("/api/bias", async (c) => {
    const parsed = z
      .object({
        items: z
          .array(
            z.object({
              exchangeId: z.string().min(1),
              symbol: z.string().min(1),
            }),
          )
          .max(20),
        indicator: z.enum(INDICATOR_IDS).optional(),
        indicators: z.array(z.enum(INDICATOR_IDS)).max(INDICATOR_IDS.length).optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid bias payload" }, 400);
    const jobs: {
      exchangeId: string;
      symbol: string;
      accountId: string;
      venue: VenueId;
      creds: ReturnType<typeof credsOf>;
      marketType: ReturnType<typeof marketTypeOf>;
    }[] = [];
    const skipped: {
      exchangeId: string;
      symbol: string;
      frames: [];
      byIndicator: Record<string, never>;
    }[] = [];
    for (const item of parsed.data.items) {
      const ex = await requireExchange(item.exchangeId);
      if (!ex) {
        skipped.push({
          exchangeId: item.exchangeId,
          symbol: item.symbol,
          frames: [],
          byIndicator: {},
        });
        continue;
      }
      jobs.push({
        exchangeId: item.exchangeId,
        symbol: item.symbol,
        accountId: ex.id,
        venue: ex.venue as VenueId,
        creds: credsOf(ex, env.keySecret),
        marketType: marketTypeOf(ex),
      });
    }
    const ids = parseIndicators(
      parsed.data.indicators?.length ? parsed.data.indicators : parsed.data.indicator,
    );
    const packs = await manyPairBias(
      jobs.map((j) => ({
        accountId: j.accountId,
        venue: j.venue,
        creds: j.creds,
        symbol: j.symbol,
        marketType: j.marketType,
        indicators: ids,
      })),
    );
    const first = ids[0]!;
    return c.json({
      results: [
        ...jobs.map((j, i) => {
          const byIndicator = packs[i] ?? {};
          return {
            exchangeId: j.exchangeId,
            symbol: j.symbol,
            frames: byIndicator[first] ?? [],
            byIndicator,
          };
        }),
        ...skipped,
      ],
    });
  });

  app.get("/api/stream/ticker", async (c) => {
    const exchangeId = c.req.query("exchangeId");
    const symbol = c.req.query("symbol");
    if (!exchangeId || !symbol) return c.json({ error: "exchangeId and symbol required" }, 400);
    const ex = await requireExchange(exchangeId);
    if (!ex) return c.json({ error: "Exchange not found" }, 404);
    const creds = credsOf(ex, env.keySecret);
    const marketType = marketTypeOf(ex);
    const feed = feedOf(ex.id, ex.venue as VenueId, creds, marketType);
    const release = retainTickerWatch({
      accountId: feed.accountId,
      venue: feed.venue,
      creds: feed.creds,
      symbol,
      marketType: feed.marketType,
    });
    return streamSSE(c, async (stream) => {
      const send = async (ticker: { last: number; bid: number; ask: number; percentage: number | null; symbol: string }) => {
        await stream.writeSSE({ event: "ticker", data: JSON.stringify(ticker) });
      };
      const existing = peekTicker(feed.accountId, symbol);
      if (existing) await send(existing);
      const unlisten = listenLive((msg) => {
        if (msg.kind !== "ticker") return;
        if (msg.accountId !== feed.accountId || msg.symbol !== symbol) return;
        void send(msg.ticker);
      });
      try {
        while (true) {
          await stream.sleep(25000);
          await stream.writeSSE({ event: "ping", data: "1" });
        }
      } finally {
        unlisten();
        release();
      }
    });
  });

  app.get("/api/stream/open-trades", (c) => {
    return streamSSE(c, async (stream) => {
      const unlisten = listenLive((msg) => {
        if (msg.kind === "quote") {
          void stream.writeSSE({ event: "quote", data: JSON.stringify(msg.quote) });
        } else if (msg.kind === "reload") {
          void stream.writeSSE({ event: "reload", data: "1" });
        }
      });
      try {
        while (true) {
          await stream.sleep(25000);
          await stream.writeSSE({ event: "ping", data: "1" });
        }
      } finally {
        unlisten();
      }
    });
  });

  app.get("/api/exchanges/:id/leverage", async (c) => {
    const ex = await requireExchange(c.req.param("id"));
    if (!ex) return c.json({ error: "Exchange not found" }, 404);
    const symbol = c.req.query("symbol");
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    const creds = credsOf(ex, env.keySecret);
    try {
      const caps = await fetchLeverageCaps(
        ex.id,
        ex.venue as VenueId,
        creds,
        symbol,
        marketTypeOf(ex),
      );
      return c.json({ caps });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/trades", async (c) => {
    const scope = c.req.query("scope") ?? "all";
    const open = [
      "cold_start",
      "waiting_trigger",
      "entry_pending",
      "in_position",
      "closing",
      "error",
    ];
    const hist = ["closed", "cancelled"];
    const filter =
      scope === "open"
        ? "AND t.status = ANY($1::text[])"
        : scope === "history"
          ? "AND t.status = ANY($1::text[])"
          : "";
    const params: unknown[] =
      scope === "open" ? [open] : scope === "history" ? [hist] : [];
    let scoped = filter;
    const vid = demoVisitorId();
    if (env.demo) {
      if (!vid) return c.json({ trades: [] });
      params.push(vid);
      scoped += ` AND t.exchange_id = $${params.length}`;
    }
    const rows = await q<TradeRow>(
      pool,
      `SELECT t.*, e.label AS exchange_label, e.venue AS venue
         FROM smart_trades t
         JOIN exchanges e ON e.id = t.exchange_id
        WHERE 1=1 ${scoped}
        ORDER BY t.created_at DESC
        LIMIT 200`,
      params,
    );
    const trades = rows.map(publicTrade);
    if (env.demo) {
      trades.sort((a, b) => {
        const d = demoSeedListRank(a.id) - demoSeedListRank(b.id);
        if (d !== 0) return d;
        return b.createdAt.localeCompare(a.createdAt);
      });
    }
    return c.json({ trades });
  });

  app.post("/api/trades", async (c) => {
    const parsed = z
      .object({
        exchangeId: z.string().min(1),
        pair: z.string().min(1),
        side: z.enum(["buy", "sell"]),
        kind: z.enum(["smart", "cover", "simple"]),
        amount: z.string().min(1),
        useExistingAssets: z.boolean().optional().default(false),
        entryType: z.enum(["limit", "market", "conditional", "signal"]),
        signalIndicator: z.enum(INDICATOR_IDS).nullable().optional(),
        entryPrice: z.string().nullable().optional(),
        trailingEntryEnabled: z.boolean().optional().default(false),
        trailingEntryPercent: z.string().nullable().optional(),
        tpEnabled: z.boolean(),
        tpType: z.enum(["limit", "market"]).nullable().optional(),
        tpPrice: z.string().nullable().optional(),
        tpPercent: z.string().nullable().optional(),
        trailingTpEnabled: z.boolean().optional().default(false),
        trailingTpPercent: z.string().nullable().optional(),
        tpReduceOnly: z.boolean().optional(),
        slEnabled: z.boolean(),
        slType: z.enum(["cond_limit", "cond_market"]).nullable().optional(),
        slTrigger: z.string().optional().default("last"),
        slPrice: z.string().nullable().optional(),
        slPercent: z.string().nullable().optional(),
        slTimeoutEnabled: z.boolean().optional().default(false),
        slTimeoutSec: z.number().int().nonnegative().nullable().optional(),
        trailingSlEnabled: z.boolean().optional().default(false),
        slReduceOnly: z.boolean().optional(),
        moveToBreakeven: z.boolean().optional().default(false),
        note: z.string().nullable().optional(),
        leverage: z.number().int().min(1).max(125).nullable().optional(),
        marginMode: z.enum(["isolated", "cross"]).nullable().optional(),
        tpTargets: z.array(tpTargetZ).max(5).optional(),
        coldStart: z.boolean().optional().default(false),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "Invalid trade payload" }, 400);
    }
    const body = parsed.data;
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return c.json({ error: "Amount is too small to make an order" }, 400);
    }
    const ex = await requireExchange(body.exchangeId);
    if (!ex) return c.json({ error: "Exchange not found" }, 404);
    const creds = credsOf(ex, env.keySecret);
    const kind = marketTypeOf(ex);
    if (kind === "swap") body.useExistingAssets = false;
    if (body.entryType === "signal") {
      if (!body.signalIndicator) {
        return c.json({ error: "Pick an indicator for Signal" }, 400);
      }
      body.coldStart = true;
      body.useExistingAssets = false;
      body.trailingEntryEnabled = false;
    }
    if (body.trailingEntryEnabled && !body.useExistingAssets && body.entryType !== "signal") {
      body.entryType = "conditional";
    }
    const markets = await loadMarkets(ex.id, ex.venue as VenueId, creds, kind);
    const market = markets.find((m) => m.symbol === body.pair);
    if (!market) return c.json({ error: `Unknown pair ${body.pair}` }, 400);
    const ticker = await fetchTicker(
      ex.id,
      ex.venue as VenueId,
      creds,
      body.pair,
      kind,
    );
    const entryPx =
      body.entryType === "signal"
        ? ticker.last
        : body.entryType === "market"
          ? body.side === "buy"
            ? ticker.ask
            : ticker.bid
          : Number(body.entryPrice ?? ticker.last);
    if (!Number.isFinite(entryPx) || entryPx <= 0) {
      return c.json({ error: "Entry price is invalid" }, 400);
    }
    const errors = validateSize({
      amount,
      price: entryPx,
      minAmount: market.minAmount,
      minCost: market.minCost,
      base: market.base,
      quote: market.quote,
    });
    if (errors.length) return c.json({ error: errors[0] }, 400);

    const id = crypto.randomUUID();
    const base = market.base;
    const quote = market.quote;
    const marginMode =
      kind === "swap" ? (body.marginMode === "cross" ? "cross" : "isolated") : null;
    let leverage =
      kind === "swap" ? Math.round(Number(body.leverage ?? 3)) : null;
    if (kind === "swap") {
      const caps = await fetchLeverageCaps(
        ex.id,
        ex.venue as VenueId,
        creds,
        body.pair,
        kind,
      );
      const max = Math.min(
        PANEL_MAX_LEVERAGE,
        marginMode === "cross" ? caps.crossMax : caps.isolatedMax,
      );
      if (leverage == null || leverage < 1) {
        return c.json({ error: "Leverage must be at least 1" }, 400);
      }
      if (leverage > max) {
        return c.json(
          { error: `Max ${marginMode} leverage on this pair is ${max}x` },
          400,
        );
      }
    }
    let status: string = "entry_pending";
    let triggerDir: string | null = null;
    if (body.coldStart) {
      status = "cold_start";
      body.useExistingAssets = false;
    } else if (body.useExistingAssets) status = "in_position";
    else if (body.entryType === "conditional") {
      status = "waiting_trigger";
      triggerDir = initialTriggerDir(body.side, ticker.last, entryPx);
    }

    await pool.query(
      `INSERT INTO smart_trades (
         id, exchange_id, pair, base, quote, side, kind, status, amount,
         use_existing_assets, entry_type, entry_price, trailing_entry_enabled,
         trailing_entry_percent, tp_enabled, tp_type, tp_price, tp_percent,
         trailing_tp_enabled, trailing_tp_percent, sl_enabled, sl_type,
         sl_trigger, sl_price, sl_percent, sl_timeout_enabled, sl_timeout_sec,
         trailing_sl_enabled, move_to_breakeven, note, trigger_dir, last_price,
         entry_filled_price, entry_filled_amount, peak_price, trough_price, filled_at,
         leverage, margin_mode, tp_reduce_only, sl_reduce_only, tp_targets,
         signal_indicator
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,$13,
         $14,$15,$16,$17,$18,
         $19,$20,$21,$22,
         $23,$24,$25,$26,$27,
         $28,$29,$30,$31,$32,
         $33,$34,$35,$36,$37,
         $38,$39,$40,$41,$42,
         $43
       )`,
      [
        id,
        ex.id,
        body.pair,
        base,
        quote,
        body.side,
        body.kind,
        status,
        String(amount),
        body.useExistingAssets,
        body.entryType,
        String(entryPx),
        body.trailingEntryEnabled,
        str(body.trailingEntryPercent),
        body.tpEnabled || parseTpTargets(body.tpTargets).length > 0,
        body.tpType ?? null,
        str(parseTpTargets(body.tpTargets)[0]?.price ?? body.tpPrice),
        str(parseTpTargets(body.tpTargets)[0]?.percent ?? body.tpPercent),
        body.trailingTpEnabled,
        str(body.trailingTpPercent),
        body.slEnabled,
        body.slType ?? null,
        body.slTrigger ?? "last",
        str(body.slPrice),
        str(body.slPercent),
        body.slTimeoutEnabled,
        body.slTimeoutSec ?? null,
        body.trailingSlEnabled,
        body.moveToBreakeven,
        str(body.note),
        triggerDir,
        String(ticker.last),
        body.useExistingAssets ? String(entryPx) : null,
        body.useExistingAssets ? String(amount) : null,
        body.useExistingAssets ? String(entryPx) : null,
        body.useExistingAssets ? String(entryPx) : null,
        body.useExistingAssets ? new Date() : null,
        leverage,
        marginMode,
        kind === "swap" && body.tpReduceOnly !== false,
        kind === "swap" && body.slReduceOnly !== false,
        stringifyTpTargets(parseTpTargets(body.tpTargets)),
        body.entryType === "signal" ? (body.signalIndicator ?? null) : null,
      ],
    );

    if (
      !body.coldStart &&
      !body.useExistingAssets &&
      body.entryType !== "conditional" &&
      body.entryType !== "signal"
    ) {
      try {
        await pool.query(
          `UPDATE smart_trades SET entry_order_id = 'placing' WHERE id = $1`,
          [id],
        );
        const placed = await placeOrder(ex.id, ex.venue as VenueId, creds, {
          symbol: body.pair,
          side: body.side,
          type: body.entryType === "limit" ? "limit" : "market",
          amount,
          price: entryPx,
          clientOrderId: `tradr-${id}-entry`,
          marketType: kind,
          leverage,
          marginMode,
        });
        await pool.query(
          `UPDATE smart_trades SET entry_order_id = $1, last_error = NULL WHERE id = $2`,
          [placed.id, id],
        );
        if (placed.status === "closed" && placed.filled > 0) {
          const px = placed.average ?? entryPx;
          await pool.query(
            `UPDATE smart_trades
                SET status = 'in_position',
                    entry_filled_price = $1,
                    entry_filled_amount = $2,
                    peak_price = $1,
                    trough_price = $1,
                    initial_amount = $2,
                    initial_quote = $4,
                    filled_at = now()
              WHERE id = $3`,
            [
              String(px),
              String(placed.filled),
              id,
              String(placed.filled * Number(px)),
            ],
          );
          await addStep(pool, {
            tradeId: id,
            side: body.side,
            price: px,
            baseAmount: placed.filled,
            quoteAmount: placed.filled * Number(px),
            status: "finished",
            orderId: placed.id,
          });
          emitReload();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await pool.query(
          `UPDATE smart_trades SET status = 'error', last_error = $1 WHERE id = $2`,
          [message.slice(0, 500), id],
        );
        return c.json({ error: message, id }, 400);
      }
    }

    const row = await qOne<TradeRow>(
      pool,
      `SELECT t.*, e.label AS exchange_label, e.venue AS venue
         FROM smart_trades t JOIN exchanges e ON e.id = t.exchange_id
        WHERE t.id = $1`,
      [id],
    );
    return c.json({ trade: publicTrade(row!) }, 201);
  });

  app.post("/api/orders", async (c) => {
    const parsed = z
      .object({
        exchangeId: z.string().min(1),
        pair: z.string().min(1),
        side: z.enum(["buy", "sell"]),
        type: z.enum(["market", "limit"]),
        amount: z.string().min(1),
        price: z.string().nullable().optional(),
        leverage: z.number().int().min(1).max(125).nullable().optional(),
        marginMode: z.enum(["isolated", "cross"]).nullable().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid order" }, 400);
    const body = parsed.data;
    const inner = await app.request("/api/trades", {
      method: "POST",
      headers: {
        cookie: c.req.header("cookie") ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        exchangeId: body.exchangeId,
        pair: body.pair,
        side: body.side,
        kind: "simple",
        amount: body.amount,
        useExistingAssets: false,
        entryType: body.type,
        entryPrice: body.price,
        tpEnabled: false,
        slEnabled: false,
        leverage: body.leverage,
        marginMode: body.marginMode,
      }),
    });
    const data = await inner.json();
    return c.json(data, inner.status as 201);
  });

  app.patch("/api/trades/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    if (!("note" in body)) return c.json({ error: "Nothing to update" }, 400);
    await pool.query(`UPDATE smart_trades SET note = $1 WHERE id = $2`, [
      str(body.note),
      id,
    ]);
    const row = await qOne<TradeRow>(
      pool,
      `SELECT t.*, e.label AS exchange_label, e.venue AS venue
         FROM smart_trades t JOIN exchanges e ON e.id = t.exchange_id
        WHERE t.id = $1`,
      [id],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ trade: publicTrade(row) });
  });

  app.post("/api/trades/:id/refresh", async (c) => {
    const id = c.req.param("id");
    const row = await qOne<TradeRow>(
      pool,
      `SELECT t.*, e.label AS exchange_label, e.venue AS venue
         FROM smart_trades t JOIN exchanges e ON e.id = t.exchange_id
        WHERE t.id = $1`,
      [id],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    const ex = await requireExchange(row.exchange_id);
    if (!ex) return c.json({ error: "Exchange missing" }, 400);
    await syncTradeQuote(pool, env, row, ex, true);
    const next = await qOne<TradeRow>(
      pool,
      `SELECT t.*, e.label AS exchange_label, e.venue AS venue
         FROM smart_trades t JOIN exchanges e ON e.id = t.exchange_id
        WHERE t.id = $1`,
      [id],
    );
    return c.json({ trade: publicTrade(next ?? row) });
  });

  app.post("/api/trades/:id/protect", async (c) => {
    const id = c.req.param("id");
    const parsed = z
      .object({
        tpEnabled: z.boolean(),
        tpType: z.enum(["limit", "market"]).nullable().optional(),
        tpPrice: z.string().nullable().optional(),
        tpPercent: z.string().nullable().optional(),
        slEnabled: z.boolean(),
        slType: z.enum(["cond_limit", "cond_market"]).nullable().optional(),
        slPrice: z.string().nullable().optional(),
        slPercent: z.string().nullable().optional(),
        exitAmount: z.string().nullable().optional(),
        tpReduceOnly: z.boolean().optional(),
        slReduceOnly: z.boolean().optional(),
        tpTargets: z.array(tpTargetZ).max(5).optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid payload" }, 400);
    const body = parsed.data;
    const row = await qOne<TradeRow>(
      pool,
      `SELECT * FROM smart_trades WHERE id = $1`,
      [id],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    if (
      row.status !== "cold_start" &&
      row.status !== "waiting_trigger" &&
      row.status !== "entry_pending" &&
      row.status !== "in_position"
    ) {
      return c.json({ error: "Trade is no longer open" }, 400);
    }
    const rawTp = body.tpEnabled ? Number(body.tpPrice) : Number.NaN;
    const rawSl = body.slEnabled ? Number(body.slPrice) : Number.NaN;
    if (
      body.tpEnabled &&
      body.tpPrice != null &&
      String(body.tpPrice).trim() !== "" &&
      (!Number.isFinite(rawTp) || rawTp < 0)
    ) {
      return c.json({ error: "Take-profit price is invalid" }, 400);
    }
    if (
      body.slEnabled &&
      body.slPrice != null &&
      String(body.slPrice).trim() !== "" &&
      (!Number.isFinite(rawSl) || rawSl < 0)
    ) {
      return c.json({ error: "Stop-loss price is invalid" }, 400);
    }
    const targets = parseTpTargets(body.tpTargets);
    const tpOn =
      (body.tpEnabled && Number.isFinite(rawTp) && rawTp > 0) || targets.length > 0;
    const slOn = body.slEnabled && Number.isFinite(rawSl) && rawSl > 0;
    const tpPx = targets[0] ? Number(targets[0].price) : tpOn ? rawTp : null;
    const slPx = slOn ? rawSl : null;
    const tpReduceOnly = body.tpReduceOnly ?? row.tp_reduce_only !== false;
    const slReduceOnly = body.slReduceOnly ?? row.sl_reduce_only !== false;
    const oldTp = row.tp_price != null ? Number(row.tp_price) : null;
    const oldSl = row.sl_price != null ? Number(row.sl_price) : null;
    const tpChanged =
      tpOn !== row.tp_enabled ||
      (tpOn && (body.tpType ?? null) !== row.tp_type) ||
      (tpOn &&
        tpPx != null &&
        (oldTp == null || Math.abs(tpPx - oldTp) > 1e-12)) ||
      tpReduceOnly !== (row.tp_reduce_only !== false) ||
      body.tpTargets != null;
    const slChanged =
      slOn !== row.sl_enabled ||
      (slOn && (body.slType ?? null) !== row.sl_type) ||
      (slOn &&
        slPx != null &&
        (oldSl == null || Math.abs(slPx - oldSl) > 1e-12)) ||
      slReduceOnly !== (row.sl_reduce_only !== false);
    const ex = await requireExchange(row.exchange_id);
    if (ex && tpChanged && row.tp_order_id) {
      await cancelOrderSafe(
        ex.id,
        ex.venue as VenueId,
        credsOf(ex, env.keySecret),
        row.tp_order_id,
        row.pair,
        marketTypeOf(ex),
      );
    }
    if (ex && tpChanged) {
      for (const t of parseTpTargets(row.tp_targets)) {
        if (t.orderId && t.orderId !== row.tp_order_id) {
          await cancelOrderSafe(
            ex.id,
            ex.venue as VenueId,
            credsOf(ex, env.keySecret),
            t.orderId,
            row.pair,
            marketTypeOf(ex),
          );
        }
      }
    }
    if (ex && slChanged && row.sl_order_id) {
      await cancelOrderSafe(
        ex.id,
        ex.venue as VenueId,
        credsOf(ex, env.keySecret),
        row.sl_order_id,
        row.pair,
        marketTypeOf(ex),
      );
    }
    await pool.query(
      `UPDATE smart_trades
          SET tp_enabled = $1,
              tp_type = $2,
              tp_price = $3,
              tp_percent = $4,
              sl_enabled = $5,
              sl_type = $6,
              sl_price = $7,
              sl_percent = $8,
              protect_amount = $9,
              tp_reduce_only = $10,
              sl_reduce_only = $11,
              tp_order_id = CASE WHEN $12 THEN NULL ELSE tp_order_id END,
              sl_order_id = CASE WHEN $13 THEN NULL ELSE sl_order_id END,
              tp_targets = $15
        WHERE id = $14`,
      [
        tpOn,
        tpOn ? (body.tpType ?? "market") : null,
        tpOn ? str(targets[0]?.price ?? body.tpPrice) : null,
        tpOn ? str(targets[0]?.percent ?? body.tpPercent) : null,
        slOn,
        slOn ? (body.slType ?? "cond_market") : null,
        slOn ? str(body.slPrice) : null,
        slOn ? str(body.slPercent) : null,
        str(body.exitAmount),
        tpReduceOnly,
        slReduceOnly,
        tpChanged,
        slChanged,
        id,
        stringifyTpTargets(targets.map((t) => ({ ...t, orderId: null }))),
      ],
    );
    const next = await qOne<TradeRow>(
      pool,
      `SELECT t.*, e.label AS exchange_label, e.venue AS venue
         FROM smart_trades t JOIN exchanges e ON e.id = t.exchange_id
        WHERE t.id = $1`,
      [id],
    );
    if (!next) return c.json({ error: "Not found" }, 404);
    return c.json({ trade: publicTrade(next) });
  });

  app.post("/api/trades/:id/fire-up", async (c) => {
    const id = c.req.param("id");
    const row = await qOne<TradeRow>(
      pool,
      `SELECT * FROM smart_trades WHERE id = $1`,
      [id],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.status !== "cold_start") {
      return c.json({ error: "This trade is not a cold start" }, 400);
    }
    const ex = await requireExchange(row.exchange_id);
    if (!ex) return c.json({ error: "Exchange missing" }, 400);
    try {
      if (row.entry_type === "signal") {
        const fired = await maybeFireSignal(pool, env, row, ex);
        if (!fired) {
          return c.json(
            { error: "All 1D, 4H, 1H, 15M and 5M must be green or red before Fire up" },
            400,
          );
        }
      } else {
        await enterAtMarket(pool, env, row, ex, row.side);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
    const next = await qOne<TradeRow>(
      pool,
      `SELECT t.*, e.label AS exchange_label, e.venue AS venue
         FROM smart_trades t JOIN exchanges e ON e.id = t.exchange_id
        WHERE t.id = $1`,
      [id],
    );
    return c.json({ trade: publicTrade(next!) });
  });

  app.post("/api/trades/:id/enter", async (c) => {
    const id = c.req.param("id");
    const parsed = z
      .object({ type: z.enum(["limit", "market"]) })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid payload" }, 400);
    const row = await qOne<TradeRow>(
      pool,
      `SELECT * FROM smart_trades WHERE id = $1`,
      [id],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.status !== "entry_pending" && row.status !== "waiting_trigger") {
      return c.json({ error: "No resting entry to move" }, 400);
    }
    const ex = await requireExchange(row.exchange_id);
    if (!ex) return c.json({ error: "Exchange missing" }, 400);
    const creds = credsOf(ex, env.keySecret);
    const kind = marketTypeOf(ex);
    const amount = Number(row.entry_filled_amount ?? row.amount);
    if (!(amount > 0)) return c.json({ error: "Amount is too small to make an order" }, 400);
    const ticker = await fetchTicker(
      ex.id,
      ex.venue as VenueId,
      creds,
      row.pair,
      kind,
    );
    const px = marketFillPrice(ticker, row.side, "market");
    const restId =
      row.entry_order_id && row.entry_order_id !== "placing" ? row.entry_order_id : null;
    try {
      if (parsed.data.type === "limit") {
        if (restId) {
          const newId = await amendLimitPrice(
            ex.id,
            ex.venue as VenueId,
            creds,
            restId,
            row.pair,
            row.side,
            amount,
            px,
            kind,
            { reduceOnly: false, type: "limit" },
          );
          await pool.query(
            `UPDATE smart_trades
                SET entry_order_id = $1,
                    entry_price = $2,
                    entry_type = 'limit',
                    last_error = NULL
              WHERE id = $3`,
            [newId, String(px), id],
          );
        } else {
          await pool.query(
            `UPDATE smart_trades SET entry_order_id = 'placing', status = 'entry_pending' WHERE id = $1`,
            [id],
          );
          const placed = await placeOrder(ex.id, ex.venue as VenueId, creds, {
            symbol: row.pair,
            side: row.side,
            type: "limit",
            amount,
            price: px,
            clientOrderId: `tradr-${id}-entry`,
            marketType: kind,
            leverage: row.leverage,
            marginMode: row.margin_mode,
          });
          await pool.query(
            `UPDATE smart_trades
                SET entry_order_id = $1,
                    entry_price = $2,
                    entry_type = 'limit',
                    status = 'entry_pending',
                    last_error = NULL
              WHERE id = $3`,
            [placed.id, String(px), id],
          );
          if (placed.status === "closed" && placed.filled > 0) {
            const fill = placed.average ?? px;
            await markEntryFilled(pool, row, fill, placed.filled, placed.id);
          }
        }
      } else {
        if (restId) {
          await cancelOrderSafe(
            ex.id,
            ex.venue as VenueId,
            creds,
            restId,
            row.pair,
            kind,
          );
        }
        await pool.query(
          `UPDATE smart_trades SET entry_order_id = 'placing', status = 'entry_pending' WHERE id = $1`,
          [id],
        );
        const placed = await placeOrder(ex.id, ex.venue as VenueId, creds, {
          symbol: row.pair,
          side: row.side,
          type: "market",
          amount,
          price: px,
          clientOrderId: `tradr-${id}-entry`,
          marketType: kind,
          leverage: row.leverage,
          marginMode: row.margin_mode,
        });
        await pool.query(
          `UPDATE smart_trades
              SET entry_order_id = $1,
                  entry_type = 'market',
                  last_error = NULL
            WHERE id = $2`,
          [placed.id, id],
        );
        if (placed.status === "closed" && placed.filled > 0) {
          const fill = placed.average ?? px;
          await markEntryFilled(pool, row, fill, placed.filled, placed.id);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE smart_trades SET last_error = $1 WHERE id = $2`,
        [message.slice(0, 500), id],
      );
      return c.json({ error: message }, 400);
    }
    const next = await qOne<TradeRow>(
      pool,
      `SELECT t.*, e.label AS exchange_label, e.venue AS venue
         FROM smart_trades t JOIN exchanges e ON e.id = t.exchange_id
        WHERE t.id = $1`,
      [id],
    );
    return c.json({ trade: publicTrade(next!) });
  });

  app.post("/api/trades/:id/cancel", async (c) => {
    const id = c.req.param("id");
    const row = await qOne<TradeRow>(
      pool,
      `SELECT * FROM smart_trades WHERE id = $1`,
      [id],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.status === "closed" || row.status === "cancelled") {
      return c.json({ error: "Already finished" }, 400);
    }
    await pool.query(
      `UPDATE smart_trades
          SET status = 'cancelled',
              closed_reason = 'detached',
              closed_at = now()
        WHERE id = $1`,
      [id],
    );
    return c.json({ ok: true, leftOnExchange: true });
  });

  app.post("/api/trades/:id/close", async (c) => {
    const id = c.req.param("id");
    const row = await qOne<TradeRow>(
      pool,
      `SELECT * FROM smart_trades WHERE id = $1`,
      [id],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.status !== "in_position" && row.status !== "entry_pending") {
      return c.json({ error: "Nothing to close" }, 400);
    }
    const ex = await requireExchange(row.exchange_id);
    if (!ex) return c.json({ error: "Exchange missing" }, 400);
    const creds = credsOf(ex, env.keySecret);
    const kind = marketTypeOf(ex);
    if (row.tp_order_id) {
      await cancelOrderSafe(
        ex.id,
        ex.venue as VenueId,
        creds,
        row.tp_order_id,
        row.pair,
        kind,
      );
    }
    if (row.sl_order_id) {
      await cancelOrderSafe(
        ex.id,
        ex.venue as VenueId,
        creds,
        row.sl_order_id,
        row.pair,
        kind,
      );
    }
    if (row.status === "entry_pending" && row.entry_order_id) {
      await cancelOrderSafe(
        ex.id,
        ex.venue as VenueId,
        creds,
        row.entry_order_id,
        row.pair,
        kind,
      );
      await pool.query(
        `UPDATE smart_trades SET status = 'cancelled', closed_at = now() WHERE id = $1`,
        [id],
      );
      return c.json({ ok: true });
    }
    const amount = Number(row.entry_filled_amount ?? row.amount);
    const exitSide = row.side === "buy" ? "sell" : "buy";
    try {
      const placed = await placeOrder(ex.id, ex.venue as VenueId, creds, {
        symbol: row.pair,
        side: exitSide,
        type: "market",
        amount,
        clientOrderId: `tradr-${id}-exit`,
        marketType: kind,
        reduceOnly: kind === "swap",
      });
      await pool.query(
        `UPDATE smart_trades
            SET status = 'closing',
                exit_order_id = $1,
                closed_reason = 'manual'
          WHERE id = $2`,
        [placed.id, id],
      );
      if (placed.status === "closed") {
        const px = placed.average ?? 0;
        await pool.query(
          `UPDATE smart_trades
              SET status = 'closed',
                  exit_price = $1,
                  closed_at = now()
            WHERE id = $2`,
          [String(px), id],
        );
        await addStep(pool, {
          tradeId: id,
          side: exitSide,
          price: px,
          baseAmount: placed.filled || amount,
          quoteAmount: (placed.filled || amount) * Number(px),
          status: "finished",
          orderId: placed.id,
        });
        emitReload();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
    return c.json({ ok: true });
  });

  app.get("/api/trades/:id/steps", async (c) => {
    const id = c.req.param("id");
    const row = await qOne<TradeRow>(
      pool,
      `SELECT * FROM smart_trades WHERE id = $1`,
      [id],
    );
    if (!row) return c.json({ error: "Not found" }, 404);
    await ensureInitialStep(pool, row);
    const steps = await listSteps(pool, id);
    return c.json({ steps });
  });

  app.post("/api/trades/:id/add-funds", async (c) => {
    const id = c.req.param("id");
    const parsed = z
      .object({
        quoteAmount: z.string().min(1),
        type: z.enum(["market", "limit"]),
        price: z.string().nullable().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid payload" }, 400);
    const row = await qOne<TradeRow>(
      pool,
      `SELECT * FROM smart_trades WHERE id = $1`,
      [id],
    );
    if (
      !row ||
      (row.status !== "in_position" &&
        row.status !== "cold_start" &&
        row.status !== "entry_pending" &&
        row.status !== "waiting_trigger")
    ) {
      return c.json({ error: "Trade is not open" }, 400);
    }
    const ex = await requireExchange(row.exchange_id);
    if (!ex) return c.json({ error: "Exchange missing" }, 400);
    const creds = credsOf(ex, env.keySecret);
    const kind = marketTypeOf(ex);
    const ticker = await fetchTicker(
      ex.id,
      ex.venue as VenueId,
      creds,
      row.pair,
      kind,
    );
    const programmed =
      row.status === "cold_start" ||
      row.status === "entry_pending" ||
      row.status === "waiting_trigger";
    const wantLimit = parsed.data.type === "limit";
    const px = wantLimit
      ? Number(parsed.data.price)
      : programmed
        ? Number(row.entry_price) || ticker.last
        : marketFillPrice(ticker, row.side, "market", null);
    const quoteAmt = Number(parsed.data.quoteAmount);
    if (!(px > 0) || !(quoteAmt > 0)) {
      return c.json(
        {
          error: wantLimit
            ? "Limit price is required"
            : "Amount is too small to make an order",
        },
        400,
      );
    }
    const lev = Math.max(1, row.leverage ?? 1);
    const plannedBase = Number(row.amount);
    const waitingAdds = parsePendingAdds(row.pending_adds);
    const bal = await fetchBalanceMap(ex.id, ex.venue as VenueId, creds, kind);
    const quoteFree = bal[row.quote]?.free ?? 0;
    const cap = leftoverAddNotional({
      quoteFree,
      plannedBase: programmed ? plannedBase : 0,
      price: programmed ? Number(row.entry_price) || px : px,
      leverage: lev,
      futures: kind === "swap",
      reservedOnExchange:
        row.status === "entry_pending" && Boolean(row.entry_order_id),
      extraNotional: pendingAddNotional(waitingAdds),
    });
    if (quoteAmt > cap.addNotional * 1.02) {
      return c.json(
        { error: "Add size is more than leftover after the programmed position" },
        400,
      );
    }
    const baseAmt = quoteAmt / px;

    if (wantLimit) {
      const add = {
        id: crypto.randomUUID(),
        price: String(px),
        baseAmount: String(baseAmt),
        quoteAmount: String(quoteAmt),
        orderId: null as string | null,
        filled: false,
      };
      const live =
        row.status === "in_position" || row.status === "entry_pending";
      try {
        if (live) {
          const placed = await placeOrder(ex.id, ex.venue as VenueId, creds, {
            symbol: row.pair,
            side: row.side,
            type: "limit",
            amount: baseAmt,
            price: px,
            clientOrderId: `tradr-${id}-add-${add.id.slice(0, 8)}`,
            marketType: kind,
            leverage: row.leverage,
            marginMode: row.margin_mode,
          });
          add.orderId = placed.id;
          if (placed.status === "closed" && placed.filled > 0) {
            add.filled = true;
            await applyScaleFill(
              pool,
              env,
              row,
              ex,
              placed.filled,
              placed.average ?? px,
              placed.id,
            );
          }
        }
        const next = [...waitingAdds, add];
        await pool.query(`UPDATE smart_trades SET pending_adds = $1 WHERE id = $2`, [
          stringifyPendingAdds(next),
          id,
        ]);
        return c.json({ ok: true, queued: !add.orderId, pendingAdds: next.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const next = [...waitingAdds, add];
        await pool.query(`UPDATE smart_trades SET pending_adds = $1 WHERE id = $2`, [
          stringifyPendingAdds(next),
          id,
        ]);
        return c.json({
          ok: true,
          queued: true,
          pendingAdds: next.length,
          note: message,
        });
      }
    }

    if (row.status === "cold_start" || row.status === "waiting_trigger") {
      const newAmt = plannedBase + baseAmt;
      await pool.query(
        `UPDATE smart_trades SET amount = $1 WHERE id = $2`,
        [String(newAmt), id],
      );
      return c.json({ ok: true });
    }
    if (row.status === "entry_pending") {
      const newAmt = plannedBase + baseAmt;
      const restId =
        row.entry_order_id && row.entry_order_id !== "placing"
          ? row.entry_order_id
          : null;
      try {
        if (restId) {
          const newId = await amendLimitPrice(
            ex.id,
            ex.venue as VenueId,
            creds,
            restId,
            row.pair,
            row.side,
            newAmt,
            Number(row.entry_price) || px,
            kind,
            { reduceOnly: false, type: "limit" },
          );
          await pool.query(
            `UPDATE smart_trades
                SET amount = $1, entry_order_id = $2, last_error = NULL
              WHERE id = $3`,
            [String(newAmt), newId, id],
          );
        } else {
          await pool.query(
            `UPDATE smart_trades SET amount = $1 WHERE id = $2`,
            [String(newAmt), id],
          );
        }
        return c.json({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 400);
      }
    }
    try {
      const placed = await placeOrder(ex.id, ex.venue as VenueId, creds, {
        symbol: row.pair,
        side: row.side,
        type: "market",
        amount: baseAmt,
        price: px,
        clientOrderId: `tradr-${id}-add-${Date.now()}`,
        marketType: kind,
        leverage: row.leverage,
        marginMode: row.margin_mode,
      });
      const fill = placed.filled > 0 ? placed.filled : baseAmt;
      const fillPx = placed.average ?? px;
      await applyScaleFill(pool, env, row, ex, fill, fillPx, placed.id);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await addStep(pool, {
        tradeId: id,
        side: row.side,
        price: px,
        baseAmount: baseAmt,
        quoteAmount: quoteAmt,
        status: "error",
        error: message,
      });
      return c.json({ error: message }, 400);
    }
  });

  app.post("/api/trades/:id/reduce-funds", async (c) => {
    const id = c.req.param("id");
    const parsed = z
      .object({
        baseAmount: z.string().min(1),
        type: z.enum(["market", "limit"]),
        price: z.string().nullable().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid payload" }, 400);
    const row = await qOne<TradeRow>(
      pool,
      `SELECT * FROM smart_trades WHERE id = $1`,
      [id],
    );
    if (!row || row.status !== "in_position") {
      return c.json({ error: "Trade is not open" }, 400);
    }
    const ex = await requireExchange(row.exchange_id);
    if (!ex) return c.json({ error: "Exchange missing" }, 400);
    const creds = credsOf(ex, env.keySecret);
    const kind = marketTypeOf(ex);
    const ticker = await fetchTicker(
      ex.id,
      ex.venue as VenueId,
      creds,
      row.pair,
      kind,
    );
    const reduceSide = row.side === "buy" ? "sell" : "buy";
    const px = marketFillPrice(
      ticker,
      reduceSide,
      parsed.data.type,
      parsed.data.price,
    );
    const baseAmt = Number(parsed.data.baseAmount);
    const held = Number(row.entry_filled_amount ?? row.amount);
    if (!(px > 0) || !(baseAmt > 0) || baseAmt > held) {
      return c.json({ error: "Amount is too small to make an order" }, 400);
    }
    try {
      const placed = await placeOrder(ex.id, ex.venue as VenueId, creds, {
        symbol: row.pair,
        side: reduceSide,
        type: parsed.data.type,
        amount: baseAmt,
        price: px,
        clientOrderId: `tradr-${id}-reduce-${Date.now()}`,
        marketType: kind,
        reduceOnly: kind === "swap",
        leverage: row.leverage,
        marginMode: row.margin_mode,
      });
      const fill = placed.filled > 0 ? placed.filled : baseAmt;
      const fillPx = placed.average ?? px;
      const newAmt = Math.max(0, held - fill);
      await pool.query(
        `UPDATE smart_trades SET amount = $1, entry_filled_amount = $1 WHERE id = $2`,
        [String(newAmt), id],
      );
      await addStep(pool, {
        tradeId: id,
        side: reduceSide,
        price: fillPx,
        baseAmount: fill,
        quoteAmount: fill * fillPx,
        status: "finished",
        orderId: placed.id,
      });
      await dropProtectOrders(pool, env, row, ex);
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await addStep(pool, {
        tradeId: id,
        side: reduceSide,
        price: px,
        baseAmount: baseAmt,
        quoteAmount: baseAmt * px,
        status: "error",
        error: message,
      });
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/dashboard", async (c) => {
    const vid = demoVisitorId();
    const exchanges = env.demo
      ? vid
        ? await q<ExchangeRow>(
            pool,
            `SELECT * FROM exchanges WHERE id = $1`,
            [vid],
          )
        : []
      : await q<ExchangeRow>(
          pool,
          `SELECT * FROM exchanges ORDER BY created_at ASC`,
        );
    const cards = await Promise.all(
      exchanges.map(async (ex) => {
        try {
          const card = await cardForExchange(pool, env, ex);
          await pool.query(
            `UPDATE exchanges SET last_ok_at = now(), last_error = NULL WHERE id = $1`,
            [ex.id],
          );
          return card;
        } catch (err) {
          const ip = await getOutboundIp();
          const message = friendlyExchangeError(ex.venue, err, ip);
          await pool.query(
            `UPDATE exchanges SET last_error = $1 WHERE id = $2`,
            [message.slice(0, 800), ex.id],
          );
          return {
            id: ex.id,
            venue: ex.venue,
            label: ex.label,
            marketType: marketTypeOf(ex),
            lastError: message,
            apiKeyLast4: ex.api_key_last4,
            usd: 0,
            btc: null,
            change24hUsd: null,
            change24hBtc: null,
            assets: [],
          };
        }
      }),
    );
    const usd = cards.reduce((a, x) => a + x.usd, 0);
    const btcParts = cards.map((x) => x.btc).filter((x): x is number => x != null);
    const btc = btcParts.length ? btcParts.reduce((a, x) => a + x, 0) : null;
    const chUsd = cards.every((x) => x.change24hUsd == null)
      ? null
      : cards.reduce((a, x) => a + (x.usd * (x.change24hUsd ?? 0)) / 100, 0);
    const change24hUsd = usd > 0 && chUsd != null ? (chUsd / usd) * 100 : null;
    const btcChs = cards.map((x) => x.change24hBtc).filter((x): x is number => x != null);
    const change24hBtc = btcChs.length
      ? btcChs.reduce((a, x) => a + x, 0) / btcChs.length
      : null;
    const snapId = env.demo ? (vid ?? exchanges[0]?.id ?? null) : null;
    await insertSnapshot(pool, snapId, usd, btc);
    const series = await loadSnapshots(pool, snapId);
    if (!series.length || series[series.length - 1]!.usd !== usd) {
      series.push({ at: new Date().toISOString(), usd, btc });
    }
    return c.json({
      exchangeCount: exchanges.length,
      usd,
      btc,
      change24hUsd,
      change24hBtc,
      exchanges: cards,
      series,
    });
  });

  app.get("/api/exchanges/:id/details", async (c) => {
    const ex = await requireExchange(c.req.param("id"));
    if (!ex) return c.json({ error: "Exchange not found" }, 404);
    try {
      const creds = credsOf(ex, env.keySecret);
      const kind = marketTypeOf(ex);
      const bal = await fetchBalanceMap(ex.id, ex.venue as VenueId, creds, kind);
      const valued = await valueBalances(ex.venue as VenueId, ex.id, creds, bal);
      await insertSnapshot(pool, ex.id, valued.usd, valued.btc);
      const series = await loadSnapshots(pool, ex.id);
      const stats = seriesStats(series);
      const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
      const realized = await realizedPnlUsd(pool, ex.id);
      const monthPnl = await realizedPnlUsd(pool, ex.id, monthAgo);
      const dayPnl = await realizedPnlUsd(pool, ex.id, dayAgo);
      const openOrders = await fetchOpenOrders(
        ex.id,
        ex.venue as VenueId,
        creds,
        undefined,
        kind,
      );
      const startUsd = series[0]?.usd ?? valued.usd;
      const monthPct = startUsd > 0 ? (monthPnl / startUsd) * 100 : null;
      const dayPct =
        valued.change24hUsd != null && valued.usd > 0
          ? (valued.change24hUsd / valued.usd) * 100
          : null;
      const details: ExchangeDetails = {
        exchange: publicExchange(ex),
        usd: valued.usd,
        btc: valued.btc,
        change24hUsd: valued.change24hUsd,
        change24hPct: dayPct,
        assetCount: valued.assets.length,
        assets: valued.assets,
        realizedPnlUsd: realized,
        monthPnlUsd: monthPnl,
        monthPnlPct: monthPct,
        dayPnlUsd: dayPnl,
        dayPnlPct: dayPct,
        sharpe: stats.sharpe,
        deviation: stats.deviation,
        sortino: stats.sortino,
        series,
        openOrders,
      };
      await pool.query(
        `UPDATE exchanges SET last_ok_at = now(), last_error = NULL WHERE id = $1`,
        [ex.id],
      );
      return c.json({ details });
    } catch (err) {
      const ip = await getOutboundIp();
      const message = friendlyExchangeError(ex.venue, err, ip);
      await pool.query(
        `UPDATE exchanges SET last_error = $1 WHERE id = $2`,
        [message.slice(0, 800), ex.id],
      );
      return c.json({ error: message }, 400);
    }
  });

  return app;
}
