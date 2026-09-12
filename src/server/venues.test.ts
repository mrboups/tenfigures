import { describe, expect, it } from "vitest";
import { VENUES, VENUE_LIST, isDexVenue, isPaperVenue, publicVenues } from "./venues.ts";

describe("DEX venues", () => {
  it("lists Hyperliquid and Lighter as dex", () => {
    expect(isDexVenue("hyperliquid")).toBe(true);
    expect(isDexVenue("lighter")).toBe(true);
    expect(isDexVenue("kraken")).toBe(false);
    expect(VENUES.hyperliquid?.needsWallet).toBe(true);
    expect(VENUE_LIST.some((v) => v.id === "lighter")).toBe(true);
  });

  it("keeps paper off the live connect list", () => {
    expect(isPaperVenue("paper")).toBe(true);
    expect(isPaperVenue("binance")).toBe(false);
    expect(publicVenues(true).map((v) => v.id)).toEqual(["paper"]);
    expect(publicVenues(false).some((v) => v.id === "paper")).toBe(false);
    expect(VENUES.paper.ccxtId).toBe("binance");
  });
});
