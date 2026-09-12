import { describe, expect, it } from "vitest";
import {
  parsePendingAdds,
  pendingAddNotional,
  stringifyPendingAdds,
} from "./adds.ts";
import { mergeFill } from "./money.ts";

describe("pending adds", () => {
  it("parses waiting limits and sums leftover notional", () => {
    const list = parsePendingAdds(
      JSON.stringify([
        { id: "a", price: "2", baseAmount: "10", quoteAmount: "20", orderId: "o1", filled: false },
        { id: "b", price: "3", baseAmount: "5", quoteAmount: "15", orderId: "o2", filled: true },
      ]),
    );
    expect(list).toHaveLength(2);
    expect(pendingAddNotional(list)).toBe(20);
    expect(stringifyPendingAdds(list)?.includes("o1")).toBe(true);
  });
});

describe("mergeFill", () => {
  it("averages a scale-in onto the open size", () => {
    const m = mergeFill(10, 100, 10, 120);
    expect(m.amount).toBe(20);
    expect(m.price).toBe(110);
  });

  it("uses the fill as entry when nothing is open yet", () => {
    const m = mergeFill(0, 0, 5, 2.5);
    expect(m.amount).toBe(5);
    expect(m.price).toBe(2.5);
  });
});
