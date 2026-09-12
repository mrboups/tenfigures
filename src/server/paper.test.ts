import { describe, expect, it } from "vitest";
import {
  DEMO_BTC_AMOUNT,
  DEMO_BTC_ENTRY,
  DEMO_BTC_QUOTE,
  DEMO_SEEDS,
  demoSeedId,
  demoSeedListRank,
  limitWouldFill,
  lockForLimit,
  settleFill,
  shouldReseedDemoTrade,
  splitPair,
  unlockLimit,
  type PaperWallet,
} from "./paper.ts";

function wallet(over: PaperWallet = {}): PaperWallet {
  return { USDT: { free: 10000, used: 0 }, ...over };
}

describe("paper fills", () => {
  it("demo seed is $10k of BTC at $59,000", () => {
    expect(DEMO_BTC_ENTRY).toBe(59000);
    expect(DEMO_BTC_QUOTE).toBe(10000);
    expect(DEMO_BTC_AMOUNT * DEMO_BTC_ENTRY).toBeCloseTo(10000, 6);
  });

  it("demo also seeds $5k ETH and $2.5k XRP", () => {
    const eth = DEMO_SEEDS.find((s) => s.slug === "eth")!;
    const xrp = DEMO_SEEDS.find((s) => s.slug === "xrp")!;
    expect(eth.quote).toBe(5000);
    expect(eth.entry).toBe(1600);
    expect(eth.quote / eth.entry).toBeCloseTo(5000 / 1600, 8);
    expect(xrp.quote).toBe(2500);
    expect(xrp.entry).toBe(1);
    expect(xrp.quote / xrp.entry).toBeCloseTo(2500, 8);
  });

  it("keeps each visitor's seed trades and only reseeds when missing or closed", () => {
    expect(demoSeedId("abc", "xrp")).toBe("demo-xrp-abc");
    expect(shouldReseedDemoTrade(undefined)).toBe(true);
    expect(shouldReseedDemoTrade("closed")).toBe(true);
    expect(shouldReseedDemoTrade("cancelled")).toBe(true);
    expect(shouldReseedDemoTrade("in_position")).toBe(false);
  });

  it("lists demo seeds BTC then ETH then XRP", () => {
    const ids = [
      "demo-xrp-abc",
      "demo-btc-abc",
      "user-1",
      "demo-eth-abc",
    ];
    ids.sort((a, b) => demoSeedListRank(a) - demoSeedListRank(b));
    expect(ids).toEqual(["demo-btc-abc", "demo-eth-abc", "demo-xrp-abc", "user-1"]);
  });

  it("splits BTC/USDT", () => {
    expect(splitPair("BTC/USDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(splitPair("ETH/USDT:USDT")).toEqual({ base: "ETH", quote: "USDT" });
  });

  it("buy limit fills when last is at or below the price", () => {
    expect(limitWouldFill("buy", 99, 100)).toBe(true);
    expect(limitWouldFill("buy", 100, 100)).toBe(true);
    expect(limitWouldFill("buy", 101, 100)).toBe(false);
  });

  it("sell limit fills when last is at or above the price", () => {
    expect(limitWouldFill("sell", 101, 100)).toBe(true);
    expect(limitWouldFill("sell", 100, 100)).toBe(true);
    expect(limitWouldFill("sell", 99, 100)).toBe(false);
  });

  it("locks quote on a buy limit and unlocks it", () => {
    const locked = lockForLimit(wallet(), "buy", 0.1, 100, "BTC", "USDT");
    expect(locked.USDT!.free).toBeCloseTo(9990);
    expect(locked.USDT!.used).toBeCloseTo(10);
    const free = unlockLimit(locked, "buy", 0.1, 100, "BTC", "USDT");
    expect(free.USDT!.free).toBeCloseTo(10000);
    expect(free.USDT!.used).toBeCloseTo(0);
  });

  it("market buy spends quote and credits base", () => {
    const next = settleFill(wallet(), "buy", 0.2, 50, "BTC", "USDT", false);
    expect(next.USDT!.free).toBeCloseTo(9990);
    expect(next.BTC!.free).toBeCloseTo(0.2);
  });

  it("limit buy fill spends the locked quote", () => {
    const locked = lockForLimit(wallet(), "buy", 1, 10, "BTC", "USDT");
    const filled = settleFill(locked, "buy", 1, 10, "BTC", "USDT", true);
    expect(filled.USDT!.used).toBeCloseTo(0);
    expect(filled.USDT!.free).toBeCloseTo(9990);
    expect(filled.BTC!.free).toBeCloseTo(1);
  });

  it("market sell spends base and credits quote", () => {
    const start = wallet({ BTC: { free: 2, used: 0 } });
    const next = settleFill(start, "sell", 1, 100, "BTC", "USDT", false);
    expect(next.BTC!.free).toBeCloseTo(1);
    expect(next.USDT!.free).toBeCloseTo(10100);
  });

  it("rejects a buy without enough quote", () => {
    expect(() =>
      settleFill(wallet(), "buy", 1000, 100, "BTC", "USDT", false),
    ).toThrow(/USDT/);
  });
});
