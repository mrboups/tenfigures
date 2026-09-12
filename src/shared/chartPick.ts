export type ChartTool = "click" | "long" | "short";

export type ChartDraft = {
  entry: number | null;
  tp: number | null;
  sl: number | null;
};

export function emptyDraft(): ChartDraft {
  return { entry: null, tp: null, sl: null };
}

/** Assign a click to TP or SL from which side of entry it landed. */
export function applyChartClick(
  tool: ChartTool,
  draft: ChartDraft,
  price: number,
): { draft: ChartDraft; done: boolean } {
  if (!(price > 0)) return { draft, done: false };
  if (tool === "click") {
    return { draft: { entry: price, tp: null, sl: null }, done: true };
  }
  const long = tool === "long";
  if (draft.entry == null) {
    return { draft: { entry: price, tp: null, sl: null }, done: false };
  }
  const entry = draft.entry;
  const above = price > entry;
  const next = { ...draft };
  if (long) {
    if (above) next.tp = price;
    else next.sl = price;
  } else if (above) next.sl = price;
  else next.tp = price;
  const done = next.tp != null && next.sl != null;
  return { draft: next, done };
}

export function chartHint(tool: ChartTool, draft: ChartDraft): string {
  if (tool === "click") return "Click the chart to set the order price";
  const side = tool === "long" ? "Long" : "Short";
  if (draft.entry == null) return `${side}: click entry`;
  if (tool === "long") {
    if (draft.tp == null && draft.sl == null)
      return "Click above for take-profit, below for stop-loss";
    if (draft.tp == null) return "Click above entry for take-profit";
    return "Click below entry for stop-loss";
  }
  if (draft.tp == null && draft.sl == null)
    return "Click below for take-profit, above for stop-loss";
  if (draft.tp == null) return "Click below entry for take-profit";
  return "Click above entry for stop-loss";
}
