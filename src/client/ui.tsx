import { useEffect, useState, type ReactNode } from "react";
import {
  INDICATORS,
  TF_FRAMES,
  indicatorShort,
  indicatorTitle,
  type IndicatorId,
  type TfBias,
} from "../shared/demark.ts";
import { VENUE_IDS } from "../shared/types.ts";

const VENUE_SET = new Set<string>(VENUE_IDS);

function iconUrl(symbol: string): string | null {
  const raw = symbol.trim();
  if (raw.length < 2) return null;
  const lower = raw.toLowerCase();
  if (VENUE_SET.has(lower)) {
    if (lower === "paper") return null;
    return `/screens/ex/${lower}.png`;
  }
  const token = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!token) return null;
  return `/screens/tokens/${token}.png`;
}

export function PnlEst({
  label,
  amount,
  up,
}: {
  label: string;
  amount: string;
  up: boolean;
}) {
  return (
    <div className="protect-est">
      <span>{label}</span>
      <strong className={up ? "green" : "red"}>{amount}</strong>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle${on ? " on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    >
      <i />
    </button>
  );
}

export function Seg({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={className ? `seg ${className}` : "seg"}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={value === o.id ? "on" : ""}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Coin({ symbol, color }: { symbol: string; color?: string }) {
  const src = iconUrl(symbol);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (!src || failed) {
    const bg = color ?? hashColor(symbol);
    return (
      <span className="icon-dot" style={{ background: bg, color: "#0b1016" }}>
        {symbol.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      className="icon-dot"
      src={src}
      alt=""
      width={18}
      height={18}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function hashColor(s: string): string {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = [42, 28, 190, 210, 260, 320, 145, 0];
  const hue = hues[h % hues.length];
  return `hsl(${hue} 70% 58%)`;
}

export function Err({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className="err">
      <span>✕</span>
      <span>{children}</span>
    </div>
  );
}

export function IconPower() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v10" />
      <path d="M6.1 6.1a8 8 0 1 0 11.8 0" />
    </svg>
  );
}

export function IconRefresh() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.3-6" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
export function IconSliders() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 8h16" />
      <path d="M4 16h16" />
      <circle cx="9" cy="8" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="16" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function IconNote() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
export function IconMore() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18" cy="12" r="1.7" />
    </svg>
  );
}
export function IconInfo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function HelpLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="help-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
    >
      <IconInfo />
    </a>
  );
}

export function IconChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19V9" />
      <path d="M10 19V5" />
      <path d="M16 19v-7" />
      <path d="M22 19V3" />
    </svg>
  );
}

export function IconShare() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5 15.4 17.5" />
      <path d="M15.4 6.5 8.6 10.5" />
    </svg>
  );
}

export function IconStar({ on }: { on?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={on ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 3.2 14.7 8.8l6.1.9-4.4 4.3 1 6.1L12 17.2 6.6 20.1l1-6.1-4.4-4.3 6.1-.9Z" />
    </svg>
  );
}

export function TfDots({
  frames,
  compact,
  title,
}: {
  frames: TfBias[];
  compact?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`tf-dots${compact ? " compact" : ""}`}
      title={title ?? "TDPR — green from the bottom (25), red from the top (75)"}
    >
      {TF_FRAMES.map((f) => {
        const row = frames.find((x) => x.tf === f.id);
        const color = row?.color;
        return (
          <span
            key={f.id}
            className={`tf-dot${color ? ` ${color}` : ""}`}
            title={f.id}
            aria-label={f.id}
          />
        );
      })}
    </div>
  );
}

export function TfStack({
  rows,
  compact,
}: {
  rows: { id: IndicatorId; frames: TfBias[] }[];
  compact?: boolean;
}) {
  const multi = rows.length > 1;
  return (
    <div className={`tf-stack${compact ? " compact" : ""}`}>
      {rows.map((row) => {
        const meta = INDICATORS.find((x) => x.id === row.id);
        return (
          <div key={row.id} className="tf-stack-row">
            {multi && (
              <span className="tf-stack-lab" title={meta?.title}>
                {indicatorShort(row.id)}
              </span>
            )}
            <TfDots
              frames={row.frames}
              compact={compact}
              title={indicatorTitle(row.id)}
            />
          </div>
        );
      })}
    </div>
  );
}

const DONUT = ["#fafafa", "#d4d4d4", "#a3a3a3", "#737373", "#525252", "#404040", "#262626"];

export function Donut({
  slices,
  label,
  sub,
}: {
  slices: { pct: number; color?: string }[];
  label: string;
  sub?: string;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg className="donut" viewBox="0 0 120 120" width="120" height="120">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#262626" strokeWidth="14" />
      {slices.map((s, i) => {
        const len = (s.pct / 100) * c;
        const el = (
          <circle
            key={i}
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={s.color ?? DONUT[i % DONUT.length]}
            strokeWidth="14"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-off}
            transform="rotate(-90 60 60)"
          />
        );
        off += len;
        return el;
      })}
      <text x="60" y="56" textAnchor="middle" fill="#dce3ed" fontSize="11">
        {label}
      </text>
      {sub && (
        <text x="60" y="72" textAnchor="middle" fill="#8091a5" fontSize="10">
          {sub}
        </text>
      )}
    </svg>
  );
}

export function LineChart({
  a,
  b,
  colorA = "#fafafa",
  colorB = "#737373",
}: {
  a: number[];
  b?: number[];
  colorA?: string;
  colorB?: string;
}) {
  const w = 560;
  const h = 180;
  const pad = 8;
  function path(xs: number[]) {
    if (!xs.length) return "";
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const span = max - min || 1;
    return xs
      .map((v, i) => {
        const x = pad + (i / Math.max(xs.length - 1, 1)) * (w - pad * 2);
        const y = h - pad - ((v - min) / span) * (h - pad * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }
  if (a.length < 2) {
    return <div className="muted chart-empty">Balance history builds as the server samples your accounts.</div>;
  }
  return (
    <svg className="line-chart" viewBox={`0 0 ${w} ${h}`} width="100%" height="180">
      <path d={path(a)} fill="none" stroke={colorA} strokeWidth="2" />
      {b && b.length === a.length && (
        <path d={path(b)} fill="none" stroke={colorB} strokeWidth="2" />
      )}
    </svg>
  );
}

export function fmtUsd(n: number, d = 2): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(d)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
