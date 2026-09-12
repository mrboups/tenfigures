import { describe, expect, it } from "vitest";
import { allowedLeverageSteps, marketTypeLabel, PANEL_MAX_LEVERAGE } from "../shared/types.ts";
import { friendlyExchangeError } from "./errors.ts";
import { baseAmountFromPosition, marketTypeOf, samePair } from "./exchanges.ts";

describe("friendlyExchangeError", () => {
  it("explains Kraken permission denied", () => {
    const msg = friendlyExchangeError(
      "kraken",
      new Error('kraken {"error":["EGeneral:Permission denied"]}'),
    );
    expect(msg).toMatch(/Query Funds/);
    expect(msg).not.toMatch(/EGeneral/);
    const withIp = friendlyExchangeError(
      "kraken",
      new Error('kraken {"error":["EGeneral:Permission denied"]}'),
      "208.77.244.33",
    );
    expect(withIp).toMatch(/208\.77\.244\.33/);
  });
});

describe("market type", () => {
  it("labels swap as futures", () => {
    expect(marketTypeLabel("swap")).toBe("futures");
    expect(marketTypeLabel("spot")).toBe("spot");
    expect(marketTypeOf({ market_type: "swap" })).toBe("swap");
    expect(marketTypeOf({ market_type: "spot" })).toBe("spot");
    expect(marketTypeOf({})).toBe("spot");
  });

  it("converts contracts to base amount", () => {
    expect(baseAmountFromPosition({ contracts: 2.5, contractSize: 1 })).toBe(2.5);
    expect(baseAmountFromPosition({ contracts: 10, contractSize: 0.01 })).toBe(0.1);
    expect(baseAmountFromPosition({ contracts: -4, contractSize: 1 })).toBe(4);
    expect(baseAmountFromPosition({ contracts: 3 })).toBe(3);
    expect(baseAmountFromPosition({ info: { size: 82 } })).toBe(82);
  });

  it("matches futures pair ids with and without settle suffix", () => {
    expect(samePair("MORPHO/USD:USD", "MORPHO/USD")).toBe(true);
    expect(samePair("MORPHO/USD:USD", "MORPHO/USD:USD")).toBe(true);
    expect(samePair("ETH/USDT", "BTC/USDT")).toBe(false);
  });

  it("keeps only allowed leverage steps", () => {
    expect(allowedLeverageSteps(50)).toEqual([2, 3, 4, 5, 10, 25, 50]);
    expect(allowedLeverageSteps(20)).toEqual([2, 3, 4, 5, 10]);
    expect(allowedLeverageSteps(PANEL_MAX_LEVERAGE)).toEqual([2, 3, 4, 5, 10]);
    expect(allowedLeverageSteps(5)).toEqual([2, 3, 4, 5]);
    expect(allowedLeverageSteps(3)).toEqual([2, 3]);
  });
});
