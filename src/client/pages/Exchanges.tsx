import { FormEvent, useEffect, useState } from "react";
import { api } from "../api.ts";
import { Coin, Donut, LineChart, fmtPct, fmtUsd } from "../ui.tsx";
import type {
  DashboardData,
  ExchangeAccount,
  ExchangeCard,
  MarketType,
  VenueInfo,
} from "../../shared/types.ts";
import { marketTypeLabel } from "../../shared/types.ts";
import { WAITLIST_ALREADY_MSG, WAITLIST_OK_MSG } from "../../shared/waitlistCopy.ts";
import { GFM_CAMPAIGN } from "../../shared/gofundme.ts";

const COLORS = ["#fafafa", "#d4d4d4", "#a3a3a3", "#737373", "#525252", "#404040"];

function shellCard(a: ExchangeAccount): ExchangeCard {
  return {
    id: a.id,
    venue: a.venue,
    label: a.label,
    marketType: a.marketType,
    lastError: null,
    apiKeyLast4: a.apiKeyLast4,
    usd: 0,
    btc: null,
    change24hUsd: null,
    change24hBtc: null,
    assets: [],
  };
}

function ExchangeTile({
  card,
  loading,
  failed,
  onOpen,
  onTrade,
  onRemove,
}: {
  card: ExchangeCard;
  loading?: boolean;
  failed?: boolean;
  onOpen: () => void;
  onTrade: () => void;
  onRemove?: () => void;
}) {
  const top = card.assets.slice(0, 3);
  const extra = card.assets.length - top.length;
  return (
    <div className={`ex-card${loading ? " is-loading" : ""}`} onClick={onOpen} aria-busy={loading}>
      <div className="ex-card-h">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Coin symbol={card.venue} />
          <div>
            <strong>{card.label}</strong>
            <div className="muted">
              {card.venue} {marketTypeLabel(card.marketType)}
            </div>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="ex-card-loading">
          <i className="spinner" />
          Loading balances…
        </div>
      ) : failed ? (
        <div className="ex-card-loading">Couldn't load balances.</div>
      ) : (
        <>
          {card.lastError && <div className="err">{card.lastError}</div>}
          <div className="comp-bar">
            {card.assets.map((a, i) => (
              <i
                key={a.asset}
                style={{
                  width: `${Math.max(a.pct, 0.4)}%`,
                  background: COLORS[i % COLORS.length],
                }}
              />
            ))}
          </div>
          <div className="comp-legend">
            {top.map((a, i) => (
              <span key={a.asset}>
                <b style={{ background: COLORS[i % COLORS.length] }} />
                {a.asset} {a.pct.toFixed(2)}%
              </span>
            ))}
            {extra > 0 && <span className="muted">… +{extra}</span>}
          </div>
          <div className="ex-totals">
            <div>
              Total:
              <strong>
                {fmtUsd(card.usd)}
                {card.btc != null ? ` / ${card.btc.toFixed(8)} BTC` : ""}
              </strong>
            </div>
            <div>
              24hr changes:
              <span className={card.change24hUsd != null && card.change24hUsd < 0 ? "red" : "green"}>
                {" "}
                {fmtPct(card.change24hUsd)}
              </span>
              {card.change24hBtc != null && (
                <span className={card.change24hBtc < 0 ? "red" : "green"}>
                  {" "}
                  {fmtPct(card.change24hBtc)}
                </span>
              )}
            </div>
          </div>
        </>
      )}
      <div className="ex-card-actions">
        <button
          className="ghost wide"
          onClick={(e) => {
            e.stopPropagation();
            onTrade();
          }}
        >
          Trade
        </button>
        {onRemove && (
          <button
            className="ghost wide"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function PortfolioPanel({
  go,
  refreshKey = 0,
  demo = false,
}: {
  go: (p: string) => void;
  refreshKey?: number;
  demo?: boolean;
}) {
  const [accounts, setAccounts] = useState<ExchangeAccount[] | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    setBusy(true);
    try {
      setData(await api.dashboard());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load portfolio");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    api
      .exchanges()
      .then((r) => setAccounts(r.exchanges))
      .catch(() => {});
    reload();
  }, [refreshKey]);

  async function remove(id: string) {
    if (!confirm("Remove this exchange account?")) return;
    try {
      await api.deleteExchange(id);
      await reload();
      const r = await api.exchanges();
      setAccounts(r.exchanges);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove");
    }
  }

  const tiles = (data
    ? data.exchanges.map((card) => ({ card, loading: false, failed: false }))
    : (accounts ?? []).map((a) => ({
        card: shellCard(a),
        loading: !error,
        failed: Boolean(error),
      }))
  ).filter(({ card }) =>
    q ? card.label.toLowerCase().includes(q.toLowerCase()) || card.venue.includes(q.toLowerCase()) : true,
  );
  const knownCount = data?.exchangeCount ?? accounts?.length;
  const showEmpty = knownCount === 0;
  const issues = (data?.exchanges ?? []).filter((c) => c.lastError).length;
  const usdSeries = data?.series.map((s) => s.usd) ?? [];
  const btcSeries = data?.series.map((s) => s.btc ?? 0) ?? [];

  return (
    <div className="portfolio-panel">
      <div className="dash-head">
        <div>
          <h1>My Portfolio</h1>
          {issues > 0 && <span className="pill-warn">Update API Key</span>}
        </div>
      </div>
      {error && <div className="banner">{error}</div>}
      <div className="stats-panel">
        <div className="card-h">
          Statistics
          <button className="icon-btn" onClick={reload} title="Refresh" disabled={busy}>
            ↻
          </button>
        </div>
        <div className="stats-row">
          <Donut
            slices={[{ pct: 100, color: "#3b82f6" }]}
            label={`Exchanges: ${knownCount ?? "…"}`}
            sub="Spot"
          />
          <div>
            <div className="muted">Total / Change 24 hr</div>
            {data ? (
              <>
                <div className="stat-big">
                  {fmtUsd(data.usd)}
                  <span className={`chg ${(data.change24hUsd ?? 0) < 0 ? "red" : "green"}`}>
                    {fmtPct(data.change24hUsd)}
                  </span>
                </div>
                <div className="muted">
                  {data.btc != null ? `≈ ${data.btc.toFixed(8)} BTC` : ""}
                  <span className={`chg ${(data.change24hBtc ?? 0) < 0 ? "red" : "green"}`}>
                    {" "}
                    {fmtPct(data.change24hBtc)}
                  </span>
                </div>
              </>
            ) : error ? (
              <div className="muted">Totals unavailable</div>
            ) : (
              <div className="stat-loading">
                <i className="spinner" />
                Loading totals…
              </div>
            )}
          </div>
          <div className="chart-wrap">
            <LineChart a={usdSeries} b={btcSeries} />
          </div>
        </div>
      </div>
      <div className="filter-bar">
        <input
          placeholder="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        {issues > 0 && <span className="chip-on">API Key Issue: {issues}</span>}
        <span className="chip-on">Spot</span>
      </div>
      <div className="ex-grid">
        {tiles.map(({ card, loading, failed }) => (
          <ExchangeTile
            key={card.id}
            card={card}
            loading={loading}
            failed={failed}
            onOpen={() => go(`/exchanges/${card.id}`)}
            onTrade={() => go("/trade")}
            onRemove={demo ? undefined : () => void remove(card.id)}
          />
        ))}
        {showEmpty && (
          <div className="empty">Connect an exchange to see live balances.</div>
        )}
      </div>
    </div>
  );
}

function EarlyAccessCard() {
  const [email, setEmail] = useState("");
  const [spots, setSpots] = useState<number | null>(null);
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .waitlist()
      .then((d) => {
        if (typeof d.remaining === "number") setSpots(d.remaining);
      })
      .catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setOk("");
    setErr("");
    try {
      const r = await api.joinWaitlist(email);
      setOk(r.already ? WAITLIST_ALREADY_MSG : WAITLIST_OK_MSG);
      if (typeof r.remaining === "number") setSpots(r.remaining);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not join");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">Early Access</div>
      <p className="hint" style={{ textAlign: "left" }}>
        First 100 get first month free and lock in 50% off subscription.
      </p>
      <form onSubmit={onSubmit}>
        <div className="field">
          <input
            type="email"
            required
            placeholder="you@email.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button className="primary" disabled={busy}>
          {busy ? "Sending…" : "Get early access"}
        </button>
      </form>
      {spots != null && <p className="muted" style={{ marginTop: 8 }}>{spots} spots left.</p>}
      {ok ? <p className="muted" style={{ marginTop: 8 }}>{ok}</p> : null}
      {err ? <div className="err">{err}</div> : null}
    </div>
  );
}

export function ExchangesPage({
  go,
  demo = false,
  fundUrl = "",
}: {
  go: (p: string) => void;
  demo?: boolean;
  fundUrl?: string;
}) {
  const [venues, setVenues] = useState<VenueInfo[]>([]);
  const [venue, setVenue] = useState<VenueInfo["id"]>("binance");
  const [marketType, setMarketType] = useState<MarketType>("spot");
  const [label, setLabel] = useState("My Binance");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const selected = venues.find((v) => v.id === venue);
  const isDex = Boolean(selected?.dex);

  async function reload() {
    const v = await api.venues();
    setVenues(v.venues);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const v = venues.find((x) => x.id === venue);
    if (v && (!label || label.startsWith("My "))) {
      setLabel(`My ${v.name}${marketType === "swap" ? " Futures" : ""}`);
    }
  }, [venue, venues, marketType]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createExchange({
        venue,
        label:
          label.trim() ||
          `My ${selected?.name ?? venue}${marketType === "swap" ? " Futures" : ""}`,
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        passphrase: passphrase || null,
        marketType: isDex ? "swap" : marketType,
      });
      setApiKey("");
      setApiSecret("");
      setPassphrase("");
      await reload();
      setTick((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page ex-page">
      <div className="connect-grid">
        {demo ? (
          <div className="demo-side">
            <div className="card">
              <div className="card-h">Demo wallet</div>
              <p className="hint" style={{ textAlign: "left" }}>
                Fake USDT on public prices. Connect-exchange is off on the demo.
              </p>
            </div>
            <EarlyAccessCard />
            <div className="card">
              <div className="card-h">Lifetime Access</div>
              <p className="hint" style={{ textAlign: "left" }}>
                Help fund the setup of the Ten Figures Trading Panel.
              </p>
              <p className="hint" style={{ textAlign: "left" }}>
                Contribute and receive lifetime access, plus free membership in the Ten Figures
                Club.
              </p>
              <a
                className="primary"
                href={fundUrl || GFM_CAMPAIGN}
                target="_blank"
                rel="noopener noreferrer"
              >
                Donate now
              </a>
            </div>
          </div>
        ) : (
        <form className="card" onSubmit={onSubmit}>
          <div className="card-h">Connect exchange</div>
          <div className="field">
            <label>Venue</label>
            <select
              value={venue}
              onChange={(e) => {
                const id = e.target.value as VenueInfo["id"];
                setVenue(id);
                const v = venues.find((x) => x.id === id);
                const mt = v?.dex ? "swap" : marketType;
                if (v?.dex) setMarketType("swap");
                if (v) setLabel(`My ${v.name}${mt === "swap" ? " Futures" : ""}`);
              }}
            >
              {(venues.length ? venues : [{ id: "binance", name: "Binance" }]).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Market</label>
            {isDex ? (
              <input value="Perpetual DEX" readOnly />
            ) : (
              <select
                value={marketType}
                onChange={(e) => {
                  const next = e.target.value as MarketType;
                  setMarketType(next);
                  const v = venues.find((x) => x.id === venue);
                  if (v) setLabel(`My ${v.name}${next === "swap" ? " Futures" : ""}`);
                }}
              >
                <option value="spot">Spot</option>
                <option value="swap">Futures</option>
              </select>
            )}
          </div>
          <div className="field">
            <label>Account name</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="field">
            <label>{isDex ? "Wallet address" : "API key"}</label>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              placeholder={isDex ? "0x…" : ""}
            />
          </div>
          <div className="field">
            <label>{isDex ? "Private key" : "API secret"}</label>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              autoComplete="new-password"
              placeholder={isDex ? "0x…" : ""}
            />
          </div>
          {selected?.needsPassphrase && (
            <div className="field">
              <label>Passphrase</label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </div>
          )}
          {error && <div className="banner">{error}</div>}
          <button
            className="primary"
            disabled={
              busy ||
              !apiSecret ||
              (selected?.needsWallet ? !apiKey : !isDex && !apiKey)
            }
          >
            {busy ? "Testing connection…" : "Save & test"}
          </button>
          <p className="help">
            {isDex
              ? venue === "hyperliquid"
                ? "Hyperliquid: paste the main wallet address and the private key of an API wallet from app.hyperliquid.xyz → More → API. Authorize that API wallet on the main account. TenFigures signs orders on the server."
                : "Lighter: paste the L1 private key (and the wallet address if you have it) from app.lighter.xyz. TenFigures signs orders on the server with that key."
              : marketType === "swap"
                ? venue === "kraken"
                  ? "Use a Kraken Futures API key (not the spot key). Enable futures trading. Leave withdrawals off."
                  : "Enable futures / perpetual trading on the key. Same key as spot is fine on most venues. Leave withdrawals off."
                : "Enable spot trading on the key. Leave withdrawals off."}{" "}
            {!isDex &&
              "If the venue asks for an IP whitelist, either turn that off or add this server after the first failed test."}
          </p>
        </form>
        )}
        <PortfolioPanel go={go} refreshKey={tick} demo={demo} />
      </div>
    </div>
  );
}
