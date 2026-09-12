import { describe, expect, it } from "vitest";
import { formatCompactUsd, formatSignedQuote, leftoverAddNotional, protectForSide } from "../shared/money.ts";
import {
  initialTriggerDir,
  percentFromPrices,
  pnl,
  priceFromPercent,
  tick,
  validateSize,
  type TradeState,
} from "./engine.ts";

function base(over: Partial<TradeState> = {}): TradeState {
  return {
    id: "t1",
    side: "buy",
    status: "in_position",
    amount: 10,
    useExistingAssets: false,
    entryType: "market",
    entryPrice: 100,
    triggerDir: null,
    tpEnabled: true,
    tpType: "market",
    tpPrice: 110,
    trailingTpEnabled: false,
    trailingTpPercent: null,
    trailingEntryEnabled: false,
    trailingEntryPercent: null,
    slEnabled: true,
    slType: "cond_market",
    slPrice: 95,
    slPercent: -5,
    slTimeoutEnabled: false,
    slTimeoutSec: null,
    slTimeoutStartedAt: null,
    trailingSlEnabled: false,
    moveToBreakeven: false,
    entryOrderId: "e1",
    tpOrderId: null,
    slOrderId: null,
    exitOrderId: null,
    entryFilledPrice: 100,
    entryFilledAmount: 10,
    peakPrice: 100,
    troughPrice: 100,
    protectAmount: null,
    closedReason: null,
    tpTargets: null,
    initialAmount: 10,
    ...over,
  };
}

describe("price helpers", () => {
  it("maps +10% and -5% off an entry the way the form does", () => {
    expect(priceFromPercent(0.03141, 10)).toBeCloseTo(0.034551, 6);
    expect(priceFromPercent(0.03141, -5)).toBeCloseTo(0.0298395, 6);
    expect(percentFromPrices(0.03141, 0.034551)).toBeCloseTo(10, 3);
  });

  it("points take-profit and stop-loss from a signal side", () => {
    const long = protectForSide("buy", 100, 10, 5);
    expect(long.tpPrice).toBeCloseTo(110, 10);
    expect(long.slPrice).toBeCloseTo(95, 10);
    const short = protectForSide("sell", 100, 10, 5);
    expect(short.tpPrice).toBeCloseTo(90, 10);
    expect(short.slPrice).toBeCloseTo(105, 10);
  });

  it("computes buy and sell pnl", () => {
    expect(pnl("buy", 100, 110, 2)).toEqual({ quote: 20, percent: 10 });
    expect(pnl("sell", 100, 90, 2)).toEqual({ quote: 20, percent: 10 });
  });

  it("formats signed quote pnl", () => {
    expect(formatSignedQuote(3.61, "USD")).toBe("+3.61 USD");
    expect(formatSignedQuote(-10.24, "USD")).toBe("-10.24 USD");
    expect(formatSignedQuote(0.0042, "USD")).toBe("+0.0042 USD");
    expect(formatCompactUsd(100000)).toBe("$100k");
    expect(formatCompactUsd(-10000)).toBe("-$10k");
    expect(formatCompactUsd(531)).toBe("$531");
  });

  it("sizes add-% off leftover after a programmed unfilled position", () => {
    const cold = leftoverAddNotional({
      quoteFree: 1000,
      plannedBase: 100,
      price: 10,
      leverage: 5,
      futures: true,
      reservedOnExchange: false,
    });
    expect(cold.plannedMargin).toBeCloseTo(200);
    expect(cold.leftoverQuote).toBeCloseTo(800);
    expect(cold.addNotional).toBeCloseTo(4000);
    const resting = leftoverAddNotional({
      quoteFree: 800,
      plannedBase: 100,
      price: 10,
      leverage: 5,
      futures: true,
      reservedOnExchange: true,
    });
    expect(resting.leftoverQuote).toBeCloseTo(800);
    expect(resting.addNotional).toBeCloseTo(4000);
  });
});

describe("validateSize", () => {
  it("flags min amount and min cost", () => {
    const a = validateSize({
      amount: 0.00005,
      price: 1,
      minAmount: 0.0001,
      base: "ETH",
    });
    expect(a[0]).toMatch(/0.0001 ETH/);
    const b = validateSize({
      amount: 0.1,
      price: 1,
      minCost: 5,
      quote: "USDT",
    });
    expect(b[0]).toMatch(/5 USDT/);
  });
});

describe("conditional trigger direction", () => {
  it("waits for a dip when last is above the buy entry", () => {
    expect(initialTriggerDir("buy", 110, 100)).toBe("lte");
  });
  it("waits for a breakout when last is below the buy entry", () => {
    expect(initialTriggerDir("buy", 90, 100)).toBe("gte");
  });
});

describe("tick", () => {
  it("places a market entry when a conditional buy trigger hits", () => {
    const actions = tick(
      base({
        status: "waiting_trigger",
        entryType: "conditional",
        entryPrice: 100,
        triggerDir: "lte",
        entryFilledPrice: null,
      }),
      { last: 99, bid: 99, ask: 99.2 },
      1,
    );
    expect(actions.some((a) => a.type === "place_entry")).toBe(true);
    expect(actions.some((a) => a.type === "mark_status" && a.status === "entry_pending")).toBe(
      true,
    );
  });

  it("does nothing while a cold start is waiting to fire up", () => {
    const actions = tick(
      base({
        status: "cold_start",
        entryFilledPrice: null,
        entryFilledAmount: null,
      }),
      { last: 105, bid: 105, ask: 105 },
      1,
    );
    expect(actions).toEqual([]);
  });

  it("does not fire while the trigger is still away", () => {
    const actions = tick(
      base({
        status: "waiting_trigger",
        entryType: "conditional",
        entryPrice: 100,
        triggerDir: "lte",
      }),
      { last: 105, bid: 105, ask: 105 },
      1,
    );
    expect(actions).toEqual([]);
  });

  it("moves to in_position and rests a limit TP after the entry fills", () => {
    const actions = tick(
      base({
        status: "entry_pending",
        tpType: "limit",
        tpPrice: 110,
        entryFilledPrice: null,
      }),
      {
        last: 101,
        bid: 100,
        ask: 101,
        entryOrder: { id: "e1", status: "closed", filled: 10, average: 100.5 },
      },
      1,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "mark_status", status: "in_position" }),
        expect.objectContaining({ type: "place_tp", orderType: "limit", price: 110 }),
      ]),
    );
  });

  it("closes on a market take-profit hit", () => {
    const actions = tick(base(), { last: 111, bid: 110, ask: 111 }, 1);
    expect(actions.some((a) => a.type === "place_exit" && a.reason === "tp")).toBe(
      true,
    );
  });

  it("prefers stop-loss over take-profit on the same tick", () => {
    const actions = tick(
      base({ tpPrice: 90, slPrice: 90 }),
      { last: 90, bid: 90, ask: 90 },
      1,
    );
    const exit = actions.find((a) => a.type === "place_exit");
    expect(exit && exit.type === "place_exit" && exit.reason).toBe("sl");
  });

  it("waits out a stop-loss timeout before exiting", () => {
    const t = base({ slTimeoutEnabled: true, slTimeoutSec: 30, slPrice: 95 });
    const first = tick(t, { last: 94, bid: 94, ask: 94 }, 1_000);
    expect(first.some((a) => a.type === "place_exit")).toBe(false);
    expect(
      first.some(
        (a) => a.type === "patch" && a.patch.slTimeoutStartedAt === 1_000,
      ),
    ).toBe(true);

    const second = tick(
      { ...t, slTimeoutStartedAt: 1_000 },
      { last: 94, bid: 94, ask: 94 },
      10_000,
    );
    expect(second.some((a) => a.type === "place_exit")).toBe(false);

    const third = tick(
      { ...t, slTimeoutStartedAt: 1_000 },
      { last: 94, bid: 94, ask: 94 },
      1_000 + 30_000,
    );
    expect(third.some((a) => a.type === "place_exit" && a.reason === "sl")).toBe(
      true,
    );
  });

  it("clears the stop-loss timer if price recovers", () => {
    const actions = tick(
      base({ slTimeoutEnabled: true, slTimeoutSec: 30, slTimeoutStartedAt: 1 }),
      { last: 101, bid: 101, ask: 101 },
      5,
    );
    expect(
      actions.some(
        (a) => a.type === "patch" && a.patch.slTimeoutStartedAt === null,
      ),
    ).toBe(true);
  });

  it("raises a trailing take-profit with the peak", () => {
    const actions = tick(
      base({
        tpType: "limit",
        tpOrderId: "tp1",
        trailingTpEnabled: true,
        trailingTpPercent: -5,
        tpPrice: 95,
        peakPrice: 100,
      }),
      { last: 120, bid: 119, ask: 120 },
      1,
    );
    const amend = actions.find((a) => a.type === "amend_tp");
    expect(amend && amend.type === "amend_tp" && amend.price).toBeCloseTo(114, 5);
  });

  it("moves stop-loss to entry after the first take-profit target fills", () => {
    const t1 = {
      id: "a",
      price: "110",
      percent: "10",
      qtyPct: 50,
      orderId: "tpA",
      filled: false,
    };
    const t2 = {
      id: "b",
      price: "120",
      percent: "20",
      qtyPct: 50,
      orderId: "tpB",
      filled: false,
    };
    const actions = tick(
      base({
        moveToBreakeven: true,
        slPrice: 95,
        slOrderId: "sl1",
        tpTargets: [t1, t2],
        tpOrderId: "tpA",
      }),
      {
        last: 110,
        bid: 110,
        ask: 110,
        tpOrders: {
          tpA: { id: "tpA", status: "closed", filled: 5, average: 110 },
        },
      },
      1,
    );
    expect(
      actions.some((a) => a.type === "amend_sl" && a.price === 100),
    ).toBe(true);
    expect(
      actions.some(
        (a) => a.type === "mark_status" && a.patch?.slPrice === 100,
      ),
    ).toBe(true);
  });

  it("activates trailing buy at the trigger then buys on the bounce", () => {
    const t = base({
      status: "waiting_trigger",
      entryType: "conditional",
      entryPrice: 100,
      triggerDir: "lte",
      trailingEntryEnabled: true,
      trailingEntryPercent: 1,
      peakPrice: null,
      troughPrice: null,
      entryFilledPrice: null,
      entryFilledAmount: null,
    });
    expect(tick(t, { last: 105, bid: 105, ask: 105 }, 1)).toEqual([]);
    const arm = tick(t, { last: 99, bid: 99, ask: 99 }, 1);
    expect(arm.some((a) => a.type === "patch" && a.patch.troughPrice === 99)).toBe(
      true,
    );
    const follow = tick(
      { ...t, peakPrice: 99, troughPrice: 99 },
      { last: 90, bid: 90, ask: 90 },
      2,
    );
    expect(
      follow.some((a) => a.type === "patch" && a.patch.troughPrice === 90),
    ).toBe(true);
    const fire = tick(
      { ...t, peakPrice: 99, troughPrice: 90 },
      { last: 91, bid: 91, ask: 91 },
      3,
    );
    expect(fire.some((a) => a.type === "place_entry")).toBe(true);
  });

  it("places a limit take-profit after it is attached on an open trade", () => {
    const actions = tick(
      base({
        tpEnabled: true,
        tpType: "limit",
        tpPrice: 110,
        tpOrderId: null,
      }),
      { last: 101, bid: 100, ask: 101 },
      1,
    );
    expect(
      actions.some((a) => a.type === "place_tp" && a.orderType === "limit" && a.price === 110),
    ).toBe(true);
  });

  it("closes when a resting take-profit order fills", () => {
    const actions = tick(
      base({ tpType: "limit", tpOrderId: "tp1", tpEnabled: true }),
      {
        last: 109,
        bid: 109,
        ask: 110,
        tpOrder: { id: "tp1", status: "closed", filled: 10, average: 110 },
      },
      1,
    );
    expect(
      actions.some(
        (a) =>
          a.type === "mark_status" &&
          a.status === "closed" &&
          a.patch?.closedReason === "tp",
      ),
    ).toBe(true);
  });

  it("rests reduce-only market TP and SL on the exchange before they hit", () => {
    const actions = tick(
      base({ tpReduceOnly: true, slReduceOnly: true }),
      { last: 101, bid: 100, ask: 101 },
      1,
    );
    expect(
      actions.some(
        (a) => a.type === "place_tp" && a.orderType === "market" && a.price === 110,
      ),
    ).toBe(true);
    expect(
      actions.some(
        (a) => a.type === "place_sl" && a.orderType === "market" && a.price === 95,
      ),
    ).toBe(true);
    expect(actions.some((a) => a.type === "place_exit")).toBe(false);
  });

  it("does not rest a native stop when a stop-loss timeout is on", () => {
    const actions = tick(
      base({
        tpEnabled: false,
        slReduceOnly: true,
        slTimeoutEnabled: true,
        slTimeoutSec: 30,
      }),
      { last: 101, bid: 101, ask: 101 },
      1,
    );
    expect(actions.some((a) => a.type === "place_sl")).toBe(false);
  });

  it("still software-fires take-profit when price is already through", () => {
    const actions = tick(
      base({ tpReduceOnly: true, slEnabled: false }),
      { last: 111, bid: 110, ask: 111 },
      1,
    );
    expect(actions.some((a) => a.type === "place_exit" && a.reason === "tp")).toBe(
      true,
    );
    expect(actions.some((a) => a.type === "place_tp")).toBe(false);
  });

  it("closes when a resting stop-loss order fills", () => {
    const actions = tick(
      base({
        slReduceOnly: true,
        slOrderId: "sl1",
        tpOrderId: "tp1",
      }),
      {
        last: 96,
        bid: 96,
        ask: 97,
        slOrder: { id: "sl1", status: "closed", filled: 10, average: 95 },
      },
      1,
    );
    expect(
      actions.some((a) => a.type === "cancel_order" && a.role === "tp"),
    ).toBe(true);
    expect(
      actions.some(
        (a) =>
          a.type === "mark_status" &&
          a.status === "closed" &&
          a.patch?.closedReason === "sl",
      ),
    ).toBe(true);
  });

  it("places each split take-profit", () => {
    const actions = tick(
      base({
        tpType: "limit",
        tpTargets: [
          { id: "a", price: "110", percent: "10", qtyPct: 25, orderId: null, filled: false },
          { id: "b", price: "120", percent: "20", qtyPct: 50, orderId: null, filled: false },
        ],
      }),
      { last: 101, bid: 100, ask: 101 },
      1,
    );
    const places = actions.filter((a) => a.type === "place_tp");
    expect(places).toHaveLength(2);
    expect(places.map((a) => (a.type === "place_tp" ? a.price : 0))).toEqual([
      110, 120,
    ]);
    expect(places.map((a) => (a.type === "place_tp" ? a.amount : 0))).toEqual([
      2.5, 5,
    ]);
  });

  it("keeps the trade open after the first split target fills", () => {
    const actions = tick(
      base({
        tpType: "limit",
        tpOrderId: "tp-a",
        tpTargets: [
          { id: "a", price: "110", percent: "10", qtyPct: 25, orderId: "tp-a", filled: false },
          { id: "b", price: "120", percent: "20", qtyPct: 50, orderId: "tp-b", filled: false },
        ],
      }),
      {
        last: 110,
        bid: 110,
        ask: 111,
        tpOrder: { id: "tp-a", status: "closed", filled: 2.5, average: 110 },
        tpOrders: {
          "tp-a": { id: "tp-a", status: "closed", filled: 2.5, average: 110 },
          "tp-b": { id: "tp-b", status: "open", filled: 0, average: null },
        },
      },
      1,
    );
    expect(
      actions.some((a) => a.type === "mark_status" && a.status === "in_position"),
    ).toBe(true);
    expect(
      actions.some((a) => a.type === "mark_status" && a.status === "closed"),
    ).toBe(false);
  });
});
