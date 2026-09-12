import { describe, expect, it } from "vitest";
import { nearestApproach } from "./viz.ts";

describe("nearestApproach", () => {
  it("marks how close a long got to TP and SL after price came back", () => {
    const hits = nearestApproach({
      side: "buy",
      entry: 100,
      last: 103,
      peak: 108,
      trough: 97,
      tp: 110,
      sl: 95,
    });
    expect(hits).toEqual([
      { kind: "tp", price: 108 },
      { kind: "sl", price: 97 },
    ]);
  });

  it("hides the mark when last is already the extreme", () => {
    expect(
      nearestApproach({
        side: "buy",
        entry: 100,
        last: 108,
        peak: 108,
        trough: 100,
        tp: 110,
        sl: 95,
      }),
    ).toEqual([]);
  });

  it("skips a target that was reached", () => {
    expect(
      nearestApproach({
        side: "buy",
        entry: 100,
        last: 104,
        peak: 110,
        trough: 100,
        tp: 110,
        sl: 95,
      }),
    ).toEqual([]);
  });

  it("marks a short the other way", () => {
    const hits = nearestApproach({
      side: "sell",
      entry: 100,
      last: 97,
      peak: 103,
      trough: 92,
      tp: 90,
      sl: 105,
    });
    expect(hits).toEqual([
      { kind: "tp", price: 92 },
      { kind: "sl", price: 103 },
    ]);
  });

  it("marks how close a buy limit got before bouncing", () => {
    expect(
      nearestApproach({
        side: "buy",
        entry: 95,
        last: 100,
        peak: 101,
        trough: 96,
        tp: null,
        sl: null,
        pendingEntry: true,
      }),
    ).toEqual([{ kind: "entry", price: 96 }]);
  });
});
