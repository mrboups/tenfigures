import { useEffect, useState } from "react";
import { formatNum, formatSignedQuote, percentFromPrices, pnl, priceFromPercent } from "../shared/money.ts";
import {
  MAX_TP_TARGETS,
  allocatedPct,
  availablePct,
  type TpTarget,
} from "../shared/targets.ts";
import { PnlEst, Seg } from "./ui.tsx";

function n(v: string | number): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmt(v: number, d = 8): string {
  return formatNum(v, d);
}

export function SplitTargetsModal({
  quote,
  base,
  last,
  entry,
  side,
  amount,
  targets,
  onChange,
  onClose,
}: {
  quote: string;
  base: string;
  last: number;
  entry: number;
  side: "buy" | "sell";
  amount: number;
  targets: TpTarget[];
  onChange: (next: TpTarget[]) => void;
  onClose: () => void;
}) {
  const ref0 = last || entry;
  const [basis, setBasis] = useState<"last" | "entry">(last > 0 ? "last" : "entry");
  const ref = (basis === "entry" ? entry : last) || ref0;
  const dir = side === "buy" ? 1 : -1;
  const avail = availablePct(targets);
  const used = allocatedPct(targets);
  const [price, setPrice] = useState(ref ? fmt(priceFromPercent(ref, 10 * dir), 8) : "");
  const [pct, setPct] = useState("10");
  const [qtyPct, setQtyPct] = useState(Math.min(25, Math.max(1, avail || 25)));

  useEffect(() => {
    if (n(price) > 0 || !(ref > 0)) return;
    setPrice(fmt(priceFromPercent(ref, (n(pct) || 10) * dir), 8));
  }, [ref, dir, pct, price]);

  function onPrice(v: string) {
    setPrice(v);
    if (ref && n(v) > 0) setPct(fmt(Math.abs(percentFromPrices(ref, n(v))), 2));
  }
  function onPct(v: string) {
    setPct(v);
    const t = v.trim();
    if (!ref || t === "" || t === "." || t === "-" || t === "+") return;
    const d = Number(t);
    if (Number.isFinite(d) && d >= 0) setPrice(fmt(priceFromPercent(ref, d * dir), 8));
  }

  function add() {
    const px = n(price);
    const qty = Math.min(avail, Math.max(1, n(qtyPct)));
    if (!(px > 0) || qty <= 0 || avail <= 0) return;
    if (targets.length >= MAX_TP_TARGETS) return;
    onChange([
      ...targets,
      {
        id: crypto.randomUUID(),
        price: String(px),
        percent: pct || null,
        qtyPct: qty,
        orderId: null,
        filled: false,
      },
    ]);
    const left = avail - qty;
    setQtyPct(Math.min(25, Math.max(1, left)));
  }

  function remove(id: string) {
    onChange(targets.filter((t) => t.id !== id));
  }

  const qtyAmt = amount * (Math.min(avail, Math.max(0, n(qtyPct))) / 100);
  const addPnl = pnl(side, entry || ref, n(price), qtyAmt).quote;
  const canAdd =
    n(price) > 0 && avail > 0 && n(qtyPct) > 0 && targets.length < MAX_TP_TARGETS;

  return (
    <div className="modal-back split-back" onClick={onClose}>
      <div className="modal split-modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-h">Profit conditions</div>
        <div className="split-top">
          <SplitRing available={avail} />
          <div className="split-list">
            <div className="split-cols">
              <span>Price</span>
              <span>Quantity</span>
              <span>Profit</span>
            </div>
            {targets.length === 0 && (
              <div className="muted">No take-profit targets yet.</div>
            )}
            {targets.map((t) => {
              const slice = pnl(side, entry || ref, n(t.price), amount * (t.qtyPct / 100)).quote;
              return (
                <div key={t.id} className="split-row">
                  <span className="mono">
                    {fmt(n(t.price), 6)} {quote}
                  </span>
                  <span>{t.qtyPct.toFixed(2)}%</span>
                  <span className={slice >= 0 ? "green" : "red"}>
                    {formatSignedQuote(slice, quote)}
                  </span>
                  <button type="button" className="ghost" onClick={() => remove(t.id)}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="muted">Price</div>
        <div className="split-price">
          <Seg
            value={basis}
            onChange={(id) => setBasis(id as "last" | "entry")}
            options={[
              { id: "last", label: "Last" },
              { id: "entry", label: "Entry" },
            ]}
          />
          <div className="input-wrap">
            <input className="mono" value={price} onChange={(e) => onPrice(e.target.value)} />
            <span className="unit">{quote}</span>
          </div>
          <div className="input-wrap">
            <input value={pct} onChange={(e) => onPct(e.target.value)} />
            <span className="unit">%</span>
          </div>
        </div>

        <div className="row-toggle">
          Volume
          <span className="muted">
            {fmt(qtyAmt, 8)} {base}
          </span>
        </div>
        <input
          className="range split-range"
          type="range"
          min={1}
          max={Math.max(1, Math.floor(avail) || 1)}
          value={Math.min(n(qtyPct), avail || 1)}
          disabled={avail <= 0}
          onChange={(e) => setQtyPct(Number(e.target.value))}
        />
        <div className="input-wrap" style={{ marginTop: 6 }}>
          <input
            value={qtyPct}
            onChange={(e) =>
              setQtyPct(Math.max(1, Math.min(avail || 1, Number(e.target.value) || 0)))
            }
          />
          <span className="unit">%</span>
        </div>
        {n(price) > 0 && qtyAmt > 0 && (
          <PnlEst
            label="Profit"
            amount={formatSignedQuote(addPnl, quote)}
            up={addPnl >= 0}
          />
        )}
        <div className="muted" style={{ marginTop: 6 }}>
          Used {used.toFixed(2)}% · {targets.length}/{MAX_TP_TARGETS} targets
        </div>
        <div className="split-actions">
          <button type="button" className="danger" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!canAdd} onClick={add}>
            Add TP target
          </button>
        </div>
      </div>
    </div>
  );
}

function SplitRing({ available }: { available: number }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const used = Math.max(0, Math.min(100, 100 - available));
  const len = (used / 100) * c;
  return (
    <svg className="split-ring" viewBox="0 0 100 100" width="108" height="108">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#262626" strokeWidth="10" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="#2ee0c5"
        strokeWidth="10"
        strokeDasharray={`${len} ${c - len}`}
        strokeDashoffset={c * 0.25}
        strokeLinecap="round"
      />
      <text x="50" y="46" textAnchor="middle" fill="#a3a3a3" fontSize="9">
        Available
      </text>
      <text x="50" y="62" textAnchor="middle" fill="#fafafa" fontSize="12" fontWeight="600">
        {available.toFixed(2)}%
      </text>
    </svg>
  );
}
