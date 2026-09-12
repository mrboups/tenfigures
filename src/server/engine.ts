import type {
  ClosedReason,
  EntryType,
  Side,
  SlType,
  TpTarget,
  TpType,
  TradeStatus,
  TriggerDir,
} from "../shared/types.ts";
import { priceFromPercent } from "../shared/money.ts";

export { percentFromPrices, pnl, priceFromPercent } from "../shared/money.ts";

export type { TradeStatus, TriggerDir };

export interface TradeState {
  id: string;
  side: Side;
  status: TradeStatus;
  amount: number;
  useExistingAssets: boolean;
  entryType: EntryType;
  entryPrice: number | null;
  triggerDir: TriggerDir | null;
  tpEnabled: boolean;
  tpType: TpType | null;
  tpPrice: number | null;
  trailingTpEnabled: boolean;
  trailingTpPercent: number | null;
  trailingEntryEnabled?: boolean;
  trailingEntryPercent?: number | null;
  slEnabled: boolean;
  slType: SlType | null;
  slPrice: number | null;
  slPercent: number | null;
  slTimeoutEnabled: boolean;
  slTimeoutSec: number | null;
  slTimeoutStartedAt: number | null;
  trailingSlEnabled: boolean;
  moveToBreakeven: boolean;
  entryOrderId: string | null;
  tpOrderId: string | null;
  slOrderId: string | null;
  exitOrderId: string | null;
  entryFilledPrice: number | null;
  entryFilledAmount: number | null;
  peakPrice: number | null;
  troughPrice: number | null;
  protectAmount: number | null;
  closedReason: ClosedReason | null;
  exitPrice?: number | null;
  tpReduceOnly?: boolean;
  slReduceOnly?: boolean;
  tpTargets?: TpTarget[] | null;
  initialAmount?: number | null;
}

export interface OrderSnap {
  id: string;
  status: "open" | "closed" | "canceled" | "rejected" | "expired";
  filled: number;
  average: number | null;
}

export interface MarketSnap {
  last: number;
  bid: number;
  ask: number;
  entryOrder?: OrderSnap | null;
  tpOrder?: OrderSnap | null;
  tpOrders?: Record<string, OrderSnap>;
  slOrder?: OrderSnap | null;
  exitOrder?: OrderSnap | null;
}

export type Action =
  | { type: "place_entry"; orderType: "market" | "limit"; price?: number }
  | {
      type: "place_tp";
      orderType: "market" | "limit";
      price: number;
      amount?: number;
      targetId?: string;
    }
  | { type: "place_sl"; orderType: "market" | "limit"; price: number }
  | {
      type: "place_exit";
      orderType: "market" | "limit";
      price?: number;
      reason: ClosedReason;
      amount?: number;
      targetId?: string;
    }
  | { type: "cancel_order"; orderId: string; role: "entry" | "tp" | "sl" | "exit" }
  | { type: "amend_tp"; orderId: string; price: number }
  | { type: "amend_sl"; orderId: string; price: number }
  | { type: "mark_status"; status: TradeStatus; patch?: Partial<TradeState> }
  | { type: "patch"; patch: Partial<TradeState> };

const REL = 1e-10;

export function initialTriggerDir(
  side: Side,
  last: number,
  entryPrice: number,
): TriggerDir {
  if (side === "buy") return last > entryPrice ? "lte" : "gte";
  return last < entryPrice ? "gte" : "lte";
}

export function validateSize(opts: {
  amount: number;
  price: number;
  minAmount?: number | null;
  minCost?: number | null;
  base?: string;
  quote?: string;
}): string[] {
  const errors: string[] = [];
  if (!(opts.amount > 0)) {
    errors.push("Amount is too small to make an order");
  }
  if (opts.minAmount != null && opts.amount < opts.minAmount) {
    const label = opts.base ? ` ${opts.base}` : "";
    errors.push(
      `Trade does not meet minimum requirements: ${opts.minAmount}${label}`,
    );
  }
  const cost = opts.amount * opts.price;
  if (opts.minCost != null && opts.price > 0 && cost < opts.minCost) {
    const label = opts.quote ? ` ${opts.quote}` : "";
    errors.push(
      `Trade does not meet minimum requirements: ${opts.minCost}${label}`,
    );
  }
  return errors;
}

function filled(order?: OrderSnap | null): boolean {
  return Boolean(order && order.status === "closed" && order.filled > 0);
}

function dead(order?: OrderSnap | null): boolean {
  if (!order) return false;
  return (
    order.status === "canceled" ||
    order.status === "rejected" ||
    order.status === "expired"
  );
}

function hitTrigger(last: number, target: number, dir: TriggerDir): boolean {
  const slack = Math.abs(target) * REL + 1e-12;
  return dir === "lte" ? last <= target + slack : last >= target - slack;
}

function slHit(side: Side, last: number, sl: number): boolean {
  return side === "buy" ? last <= sl : last >= sl;
}

function tpHit(side: Side, last: number, tp: number): boolean {
  return side === "buy" ? last >= tp : last <= tp;
}

interface LiveTarget {
  id: string;
  price: number;
  qtyPct: number;
  orderId: string | null;
}

function liveTargets(trade: TradeState): LiveTarget[] {
  const listed = (trade.tpTargets ?? [])
    .filter((t) => !t.filled && Number(t.price) > 0 && t.qtyPct > 0)
    .map((t) => ({
      id: t.id,
      price: Number(t.price),
      qtyPct: t.qtyPct,
      orderId: t.orderId,
    }))
    .filter((t) => Number.isFinite(t.price) && t.price > 0);
  if (listed.length) return listed;
  if (trade.tpEnabled && trade.tpPrice != null && trade.tpPrice > 0) {
    const held = trade.entryFilledAmount ?? trade.amount;
    const slice = trade.protectAmount;
    const qtyPct =
      slice != null && held > 0 && slice > 0 && slice < held * 0.98
        ? (slice / held) * 100
        : 100;
    return [
      {
        id: "main",
        price: trade.tpPrice,
        qtyPct,
        orderId: trade.tpOrderId,
      },
    ];
  }
  return [];
}

function targetQty(trade: TradeState, qtyPct: number): number {
  const basis = trade.initialAmount ?? trade.entryFilledAmount ?? trade.amount;
  return Math.max(0, (basis * qtyPct) / 100);
}

function orderFor(market: MarketSnap, orderId: string | null): OrderSnap | null {
  if (!orderId) return null;
  return market.tpOrders?.[orderId] ?? (market.tpOrder?.id === orderId ? market.tpOrder : null);
}

function betterTp(
  side: Side,
  next: number,
  current: number | null,
): boolean {
  if (current == null) return true;
  return side === "buy" ? next > current : next < current;
}

function betterSl(
  side: Side,
  next: number,
  current: number | null,
): boolean {
  if (current == null) return true;
  return side === "buy" ? next > current : next < current;
}

export function tick(
  trade: TradeState,
  market: MarketSnap,
  now: number,
): Action[] {
  const actions: Action[] = [];
  const last = market.last;
  if (trade.status === "cold_start") return actions;

  if (trade.status === "waiting_trigger") {
    if (trade.entryPrice == null || trade.triggerDir == null) return actions;
    const trailPct = trade.trailingEntryEnabled
      ? Math.abs(trade.trailingEntryPercent ?? 0)
      : 0;
    if (trailPct > 0) {
      const armed = trade.peakPrice != null || trade.troughPrice != null;
      if (!armed) {
        if (!hitTrigger(last, trade.entryPrice, trade.triggerDir)) return actions;
        actions.push({
          type: "patch",
          patch: { peakPrice: last, troughPrice: last },
        });
        return actions;
      }
      let peak = trade.peakPrice ?? last;
      let trough = trade.troughPrice ?? last;
      const trailPatch: Partial<TradeState> = {};
      if (last > peak) {
        peak = last;
        trailPatch.peakPrice = peak;
      }
      if (last < trough) {
        trough = last;
        trailPatch.troughPrice = trough;
      }
      if (Object.keys(trailPatch).length) {
        actions.push({ type: "patch", patch: trailPatch });
      }
      const fire =
        trade.side === "buy"
          ? last >= priceFromPercent(trough, trailPct)
          : last <= priceFromPercent(peak, -trailPct);
      if (!fire) return actions;
    } else if (!hitTrigger(last, trade.entryPrice, trade.triggerDir)) {
      return actions;
    }
    if (trade.entryType === "limit") {
      actions.push({
        type: "place_entry",
        orderType: "limit",
        price: trade.entryPrice,
      });
    } else {
      actions.push({ type: "place_entry", orderType: "market" });
    }
    actions.push({ type: "mark_status", status: "entry_pending" });
    return actions;
  }

  if (trade.status === "entry_pending") {
    const order = market.entryOrder;
    if (filled(order)) {
      const px = order!.average ?? last;
      const amt = order!.filled || trade.amount;
      const patch: Partial<TradeState> = {
        entryFilledPrice: px,
        entryFilledAmount: amt,
        peakPrice: px,
        troughPrice: px,
      };
      actions.push({ type: "mark_status", status: "in_position", patch });
      if (trade.tpEnabled && trade.tpType === "limit" && trade.tpPrice != null) {
        actions.push({
          type: "place_tp",
          orderType: "limit",
          price: trade.tpPrice,
        });
      }
      return actions;
    }
    if (dead(order)) {
      actions.push({ type: "mark_status", status: "cancelled" });
    }
    return actions;
  }

  if (trade.status === "closing") {
    const exit = market.exitOrder;
    if (filled(exit)) {
      actions.push({
        type: "mark_status",
        status: "closed",
        patch: { exitPrice: exit!.average ?? last },
      });
    } else if (dead(exit)) {
      actions.push({
        type: "mark_status",
        status: "error",
      });
    }
    return actions;
  }

  if (trade.status !== "in_position") return actions;

  const entry = trade.entryFilledPrice ?? trade.entryPrice ?? last;
  let peak = trade.peakPrice ?? entry;
  let trough = trade.troughPrice ?? entry;
  if (last > peak) peak = last;
  if (last < trough) trough = last;

  const patch: Partial<TradeState> = {};
  if (peak !== trade.peakPrice) patch.peakPrice = peak;
  if (trough !== trade.troughPrice) patch.troughPrice = trough;

  let tpPrice = trade.tpPrice;
  if (
    trade.tpEnabled &&
    trade.trailingTpEnabled &&
    trade.trailingTpPercent != null &&
    (trade.tpTargets ?? []).filter((t) => !t.filled).length <= 1
  ) {
    const extreme = trade.side === "buy" ? peak : trough;
    const next = priceFromPercent(extreme, trade.trailingTpPercent);
    if (betterTp(trade.side, next, tpPrice)) {
      tpPrice = next;
      patch.tpPrice = next;
      if (trade.tpOrderId) {
        actions.push({
          type: "amend_tp",
          orderId: trade.tpOrderId,
          price: next,
        });
      }
    }
  }

  let slPrice = trade.slPrice;
  if (trade.slEnabled) {
    if (trade.trailingSlEnabled && trade.slPercent != null) {
      const next = priceFromPercent(last, trade.slPercent);
      if (betterSl(trade.side, next, slPrice)) {
        slPrice = next;
        patch.slPrice = next;
      }
    }
  }

  if (Object.keys(patch).length) actions.push({ type: "patch", patch });

  const splits = liveTargets({ ...trade, tpPrice: tpPrice ?? trade.tpPrice });
  const tpPx = splits[0]?.price ?? tpPrice ?? trade.tpPrice;
  const tpAtMarket = trade.tpType === "market";
  const slAtMarket = trade.slType !== "cond_limit";
  const splitMode = (trade.tpTargets ?? []).some((t) => !t.filled);

  if (dead(market.tpOrder) && trade.tpOrderId) {
    actions.push({ type: "patch", patch: { tpOrderId: null } });
    trade = { ...trade, tpOrderId: null };
  }
  if (splitMode) {
    let nextTargets = trade.tpTargets ?? [];
    let changed = false;
    for (const t of splits) {
      const snap = orderFor(market, t.orderId);
      if (dead(snap) && t.orderId) {
        nextTargets = nextTargets.map((x) =>
          x.id === t.id ? { ...x, orderId: null } : x,
        );
        changed = true;
      }
    }
    if (changed) {
      actions.push({ type: "patch", patch: { tpTargets: nextTargets } });
      trade = { ...trade, tpTargets: nextTargets };
    }
  }
  if (dead(market.slOrder) && trade.slOrderId) {
    actions.push({ type: "patch", patch: { slOrderId: null } });
    trade = { ...trade, slOrderId: null };
  }

  if (trade.tpEnabled) {
    for (const t of liveTargets({ ...trade, tpPrice: tpPx ?? trade.tpPrice })) {
      if (t.orderId) continue;
      if (trade.tpType === "limit") {
        actions.push({
          type: "place_tp",
          orderType: "limit",
          price: t.price,
          amount: targetQty(trade, t.qtyPct),
          targetId: t.id,
        });
      } else if (trade.tpReduceOnly && !tpHit(trade.side, last, t.price)) {
        actions.push({
          type: "place_tp",
          orderType: "market",
          price: t.price,
          amount: targetQty(trade, t.qtyPct),
          targetId: t.id,
        });
      }
    }
  }

  if (
    trade.slEnabled &&
    slPrice != null &&
    trade.slOrderId &&
    slPrice !== trade.slPrice
  ) {
    actions.push({
      type: "amend_sl",
      orderId: trade.slOrderId,
      price: slPrice,
    });
  }

  if (
    trade.slEnabled &&
    slPrice != null &&
    !trade.slOrderId &&
    trade.slReduceOnly &&
    !trade.slTimeoutEnabled &&
    !slHit(trade.side, last, slPrice)
  ) {
    actions.push({
      type: "place_sl",
      orderType: slAtMarket ? "market" : "limit",
      price: slPrice,
    });
  }

  if (trade.tpEnabled && splitMode) {
    const hits = liveTargets(trade)
      .map((t) => ({ t, snap: orderFor(market, t.orderId) }))
      .filter((h) => filled(h.snap));
    if (hits.length) {
      const held = trade.entryFilledAmount ?? trade.amount;
      const taken = hits.reduce(
        (s, h) => s + (h.snap!.filled || targetQty(trade, h.t.qtyPct)),
        0,
      );
      const left = Math.max(0, held - taken);
      const filledIds = new Set(hits.map((h) => h.t.id));
      const nextTargets = (trade.tpTargets ?? []).map((t) =>
        filledIds.has(t.id) ? { ...t, filled: true } : t,
      );
      const still = nextTargets.filter((t) => !t.filled);
      const avg =
        hits[hits.length - 1]?.snap?.average ?? tpPx ?? last;
      if (!still.length || left <= (trade.initialAmount ?? held) * 0.02) {
        if (trade.slOrderId) {
          actions.push({
            type: "cancel_order",
            orderId: trade.slOrderId,
            role: "sl",
          });
        }
        actions.push({
          type: "mark_status",
          status: "closed",
          patch: {
            amount: left,
            entryFilledAmount: left,
            tpTargets: nextTargets,
            exitPrice: avg,
            closedReason: "tp",
          },
        });
        return actions;
      }
      const nxt = still[0]!;
      const bePatch: Partial<TradeState> = {
        amount: left,
        entryFilledAmount: left,
        tpTargets: nextTargets,
        tpPrice: Number(nxt.price),
        tpOrderId: nxt.orderId,
        protectAmount: targetQty(
          { ...trade, initialAmount: trade.initialAmount ?? held },
          nxt.qtyPct,
        ),
      };
      if (trade.moveToBreakeven) {
        const be = trade.entryFilledPrice ?? trade.entryPrice;
        if (be != null && betterSl(trade.side, be, trade.slPrice)) {
          bePatch.slPrice = be;
          if (trade.slOrderId) {
            actions.push({
              type: "amend_sl",
              orderId: trade.slOrderId,
              price: be,
            });
          }
        }
      }
      actions.push({
        type: "mark_status",
        status: "in_position",
        patch: bePatch,
      });
      return actions;
    }
  }

  if (trade.tpEnabled && filled(market.tpOrder)) {
    const held = trade.entryFilledAmount ?? trade.amount;
    const taken = market.tpOrder!.filled || trade.protectAmount || held;
    if (trade.protectAmount != null && taken < held * 0.98) {
      const left = Math.max(0, held - taken);
      actions.push({
        type: "mark_status",
        status: "in_position",
        patch: {
          amount: left,
          entryFilledAmount: left,
          protectAmount: null,
          tpEnabled: false,
          tpOrderId: null,
        },
      });
      return actions;
    }
    if (trade.slOrderId) {
      actions.push({
        type: "cancel_order",
        orderId: trade.slOrderId,
        role: "sl",
      });
    }
    actions.push({
      type: "mark_status",
      status: "closed",
      patch: {
        exitPrice: market.tpOrder!.average ?? tpPx ?? last,
        closedReason: "tp",
      },
    });
    return actions;
  }

  if (trade.slEnabled && filled(market.slOrder)) {
    if (trade.tpOrderId) {
      actions.push({
        type: "cancel_order",
        orderId: trade.tpOrderId,
        role: "tp",
      });
    }
    for (const t of trade.tpTargets ?? []) {
      if (t.orderId && t.orderId !== trade.tpOrderId && !t.filled) {
        actions.push({
          type: "cancel_order",
          orderId: t.orderId,
          role: "tp",
        });
      }
    }
    actions.push({
      type: "mark_status",
      status: "closed",
      patch: {
        exitPrice: market.slOrder!.average ?? slPrice ?? last,
        closedReason: "sl",
      },
    });
    return actions;
  }

  if (
    trade.slEnabled &&
    slPrice != null &&
    slHit(trade.side, last, slPrice) &&
    !trade.slOrderId
  ) {
    if (trade.slTimeoutEnabled && (trade.slTimeoutSec ?? 0) > 0) {
      if (trade.slTimeoutStartedAt == null) {
        actions.push({
          type: "patch",
          patch: { slTimeoutStartedAt: now },
        });
        return actions;
      }
      if (now - trade.slTimeoutStartedAt < trade.slTimeoutSec! * 1000) {
        return actions;
      }
    }
    return fireExit(actions, trade, "sl", trade.slType, slPrice);
  }

  if (trade.slTimeoutStartedAt != null) {
    actions.push({ type: "patch", patch: { slTimeoutStartedAt: null } });
  }

  if (trade.tpEnabled && tpAtMarket) {
    const open = liveTargets({ ...trade, tpPrice: tpPx ?? trade.tpPrice }).filter(
      (t) => !t.orderId && tpHit(trade.side, last, t.price),
    );
    const first = open[0];
    if (first) {
      const qty = targetQty(trade, first.qtyPct);
      const held = trade.entryFilledAmount ?? trade.amount;
      if (first.id !== "main" && qty < held * 0.98) {
        actions.push({
          type: "place_exit",
          orderType: "market",
          price: first.price,
          reason: "tp",
          amount: qty,
          targetId: first.id,
        });
        return actions;
      }
      if (!trade.tpOrderId) {
        return fireExit(actions, trade, "tp", "market", first.price);
      }
    }
  }

  return actions;
}

function fireExit(
  actions: Action[],
  trade: TradeState,
  reason: ClosedReason,
  slOrTpType: SlType | TpType | "market" | null,
  price: number,
  amount?: number,
  targetId?: string,
): Action[] {
  if (trade.tpOrderId) {
    actions.push({
      type: "cancel_order",
      orderId: trade.tpOrderId,
      role: "tp",
    });
  }
  for (const t of trade.tpTargets ?? []) {
    if (t.orderId && t.orderId !== trade.tpOrderId && !t.filled) {
      actions.push({
        type: "cancel_order",
        orderId: t.orderId,
        role: "tp",
      });
    }
  }
  if (trade.slOrderId) {
    actions.push({
      type: "cancel_order",
      orderId: trade.slOrderId,
      role: "sl",
    });
  }
  const asLimit = slOrTpType === "cond_limit" || slOrTpType === "limit";
  actions.push({
    type: "place_exit",
    orderType: asLimit && reason === "sl" ? "limit" : "market",
    price: asLimit && reason === "sl" ? price : undefined,
    reason,
    amount,
    targetId,
  });
  actions.push({
    type: "mark_status",
    status: "closing",
    patch: { closedReason: reason },
  });
  return actions;
}
