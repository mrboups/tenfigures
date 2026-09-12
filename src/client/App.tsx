import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { ExchangeDetailPage } from "./pages/ExchangeDetail.tsx";
import { ExchangesPage } from "./pages/Exchanges.tsx";
import { LoginPage } from "./pages/Login.tsx";
import { HelpPage } from "./pages/Help.tsx";
import { PositionsPage } from "./pages/Positions.tsx";
import { TradePage } from "./pages/Trade.tsx";
import { StarStrip } from "./StarStrip.tsx";
import { IconPower } from "./ui.tsx";
import { appPath, routePath } from "./base.ts";
import { PRODUCT } from "./brand.ts";
import { SupportPrompt } from "./SupportPrompt.tsx";
import { CrispChat } from "./CrispChat.tsx";

function pathNow() {
  return routePath();
}

export function App() {
  const [path, setPath] = useState(pathNow);
  const [user, setUser] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [ready, setReady] = useState(false);
  const [fundUrl, setFundUrl] = useState("");

  useEffect(() => {
    const onPop = () => setPath(pathNow());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setUser(m.username);
        setDemo(Boolean(m.demo));
        setFundUrl(m.gofundmeUrl ?? "");
        if (path === "/login" || path === "/" || path === "/dashboard") go("/positions");
      })
      .catch(() => {
        setUser(null);
        setDemo(false);
        if (path !== "/login") go("/login");
      })
      .finally(() => setReady(true));
  }, []);

  function go(p: string) {
    history.pushState({}, "", appPath(p));
    setPath(p);
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setDemo(false);
    go("/login");
  }

  if (!ready) return <div className="page muted">Loading…</div>;
  if (!user) {
    return (
      <LoginPage
        onLoggedIn={(name) => {
          setUser(name);
          go("/positions");
        }}
      />
    );
  }

  const exchangeId = path.startsWith("/exchanges/") ? path.slice("/exchanges/".length) : "";
  const helpSlug = path.startsWith("/help/")
    ? decodeURIComponent(path.slice("/help/".length))
    : path === "/help"
      ? ""
      : null;
  const page =
    helpSlug != null
      ? "help"
      : path.startsWith("/exchanges/") && exchangeId
        ? "exchange"
        : path.startsWith("/exchanges")
          ? "exchanges"
          : path.startsWith("/trade")
            ? "trade"
            : "positions";

  return (
    <div className="app">
      <nav className="topnav">
        {demo ? (
          <a className="brand" href="/" aria-label={PRODUCT}>
            Ten<span>Figures</span>
          </a>
        ) : (
          <button type="button" className="brand" onClick={() => go("/positions")} aria-label={PRODUCT}>
            Ten<span>Figures</span>
          </button>
        )}
        <button
          className={`navlink${page === "positions" ? " on" : ""}`}
          onClick={() => go("/positions")}
        >
          Positions
        </button>
        <button className={`navlink${page === "trade" ? " on" : ""}`} onClick={() => go("/trade")}>
          Trade
        </button>
        <button
          className={`navlink${page === "exchanges" || page === "exchange" ? " on" : ""}`}
          onClick={() => go("/exchanges")}
        >
          Exchanges
        </button>
        <button
          className={`navlink${page === "help" ? " on" : ""}`}
          onClick={() => go("/help")}
        >
          Help
        </button>
        <div className="nav-spacer" />
        {demo ? (
          <span className="paper-badge">Demo</span>
        ) : (
          <button className="icon-btn" title="Log out" aria-label="Log out" onClick={logout}>
            <IconPower />
          </button>
        )}
      </nav>
      <StarStrip go={go} />
      {page === "positions" && <PositionsPage />}
      {page === "trade" && <TradePage go={go} />}
      {page === "help" && <HelpPage slug={helpSlug ?? ""} go={go} />}
      {page === "exchanges" && <ExchangesPage go={go} demo={demo} fundUrl={fundUrl} />}
      {page === "exchange" && exchangeId && (
        <ExchangeDetailPage id={exchangeId} go={go} demo={demo} />
      )}
      {demo && fundUrl ? <SupportPrompt url={fundUrl} /> : null}
      {demo ? <CrispChat /> : null}
    </div>
  );
}
