import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { Coin, IconChart, IconNote, IconRefresh, IconShare, PnlEst, Seg, Toggle } from "../ui.tsx";
import { SplitTargetsModal } from "../SplitTargets.tsx";
import type { TpTarget } from "../../shared/types.ts";
import {
  formatCompactUsd,
  formatNum,
  formatSignedQuote,
  leftoverAddNotional,
  percentFromPrices,
  pnl,
  priceFromPercent,
} from "../../shared/money.ts";
import type { BalanceInfo, SmartTrade, TradeStep } from "../../shared/types.ts";
import { INDICATORS } from "../../shared/demark.ts";
import { nearestApproach } from "../../shared/viz.ts";
import { pendingAddNotional } from "../../shared/adds.ts";
import { playClosed, playFilled, unlockTradeAlerts } from "../tradeAlert.ts";

function n(v: string | null | undefined): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** 0 is a real distance (entry / breakeven). Empty or incomplete typing is ignored. */
function distNum(v: string): number | null {
  const t = v.trim();
  if (t === "" || t === "." || t === "-" || t === "+") return null;
  const x = Number(t);
  return Number.isFinite(x) && x >= 0 ? x : null;
}

function fmt(v: string | number | null | undefined, d = 8): string {
  const x = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(x)) return "—";
  return formatNum(x, d);
}

function fmtDate(iso: string): { d: string; t: string } {
  const dt = new Date(iso);
  return {
    d: dt.toLocaleDateString(),
    t: dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

function marginLabel(mode: string | null | undefined): string {
  if (mode === "cross") return "Cross";
  if (mode === "isolated") return "Isolated";
  return mode ?? "";
}

function isFuturesTrade(t: SmartTrade): boolean {
  return t.leverage != null || t.marginMode != null;
}

function priceStep(p: number): number {
  if (!(p > 0)) return 0.001;
  return 10 ** (Math.floor(Math.log10(p)) - 3);
}

function MarkEdit({
  value,
  side,
  entry,
  amount,
  quote,
  onSave,
  onCancel,
}: {
  value: number;
  side: "buy" | "sell";
  entry: number;
  amount: number;
  quote: string;
  onSave: (v: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(fmt(value, 5));
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const step = priceStep(n(raw) || value);
  const px = n(raw) || value;
  const quotePnl =
    entry > 0 && px > 0 && amount > 0 ? pnl(side, entry, px, amount).quote : 0;

  useEffect(() => {
    function down(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) onCancel();
    }
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [onCancel]);

  function bump(dir: number) {
    const cur = n(raw) || value;
    setRaw(fmt(Math.max(0, cur + dir * step), 8));
  }

  async function save() {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || busy) return;
    setBusy(true);
    try {
      await onSave(v);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span
      ref={wrap}
      className="mark-edit"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" disabled={busy} onClick={() => bump(-1)}>
        −
      </button>
      <input
        className="mono"
        value={raw}
        disabled={busy}
        autoFocus
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" disabled={busy} onClick={() => bump(1)}>
        +
      </button>
      <button type="button" className="save" disabled={busy} onClick={() => void save()}>
        {busy ? "…" : "Save"}
      </button>
      {entry > 0 && px > 0 && amount > 0 && (
        <span className={`mark-pnl${quotePnl >= 0 ? " green" : " red"}`}>
          {formatCompactUsd(quotePnl)}
        </span>
      )}
    </span>
  );
}

function isColdStart(t: SmartTrade): boolean {
  return t.status === "cold_start";
}

function isSignalWait(t: SmartTrade): boolean {
  return t.status === "cold_start" && t.entryType === "signal";
}

function signalLabel(t: SmartTrade): string {
  return INDICATORS.find((x) => x.id === t.signalIndicator)?.label ?? "Signal";
}

function protectLabel(
  tag: string,
  price: number,
  side: "buy" | "sell",
  entry: number,
  amount: number,
  quote: string,
): string {
  if (!(entry > 0) || !(amount > 0) || !(price > 0)) return `${tag} ${fmt(price, 5)}`;
  return `${tag} ${fmt(price, 5)} (${formatCompactUsd(pnl(side, entry, price, amount).quote)})`;
}

function isPendingEntry(t: SmartTrade): boolean {
  return t.status === "entry_pending" || t.status === "waiting_trigger";
}

function StatusBar({
  trade,
  onSaved,
  onFire,
  readOnly,
}: {
  trade: SmartTrade;
  onSaved: () => Promise<void>;
  onFire?: () => void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState<"tp" | "sl" | null>(null);
  const entry = n(trade.entryFilledPrice ?? trade.entryPrice);
  const last = n(trade.lastPrice) || entry;
  const tp = n(trade.tpPrice);
  const sl = n(trade.slPrice);
  const liq = n(trade.liquidationPrice);
  const held = n(trade.entryFilledAmount ?? trade.amount);
  const qty =
    n(trade.protectAmount) > 0 && n(trade.protectAmount) < held
      ? n(trade.protectAmount)
      : held;
  const tps = (trade.tpTargets ?? []).filter((t) => !t.filled && n(t.price) > 0);
  const pending = isPendingEntry(trade);
  const approaches = nearestApproach({
    side: trade.side,
    entry,
    last,
    peak: n(trade.peakPrice) || null,
    trough: n(trade.troughPrice) || null,
    tp: (() => {
      if (tps.length) {
        const prices = tps.map((t) => n(t.price)).filter((p) => p > 0);
        if (!prices.length) return tp > 0 ? tp : null;
        return trade.side === "buy" ? Math.min(...prices) : Math.max(...prices);
      }
      return tp > 0 ? tp : null;
    })(),
    sl: sl > 0 ? sl : null,
    pendingEntry: pending || isColdStart(trade),
  });
  const focus = [
    entry,
    last,
    sl,
    tp,
    ...tps.map((t) => n(t.price)),
    ...approaches.map((a) => a.price),
  ].filter((x) => x > 0);
  let min = Math.min(...focus, last);
  let max = Math.max(...focus, last);
  const core = max - min || Math.abs(last) * 0.01 || 1;
  const liqOnBar =
    liq > 0 && liq >= min - core * 1.15 && liq <= max + core * 1.15;
  if (liqOnBar) {
    min = Math.min(min, liq);
    max = Math.max(max, liq);
  }
  const pad = (max - min) * 0.06 || last * 0.001;
  min -= pad;
  max += pad;
  const span = max - min || 1;
  const xOf = (v: number) => ((v - min) / span) * 100;
  const cropLow = liq > 0 && !liqOnBar && liq < min;
  const cropHigh = liq > 0 && !liqOnBar && liq > max;
  const up = last >= entry;
  const width = (Math.abs(last - entry) / span) * 100;
  const left = ((Math.min(entry, last) - min) / span) * 100;
  const change = entry ? ((last - entry) / entry) * 100 * (trade.side === "sell" ? -1 : 1) : 0;

  const marks: { p: number; kind: string; label: string; above?: boolean; tip?: string }[] = [];
  if (liqOnBar) marks.push({ p: liq, kind: "liq", label: `Liq ${fmt(liq, 5)}` });
  if (sl > 0)
    marks.push({
      p: sl,
      kind: "sl",
      label: protectLabel("SL", sl, trade.side, entry, qty, trade.quote),
    });
  if (entry > 0) {
    marks.push({
      p: entry,
      kind: isColdStart(trade) ? "cold" : "entry",
      label: isSignalWait(trade)
        ? `Signal ${fmt(entry, 5)}`
        : isColdStart(trade)
          ? `Cold ${fmt(entry, 5)}`
          : `${trade.side === "buy" ? "Buy" : "Sell"} ${fmt(entry, 5)}`,
    });
  }
  if (tps.length) {
    tps.forEach((t, i) => {
      const p = n(t.price);
      const slice = qty * (t.qtyPct / 100);
      marks.push({
        p,
        kind: "tp",
        label: protectLabel(
          tps.length > 1 ? `TP${i + 1}` : "TP",
          p,
          trade.side,
          entry,
          slice > 0 ? slice : qty,
          trade.quote,
        ),
      });
    });
  } else if (tp > 0) {
    marks.push({
      p: tp,
      kind: "tp",
      label: protectLabel("TP", tp, trade.side, entry, qty, trade.quote),
    });
  }
  for (const a of approaches) {
    const tag =
      a.kind === "tp" ? "Near TP" : a.kind === "sl" ? "Near SL" : "Near";
    marks.push({
      p: a.price,
      kind: `miss miss-${a.kind}`,
      label: "",
      tip: `${tag} ${fmt(a.price, 5)}`,
      above: true,
    });
  }
  if (last > 0) {
    marks.push({
      p: last,
      kind: pending ? "last pending" : change >= 0 ? "last up" : "last down",
      label: fmt(last, 5),
      above: true,
    });
  }

  async function saveLevel(kind: "tp" | "sl", price: number) {
    const nextTp = kind === "tp" ? price : n(trade.tpPrice);
    const nextSl = kind === "sl" ? price : n(trade.slPrice);
    const tpOn = nextTp > 0;
    const slOn = nextSl > 0;
    await api.setProtect(trade.id, {
      tpEnabled: tpOn,
      tpType: tpOn ? trade.tpType ?? "market" : null,
      tpPrice: tpOn ? fmt(nextTp, 8) : null,
      tpPercent: tpOn && entry ? String(percentFromPrices(entry, nextTp)) : null,
      tpTargets: trade.tpTargets,
      slEnabled: slOn,
      slType: slOn ? trade.slType ?? "cond_market" : null,
      slPrice: slOn ? fmt(nextSl, 8) : null,
      slPercent: slOn && entry ? String(percentFromPrices(entry, nextSl)) : null,
      exitAmount: trade.protectAmount,
      tpReduceOnly: trade.tpReduceOnly !== false,
      slReduceOnly: trade.slReduceOnly !== false,
    });
    setEditing(null);
    await onSaved();
  }

  return (
    <div className="status-viz">
      {isColdStart(trade) && onFire && !readOnly && (
        <button
          type="button"
          className="fire-up"
          onClick={(e) => {
            e.stopPropagation();
            onFire();
          }}
        >
          Fire up
        </button>
      )}
      <div
        className={`status-bar${cropLow ? " crop-low" : ""}${cropHigh ? " crop-high" : ""}${liq > 0 && trade.side === "sell" ? " liq-right" : ""}`}
      >
        {liq > 0 && trade.side !== "sell" && (
          <div className="liq-flag" title={`Liquidation ${fmt(liq, 5)}`}>
            Liq {fmt(liq, 5)}
          </div>
        )}
        <div className="status-scale">
        <div className="track">
          <div
            className="fill"
            style={{
              width: `${width}%`,
              marginLeft: `${left}%`,
              background: pending
                ? "var(--dim)"
                : up && trade.side === "buy"
                  ? "var(--green)"
                  : "var(--red)",
            }}
          />
        </div>
        {marks.map((m) => {
          const x = xOf(m.p);
          const xEntry = entry > 0 ? xOf(entry) : -999;
          const xTp = tp > 0 ? xOf(tp) : -999;
          const tpNearEntry = tp > 0 && entry > 0 && Math.abs(xTp - xEntry) < 18;
          let edge: "start" | "end" | "mid" =
            x <= 8 ? "start" : x >= 92 ? "end" : "mid";
          if (m.kind === "tp") {
            edge =
              x >= 98
                ? "end"
                : tpNearEntry && xTp < xEntry
                  ? "end"
                  : "start";
          }
          if ((m.kind === "entry" || m.kind === "cold") && tpNearEntry) {
            edge = x <= 8 ? "start" : xTp >= xEntry ? "end" : "start";
          }
          const level =
            !readOnly && (m.kind === "sl" || (m.kind === "tp" && tps.length <= 1))
              ? m.kind
              : null;
          const live = level != null && editing === level;
          return (
            <div
              key={`${m.kind}-${m.p}-${m.above ? "a" : "b"}`}
              className={`mark ${m.kind}${m.above ? " above" : ""} edge-${edge}${live ? " editing" : ""}`}
              style={{ left: `${x}%` }}
              title={m.tip ?? (level ? `Edit ${m.label}` : m.label)}
            >
              <i className="tick" />
              {live ? (
                <MarkEdit
                  value={m.p}
                  side={trade.side}
                  entry={entry}
                  amount={qty}
                  quote={trade.quote}
                  onSave={(v) => saveLevel(level, v)}
                  onCancel={() => setEditing(null)}
                />
              ) : m.label ? (
                <span
                  className={`mark-lab${level ? " edit" : ""}`}
                  onClick={
                    level
                      ? (e) => {
                          e.stopPropagation();
                          setEditing(level);
                        }
                      : undefined
                  }
                >
                  {m.label}
                </span>
              ) : null}
            </div>
          );
        })}
        </div>
        {liq > 0 && trade.side === "sell" && (
          <div className="liq-flag" title={`Liquidation ${fmt(liq, 5)}`}>
            Liq {fmt(liq, 5)}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryStatus({ trade }: { trade: SmartTrade }) {
  const pct = n(trade.pnlPercent);
  if (trade.closedReason === "detached" || (trade.status === "cancelled" && !trade.closedReason)) {
    return (
      <div>
        <div className="red">✕ Cancelled</div>
        <div className="muted">Creation date {new Date(trade.createdAt).toLocaleString()}</div>
      </div>
    );
  }
  if (trade.closedReason === "manual") {
    return (
      <div>
        <div className={pct >= 0 ? "green" : "red"}>
          ✓ Closed at Market Price: {pct.toFixed(2)}%
        </div>
        <div className="muted">Creation date {new Date(trade.createdAt).toLocaleString()}</div>
      </div>
    );
  }
  const label =
    trade.closedReason === "tp"
      ? "Finished"
      : trade.closedReason === "sl"
        ? "Stop loss"
        : "Finished";
  return (
    <div>
      <div className={pct >= 0 ? "green" : "red"}>
        ✓ {label}: {pct.toFixed(2)}%
      </div>
      <div className="muted">Creation date {new Date(trade.createdAt).toLocaleString()}</div>
    </div>
  );
}

function FundsModal({
  kind,
  trade,
  balance,
  last,
  onClose,
  onSave,
}: {
  kind: "add" | "reduce";
  trade: SmartTrade;
  balance: BalanceInfo | null;
  last: number;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const quoteFree = balance?.byAsset[trade.quote]?.free ?? 0;
  const held = n(trade.entryFilledAmount ?? trade.amount);
  const futures = isFuturesTrade(trade);
  const lev = futures ? Math.max(1, trade.leverage ?? 1) : 1;
  const programmed = isColdStart(trade) || isPendingEntry(trade);
  const plannedPx = n(trade.entryPrice) || last;
  const reservedOnExchange =
    trade.status === "entry_pending" && Boolean(trade.entryOrderId);
  const addCap = leftoverAddNotional({
    quoteFree,
    plannedBase: programmed ? held : 0,
    price: plannedPx,
    leverage: lev,
    futures,
    reservedOnExchange,
    extraNotional: pendingAddNotional(trade.pendingAdds ?? []),
  });
  const addCapacity = programmed ? addCap.addNotional : quoteFree * lev;
  const [pct, setPct] = useState(10);
  const [type, setType] = useState<"market" | "limit">("market");
  const [price, setPrice] = useState(String(last || ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const px = type === "limit" ? n(price) : last;
  const quoteAmt = kind === "add" ? (addCapacity * pct) / 100 : held * px * (pct / 100);
  const baseAmt = kind === "add" ? (px > 0 ? quoteAmt / px : 0) : (held * pct) / 100;
  const title =
    kind === "add"
      ? futures
        ? "Add position"
        : "Add funds"
      : futures
        ? "Reduce position"
        : "Reduce funds";

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (kind === "add") {
        await api.addFunds(trade.id, {
          quoteAmount: String(quoteAmt),
          type,
          price: type === "limit" ? price : null,
        });
      } else {
        await api.reduceFunds(trade.id, {
          baseAmount: String(baseAmt),
          type,
          price: type === "limit" ? price : null,
        });
      }
      await onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Order failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal funds" onClick={(e) => e.stopPropagation()}>
        <div className="card-h">
          {title}
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="row-toggle">
          Volume
          <span className="muted">
            {kind === "add"
              ? `${fmt(addCapacity, 8)} ${trade.quote} available`
              : `${fmt(held, 8)} ${trade.base}`}
          </span>
        </div>
        {kind === "add" && programmed && (
          <p className="hint" style={{ textAlign: "left" }}>
            {pct}% of leftover after the programmed {fmt(held, 4)} {trade.base}
            {futures ? ` · same ${lev}x` : ""}.
          </p>
        )}
        {kind === "add" && futures && !programmed && (
          <p className="hint" style={{ textAlign: "left" }}>
            Added at the same {lev}x {marginLabel(trade.marginMode)}.
          </p>
        )}
        <div className="input-wrap">
          <input
            className="mono"
            value={kind === "add" ? fmt(quoteAmt, 8) : fmt(baseAmt, 8)}
            readOnly
          />
          <span className="unit">{kind === "add" ? trade.quote : trade.base}</span>
        </div>
        <div className="input-wrap" style={{ marginTop: 8 }}>
          <input
            value={pct}
            onChange={(e) => setPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          />
          <span className="unit">%</span>
        </div>
        <input
          className="range"
          type="range"
          min={1}
          max={100}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          style={{ margin: "10px 0" }}
        />
        <Seg
          value={type}
          onChange={(id) => setType(id as "market" | "limit")}
          options={[
            { id: "market", label: "Market" },
            { id: "limit", label: "Limit" },
          ]}
        />
        {kind === "add" && type === "limit" && (
          <p className="hint" style={{ textAlign: "left" }}>
            {programmed
              ? "Rests at this price. If it fills, size is added to this trade — even if the first limit is still waiting."
              : "Rests at this price and adds when it fills."}
          </p>
        )}
        {kind === "add" && programmed && type === "market" && (
          <p className="hint" style={{ textAlign: "left" }}>
            Increases the waiting order's size at {fmt(plannedPx, 6)} {trade.quote}.
          </p>
        )}
        <div className="muted">Price</div>
        <input
          className="mono"
          inputMode="decimal"
          value={type === "limit" ? price : fmt(last, 8)}
          disabled={type === "market"}
          onChange={(e) => setPrice(e.target.value)}
        />
        <div className="funds-tot">
          <span>{futures ? "Notional" : "Total quote currency"}</span>
          <strong>
            {fmt(kind === "add" ? quoteAmt : baseAmt * px, 8)} {trade.quote}
          </strong>
        </div>
        <div className="funds-tot">
          <span>{futures ? "Position" : "Total base currency"}</span>
          <strong>
            {fmt(baseAmt, 8)} {trade.base}
          </strong>
        </div>
        {error && <div className="err">{error}</div>}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Discard
          </button>
          <button className="primary" style={{ width: "auto" }} disabled={busy} onClick={save}>
            {busy ? "Sending…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProtectModal({
  trade,
  onClose,
  onSave,
}: {
  trade: SmartTrade;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const entry = n(trade.entryFilledPrice ?? trade.entryPrice);
  const last = n(trade.lastPrice) || entry;
  const ref = entry || last;
  const dir = trade.side === "buy" ? 1 : -1;
  const held = n(trade.entryFilledAmount ?? trade.amount);
  const [mode, setMode] = useState<"entire" | "partial">(
    trade.protectAmount && n(trade.protectAmount) > 0 && n(trade.protectAmount) < held
      ? "partial"
      : "entire",
  );
  const [qtyPct, setQtyPct] = useState(
    held > 0 && trade.protectAmount
      ? Math.round((n(trade.protectAmount) / held) * 100)
      : 100,
  );
  const [tpPrice, setTpPrice] = useState(trade.tpPrice && n(trade.tpPrice) > 0 ? trade.tpPrice : "");
  const [tpDist, setTpDist] = useState(
    trade.tpPrice && ref ? fmt(Math.abs(percentFromPrices(ref, n(trade.tpPrice))), 2) : "",
  );
  const [slPrice, setSlPrice] = useState(trade.slPrice && n(trade.slPrice) > 0 ? trade.slPrice : "");
  const [slDist, setSlDist] = useState(
    trade.slPrice && ref ? fmt(Math.abs(percentFromPrices(ref, n(trade.slPrice))), 2) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tpReduceOnly, setTpReduceOnly] = useState(trade.tpReduceOnly !== false);
  const [slReduceOnly, setSlReduceOnly] = useState(trade.slReduceOnly !== false);
  const [tpSplits, setTpSplits] = useState<TpTarget[]>(trade.tpTargets ?? []);
  const [splitOpen, setSplitOpen] = useState(false);
  const isFutures = isFuturesTrade(trade);
  const qty = mode === "entire" ? held : (held * Math.max(1, Math.min(100, qtyPct))) / 100;
  const tpOn = n(tpPrice) > 0;
  const slOn = n(slPrice) > 0;
  const tpPnlQ = tpSplits.length
    ? tpSplits.reduce(
        (sum, t) => sum + pnl(trade.side, ref, n(t.price), held * (t.qtyPct / 100)).quote,
        0,
      )
    : tpOn
      ? pnl(trade.side, ref, n(tpPrice), qty).quote
      : 0;
  const slPnlQ = slOn ? pnl(trade.side, ref, n(slPrice), qty).quote : 0;

  function onTpPrice(v: string) {
    setTpPrice(v);
    if (ref && n(v) > 0) setTpDist(fmt(Math.abs(percentFromPrices(ref, n(v))), 2));
  }
  function onTpDist(v: string) {
    setTpDist(v);
    const d = distNum(v);
    if (ref && d != null) setTpPrice(fmt(priceFromPercent(ref, d * dir), 8));
  }
  function onSlPrice(v: string) {
    setSlPrice(v);
    if (ref && n(v) > 0) setSlDist(fmt(Math.abs(percentFromPrices(ref, n(v))), 2));
  }
  function onSlDist(v: string) {
    setSlDist(v);
    const d = distNum(v);
    if (ref && d != null) setSlPrice(fmt(priceFromPercent(ref, -d * dir), 8));
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.setProtect(trade.id, {
        tpEnabled: tpOn || tpSplits.length > 0,
        tpType: tpOn || tpSplits.length ? "market" : null,
        tpPrice: tpSplits[0]?.price ?? (tpOn ? tpPrice : null),
        tpPercent: tpSplits[0]?.percent ?? (tpOn ? String(n(tpDist) * dir) : null),
        slEnabled: slOn,
        slType: slOn ? "cond_market" : null,
        slPrice: slOn ? slPrice : null,
        slPercent: slOn ? String(-n(slDist) * dir) : null,
        exitAmount: mode === "partial" ? fmt(qty, 8) : null,
        tpReduceOnly: isFutures ? tpReduceOnly : false,
        slReduceOnly: isFutures ? slReduceOnly : false,
        tpTargets: tpSplits.length ? tpSplits : [],
      });
      await onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update protection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal protect-modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-h">Add TP / SL</div>
        <Seg
          value={mode}
          onChange={(id) => setMode(id as "entire" | "partial")}
          options={[
            { id: "entire", label: "Entire position" },
            { id: "partial", label: "Partial exits" },
          ]}
        />
        {mode === "partial" && (
          <div className="protect-box">
            <div className="row-toggle">
              Quantity
              <span className="muted">{trade.base}</span>
            </div>
            <div className="input-wrap">
              <input className="mono" value={fmt(qty, 8)} readOnly />
              <span className="unit">{trade.base}</span>
            </div>
            <input
              className="range"
              type="range"
              min={1}
              max={100}
              value={qtyPct}
              onChange={(e) => setQtyPct(Number(e.target.value))}
              style={{ margin: "10px 0 4px" }}
            />
            <div className="muted" style={{ textAlign: "right" }}>
              {qtyPct}%
            </div>
          </div>
        )}
        <div className="protect-box">
          <div className="row-toggle">
            Take profit
            <span className="muted">Trigger by distance · Mark</span>
          </div>
          {isFutures && (
            <div className="row-toggle">
              Reduce only
              <Toggle on={tpReduceOnly} onChange={setTpReduceOnly} />
            </div>
          )}
          <div className="protect-row">
            <div className="input-wrap">
              <input
                className="mono"
                placeholder="Trigger USD"
                value={tpPrice}
                onChange={(e) => onTpPrice(e.target.value)}
              />
              <span className="unit">{trade.quote}</span>
            </div>
            <div className="input-wrap">
              <input
                placeholder="Entry distance %"
                value={tpDist}
                onChange={(e) => onTpDist(e.target.value)}
              />
              <span className="unit">+</span>
            </div>
          </div>
          {(tpOn || tpSplits.length > 0) && (
            <PnlEst
              label={tpSplits.length ? "Profit · targets" : "Profit"}
              amount={formatSignedQuote(tpPnlQ, trade.quote)}
              up={tpPnlQ >= 0}
            />
          )}
          <button
            type="button"
            className={`split${tpSplits.length ? " on" : ""}`}
            onClick={() => setSplitOpen(true)}
          >
            {tpSplits.length ? `Split Targets · ${tpSplits.length}` : "Split Targets"}
          </button>
        </div>
        {splitOpen && (
          <SplitTargetsModal
            quote={trade.quote}
            base={trade.base}
            last={last}
            entry={entry || last}
            side={trade.side}
            amount={held}
            targets={tpSplits}
            onChange={setTpSplits}
            onClose={() => setSplitOpen(false)}
          />
        )}
        <div className="protect-box">
          <div className="row-toggle">
            Stop loss
            <span className="muted">Trigger by distance · Mark</span>
          </div>
          {isFutures && (
            <div className="row-toggle">
              Reduce only
              <Toggle on={slReduceOnly} onChange={setSlReduceOnly} />
            </div>
          )}
          <div className="protect-row">
            <div className="input-wrap">
              <input
                className="mono"
                placeholder="Trigger USD"
                value={slPrice}
                onChange={(e) => onSlPrice(e.target.value)}
              />
              <span className="unit">{trade.quote}</span>
            </div>
            <div className="input-wrap">
              <input
                placeholder="Entry distance %"
                value={slDist}
                onChange={(e) => onSlDist(e.target.value)}
              />
              <span className="unit">−</span>
            </div>
          </div>
          {slOn && (
            <PnlEst
              label="Loss"
              amount={formatSignedQuote(slPnlQ, trade.quote)}
              up={slPnlQ >= 0}
            />
          )}
        </div>
        {error && <div className="err">{error}</div>}
        <div className="protect-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

type Candle = { t: number; o: number; h: number; l: number; c: number };

function MiniChart({
  trade,
  candles,
  timeframe,
  onTimeframe,
  onClose,
}: {
  trade: SmartTrade;
  candles: Candle[];
  timeframe: string;
  onTimeframe: (tf: string) => void;
  onClose: () => void;
}) {
  const w = 320;
  const h = 280;
  const pad = 10;
  const entry = n(trade.entryFilledPrice ?? trade.entryPrice);
  const last = n(trade.lastPrice) || entry;
  const tp = trade.tpEnabled ? n(trade.tpPrice) : 0;
  const sl = trade.slEnabled ? n(trade.slPrice) : 0;
  const liq = n(trade.liquidationPrice);
  const extras = [entry, last, tp, sl, liq].filter((x) => x > 0);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const min = Math.min(...(lows.length ? lows : [last]), ...extras);
  const max = Math.max(...(highs.length ? highs : [last]), ...extras);
  const span = max - min || 1;
  const y = (p: number) => pad + (1 - (p - min) / span) * (h - pad * 2);
  const inner = w - pad * 2;
  const slot = candles.length ? inner / candles.length : inner;

  function line(
    price: number,
    color: string,
    label: string,
    side: "left" | "right" = "right",
  ) {
    if (!(price > 0)) return null;
    const yy = y(price);
    const left = side === "left";
    return (
      <g>
        <line x1={pad} x2={w - pad} y1={yy} y2={yy} stroke={color} strokeDasharray="3 3" strokeWidth="1" />
        <text
          x={left ? pad : w - pad}
          y={yy - 3}
          fill={color}
          fontSize="9"
          textAnchor={left ? "start" : "end"}
        >
          {label} {fmt(price, 5)}
        </text>
      </g>
    );
  }

  return (
    <div className="pos-chart">
      <div className="pos-chart-h">
        <div className="pair-cell">
          <Coin symbol={trade.base} />
          <div>
            {trade.base}/{trade.quote}
            <div className="muted">
              {trade.exchangeLabel}
              {trade.leverage ? ` · ${trade.leverage}x` : ""}
            </div>
          </div>
        </div>
        <button className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="pos-chart-tf">
        {["5m", "15m", "1h"].map((tf) => (
          <button
            key={tf}
            type="button"
            className={timeframe === tf ? "on" : ""}
            onClick={() => onTimeframe(tf)}
          >
            {tf}
          </button>
        ))}
      </div>
      {candles.length === 0 ? (
        <div className="muted" style={{ padding: 16 }}>
          Loading chart…
        </div>
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} className="pos-chart-svg">
          {candles.map((c, i) => {
            const x = pad + i * slot + slot / 2;
            const up = c.c >= c.o;
            const color = up ? "#1fd18e" : "#f25c6e";
            return (
              <g key={c.t}>
                <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth="1" />
                <rect
                  x={x - Math.max(1, slot * 0.3)}
                  y={Math.min(y(c.o), y(c.c))}
                  width={Math.max(2, slot * 0.6)}
                  height={Math.max(1, Math.abs(y(c.c) - y(c.o)))}
                  fill={color}
                />
              </g>
            );
          })}
          {line(entry, isColdStart(trade) ? "#5eead4" : "#fafafa", isColdStart(trade) ? "Cold" : "Entry")}
          {line(tp, "#1fd18e", "TP", "left")}
          {line(sl, "#f25c6e", "SL", "left")}
          {line(liq, "#f5a623", "Liq")}
        </svg>
      )}
    </div>
  );
}

export function PositionsPage() {
  const [tab, setTab] = useState<"open" | "history">("open");
  const [trades, setTrades] = useState<SmartTrade[]>([]);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, TradeStep[]>>({});
  const [funds, setFunds] = useState<{ kind: "add" | "reduce"; trade: SmartTrade } | null>(null);
  const [protect, setProtect] = useState<SmartTrade | null>(null);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [confirmAct, setConfirmAct] = useState<{
    kind: "close" | "cancel" | "fire" | "enter_limit" | "enter_market";
    trade: SmartTrade;
  } | null>(null);
  const [chartId, setChartId] = useState<string | null>(null);
  const [chartTf, setChartTf] = useState("15m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [actBusy, setActBusy] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [flash, setFlash] = useState<Record<string, { kind: "filled" | "closed"; until: number }>>(
    {},
  );
  const [notices, setNotices] = useState<
    { id: string; pair: string; kind: "filled" | "closed"; until: number }[]
  >([]);
  const tradesRef = useRef<SmartTrade[]>([]);

  function noteEvents(prev: SmartTrade[], next: SmartTrade[]) {
    if (!prev.length) return;
    const nextBy = new Map(next.map((t) => [t.id, t]));
    const now = Date.now();
    const until = now + 45_000;
    const found: { id: string; pair: string; kind: "filled" | "closed" }[] = [];
    for (const p of prev) {
      const cur = nextBy.get(p.id);
      if (cur) {
        if (p.status !== "in_position" && cur.status === "in_position") {
          found.push({ id: cur.id, pair: `${cur.base}/${cur.quote}`, kind: "filled" });
        }
        if (p.status !== "closed" && cur.status === "closed") {
          found.push({ id: cur.id, pair: `${cur.base}/${cur.quote}`, kind: "closed" });
        }
      } else if (
        tab === "open" &&
        (p.status === "in_position" || p.status === "closing")
      ) {
        found.push({ id: p.id, pair: `${p.base}/${p.quote}`, kind: "closed" });
      }
    }
    if (!found.length) return;
    for (const e of found) {
      if (e.kind === "filled") playFilled();
      else playClosed();
    }
    setFlash((cur) => {
      const n = { ...cur };
      for (const e of found) n[e.id] = { kind: e.kind, until };
      return n;
    });
    setNotices((cur) => [
      ...found.map((e) => ({ ...e, until })),
      ...cur.filter((x) => x.until > now),
    ]);
  }

  async function reload() {
    const r = await api.trades(tab === "open" ? "open" : "history");
    noteEvents(tradesRef.current, r.trades);
    tradesRef.current = r.trades;
    setTrades(r.trades);
  }

  async function refreshTrade(tr: SmartTrade) {
    setRefreshing(tr.id);
    setError("");
    try {
      const r = await api.refreshTrade(tr.id);
      setTrades((prev) => prev.map((t) => (t.id === r.trade.id ? r.trade : t)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh price");
    } finally {
      setRefreshing(null);
    }
  }

  useEffect(() => {
    function unlock() {
      unlockTradeAlerts();
      window.removeEventListener("pointerdown", unlock);
    }
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setFlash((cur) => {
        const n: typeof cur = {};
        for (const [id, v] of Object.entries(cur)) if (v.until > now) n[id] = v;
        return n;
      });
      setNotices((cur) => cur.filter((x) => x.until > now));
    }, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setMenu(null);
    tradesRef.current = [];
    reload().catch((e) => setError(e.message));
    const t = setInterval(() => reload().catch(() => undefined), tab === "open" ? 15000 : 4000);
    let es: EventSource | null = null;
    if (tab === "open") {
      es = new EventSource("/api/stream/open-trades");
      es.addEventListener("quote", (ev) => {
        try {
          const q = JSON.parse((ev as MessageEvent).data) as {
            id: string;
            lastPrice: string;
            pnlQuote: string;
            pnlPercent: string;
            liquidationPrice?: string | null;
            amount?: string;
            entryFilledAmount?: string;
            entryFilledPrice?: string;
            peakPrice?: string;
            troughPrice?: string;
          };
          setTrades((prev) =>
            prev.map((tr) =>
              tr.id === q.id
                ? {
                    ...tr,
                    lastPrice: q.lastPrice,
                    pnlQuote: q.pnlQuote,
                    pnlPercent: q.pnlPercent,
                    liquidationPrice: q.liquidationPrice ?? tr.liquidationPrice,
                    amount: q.amount ?? tr.amount,
                    entryFilledAmount: q.entryFilledAmount ?? tr.entryFilledAmount,
                    entryFilledPrice: q.entryFilledPrice ?? tr.entryFilledPrice,
                    peakPrice: q.peakPrice ?? tr.peakPrice,
                    troughPrice: q.troughPrice ?? tr.troughPrice,
                  }
                : tr,
            ),
          );
        } catch {
          /* ignore */
        }
      });
      es.addEventListener("reload", () => {
        void reload().catch(() => undefined);
      });
    }
    return () => {
      clearInterval(t);
      es?.close();
    };
  }, [tab]);

  useEffect(() => {
    if (tab === "history") return;
    if (menu && trades.some((t) => t.id === menu)) return;
    setMenu(trades[0]?.id ?? null);
  }, [trades, menu, tab]);

  const history = tab === "history";
  const chartTrade = trades.find((t) => t.id === chartId) ?? null;

  useEffect(() => {
    if (!chartTrade) {
      setCandles([]);
      return;
    }
    let live = true;
    setCandles([]);
    api
      .candles(chartTrade.exchangeId, chartTrade.pair, chartTf)
      .then((r) => {
        if (live) setCandles(r.candles);
      })
      .catch(() => {
        if (live) setCandles([]);
      });
    const t = setInterval(() => {
      api
        .candles(chartTrade.exchangeId, chartTrade.pair, chartTf)
        .then((r) => {
          if (live) setCandles(r.candles);
        })
        .catch(() => undefined);
    }, 20000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [chartTrade?.id, chartTrade?.exchangeId, chartTrade?.pair, chartTf]);

  async function saveNote(id: string) {
    await api.setNote(id, note);
    setEditing(null);
    await reload();
  }

  async function toggleExpand(tr: SmartTrade) {
    const next = openId === tr.id ? null : tr.id;
    setOpenId(next);
    if (next && !steps[tr.id]) {
      const r = await api.tradeSteps(tr.id);
      setSteps((s) => ({ ...s, [tr.id]: r.steps }));
    }
  }

  async function share(tr: SmartTrade) {
    const text = `${tr.base}/${tr.quote} on ${tr.exchangeLabel}
Status: ${tr.status}${tr.closedReason ? ` (${tr.closedReason})` : ""}
PnL: ${tr.pnlQuote ?? "—"} ${tr.quote} (${tr.pnlPercent ?? "—"}%)
${location.origin}/positions`;
    await navigator.clipboard.writeText(text);
  }

  async function runConfirm() {
    if (!confirmAct) return;
    setActBusy(true);
    try {
      if (confirmAct.kind === "close") await api.closeTrade(confirmAct.trade.id);
      else if (confirmAct.kind === "fire") await api.fireUp(confirmAct.trade.id);
      else if (confirmAct.kind === "enter_limit")
        await api.enterPosition(confirmAct.trade.id, "limit");
      else if (confirmAct.kind === "enter_market")
        await api.enterPosition(confirmAct.trade.id, "market");
      else await api.cancelTrade(confirmAct.trade.id);
      setConfirmAct(null);
      await reload();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : confirmAct.kind === "close"
            ? "Close failed"
            : confirmAct.kind === "fire"
              ? "Fire up failed"
              : confirmAct.kind.startsWith("enter")
                ? "Could not enter"
                : "Cancel failed",
      );
    } finally {
      setActBusy(false);
    }
  }

  async function openFunds(kind: "add" | "reduce", tr: SmartTrade) {
    try {
      const b = await api.balance(tr.exchangeId);
      setBalance(b);
    } catch {
      setBalance(null);
    }
    setFunds({ kind, trade: tr });
  }

  return (
    <div className="page pos-page">
      {error && <div className="banner">{error}</div>}
      <div className="tabs">
        <button className={`tab${tab === "open" ? " on-plain" : ""}`} onClick={() => setTab("open")}>
          Active
        </button>
        <button
          className={`tab${tab === "history" ? " on-plain" : ""}`}
          onClick={() => setTab("history")}
        >
          History
        </button>
      </div>
      <div className="pos-body">
      {notices.length > 0 && (
        <div className="trade-notices">
          {notices.map((n) => (
            <div key={`${n.id}-${n.kind}-${n.until}`} className={`trade-notice ${n.kind}`}>
              {n.pair} {n.kind === "filled" ? "filled" : "closed"}
            </div>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="pos">
          <thead>
            <tr>
              <th>Pair</th>
              <th>{history ? "Closed on" : "Opened"}</th>
              <th>Volume</th>
              <th>Status</th>
              <th>P/L</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    {history
                      ? "No closed trades yet."
                      : "No open trades. Open the Trade tab to place one."}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          {trades.map((tr) => {
              const dt = fmtDate(history ? tr.closedAt ?? tr.createdAt : tr.createdAt);
              const pnlQ = n(tr.pnlQuote);
              const pnlP = n(tr.pnlPercent);
              const up = pnlQ >= 0;
              const amt = tr.entryFilledAmount ?? tr.amount;
              const quoteAmt = n(amt) * n(tr.lastPrice ?? tr.entryPrice);
              const entry = n(tr.entryFilledPrice ?? tr.entryPrice);
              const feePx = entry ? entry * 1.001 : 0;
              const buys = (steps[tr.id] ?? []).filter((s) => s.side === "buy");
              const sells = (steps[tr.id] ?? []).filter((s) => s.side === "sell");
              const evt = flash[tr.id];
              return (
                <tbody
                  key={tr.id}
                  className={`pos-card${menu === tr.id ? " picked" : ""}${evt ? ` flash-${evt.kind}` : ""}`}
                >
                  <tr
                    className={menu === tr.id ? "picked" : ""}
                    onClick={() => {
                      if (!history) setMenu(tr.id);
                    }}
                  >
                    <td>
                      <div className="pair-cell">
                        <button
                          className="chev"
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleExpand(tr);
                          }}
                        >
                          {openId === tr.id ? "▾" : "▸"}
                        </button>
                        <Coin symbol={tr.base} />
                        <div>
                          <div className="pair-name">
                            {tr.base}/{tr.quote}
                            {evt && (
                              <span className={`evt-tag ${evt.kind}`}>
                                {evt.kind === "filled" ? "Filled" : "Closed"}
                              </span>
                            )}
                          </div>
                          <div className="ex-line">
                            {isSignalWait(tr)
                              ? `Signal · ${signalLabel(tr)} · `
                              : isColdStart(tr)
                                ? "Cold start · "
                                : ""}
                            {tr.leverage ? `${tr.leverage}x` : ""}
                            {tr.marginMode ? ` ${marginLabel(tr.marginMode)}` : ""}
                            {tr.leverage || tr.marginMode ? " · " : ""}
                            {tr.exchangeLabel}
                          </div>
                          {(editing === tr.id || tr.note) && (
                            <div className="note-line">
                              <IconNote />
                              {editing === tr.id ? (
                                <span style={{ display: "flex", gap: 6 }}>
                                  <input
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    style={{ width: 220 }}
                                  />
                                  <button className="ghost" onClick={() => saveNote(tr.id)}>
                                    Save
                                  </button>
                                </span>
                              ) : (
                                <span>{tr.note}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="mono opened" data-label={history ? "Closed" : "Opened"}>
                      {dt.d}
                      <div className="muted">{dt.t}</div>
                    </td>
                    <td className="vol-cell" data-label="Volume">
                      <strong>
                        {fmt(history ? tr.initialAmount ?? amt : amt, 4)} {tr.base}
                      </strong>
                      <div className="muted">
                        {fmt(history ? tr.initialQuote ?? quoteAmt : quoteAmt, 2)} {tr.quote}
                      </div>
                    </td>
                    <td className="status-cell">
                      {history && <HistoryStatus trade={tr} />}
                      <StatusBar
                        trade={tr}
                        readOnly={history}
                        onSaved={reload}
                        onFire={() => setConfirmAct({ kind: "fire", trade: tr })}
                      />
                    </td>
                    <td className="pnl-cell">
                      {history && (tr.closedReason === "detached" || tr.status === "cancelled") ? (
                        <span className="muted">—</span>
                      ) : (
                        <div
                          className={`pnl ${isPendingEntry(tr) ? "pending" : up ? "green" : "red"}`}
                        >
                          {up ? "+" : ""}
                          {fmt(pnlP, 2)}%
                          <small>
                            {up ? "+" : ""}
                            {fmt(pnlQ, 2)} $
                          </small>
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className={`icon-btn${chartId === tr.id ? " on" : ""}`}
                          title="Chart"
                          onClick={() => {
                            if (!history) setMenu(tr.id);
                            setChartId(chartId === tr.id ? null : tr.id);
                          }}
                        >
                          <IconChart />
                        </button>
                        {history ? (
                          <button className="icon-btn" title="Share" onClick={() => void share(tr)}>
                            <IconShare />
                          </button>
                        ) : (
                          <>
                            <button
                              className="icon-btn"
                              title="Refresh price"
                              disabled={refreshing === tr.id}
                              onClick={() => void refreshTrade(tr)}
                            >
                              <IconRefresh />
                            </button>
                            <button
                              className="icon-btn"
                              title="Note"
                              onClick={() => {
                                setEditing(tr.id);
                                setNote(tr.note ?? "");
                              }}
                            >
                              <IconNote />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {!history && (
                    <tr className={`acts-row${menu === tr.id ? " picked" : ""}`}>
                      <td colSpan={6}>
                        <div className="row-acts" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => setProtect(tr)}>
                            Take profit / Stop loss
                          </button>
                          {isColdStart(tr) ? (
                            <>
                            <button
                              type="button"
                              className="fire-up-act"
                              onClick={() => setConfirmAct({ kind: "fire", trade: tr })}
                            >
                              Fire up
                            </button>
                            <button type="button" onClick={() => void openFunds("add", tr)}>
                              {isFuturesTrade(tr) ? "+ Add position" : "+$ Add funds"}
                            </button>
                            </>
                          ) : isPendingEntry(tr) ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setConfirmAct({ kind: "enter_limit", trade: tr })}
                              >
                                Enter position limit
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmAct({ kind: "enter_market", trade: tr })}
                              >
                                Enter position market
                              </button>
                              <button type="button" onClick={() => void openFunds("add", tr)}>
                                {isFuturesTrade(tr) ? "+ Add position" : "+$ Add funds"}
                              </button>
                            </>
                          ) : (
                            <>
                          <button type="button" onClick={() => void openFunds("add", tr)}>
                            {isFuturesTrade(tr) ? "+ Add position" : "+$ Add funds"}
                          </button>
                          <button type="button" onClick={() => void openFunds("reduce", tr)}>
                            {isFuturesTrade(tr) ? "− Reduce position" : "−$ Reduce funds"}
                          </button>
                          <button
                            type="button"
                            className="warn"
                            onClick={() => setConfirmAct({ kind: "close", trade: tr })}
                          >
                            Close at Market Price
                          </button>
                            </>
                          )}
                          <button
                            type="button"
                            className="danger-txt"
                            onClick={() => setConfirmAct({ kind: "cancel", trade: tr })}
                          >
                            {isColdStart(tr) ? "Discard" : "Cancel"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {openId === tr.id && (
                    <tr className="expand">
                      <td colSpan={6}>
                        <div className="expand-box">
                          <div className="expand-meta">
                            Enter price ({tr.side}): {fmt(entry, 6)}
                            <span>Price with exchange fees: {fmt(feePx, 6)}</span>
                            {(tr.pendingAdds ?? []).filter((a) => !a.filled).length > 0 && (
                              <span>
                                Waiting adds:{" "}
                                {(tr.pendingAdds ?? [])
                                  .filter((a) => !a.filled)
                                  .map(
                                    (a) =>
                                      `${fmt(a.baseAmount, 4)} ${tr.base} @ ${fmt(a.price, 6)}`,
                                  )
                                  .join(" · ")}
                              </span>
                            )}
                            <span>
                              {history ? "Close price" : "Current Price"}:{" "}
                              {fmt(history ? tr.exitPrice : tr.lastPrice, 6)}
                            </span>
                          </div>
                          <div className="expand-meta">
                            Initial Position: {fmt(tr.initialAmount ?? amt, 8)} {tr.base}{" "}
                            {fmt(tr.initialQuote ?? quoteAmt, 8)} {tr.quote}
                            {tr.tpEnabled && tr.tpPrice && (
                              <span>Take profit: {fmt(tr.tpPrice, 6)}</span>
                            )}
                            {tr.slEnabled && tr.slPrice && (
                              <span>Stop loss: {fmt(tr.slPrice, 6)}</span>
                            )}
                            {tr.liquidationPrice && n(tr.liquidationPrice) > 0 && (
                              <span>Liquidation: {fmt(tr.liquidationPrice, 6)}</span>
                            )}
                          </div>
                          <table className="steps">
                            <thead>
                              <tr>
                                <th>Buy steps</th>
                                <th>Price</th>
                                <th>Volume</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {buys.length === 0 && (
                                <tr>
                                  <td colSpan={4} className="muted">
                                    No buy steps yet.
                                  </td>
                                </tr>
                              )}
                              {buys.map((s) => (
                                <tr key={s.id}>
                                  <td>Buy step {s.stepNo}</td>
                                  <td>{fmt(s.price, 6)}</td>
                                  <td>
                                    {s.baseAmount} {tr.base}
                                    {s.quoteAmount ? ` / ${fmt(s.quoteAmount, 6)} ${tr.quote}` : ""}
                                  </td>
                                  <td className={s.status === "error" ? "red" : ""}>
                                    {s.status === "finished"
                                      ? "Finished"
                                      : s.status === "cancelled"
                                        ? "Cancelled"
                                        : s.error || "Error"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {sells.length > 0 && (
                            <table className="steps">
                              <thead>
                                <tr>
                                  <th>Sell steps</th>
                                  <th>Price</th>
                                  <th>Volume</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sells.map((s) => (
                                  <tr key={s.id}>
                                    <td>Sell step {s.stepNo}</td>
                                    <td>{fmt(s.price, 6)}</td>
                                    <td>
                                      {s.baseAmount} {tr.base}
                                      {s.quoteAmount ? ` / ${fmt(s.quoteAmount, 6)} ${tr.quote}` : ""}
                                    </td>
                                    <td>
                                      {s.status === "finished" ? "Finished" : s.error || s.status}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
        </table>
      </div>
      {chartTrade && (
        <MiniChart
          trade={chartTrade}
          candles={candles}
          timeframe={chartTf}
          onTimeframe={setChartTf}
          onClose={() => setChartId(null)}
        />
      )}
      </div>
      {confirmAct && (
        <div className="modal-back" onClick={() => setConfirmAct(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              {confirmAct.kind === "close"
                ? "Close at market?"
                : confirmAct.kind === "fire"
                  ? isSignalWait(confirmAct.trade)
                    ? "Enter on signal?"
                    : "Fire up this trade?"
                  : confirmAct.kind === "enter_limit"
                    ? "Enter at limit?"
                    : confirmAct.kind === "enter_market"
                      ? "Enter at market?"
                      : isColdStart(confirmAct.trade)
                        ? "Discard this cold start?"
                        : "Cancel this trade?"}
            </h2>
            <p className="hint" style={{ textAlign: "left" }}>
              {confirmAct.trade.base}/{confirmAct.trade.quote} · {confirmAct.trade.exchangeLabel}
              {confirmAct.trade.venue === "paper" ? " · Demo" : ""}
              {confirmAct.kind === "close"
                ? confirmAct.trade.venue === "paper"
                  ? " will be closed in the demo wallet at market."
                  : " will be closed on the exchange at market."
                : confirmAct.kind === "fire"
                  ? isSignalWait(confirmAct.trade)
                    ? " opens Long if every timeframe is green, Short if every timeframe is red. Mixed colors stay waiting."
                    : " opens at market now. Take-profit and stop-loss stay at the prices you set."
                  : confirmAct.kind === "enter_limit"
                    ? " — the resting limit moves to the current price so it can fill."
                    : confirmAct.kind === "enter_market"
                      ? " — the limit is cancelled and the position opens at market."
                      : isColdStart(confirmAct.trade)
                        ? " will be discarded. Nothing was sent to the exchange."
                        : confirmAct.trade.venue === "paper"
                          ? " will be detached here. The demo position stays in this wallet."
                          : " will be detached here. The position stays on the exchange."}
            </p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirmAct(null)}>
                Back
              </button>
              <button
                className={
                  confirmAct.kind === "cancel" ? "danger" : "primary"
                }
                style={{ width: "auto" }}
                disabled={actBusy}
                onClick={() => void runConfirm()}
              >
                {actBusy
                  ? "Sending…"
                  : confirmAct.kind === "close"
                    ? "Close"
                    : confirmAct.kind === "fire"
                      ? "Fire up"
                      : confirmAct.kind === "enter_limit"
                        ? "Move limit"
                        : confirmAct.kind === "enter_market"
                          ? confirmAct.trade.side === "sell"
                            ? "Sell market"
                            : "Buy market"
                          : isColdStart(confirmAct.trade)
                            ? "Discard"
                            : "Cancel trade"}
              </button>
            </div>
          </div>
        </div>
      )}
      {funds && (
        <FundsModal
          kind={funds.kind}
          trade={funds.trade}
          balance={balance}
          last={n(funds.trade.lastPrice)}
          onClose={() => setFunds(null)}
          onSave={async () => {
            setFunds(null);
            await reload();
          }}
        />
      )}
      {protect && (
        <ProtectModal
          trade={protect}
          onClose={() => setProtect(null)}
          onSave={async () => {
            setProtect(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}
