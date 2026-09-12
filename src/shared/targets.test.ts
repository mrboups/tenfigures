import { describe, expect, it } from "vitest";
import { allocatedPct, availablePct, parseTpTargets, reorientTargets } from "./targets.ts";

describe("tp targets", () => {
  it("parses and sums open quantity", () => {
    const list = parseTpTargets(
      JSON.stringify([
        { id: "a", price: "1.1", percent: "10", qtyPct: 25, orderId: null, filled: false },
        { id: "b", price: "1.2", percent: "20", qtyPct: 50, orderId: null, filled: true },
      ]),
    );
    expect(list).toHaveLength(2);
    expect(allocatedPct(list)).toBe(25);
    expect(availablePct(list)).toBe(75);
  });

  it("reorients split targets to the signal side", () => {
    const src = parseTpTargets(
      JSON.stringify([
        { id: "a", price: "110", percent: "10", qtyPct: 40, orderId: "x", filled: false },
      ]),
    );
    const long = reorientTargets("buy", 200, src, 100);
    expect(Number(long[0]!.price)).toBeCloseTo(220, 10);
    expect(long[0]!.percent).toBe("10");
    expect(long[0]!.orderId).toBeNull();
    const short = reorientTargets("sell", 200, src, 100);
    expect(Number(short[0]!.price)).toBeCloseTo(180, 10);
    expect(short[0]!.percent).toBe("-10");
  });
});
