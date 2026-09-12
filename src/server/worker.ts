import type { AppEnv } from "./env.ts";
import {
  type ExchangeRow,
  type TradeRow,
  q,
  qOne,
  type PoolClient,
} from "./db.ts";
import { credsOf } from "./creds.ts";
import { addStep } from "./steps.ts";
import { maybeSnapshotAll } from "./portfolio.ts";
import {
  type Action,
  type TradeState,
  pnl,
  tick,
} from "./engine.ts";
import {
  amendLimitPrice,
  cancelOrderSafe,
  fetchBalanceMap,
  estimateLiquidation,
  fetchOpenPosition,
  fetchOrderSnap,
  fetchTicker,
  marketTypeOf,
  placeOrder,
  type Creds,
} from "./exchanges.ts";
import {
  emitQuote,
  emitReload,
  quoteFromTicker,
  resolveTicker,
  syncTickerWatches,
  trackLiveTrade,
} from "./live.ts";
import type { ClosedReason, Side, VenueId } from "../shared/types.ts";
import { isPaperVenue } from "./venues.ts";
import { parseTpTargets, reorientTargets, stringifyTpTargets } from "../shared/targets.ts";
import {
  parseAppliedIds,
  parsePendingAdds,
  stringifyAppliedIds,
  stringifyPendingAdds,
} from "../shared/adds.ts";
import { pairBias } from "./bias.ts";
import { parseIndicator, signalSide } from "../shared/demark.ts";
import { mergeFill, percentFromPrices, protectForSide } from "../shared/money.ts";

const OPEN = [
  "cold_start",
  "waiting_trigger",
  "entry_pending",
  "in_position",
  "closing",
];

function n(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function stretchExtremes(
  last: number,
  peakRaw: string | null,
  troughRaw: string | null,
): { peak: number; trough: number } {
  let peak = n(peakRaw);
  let trough = n(troughRaw);
  if (peak == null || peak <= 0) peak = last;
  if (trough == null || trough <= 0) trough = last;
  if (last > peak) peak = last;
  if (last < trough) trough = last;
  return { peak, trough };
}

export async function applyScaleFill(
  pool: PoolClient,
  env: AppEnv,
  row: TradeRow,
  ex: ExchangeRow,
  fillAmt: number,
  fillPx: number,
  orderId: string | null,
): Promise<void> {
  if (!(fillAmt > 0) || !(fillPx > 0)) return;
  const applied = parseAppliedIds(row.applied_order_ids);
  if (orderId && applied.includes(orderId)) return;
  const oldAmt = Number(row.entry_filled_amount ?? 0);
  const oldPx = Number(row.entry_filled_price ?? 0);
  const merged = mergeFill(oldAmt, oldPx, fillAmt, fillPx);
  if (orderId) applied.push(orderId);
  const nextStatus =
    row.status === "closed" || row.status === "cancelled" || row.status === "closing"
      ? row.status
      : "in_position";
  const first = !(oldAmt > 0);
  await pool.query(
    `UPDATE smart_trades
        SET amount = $1,
            entry_filled_amount = $1,
            entry_filled_price = $2,
            status = $3,
            applied_order_ids = $4,
            peak_price = CASE WHEN $5 = 1 THEN $2 ELSE peak_price END,
            trough_price = CASE WHEN $5 = 1 THEN $2 ELSE trough_price END,
            filled_at = COALESCE(filled_at, now()),
            last_error = NULL
      WHERE id = $6`,
    [
      String(merged.amount),
      String(merged.price),
      nextStatus,
      stringifyAppliedIds(applied),
      first ? 1 : 0,
      row.id,
    ],
  );
  row.amount = String(merged.amount);
  row.entry_filled_amount = String(merged.amount);
  row.entry_filled_price = String(merged.price);
  row.status = nextStatus as TradeRow["status"];
  row.applied_order_ids = stringifyAppliedIds(applied);
  await addStep(pool, {
    tradeId: row.id,
    side: row.side,
    price: fillPx,
    baseAmount: fillAmt,
    quoteAmount: fillAmt * fillPx,
    status: "finished",
    orderId,
  });
  emitReload();
  const creds = credsOf(ex, env.keySecret);
  const kind = marketTypeOf(ex);
  if (row.tp_order_id) {
    await cancelOrderSafe(ex.id, ex.venue as VenueId, creds, row.tp_order_id, row.pair, kind);
  }
  if (row.sl_order_id) {
    await cancelOrderSafe(ex.id, ex.venue as VenueId, creds, row.sl_order_id, row.pair, kind);
  }
  if (row.tp_order_id || row.sl_order_id) {
    await pool.query(
      `UPDATE smart_trades SET tp_order_id = NULL, sl_order_id = NULL WHERE id = $1`,
      [row.id],
    );
    row.tp_order_id = null;
    row.sl_order_id = null;
  }
}

async function settlePendingAdds(
  pool: PoolClient,
  env: AppEnv,
  row: TradeRow,
  ex: ExchangeRow,
): Promise<void> {
  const creds = credsOf(ex, env.keySecret);
  const kind = marketTypeOf(ex);
  const venue = ex.venue as VenueId;
  const adds = parsePendingAdds(row.pending_adds);
  const canPlace = row.status === "in_position" || row.status === "entry_pending";
  let dirty = false;

  for (const add of adds) {
    if (add.filled) continue;
    if (!add.orderId && canPlace) {
      try {
        const placed = await placeOrder(ex.id, venue, creds, {
          symbol: row.pair,
          side: row.side,
          type: "limit",
          amount: Number(add.baseAmount),
          price: Number(add.price),
          clientOrderId: `tradr-${row.id}-add-${add.id.slice(0, 8)}`,
          marketType: kind,
          leverage: row.leverage,
          marginMode: row.margin_mode,
        });
        add.orderId = placed.id;
        dirty = true;
        if (placed.status === "closed" && placed.filled > 0) {
          add.filled = true;
          await applyScaleFill(
            pool,
            env,
            row,
            ex,
            placed.filled,
            placed.average ?? Number(add.price),
            placed.id,
          );
        }
      } catch {
        /* stay queued until the entry is live */
      }
    } else if (add.orderId) {
      const snap = await fetchOrderSnap(ex.id, venue, creds, add.orderId, row.pair, kind);
      if (snap && snap.status === "closed" && snap.filled > 0) {
        add.filled = true;
        dirty = true;
        await applyScaleFill(
          pool,
          env,
          row,
          ex,
          snap.filled,
          snap.average ?? Number(add.price),
          add.orderId,
        );
      }
    }
  }

  if (row.entry_order_id && row.entry_order_id !== "placing") {
    const applied = parseAppliedIds(row.applied_order_ids);
    if (!applied.includes(row.entry_order_id)) {
      const snap = await fetchOrderSnap(
        ex.id,
        venue,
        creds,
        row.entry_order_id,
        row.pair,
        kind,
      );
      if (snap && snap.status === "closed" && snap.filled > 0) {
        await applyScaleFill(
          pool,
          env,
          row,
          ex,
          snap.filled,
          snap.average ?? n(row.entry_price) ?? n(row.entry_filled_price) ?? 0,
          row.entry_order_id,
        );
      }
    }
  }

  if (dirty) {
    const packed = stringifyPendingAdds(adds);
    await pool.query(`UPDATE smart_trades SET pending_adds = $1 WHERE id = $2`, [
      packed,
      row.id,
    ]);
    row.pending_adds = packed;
  }
}

function toState(row: TradeRow, swap = false): TradeState {
  return {
    id: row.id,
    side: row.side,
    status: row.status,
    amount: Number(row.amount),
    useExistingAssets: row.use_existing_assets,
    entryType: row.entry_type,
    entryPrice: n(row.entry_price),
    triggerDir: row.trigger_dir,
    tpEnabled: row.tp_enabled,
    tpType: row.tp_type,
    tpPrice: n(row.tp_price),
    trailingTpEnabled: row.trailing_tp_enabled,
    trailingTpPercent: n(row.trailing_tp_percent),
    trailingEntryEnabled: row.trailing_entry_enabled,
    trailingEntryPercent: n(row.trailing_entry_percent),
    slEnabled: row.sl_enabled,
    slType: row.sl_type,
    slPrice: n(row.sl_price),
    slPercent: n(row.sl_percent),
    slTimeoutEnabled: row.sl_timeout_enabled,
    slTimeoutSec: row.sl_timeout_sec,
    slTimeoutStartedAt: row.sl_timeout_started_at
      ? row.sl_timeout_started_at.getTime()
      : null,
    trailingSlEnabled: row.trailing_sl_enabled,
    moveToBreakeven: row.move_to_breakeven,
    entryOrderId: row.entry_order_id,
    tpOrderId: row.tp_order_id,
    slOrderId: row.sl_order_id,
    exitOrderId: row.exit_order_id,
    entryFilledPrice: n(row.entry_filled_price),
    entryFilledAmount: n(row.entry_filled_amount),
    peakPrice: n(row.peak_price),
    troughPrice: n(row.trough_price),
    protectAmount: n(row.protect_amount),
    closedReason: row.closed_reason,
    tpReduceOnly: swap && row.tp_reduce_only !== false,
    slReduceOnly: swap && row.sl_reduce_only !== false,
    tpTargets: parseTpTargets(row.tp_targets),
    initialAmount: n(row.initial_amount),
  };
}

async function applyPatch(
  pool: PoolClient,
  id: string,
  patch: Partial<TradeState> & { closedReason?: ClosedReason | null },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.peakPrice != null) add("peak_price", String(patch.peakPrice));
  if (patch.troughPrice != null) add("trough_price", String(patch.troughPrice));
  if (patch.tpPrice != null) add("tp_price", String(patch.tpPrice));
  if (patch.slPrice != null) add("sl_price", String(patch.slPrice));
  if (patch.entryFilledPrice != null)
    add("entry_filled_price", String(patch.entryFilledPrice));
  if (patch.entryFilledAmount != null)
    add("entry_filled_amount", String(patch.entryFilledAmount));
  if ("exitPrice" in patch && patch.exitPrice != null)
    add("exit_price", String(patch.exitPrice));
  if ("slTimeoutStartedAt" in patch) {
    add(
      "sl_timeout_started_at",
      patch.slTimeoutStartedAt == null
        ? null
        : new Date(patch.slTimeoutStartedAt),
    );
  }
  if (patch.closedReason) add("closed_reason", patch.closedReason);
  if (patch.amount != null) add("amount", String(patch.amount));
  if (patch.tpEnabled === false) add("tp_enabled", false);
  if (patch.slEnabled === false) add("sl_enabled", false);
  if (patch.tpOrderId === null) add("tp_order_id", null);
  else if (patch.tpOrderId) add("tp_order_id", patch.tpOrderId);
  if (patch.slOrderId === null) add("sl_order_id", null);
  if ("protectAmount" in patch)
    add("protect_amount", patch.protectAmount == null ? null : String(patch.protectAmount));
  if (patch.tpTargets) add("tp_targets", stringifyTpTargets(patch.tpTargets));
  if (!sets.length) return;
  params.push(id);
  await pool.query(
    `UPDATE smart_trades SET ${sets.join(", ")} WHERE id = $${params.length}`,
    params,
  );
}

async function setStatus(
  pool: PoolClient,
  id: string,
  status: TradeState["status"],
  patch?: Partial<TradeState>,
): Promise<void> {
  const extra: string[] = [];
  const params: unknown[] = [status, id];
  if (status === "in_position") extra.push("filled_at = now()");
  if (status === "closed" || status === "cancelled")
    extra.push("closed_at = now()");
  if (patch) await applyPatch(pool, id, patch);
  const sql = `UPDATE smart_trades SET status = $1${extra.length ? ", " + extra.join(", ") : ""} WHERE id = $2`;
  await pool.query(sql, params);
  if (status === "in_position" || status === "closed" || status === "cancelled") {
    emitReload();
  }
}

async function setError(
  pool: PoolClient,
  id: string,
  message: string,
): Promise<void> {
  await pool.query(
    `UPDATE smart_trades SET last_error = $1 WHERE id = $2`,
    [message.slice(0, 500), id],
  );
}

async function applyAction(
  pool: PoolClient,
  env: AppEnv,
  row: TradeRow,
  ex: ExchangeRow,
  creds: Creds,
  action: Action,
): Promise<void> {
  const venue = ex.venue as VenueId;
  const kind = marketTypeOf(ex);
  const exitSide = row.side === "buy" ? "sell" : "buy";
  const held = Number(row.entry_filled_amount ?? row.amount);
  const slice = Number(row.protect_amount);
  const amount = slice > 0 && slice < held ? slice : held;
  const amtOf = (actionAmt?: number) =>
    actionAmt != null && actionAmt > 0 ? actionAmt : amount;

  switch (action.type) {
    case "patch":
      await applyPatch(pool, row.id, action.patch);
      return;
    case "mark_status":
      await setStatus(pool, row.id, action.status, action.patch);
      return;
    case "place_entry": {
      await pool.query(
        `UPDATE smart_trades SET entry_order_id = 'placing' WHERE id = $1`,
        [row.id],
      );
      const placed = await placeOrder(ex.id, venue, creds, {
        symbol: row.pair,
        side: row.side,
        type: action.orderType,
        amount: Number(row.amount),
        price: action.price ?? n(row.entry_price) ?? undefined,
        clientOrderId: `tradr-${row.id}-entry`,
        marketType: kind,
        leverage: row.leverage,
        marginMode: row.margin_mode,
      });
      await pool.query(
        `UPDATE smart_trades SET entry_order_id = $1, last_error = NULL WHERE id = $2`,
        [placed.id, row.id],
      );
      if (placed.status === "closed" && placed.filled > 0) {
        const px = placed.average ?? action.price ?? 0;
        await pool.query(
          `UPDATE smart_trades
             SET entry_filled_price = $1, entry_filled_amount = $2,
                 peak_price = $1, trough_price = $1
           WHERE id = $3`,
          [String(px), String(placed.filled), row.id],
        );
        await addStep(pool, {
          tradeId: row.id,
          side: row.side,
          price: px,
          baseAmount: placed.filled,
          quoteAmount: placed.filled * Number(px),
          status: "finished",
          orderId: placed.id,
        });
      }
      return;
    }
    case "place_tp": {
      const tpAmt = amtOf(action.amount);
      await pool.query(
        `UPDATE smart_trades SET tp_order_id = 'placing' WHERE id = $1`,
        [row.id],
      );
      try {
        const reduceOnly = kind === "swap" && row.tp_reduce_only !== false;
        const tag = action.targetId && action.targetId !== "main" ? action.targetId.slice(0, 8) : "tp";
        const placed = await placeOrder(ex.id, venue, creds, {
          symbol: row.pair,
          side: exitSide,
          type: action.orderType,
          amount: tpAmt,
          price: action.price,
          clientOrderId: `tradr-${row.id}-${tag}`,
          marketType: kind,
          reduceOnly,
          trigger: reduceOnly && action.orderType === "market" ? "tp" : undefined,
        });
        const targets = parseTpTargets(row.tp_targets);
        const nextTargets =
          action.targetId && action.targetId !== "main"
            ? targets.map((t) =>
                t.id === action.targetId ? { ...t, orderId: placed.id } : t,
              )
            : targets;
        await pool.query(
          `UPDATE smart_trades
              SET tp_order_id = $1,
                  tp_targets = $2
            WHERE id = $3`,
          [
            placed.id,
            stringifyTpTargets(nextTargets.length ? nextTargets : targets),
            row.id,
          ],
        );
      } catch (err) {
        await pool.query(
          `UPDATE smart_trades SET tp_order_id = NULL WHERE id = $1`,
          [row.id],
        );
        throw err;
      }
      return;
    }
    case "place_sl": {
      await pool.query(
        `UPDATE smart_trades SET sl_order_id = 'placing' WHERE id = $1`,
        [row.id],
      );
      try {
        const reduceOnly = kind === "swap" && row.sl_reduce_only !== false;
        const placed = await placeOrder(ex.id, venue, creds, {
          symbol: row.pair,
          side: exitSide,
          type: action.orderType,
          amount,
          price: action.price,
          clientOrderId: `tradr-${row.id}-sl`,
          marketType: kind,
          reduceOnly,
          trigger: reduceOnly ? "sl" : undefined,
        });
        await pool.query(
          `UPDATE smart_trades SET sl_order_id = $1 WHERE id = $2`,
          [placed.id, row.id],
        );
      } catch (err) {
        await pool.query(
          `UPDATE smart_trades SET sl_order_id = NULL WHERE id = $1`,
          [row.id],
        );
        throw err;
      }
      return;
    }
    case "place_exit": {
      await pool.query(
        `UPDATE smart_trades SET exit_order_id = 'placing', closed_reason = $2 WHERE id = $1`,
        [row.id, action.reason],
      );
      const exitAmt = amtOf(action.amount);
      const placed = await placeOrder(ex.id, venue, creds, {
        symbol: row.pair,
        side: exitSide,
        type: action.orderType,
        amount: exitAmt,
        price: action.price,
        clientOrderId: `tradr-${row.id}-exit`,
        marketType: kind,
        reduceOnly: kind === "swap",
      });
      await pool.query(
        `UPDATE smart_trades SET exit_order_id = $1 WHERE id = $2`,
        [placed.id, row.id],
      );
      if (placed.status === "closed" && placed.filled > 0) {
        const px = placed.average ?? action.price ?? 0;
        await addStep(pool, {
          tradeId: row.id,
          side: exitSide,
          price: px,
          baseAmount: placed.filled,
          quoteAmount: placed.filled * Number(px),
          status: "finished",
          orderId: placed.id,
        });
        const left = held - placed.filled;
        if (left > held * 0.02) {
          const targets = parseTpTargets(row.tp_targets);
          const marked =
            action.reason === "tp" && action.targetId
              ? targets.map((t) =>
                  t.id === action.targetId ? { ...t, filled: true, orderId: null } : t,
                )
              : targets;
          const still = marked.filter((t) => !t.filled);
          const nxt = still[0];
          await pool.query(
            `UPDATE smart_trades
                SET status = 'in_position',
                    amount = $1,
                    entry_filled_amount = $1,
                    protect_amount = $4,
                    exit_order_id = NULL,
                    tp_enabled = CASE WHEN $3 = 'tp' AND $5 THEN false ELSE tp_enabled END,
                    sl_enabled = CASE WHEN $3 = 'sl' THEN false ELSE sl_enabled END,
                    tp_order_id = $6,
                    tp_price = COALESCE($7, tp_price),
                    tp_targets = $8,
                    sl_order_id = CASE WHEN $3 = 'sl' THEN NULL ELSE sl_order_id END
              WHERE id = $2`,
            [
              String(left),
              row.id,
              action.reason,
              nxt ? String((Number(row.initial_amount ?? held) * nxt.qtyPct) / 100) : null,
              still.length === 0,
              nxt?.orderId ?? null,
              nxt?.price ?? null,
              stringifyTpTargets(marked),
            ],
          );
        }
      }
      return;
    }
    case "cancel_order": {
      await cancelOrderSafe(ex.id, venue, creds, action.orderId, row.pair, kind);
      if (action.role === "tp") {
        await pool.query(
          `UPDATE smart_trades SET tp_order_id = NULL WHERE id = $1`,
          [row.id],
        );
      }
      if (action.role === "sl") {
        await pool.query(
          `UPDATE smart_trades SET sl_order_id = NULL WHERE id = $1`,
          [row.id],
        );
      }
      return;
    }
    case "amend_tp": {
      const reduceOnly = kind === "swap" && row.tp_reduce_only !== false;
      const newId = await amendLimitPrice(
        ex.id,
        venue,
        creds,
        action.orderId,
        row.pair,
        exitSide,
        amount,
        action.price,
        kind,
        {
          reduceOnly,
          trigger: reduceOnly && row.tp_type === "market" ? "tp" : undefined,
          type: row.tp_type === "limit" ? "limit" : "market",
        },
      );
      await pool.query(
        `UPDATE smart_trades SET tp_order_id = $1, tp_price = $2 WHERE id = $3`,
        [newId, String(action.price), row.id],
      );
      return;
    }
    case "amend_sl": {
      const reduceOnly = kind === "swap" && row.sl_reduce_only !== false;
      const newId = await amendLimitPrice(
        ex.id,
        venue,
        creds,
        action.orderId,
        row.pair,
        exitSide,
        amount,
        action.price,
        kind,
        {
          reduceOnly,
          trigger: reduceOnly ? "sl" : undefined,
          type: row.sl_type === "cond_limit" ? "limit" : "market",
        },
      );
      await pool.query(
        `UPDATE smart_trades SET sl_order_id = $1, sl_price = $2 WHERE id = $3`,
        [newId, String(action.price), row.id],
      );
      return;
    }
  }
}

export async function syncTradeQuote(
  pool: PoolClient,
  env: AppEnv,
  row: TradeRow,
  ex: ExchangeRow,
  force = false,
): Promise<{ last: number; bid: number; ask: number }> {
  const creds = credsOf(ex, env.keySecret);
  const kind = marketTypeOf(ex);
  const ticker = await resolveTicker(
    ex.id,
    ex.venue as VenueId,
    creds,
    row.pair,
    kind,
    force,
  );
  let entry = Number(row.entry_filled_price ?? row.entry_price ?? ticker.last);
  let amt = Number(row.entry_filled_amount ?? row.amount);
  let liq = row.liquidation_price ?? null;
  if (kind === "swap") {
    try {
      const pos = await fetchOpenPosition(
        ex.id,
        ex.venue as VenueId,
        creds,
        row.pair,
        kind,
      );
      if (pos?.liquidationPrice != null) liq = String(pos.liquidationPrice);
      if (pos && pos.amount > 0) {
        amt = pos.amount;
        if (pos.entryPrice != null && pos.entryPrice > 0) entry = pos.entryPrice;
      }
    } catch {
      /* keep */
    }
    if (liq == null) {
      const est = estimateLiquidation(row.side, entry, row.leverage);
      if (est != null) liq = String(est);
    }
  }
  const { quote, percent } = pnl(row.side, entry, ticker.last, amt);
  const { peak, trough } = stretchExtremes(
    ticker.last,
    row.peak_price,
    row.trough_price,
  );
  await pool.query(
    `UPDATE smart_trades
        SET last_price = $1, pnl_quote = $2, pnl_percent = $3, liquidation_price = $4,
            amount = $5, entry_filled_amount = $5, entry_filled_price = $6,
            peak_price = $8, trough_price = $9
      WHERE id = $7`,
    [
      String(ticker.last),
      String(quote),
      String(percent),
      liq,
      String(amt),
      String(entry),
      row.id,
      String(peak),
      String(trough),
    ],
  );
  row.peak_price = String(peak);
  row.trough_price = String(trough);
  emitQuote(
    quoteFromTicker(row.id, row.side, entry, amt, ticker.last, liq, { peak, trough }),
  );
  trackLiveTrade(ex.id, row.pair, {
    id: row.id,
    side: row.side,
    entry,
    amount: amt,
    liq,
  });
  return ticker;
}

async function syncColdQuote(
  pool: PoolClient,
  env: AppEnv,
  row: TradeRow,
  ex: ExchangeRow,
): Promise<void> {
  const creds = credsOf(ex, env.keySecret);
  const kind = marketTypeOf(ex);
  const ticker = await resolveTicker(
    ex.id,
    ex.venue as VenueId,
    creds,
    row.pair,
    kind,
    false,
  );
  const entry = Number(row.entry_price ?? ticker.last);
  const amt = Number(row.amount);
  let liq = row.liquidation_price ?? null;
  if (kind === "swap") {
    const est = estimateLiquidation(row.side, entry, row.leverage);
    if (est != null) liq = String(est);
  }
  const { quote, percent } = pnl(row.side, entry, ticker.last, amt);
  const { peak, trough } = stretchExtremes(
    ticker.last,
    row.peak_price,
    row.trough_price,
  );
  await pool.query(
    `UPDATE smart_trades
        SET last_price = $1, pnl_quote = $2, pnl_percent = $3, liquidation_price = $4,
            peak_price = $6, trough_price = $7
      WHERE id = $5`,
    [
      String(ticker.last),
      String(quote),
      String(percent),
      liq,
      row.id,
      String(peak),
      String(trough),
    ],
  );
}

async function applySignalProtect(
  pool: PoolClient,
  row: TradeRow,
  side: Side,
  fill: number,
): Promise<void> {
  const prot = protectForSide(side, fill, n(row.tp_percent), n(row.sl_percent));
  const fromEntry = n(row.entry_price) ?? fill;
  const targets = reorientTargets(side, fill, parseTpTargets(row.tp_targets), fromEntry);
  await pool.query(
    `UPDATE smart_trades
        SET side = $1,
            tp_price = $2,
            sl_price = $3,
            tp_percent = $4,
            sl_percent = $5,
            tp_targets = $6
      WHERE id = $7`,
    [
      side,
      prot.tpPrice != null ? String(prot.tpPrice) : row.tp_price,
      prot.slPrice != null ? String(prot.slPrice) : row.sl_price,
      prot.tpPercent != null ? String(prot.tpPercent) : row.tp_percent,
      prot.slPercent != null ? String(prot.slPercent) : row.sl_percent,
      stringifyTpTargets(targets) ?? row.tp_targets,
      row.id,
    ],
  );
  row.side = side;
  if (prot.tpPrice != null) row.tp_price = String(prot.tpPrice);
  if (prot.slPrice != null) row.sl_price = String(prot.slPrice);
  if (prot.tpPercent != null) row.tp_percent = String(prot.tpPercent);
  if (prot.slPercent != null) row.sl_percent = String(prot.slPercent);
  if (targets.length) row.tp_targets = stringifyTpTargets(targets);
}

export async function enterAtMarket(
  pool: PoolClient,
  env: AppEnv,
  row: TradeRow,
  ex: ExchangeRow,
  side: Side,
): Promise<void> {
  const creds = credsOf(ex, env.keySecret);
  const kind = marketTypeOf(ex);
  const amount = Number(row.amount);
  if (!(amount > 0)) throw new Error("Amount is too small to make an order");
  const ticker = await fetchTicker(
    ex.id,
    ex.venue as VenueId,
    creds,
    row.pair,
    kind,
  );
  const px = side === "buy" ? ticker.ask || ticker.last : ticker.bid || ticker.last;
  try {
    await pool.query(
      `UPDATE smart_trades
          SET entry_order_id = 'placing',
              status = 'entry_pending',
              side = $2,
              trailing_entry_enabled = false
        WHERE id = $1`,
      [row.id, side],
    );
    const placed = await placeOrder(ex.id, ex.venue as VenueId, creds, {
      symbol: row.pair,
      side,
      type: "market",
      amount,
      price: px,
      clientOrderId: `tradr-${row.id}-entry`,
      marketType: kind,
      leverage: row.leverage,
      marginMode: row.margin_mode,
    });
    await pool.query(
      `UPDATE smart_trades SET entry_order_id = $1, last_error = NULL WHERE id = $2`,
      [placed.id, row.id],
    );
    if (placed.status === "closed" && placed.filled > 0) {
      const fill = placed.average ?? px;
      const tpPx = row.tp_price != null ? Number(row.tp_price) : null;
      const slPx = row.sl_price != null ? Number(row.sl_price) : null;
      await pool.query(
        `UPDATE smart_trades
            SET status = 'in_position',
                side = $7,
                trailing_entry_enabled = false,
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
          String(placed.filled),
          row.id,
          String(placed.filled * Number(fill)),
          tpPx != null && fill > 0 ? String(percentFromPrices(fill, tpPx)) : row.tp_percent,
          slPx != null && fill > 0 ? String(percentFromPrices(fill, slPx)) : row.sl_percent,
          side,
        ],
      );
      await addStep(pool, {
        tradeId: row.id,
        side,
        price: fill,
        baseAmount: placed.filled,
        quoteAmount: placed.filled * Number(fill),
        status: "finished",
        orderId: placed.id,
      });
      emitReload();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE smart_trades SET status = 'cold_start', entry_order_id = NULL, last_error = $1 WHERE id = $2`,
      [message.slice(0, 500), row.id],
    );
    throw err;
  }
}

export async function maybeFireSignal(
  pool: PoolClient,
  env: AppEnv,
  row: TradeRow,
  ex: ExchangeRow,
): Promise<boolean> {
  if (row.entry_type !== "signal" || !row.signal_indicator) return false;
  const creds = credsOf(ex, env.keySecret);
  const kind = marketTypeOf(ex);
  const frames = await pairBias(
    ex.id,
    ex.venue as VenueId,
    creds,
    row.pair,
    kind,
    parseIndicator(row.signal_indicator),
  );
  const side = signalSide(frames);
  if (!side) return false;
  const ticker = await fetchTicker(
    ex.id,
    ex.venue as VenueId,
    creds,
    row.pair,
    kind,
  );
  const px = side === "buy" ? ticker.ask || ticker.last : ticker.bid || ticker.last;
  await applySignalProtect(pool, row, side, px);
  await enterAtMarket(pool, env, row, ex, side);
  return true;
}

async function processTrade(
  pool: PoolClient,
  env: AppEnv,
  row: TradeRow,
  ex: ExchangeRow,
): Promise<void> {
  if (isPaperVenue(ex.venue) && !env.demo) {
    await setError(pool, row.id, "Paper venue is demo-only");
    return;
  }
  if (
    row.entry_order_id === "placing" ||
    row.tp_order_id === "placing" ||
    row.sl_order_id === "placing" ||
    row.exit_order_id === "placing"
  ) {
    return;
  }
  await settlePendingAdds(pool, env, row, ex);
  if (row.status === "cold_start") {
    if (row.entry_type === "signal") {
      const fired = await maybeFireSignal(pool, env, row, ex);
      if (!fired) await syncColdQuote(pool, env, row, ex);
      return;
    }
    await syncColdQuote(pool, env, row, ex);
    return;
  }
  const creds = credsOf(ex, env.keySecret);
  const ticker = await syncTradeQuote(pool, env, row, ex);
  const kind = marketTypeOf(ex);

  const [entryOrder, tpOrder, slOrder, exitOrder] = await Promise.all([
    row.entry_order_id
      ? fetchOrderSnap(
          ex.id,
          ex.venue as VenueId,
          creds,
          row.entry_order_id,
          row.pair,
          kind,
        )
      : null,
    row.tp_order_id
      ? fetchOrderSnap(
          ex.id,
          ex.venue as VenueId,
          creds,
          row.tp_order_id,
          row.pair,
          kind,
        )
      : null,
    row.sl_order_id
      ? fetchOrderSnap(
          ex.id,
          ex.venue as VenueId,
          creds,
          row.sl_order_id,
          row.pair,
          kind,
        )
      : null,
    row.exit_order_id
      ? fetchOrderSnap(
          ex.id,
          ex.venue as VenueId,
          creds,
          row.exit_order_id,
          row.pair,
          kind,
        )
      : null,
  ]);

  const state = toState(
    (await qOne<TradeRow>(pool, `SELECT * FROM smart_trades WHERE id = $1`, [
      row.id,
    ])) ?? row,
    kind === "swap",
  );
  const extraIds = (state.tpTargets ?? [])
    .map((t) => t.orderId)
    .filter((id): id is string => Boolean(id) && id !== row.tp_order_id);
  const extraSnaps = await Promise.all(
    extraIds.map((id) =>
      fetchOrderSnap(ex.id, ex.venue as VenueId, creds, id, row.pair, kind),
    ),
  );
  const tpOrders: Record<string, NonNullable<typeof tpOrder>> = {};
  if (tpOrder) tpOrders[tpOrder.id] = tpOrder;
  extraIds.forEach((id, i) => {
    const snap = extraSnaps[i];
    if (snap) tpOrders[id] = snap;
  });
  const actions = tick(
    state,
    {
      last: ticker.last,
      bid: ticker.bid,
      ask: ticker.ask,
      entryOrder,
      tpOrder,
      tpOrders,
      slOrder,
      exitOrder,
    },
    Date.now(),
  );

  for (const action of actions) {
    await applyAction(pool, env, { ...row, ...state } as unknown as TradeRow, ex, creds, action);
    const latest = await qOne<TradeRow>(
      pool,
      `SELECT * FROM smart_trades WHERE id = $1`,
      [row.id],
    );
    if (latest) Object.assign(row, latest);
  }
}

export async function workerTick(pool: PoolClient, env: AppEnv): Promise<void> {
  const trades = await q<TradeRow>(
    pool,
    `SELECT t.*, e.label AS exchange_label, e.venue AS venue
       FROM smart_trades t
       JOIN exchanges e ON e.id = t.exchange_id
      WHERE t.status = ANY($1::text[])
      ORDER BY t.created_at ASC
      LIMIT 100`,
    [OPEN],
  );
  const watchNeed: {
    accountId: string;
    venue: VenueId;
    creds: Creds;
    symbol: string;
    marketType: ReturnType<typeof marketTypeOf>;
  }[] = [];
  const seen = new Set<string>();
  for (const trade of trades) {
    try {
      const ex = await qOne<ExchangeRow>(
        pool,
        `SELECT * FROM exchanges WHERE id = $1`,
        [trade.exchange_id],
      );
      if (!ex) continue;
      const paper = isPaperVenue(ex.venue);
      const key = paper ? `paper-public:${trade.pair}` : `${ex.id}:${trade.pair}`;
      if (!seen.has(key)) {
        seen.add(key);
        watchNeed.push({
          accountId: paper ? "paper-public" : ex.id,
          venue: (paper ? "binance" : ex.venue) as VenueId,
          creds: paper
            ? { apiKey: "", secret: "" }
            : credsOf(ex, env.keySecret),
          symbol: trade.pair,
          marketType: paper ? "spot" : marketTypeOf(ex),
        });
      }
      await processTrade(pool, env, trade, ex);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setError(pool, trade.id, message);
    }
  }
  syncTickerWatches(watchNeed);
}

export function startWorker(pool: PoolClient, env: AppEnv): void {
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      await workerTick(pool, env);
      await maybeSnapshotAll(pool, env);
    } catch (err) {
      console.error("worker tick failed", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  setInterval(loop, env.workerIntervalMs);
  void loop();
}

export async function liveBalance(
  pool: PoolClient,
  env: AppEnv,
  exchangeId: string,
) {
  const ex = await qOne<ExchangeRow>(
    pool,
    `SELECT * FROM exchanges WHERE id = $1`,
    [exchangeId],
  );
  if (!ex) throw new Error("Exchange not found");
  const creds = credsOf(ex, env.keySecret);
  return fetchBalanceMap(ex.id, ex.venue as VenueId, creds, marketTypeOf(ex));
}

export { credsOf } from "./creds.ts";
