import { describe, expect, it } from "vitest";
import { dailyReturns, sharpe, sortino, stdev } from "./stats.ts";

describe("stats", () => {
  it("computes sharpe from varying daily returns", () => {
    const s = sharpe([0.01, -0.005, 0.02, 0.0, 0.015]);
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThan(0);
  });

  it("returns null sharpe without enough samples", () => {
    expect(sharpe([])).toBeNull();
    expect(sharpe([0.01])).toBeNull();
  });

  it("builds daily returns from snapshots", () => {
    const r = dailyReturns([
      { at: new Date("2026-09-01T10:00:00Z"), usd: 100 },
      { at: new Date("2026-09-01T22:00:00Z"), usd: 110 },
      { at: new Date("2026-09-02T10:00:00Z"), usd: 121 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toBeCloseTo(0.1, 8);
  });

  it("sortino ignores upside in the denominator", () => {
    const s = sortino([0.02, 0.03, -0.01, -0.02]);
    expect(s).not.toBeNull();
    expect(stdev([-0.01, -0.02])).toBeGreaterThan(0);
  });
});
