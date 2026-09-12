import { describe, expect, it } from "vitest";
import { applyChartClick, chartHint, emptyDraft } from "./chartPick.ts";

describe("applyChartClick", () => {
  it("click tool finishes on the first price", () => {
    const r = applyChartClick("click", emptyDraft(), 2.5);
    expect(r.done).toBe(true);
    expect(r.draft.entry).toBe(2.5);
  });

  it("ignores non-positive prices", () => {
    const r = applyChartClick("click", emptyDraft(), 0);
    expect(r.done).toBe(false);
    expect(r.draft.entry).toBeNull();
  });

  it("long tool maps above to TP and below to SL", () => {
    let r = applyChartClick("long", emptyDraft(), 100);
    expect(r.done).toBe(false);
    r = applyChartClick("long", r.draft, 110);
    expect(r.draft.tp).toBe(110);
    expect(r.done).toBe(false);
    r = applyChartClick("long", r.draft, 90);
    expect(r.draft.sl).toBe(90);
    expect(r.done).toBe(true);
  });

  it("short tool maps below to TP and above to SL", () => {
    let r = applyChartClick("short", emptyDraft(), 100);
    r = applyChartClick("short", r.draft, 88);
    r = applyChartClick("short", r.draft, 112);
    expect(r.done).toBe(true);
    expect(r.draft).toEqual({ entry: 100, tp: 88, sl: 112 });
  });
});

describe("chartHint", () => {
  it("tells the next click for a long", () => {
    expect(chartHint("click", emptyDraft())).toMatch(/order price/i);
    expect(chartHint("long", emptyDraft())).toBe("Long: click entry");
    expect(chartHint("long", { entry: 100, tp: null, sl: null })).toMatch(/above for take-profit/i);
    expect(chartHint("short", { entry: 100, tp: 88, sl: null })).toMatch(/above entry for stop-loss/i);
  });
});
