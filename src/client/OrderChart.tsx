import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { api } from "./api.ts";
import {
  applyChartClick,
  emptyDraft,
  type ChartDraft,
  type ChartTool,
} from "../shared/chartPick.ts";
import type { Side } from "../shared/types.ts";

function IconDot() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}
function IconArrowUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}
function IconArrowDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14" />
      <path d="M19 12l-7 7-7-7" />
    </svg>
  );
}

const TFS = [
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1H" },
  { id: "4h", label: "4H" },
  { id: "1d", label: "1D" },
] as const;

type Candle = { t: number; o: number; h: number; l: number; c: number };

export function OrderChart({
  exchangeId,
  pair,
  last,
  entry,
  tp,
  sl,
  onPickPrice,
  onPickPosition,
}: {
  exchangeId: string;
  pair: string;
  last: number;
  entry: number;
  tp: number;
  sl: number;
  onPickPrice: (price: number) => void;
  onPickPosition: (p: { side: Side; entry: number; tp: number; sl: number }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lines = useRef<{ entry?: IPriceLine; tp?: IPriceLine; sl?: IPriceLine }>({});
  const toolRef = useRef<ChartTool>("click");
  const draftRef = useRef<ChartDraft>(emptyDraft());
  const pickPriceRef = useRef(onPickPrice);
  const pickPosRef = useRef(onPickPosition);
  pickPriceRef.current = onPickPrice;
  pickPosRef.current = onPickPosition;
  const [tf, setTf] = useState<(typeof TFS)[number]["id"]>("15m");
  const [tool, setTool] = useState<ChartTool>("click");
  const [draft, setDraft] = useState<ChartDraft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  toolRef.current = tool;
  draftRef.current = draft;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0a" },
        textColor: "#a3a3a3",
        fontFamily: "Inter, Segoe UI, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1a1a1a" },
        horzLines: { color: "#1a1a1a" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "#262626",
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: "#262626",
        timeVisible: true,
        rightOffset: 12,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#1fd18e",
      downColor: "#f25c6e",
      borderUpColor: "#1fd18e",
      borderDownColor: "#f25c6e",
      wickUpColor: "#1fd18e",
      wickDownColor: "#f25c6e",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const pickAt = (px: number) => {
      const curTool = toolRef.current;
      const r = applyChartClick(curTool, draftRef.current, px);
      draftRef.current = r.draft;
      setDraft(r.draft);
      if (curTool === "click" && r.draft.entry != null) {
        pickPriceRef.current(r.draft.entry);
        draftRef.current = emptyDraft();
        setDraft(emptyDraft());
        return;
      }
      if (r.done && r.draft.entry != null && r.draft.tp != null && r.draft.sl != null) {
        pickPosRef.current({
          side: curTool === "short" ? "sell" : "buy",
          entry: r.draft.entry,
          tp: r.draft.tp,
          sl: r.draft.sl,
        });
        draftRef.current = emptyDraft();
        setDraft(emptyDraft());
        setTool("click");
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!seriesRef.current) return;
      const y = e.clientY - el.getBoundingClientRect().top;
      const price = seriesRef.current.coordinateToPrice(y);
      if (price == null || !(Number(price) > 0)) return;
      pickAt(Number(price));
    };
    el.addEventListener("click", onClick, true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setDraft(emptyDraft());
        setTool("click");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      el.removeEventListener("click", onClick, true);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lines.current = {};
    };
  }, []);

  useEffect(() => {
    if (!exchangeId || !pair || !seriesRef.current) return;
    let live = true;
    setBusy(true);
    setErr("");
    api
      .candles(exchangeId, pair, tf, 300)
      .then((r) => {
        if (!live || !seriesRef.current) return;
        const rows = (r.candles as Candle[])
          .map((c) => {
            const t = c.t > 1e12 ? Math.floor(c.t / 1000) : c.t;
            return {
              time: t as UTCTimestamp,
              open: c.o,
              high: c.h,
              low: c.l,
              close: c.c,
            };
          })
          .filter((c) => c.open > 0 && c.high > 0);
        seriesRef.current.setData(rows);
        const scale = chartRef.current?.timeScale();
        scale?.fitContent();
        scale?.applyOptions({ rightOffset: 12 });
      })
      .catch((e) => {
        if (live) setErr(e instanceof Error ? e.message : "Chart failed");
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [exchangeId, pair, tf]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const showEntry = draft.entry ?? (entry > 0 ? entry : last);
    const showTp = draft.tp ?? (tp > 0 ? tp : 0);
    const showSl = draft.sl ?? (sl > 0 ? sl : 0);
    const put = (
      key: "entry" | "tp" | "sl",
      price: number,
      color: string,
      title: string,
    ) => {
      if (!(price > 0)) {
        if (lines.current[key]) {
          series.removePriceLine(lines.current[key]!);
          lines.current[key] = undefined;
        }
        return;
      }
      if (lines.current[key]) {
        lines.current[key]!.applyOptions({ price, color, title });
        return;
      }
      lines.current[key] = series.createPriceLine({
        price,
        color,
        title,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
      });
    };
    put("entry", showEntry, "#fafafa", "Entry");
    put("tp", showTp, "#1fd18e", "TP");
    put("sl", showSl, "#f25c6e", "SL");
  }, [entry, tp, sl, last, draft, pair]);

  return (
    <div className="order-chart">
      <div className="order-chart-bar">
        <div className="seg">
          {TFS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tf === t.id ? "on" : ""}
              onClick={() => setTf(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="seg order-chart-tools">
          <button
            type="button"
            className={tool === "click" ? "on" : ""}
            title="Click price"
            aria-label="Click price"
            onClick={() => {
              setTool("click");
              draftRef.current = emptyDraft();
              setDraft(emptyDraft());
            }}
          >
            <IconDot />
          </button>
          <button
            type="button"
            className={tool === "long" ? "on on-long" : ""}
            title="Long"
            aria-label="Long"
            onClick={() => {
              setTool("long");
              draftRef.current = emptyDraft();
              setDraft(emptyDraft());
            }}
          >
            <IconArrowUp />
          </button>
          <button
            type="button"
            className={tool === "short" ? "on on-short" : ""}
            title="Short"
            aria-label="Short"
            onClick={() => {
              setTool("short");
              draftRef.current = emptyDraft();
              setDraft(emptyDraft());
            }}
          >
            <IconArrowDown />
          </button>
        </div>
      </div>
      <div className="order-chart-host" ref={host} />
      {(!exchangeId || !pair) && (
        <div className="order-chart-empty">Pick a pair to load the chart.</div>
      )}
      {busy && exchangeId && pair && <div className="order-chart-empty">Loading…</div>}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
