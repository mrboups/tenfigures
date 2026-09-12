import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import {
  labelPair,
  moveStar,
  onStarsChange,
  openStarredTrade,
  readStars,
  toggleStar,
  type Star,
} from "./stars.ts";
import {
  clearIndicators,
  onIndicatorChange,
  readIndicators,
  toggleIndicator,
} from "./indicator.ts";
import { Coin, IconRefresh, IconSliders, IconStar, TfStack } from "./ui.tsx";
import type { ExchangeAccount } from "../shared/types.ts";
import {
  INDICATORS,
  emptyTfBias,
  type IndicatorId,
  type TfBias,
} from "../shared/demark.ts";

const EMPTY = emptyTfBias();

function alignedColor(frames: TfBias[]): "green" | "red" | null {
  const colors = EMPTY.map(
    (f) => frames.find((x) => x.tf === f.tf)?.color ?? null,
  );
  if (colors.some((c) => c == null) || colors.length < EMPTY.length) return null;
  const first = colors[0];
  if (first == null) return null;
  return colors.every((c) => c === first) ? first : null;
}

function chipAligned(
  ids: IndicatorId[],
  byInd: Partial<Record<IndicatorId, TfBias[]>>,
): "green" | "red" | null {
  const colors = ids.map((id) => alignedColor(byInd[id] ?? EMPTY));
  if (colors.some((c) => c == null)) return null;
  const first = colors[0];
  if (first == null) return null;
  return colors.every((c) => c === first) ? first : null;
}

function chipName(star: Star): string {
  return labelPair(star.symbol);
}

function chipExchange(star: Star, accounts: ExchangeAccount[]): string {
  const acc = accounts.find((a) => a.id === star.exchangeId);
  if (!acc) return "";
  return acc.label;
}

export function StarStrip({ go }: { go: (p: string) => void }) {
  const [stars, setStars] = useState<Star[]>(() => readStars());
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [bias, setBias] = useState<
    Record<string, Partial<Record<IndicatorId, TfBias[]>>>
  >({});
  const [busy, setBusy] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorId[]>(() => readIndicators());
  const [panel, setPanel] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragged = useRef(false);
  const tools = useRef<HTMLDivElement>(null);

  useEffect(() => onStarsChange(() => setStars(readStars())), []);
  useEffect(
    () => onIndicatorChange(() => setIndicators(readIndicators())),
    [],
  );

  useEffect(() => {
    api
      .exchanges()
      .then((r) => setAccounts(r.exchanges))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!panel) return;
    function down(e: MouseEvent) {
      if (!tools.current?.contains(e.target as Node)) setPanel(false);
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") setPanel(false);
    }
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [panel]);

  const load = useCallback(
    async (manual = false) => {
      if (!stars.length || !indicators.length) {
        setBias({});
        return;
      }
      if (manual) setBusy(true);
      try {
        const r = await api.biasMany(stars, indicators);
        const next: Record<string, Partial<Record<IndicatorId, TfBias[]>>> = {};
        for (const row of r.results) {
          next[`${row.exchangeId}:${row.symbol}`] =
            row.byIndicator ??
            (row.frames.length && indicators[0]
              ? { [indicators[0]]: row.frames }
              : {});
        }
        setBias(next);
      } catch {
        /* keep last */
      } finally {
        if (manual) setBusy(false);
      }
    },
    [stars, indicators],
  );

  useEffect(() => {
    if (!stars.length || !indicators.length) {
      setBias({});
      return;
    }
    void load(false);
    const t = setInterval(() => void load(false), 30000);
    return () => clearInterval(t);
  }, [stars, indicators, load]);

  if (!stars.length) return null;

  const labels = indicators.length
    ? indicators.map((id) => INDICATORS.find((x) => x.id === id)?.label ?? id).join(", ")
    : "None";

  function pick(id: IndicatorId) {
    setIndicators(toggleIndicator(id));
  }

  function pickNone() {
    setIndicators(clearIndicators());
  }

  return (
    <div className="star-strip">
      <div className="star-strip-list">
        {stars.map((s, i) => {
          const key = `${s.exchangeId}:${s.symbol}`;
          const byInd = bias[key] ?? {};
          const aligned = indicators.length ? chipAligned(indicators, byInd) : null;
          const name = chipName(s);
          const ex = chipExchange(s, accounts);
          return (
            <div
              key={key}
              className={`star-chip${aligned ? ` hot-${aligned}` : ""}${dragFrom === i ? " dragging" : ""}${dragOver === i && dragFrom !== i ? " drag-over" : ""}`}
              draggable
              title={ex ? `Trade ${name} · ${ex}` : `Trade ${name}`}
              onClick={() => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                openStarredTrade(s);
                go("/trade");
              }}
              onDragStart={(e) => {
                if ((e.target as HTMLElement).closest("button.star-btn")) {
                  e.preventDefault();
                  return;
                }
                dragged.current = false;
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOver(i);
              }}
              onDragLeave={() => {
                setDragOver((cur) => (cur === i ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragFrom ?? Number(e.dataTransfer.getData("text/plain"));
                dragged.current = from !== i;
                setStars(moveStar(from, i));
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
            >
              <button
                type="button"
                className="star-btn on"
                title="Unstar"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleStar(s.exchangeId, s.symbol);
                }}
              >
                <IconStar on />
              </button>
              <span className="star-pair-block">
                <span className="star-pair-line">
                  <Coin symbol={labelPair(s.symbol).split("/")[0] ?? s.symbol} />
                  <span className={`star-pair${aligned ? ` hot-${aligned}` : ""}`}>{name}</span>
                </span>
                {ex ? <span className="star-ex">{ex}</span> : null}
                {indicators.length > 0 && (
                  <TfStack
                    compact
                    rows={indicators.map((id) => ({
                      id,
                      frames: byInd[id] ?? EMPTY,
                    }))}
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="star-tools" ref={tools}>
        <button
          type="button"
          className={`icon-btn star-refresh${panel ? " on" : ""}`}
          title={`Indicators: ${labels}`}
          aria-expanded={panel}
          aria-haspopup="listbox"
          onClick={() => setPanel((v) => !v)}
        >
          <IconSliders />
        </button>
        {panel && (
          <div
            className="indi-panel"
            role="listbox"
            aria-multiselectable="true"
            aria-label="Indicators"
          >
            <div className="indi-head">Indicators — none, one, or more</div>
            <button
              type="button"
              role="option"
              aria-selected={indicators.length === 0}
              className={indicators.length === 0 ? "on" : ""}
              onClick={pickNone}
            >
              <span className="indi-name">None</span>
              <span className="indi-hint">Ticker and exchange only</span>
            </button>
            {INDICATORS.map((item) => {
              const on = indicators.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={on ? "on" : ""}
                  onClick={() => pick(item.id)}
                >
                  <span className="indi-name">{item.label}</span>
                  <span className="indi-hint">{item.hint}</span>
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          className={`icon-btn star-refresh${busy ? " spin" : ""}`}
          title="Refresh"
          disabled={busy}
          onClick={() => void load(true)}
        >
          <IconRefresh />
        </button>
      </div>
    </div>
  );
}
