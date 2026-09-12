import type { VenueId, VenueInfo } from "../shared/types.ts";

export const VENUES: Record<VenueId, VenueInfo> = {
  binance: {
    id: "binance",
    name: "Binance",
    ccxtId: "binance",
    needsPassphrase: false,
  },
  mexc: {
    id: "mexc",
    name: "MEXC",
    ccxtId: "mexc",
    needsPassphrase: false,
  },
  gate: {
    id: "gate",
    name: "Gate.io",
    ccxtId: "gate",
    needsPassphrase: false,
  },
  bitget: {
    id: "bitget",
    name: "Bitget",
    ccxtId: "bitget",
    needsPassphrase: true,
  },
  bybit: {
    id: "bybit",
    name: "Bybit",
    ccxtId: "bybit",
    needsPassphrase: false,
  },
  kraken: {
    id: "kraken",
    name: "Kraken",
    ccxtId: "kraken",
    needsPassphrase: false,
  },
  hyperliquid: {
    id: "hyperliquid",
    name: "Hyperliquid",
    ccxtId: "hyperliquid",
    needsPassphrase: false,
    dex: true,
    needsWallet: true,
  },
  lighter: {
    id: "lighter",
    name: "Lighter",
    ccxtId: "lighter",
    needsPassphrase: false,
    dex: true,
    needsWallet: false,
  },
  paper: {
    id: "paper",
    name: "Demo Account",
    ccxtId: "binance",
    needsPassphrase: false,
  },
};

export const VENUE_LIST: VenueInfo[] = Object.values(VENUES);

export function isDexVenue(venue: VenueId | string): boolean {
  return Boolean(VENUES[venue as VenueId]?.dex);
}

export function isPaperVenue(venue: VenueId | string): boolean {
  return venue === "paper";
}

export function publicVenues(demo: boolean): VenueInfo[] {
  if (demo) return [VENUES.paper];
  return VENUE_LIST.filter((v) => v.id !== "paper");
}
