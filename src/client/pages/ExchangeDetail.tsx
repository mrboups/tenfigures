import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Coin, Donut, LineChart, fmtPct, fmtUsd } from "../ui.tsx";
import type { ExchangeDetails } from "../../shared/types.ts";
import { marketTypeLabel } from "../../shared/types.ts";

export function ExchangeDetailPage({
  id,
  go,
  demo = false,
}: {
  id: string;
  go: (p: string) => void;
  demo?: boolean;
}) {
  const [d, setD] = useState<ExchangeDetails | null>(null);
  const [tab, setTab] = useState<"stats" | "orders" | "settings">("stats");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    setBusy(true);
    try {
      const r = await api.exchangeDetails(id);
      setD(r.details);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load account");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    reload();
  }, [id]);

  async function remove() {
    if (!confirm("Remove this exchange account?")) return;
    try {
      await api.deleteExchange(id);
      go("/exchanges");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove");
    }
  }

  if (!d && !error) return <div className="page muted">Loading account…</div>;

  const usdSeries = d?.series.map((s) => s.usd) ?? [];
  const btcSeries = d?.series.map((s) => s.btc ?? 0) ?? [];

  return (
    <div className="page">
      <div className="dash-head">
        <div>
          <button className="ghost" onClick={() => go("/exchanges")}>
            ← Exchanges
          </button>
          <h1 style={{ marginTop: 10 }}>
            {d?.exchange.label ?? "Account"} / {d?.exchange.venue}{" "}
            {marketTypeLabel(d?.exchange.marketType)}
          </h1>
        </div>
        <div className="muted">
          Api Key: ········{d?.exchange.apiKeyLast4 ?? "····"}
        </div>
      </div>
      {error && <div className="banner">{error}</div>}
      <div className="tabs">
        <button className={`tab${tab === "stats" ? " on-plain" : ""}`} onClick={() => setTab("stats")}>
          Statistics
        </button>
        <button
          className={`tab${tab === "orders" ? " on-plain" : ""}`}
          onClick={() => setTab("orders")}
        >
          Opened orders
        </button>
        <button
          className={`tab${tab === "settings" ? " on-plain" : ""}`}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
      </div>

      {tab === "stats" && d && (
        <>
          <div className="stats-panel">
            <div className="card-h">
              Statistics
              <button className="icon-btn" onClick={reload} disabled={busy}>
                ↻
              </button>
            </div>
            <div className="stats-metrics">
              <Donut
                slices={d.assets.slice(0, 6).map((a) => ({ pct: a.pct }))}
                label={`Assets: ${d.assetCount}`}
              />
              <div>
                <div className="muted">Balance</div>
                <div className="stat-big">{d.btc != null ? `${d.btc.toFixed(5)} BTC` : "—"}</div>
                <div>{fmtUsd(d.usd)}</div>
              </div>
              <div>
                <div className="muted">Overall profit</div>
                <div className={`stat-big ${d.realizedPnlUsd < 0 ? "red" : "green"}`}>
                  {fmtUsd(d.realizedPnlUsd)}
                </div>
              </div>
              <div>
                <div className="muted">Latest 30 days</div>
                <div className={d.monthPnlUsd < 0 ? "red" : "green"}>{fmtUsd(d.monthPnlUsd)}</div>
              </div>
              <div>
                <div className="muted">Profit, % Month</div>
                <div className={(d.monthPnlPct ?? 0) < 0 ? "red" : "green"}>
                  {fmtPct(d.monthPnlPct)}
                </div>
              </div>
              <div>
                <div className="muted">Profit, % Day</div>
                <div className={(d.dayPnlPct ?? 0) < 0 ? "red" : "green"}>{fmtPct(d.dayPnlPct)}</div>
              </div>
            </div>
            <div className="ratio-row">
              <span>Sharpe ratio {d.sharpe == null ? "—" : d.sharpe.toFixed(4)}</span>
              <span>Deviation {d.deviation == null ? "—" : d.deviation.toFixed(2)}</span>
              <span>Sortino ratio {d.sortino == null ? "—" : d.sortino.toFixed(4)}</span>
            </div>
          </div>
          <div className="stats-panel">
            <div className="card-h">
              Tokens: {d.assetCount}
              <span>{fmtUsd(d.usd)}</span>
            </div>
            <table className="tok">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Amount</th>
                  <th>USD</th>
                  <th>%</th>
                  <th>24h</th>
                </tr>
              </thead>
              <tbody>
                {d.assets.map((a) => (
                  <tr key={a.asset}>
                    <td>
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <Coin symbol={a.asset} /> {a.asset}
                      </span>
                    </td>
                    <td className="mono">{a.amount}</td>
                    <td>{fmtUsd(a.usd)}</td>
                    <td>{a.pct.toFixed(2)}%</td>
                    <td className={(a.change24h ?? 0) < 0 ? "red" : "green"}>
                      {fmtPct(a.change24h)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stats-panel">
            <div className="card-h">Balance</div>
            <LineChart a={usdSeries} b={btcSeries} />
          </div>
        </>
      )}

      {tab === "orders" && d && (
        <div className="stats-panel">
          <table className="tok">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Side</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.openOrders.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">No open orders on this account.</div>
                  </td>
                </tr>
              )}
              {d.openOrders.map((o) => (
                <tr key={o.id}>
                  <td>{o.symbol}</td>
                  <td>{o.side}</td>
                  <td>{o.type}</td>
                  <td className="mono">{o.amount}</td>
                  <td className="mono">{o.price ?? "—"}</td>
                  <td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "settings" && d && (
        <div className="stats-panel" style={{ maxWidth: 480 }}>
          <div className="field">
            <label>Account name</label>
            <input value={d.exchange.label} readOnly />
          </div>
          <div className="field">
            <label>Venue</label>
            <input value={d.exchange.venue} readOnly />
          </div>
          {!demo && (
            <div className="field">
              <label>API key</label>
              <input value={`········${d.exchange.apiKeyLast4 ?? ""}`} readOnly />
            </div>
          )}
          {d.exchange.lastOkAt && (
            <p className="help">Last ok {new Date(d.exchange.lastOkAt).toLocaleString()}</p>
          )}
          {!demo && (
            <button className="ghost" onClick={remove}>
              Remove account
            </button>
          )}
        </div>
      )}
    </div>
  );
}
