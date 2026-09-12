import { describe, expect, it } from "vitest";
import {
  alignedTfColor,
  biasFromCandles,
  DEFAULT_INDICATOR,
  donchianBias,
  donchianTrend,
  fromEndsBias,
  lastCrossBias,
  mfi,
  parseIndicators,
  signalSide,
  tdpr,
  type Candle,
  type TfBias,
} from "./demark.ts";

function bar(c: number, side: "up" | "down" | "doji", v = 10): Candle {
  if (side === "doji") return { o: c, h: c + 1, l: c - 1, c, v };
  if (side === "up") return { o: c - 1, h: c + 1, l: c - 1, c: c + 1, v };
  return { o: c + 1, h: c + 1, l: c - 1, c: c - 1, v };
}

function series(n: number, side: "up" | "down" | "doji", start = 50): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = side === "down" ? start - i : start + i;
    out.push(bar(c, side));
  }
  return out;
}

describe("mfi", () => {
  it("prints 100 when typical price only rises", () => {
    const vals = mfi(series(30, "up"));
    expect(vals[vals.length - 1]).toBe(100);
  });

  it("prints 0 when typical price only falls", () => {
    const vals = mfi(series(30, "down"));
    expect(vals[vals.length - 1]).toBe(0);
  });
});

describe("tdpr", () => {
  it("prints 100 on a window of full-range up candles", () => {
    const vals = tdpr(series(25, "up"));
    expect(vals[vals.length - 1]).toBe(100);
  });

  it("prints 0 on a window of full-range down candles", () => {
    const vals = tdpr(series(25, "down"));
    expect(vals[vals.length - 1]).toBe(0);
  });

  it("prints 50 when every bar is a doji", () => {
    const vals = tdpr(series(25, "doji"));
    expect(vals[vals.length - 1]).toBe(50);
  });

  it("uses len+1 bars (Pine for i = 0 to len)", () => {
    const candles = [bar(50, "up"), ...series(20, "doji")];
    expect(tdpr(candles, 20)[candles.length - 1]).toBe(100);
  });
});

describe("lastCrossBias", () => {
  it("is green after MF crosses up through TDPR", () => {
    expect(lastCrossBias([10, 20, 40, 60, 70], [50, 50, 50, 50, 50])).toBe(
      "green",
    );
  });

  it("is red after MF crosses down through TDPR", () => {
    expect(lastCrossBias([90, 80, 60, 40, 30], [50, 50, 50, 50, 50])).toBe(
      "red",
    );
  });

  it("keeps the latest cross when both happen", () => {
    expect(lastCrossBias([10, 60, 40, 70], [50, 50, 50, 50])).toBe("green");
    expect(lastCrossBias([90, 40, 60, 30], [50, 50, 50, 50])).toBe("red");
  });

  it("falls back to MF vs TDPR when they never crossed", () => {
    expect(lastCrossBias([80, 80, 80], [50, 50, 50])).toBe("green");
    expect(lastCrossBias([20, 20, 20], [50, 50, 50])).toBe("red");
    expect(lastCrossBias([0, 0, 0], [0, 0, 0])).toBe("red");
    expect(lastCrossBias([100, 100], [100, 100])).toBe("green");
  });
});

describe("fromEndsBias", () => {
  it("is green after a more recent print at or below 25", () => {
    expect(fromEndsBias([80, 70, 20, 40, 50])).toBe("green");
  });

  it("is red after a more recent print at or above 75", () => {
    expect(fromEndsBias([20, 30, 80, 60, 55])).toBe("red");
  });
});

describe("biasFromCandles", () => {
  it("TDPR from-ends is red after a long run of up candles (from the top)", () => {
    expect(biasFromCandles(series(40, "up"))).toBe("red");
  });

  it("TDPR from-ends is green after a long run of down candles (from the bottom)", () => {
    expect(biasFromCandles(series(40, "down"))).toBe("green");
  });

  it("TDPR cross is green on a long run of up candles", () => {
    expect(biasFromCandles(series(40, "up"), "tdpr-cross")).toBe("green");
  });

  it("TDPR cross is red on a long run of down candles", () => {
    expect(biasFromCandles(series(40, "down"), "tdpr-cross")).toBe("red");
  });

  it("returns null without enough history", () => {
    expect(biasFromCandles(series(5, "up"))).toBeNull();
  });

  it("Donchian is green after a break above the prior channel", () => {
    expect(biasFromCandles(series(40, "up"), "donchian")).toBe("green");
  });

  it("Donchian is red after a break below the prior channel", () => {
    expect(biasFromCandles(series(40, "down"), "donchian")).toBe("red");
  });
});

describe("donchianTrend", () => {
  it("keeps the last flip until the other side breaks", () => {
    const up = series(25, "up", 50);
    const t = donchianTrend(up, 20);
    expect(t[t.length - 1]).toBe(1);
    expect(donchianBias(up, 20)).toBe("green");
    const down = series(25, "down", 80);
    expect(donchianTrend(down, 20)[down.length - 1]).toBe(-1);
    expect(donchianBias(down, 20)).toBe("red");
  });
});

describe("parseIndicators", () => {
  it("wraps a single id and drops junk", () => {
    expect(parseIndicators("tdpr")).toEqual(["tdpr"]);
    expect(parseIndicators(["donchian", "nope", "tdpr"])).toEqual(["tdpr", "donchian"]);
  });

  it("keeps catalog order and defaults when empty", () => {
    expect(parseIndicators(["donchian", "tdpr-cross"])).toEqual(["tdpr-cross", "donchian"]);
    expect(parseIndicators([])).toEqual([DEFAULT_INDICATOR]);
    expect(parseIndicators('["donchian","tdpr"]')).toEqual(["tdpr", "donchian"]);
  });
});

function frames(colors: Array<"green" | "red" | null>): TfBias[] {
  const ids = ["1D", "4H", "1H", "15M", "5M"] as const;
  return ids.map((tf, i) => ({ tf, color: colors[i] ?? null }));
}

describe("signalSide", () => {
  it("is buy when every timeframe is green", () => {
    expect(alignedTfColor(frames(["green", "green", "green", "green", "green"]))).toBe("green");
    expect(signalSide(frames(["green", "green", "green", "green", "green"]))).toBe("buy");
  });

  it("is sell when every timeframe is red", () => {
    expect(signalSide(frames(["red", "red", "red", "red", "red"]))).toBe("sell");
  });

  it("waits when a timeframe is missing or mixed", () => {
    expect(signalSide(frames(["green", "green", "green", "green", null]))).toBeNull();
    expect(signalSide(frames(["green", "green", "red", "green", "green"]))).toBeNull();
  });
});
