import type { AppEnv } from "./env.ts";
import { CRISP_SCRIPT, CRISP_WEBSITE_ID } from "../shared/crisp.ts";
import { GFM_CAMPAIGN } from "../shared/gofundme.ts";
import { WAITLIST_ALREADY_MSG, WAITLIST_OK_MSG } from "../shared/waitlistCopy.ts";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function landingHtml(env: AppEnv): string {
  const appHref = env.publicBase ? `${env.publicBase}/` : "/app/";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ten Figures Club</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg: #0a0a0a;
        --panel: #0f0f0f;
        --line: #262626;
        --line-2: #404040;
        --text: #fafafa;
        --muted: #a3a3a3;
        --dim: #737373;
        --radius: 6px;
      }
      * { box-sizing: border-box; }
      html { color-scheme: dark; scroll-behavior: smooth; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, "Segoe UI", sans-serif;
        font-size: 15px;
        line-height: 1.5;
      }
      a { color: var(--text); text-decoration: none; }
      a:hover { text-decoration: underline; }
      .topnav {
        display: flex;
        align-items: center;
        gap: 18px;
        min-height: 48px;
        padding: 8px 24px;
        border-bottom: 1px solid var(--line);
        position: sticky;
        top: 0;
        background: var(--bg);
        z-index: 10;
        flex-wrap: wrap;
      }
      .brand {
        font-weight: 700;
        letter-spacing: 0.04em;
        font-size: 13px;
        text-decoration: none;
      }
      .nav-spacer { flex: 1; }
      .navlink { color: var(--muted); font-size: 13px; }
      .navlink:hover { color: var(--text); text-decoration: none; }
      .primary, .ghost, button.primary {
        display: inline-block;
        border-radius: var(--radius);
        padding: 8px 14px;
        font-weight: 600;
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        text-decoration: none;
        border: none;
      }
      .primary {
        background: var(--text);
        color: var(--bg);
      }
      .primary:hover { filter: brightness(0.9); text-decoration: none; }
      .ghost {
        background: transparent;
        color: var(--text);
        border: 1px solid var(--line-2);
      }
      .ghost:hover { border-color: var(--text); text-decoration: none; }
      .wrap { max-width: 980px; margin: 0 auto; padding: 48px 24px 72px; }
      .kicker {
        font-size: 12px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--dim);
        font-weight: 600;
        margin: 0 0 10px;
      }
      h1 { font-size: 36px; letter-spacing: -0.03em; margin: 0 0 12px; font-weight: 650; line-height: 1.15; }
      h2 { font-size: 28px; letter-spacing: -0.03em; margin: 0 0 12px; font-weight: 650; line-height: 1.2; }
      .lede { color: var(--muted); margin: 0 0 24px; max-width: 36rem; }
      .hero {
        display: grid;
        grid-template-columns: 1fr minmax(240px, 300px);
        gap: 28px;
        align-items: start;
      }
      .hero-copy .lede { margin-bottom: 0; }
      .hero-card p + p { margin-top: 10px; }
      .hero-card .primary { width: 100%; text-align: center; margin-top: 14px; }
      .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .ctas { align-items: center; gap: 16px; }
      .cta-early {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 12px;
        flex: 0 0 auto;
      }
      .cta-early .ghost { flex-shrink: 0; white-space: nowrap; }
      .cta-early .sub {
        margin: 0;
        max-width: 18rem;
        font-size: 13px;
        line-height: 1.35;
        color: var(--muted);
      }
      .viz {
        margin-top: 36px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--panel);
      }
      .viz img { width: 100%; height: auto; display: block; }
      a.viz { color: inherit; text-decoration: none; display: block; }
      a.viz:hover { text-decoration: none; border-color: var(--line-2); }
      .ex-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 14px 0 0;
      }
      .ex {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 5px 10px 5px 7px;
        font-size: 12px;
        color: var(--muted);
      }
      .ex img { width: 20px; height: 20px; border-radius: 4px; object-fit: cover; display: block; }
      .ex-note { color: var(--dim); font-size: 12px; margin: 10px 0 0; }
      section { margin-top: 72px; }
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 18px;
      }
      .card h3 { margin: 0 0 8px; font-size: 16px; }
      .card p, .card ul { margin: 0; color: var(--muted); }
      .card ul { padding-left: 1.15rem; }
      .card li { margin: 6px 0; }
      .card .row { margin-top: 14px; }
      input[type="email"] {
        background: var(--bg);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 8px 10px;
        color: var(--text);
        font: inherit;
        min-width: 180px;
        flex: 1;
        outline: none;
      }
      input:focus { border-color: var(--line-2); }
      .note { color: var(--dim); font-size: 12px; margin: 8px 0 0; }
      .ok { color: var(--text); font-size: 13px; margin: 8px 0 0; }
      .err { color: #f25c6e; font-size: 13px; margin: 8px 0 0; }
      .band {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 28px 24px;
        background: var(--panel);
      }
      footer {
        margin-top: 72px;
        padding-top: 24px;
        border-top: 1px solid var(--line);
        color: var(--dim);
        font-size: 13px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }
      footer strong { color: var(--text); }
      footer .mail { color: var(--muted); }
      .overlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .overlay[hidden] { display: none; }
      .overlay-back {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.72);
      }
      .overlay-card {
        position: relative;
        width: min(420px, 100%);
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 24px 24px 22px;
      }
      .overlay-card h2 { font-size: 22px; margin: 0 0 10px; letter-spacing: -0.03em; }
      .overlay-card .lede { margin: 0 0 18px; max-width: none; }
      .overlay-card form { display: flex; flex-direction: column; gap: 10px; }
      .overlay-card .primary { width: 100%; text-align: center; }
      .overlay-x {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        color: var(--muted);
        font-size: 18px;
        line-height: 1;
        padding: 4px 8px;
        cursor: pointer;
      }
      .overlay-x:hover { color: var(--text); }
      body.overlay-open { overflow: hidden; }
      @media (max-width: 800px) {
        h1 { font-size: 28px; }
        h2 { font-size: 22px; }
        .grid2, .grid3, .hero { grid-template-columns: 1fr; }
        .viz { height: auto; }
        .topnav .primary { width: 100%; text-align: center; }
      }
    </style>
  </head>
  <body>
    <nav class="topnav">
      <a class="brand" href="/">Ten Figures</a>
      <div class="nav-spacer"></div>
      <a class="primary" href="${esc(appHref)}">Open Demo</a>
    </nav>

    <div class="wrap">
      <div class="hero">
        <div class="hero-copy">
          <p class="kicker">Ten Figures Trading Panel</p>
          <h1>One clear view on all your trades.</h1>
          <p class="lede">
            Open, manage, and close positions across multiple exchanges — all from one trading panel.
          </p>
          <div class="row ctas" style="margin-top:22px">
            <a class="primary" href="${esc(appHref)}">Open Demo</a>
            <div class="cta-early">
              <a class="ghost js-early" href="#join">Get early access</a>
              <p class="sub">First 100 get first month free and lock in 50% off subscription.</p>
            </div>
          </div>
        </div>
        <div class="card hero-card">
          <h3>Lifetime Access</h3>
          <p>Help fund the setup of the Ten Figures Trading Panel.</p>
          <p>Contribute and receive lifetime access, plus free membership in the Ten Figures Club.</p>
          <a class="primary" href="${esc(GFM_CAMPAIGN)}" target="_blank" rel="noopener noreferrer">Donate now</a>
        </div>
      </div>
      <a class="viz" href="${esc(appHref)}">
        <img src="/screens/landing-panel.png?v=2" alt="Ten Figures Trading Panel — open positions" />
      </a>
      <div class="ex-row">
        <span class="ex"><img src="/screens/ex/binance.png" alt="" width="20" height="20" />Binance</span>
        <span class="ex"><img src="/screens/ex/mexc.png" alt="" width="20" height="20" />MEXC</span>
        <span class="ex"><img src="/screens/ex/gate.png" alt="" width="20" height="20" />Gate.io</span>
        <span class="ex"><img src="/screens/ex/bitget.png" alt="" width="20" height="20" />Bitget</span>
        <span class="ex"><img src="/screens/ex/bybit.png" alt="" width="20" height="20" />Bybit</span>
        <span class="ex"><img src="/screens/ex/kraken.png" alt="" width="20" height="20" />Kraken</span>
        <span class="ex"><img src="/screens/ex/hyperliquid.png" alt="" width="20" height="20" />Hyperliquid</span>
        <span class="ex"><img src="/screens/ex/lighter.png" alt="" width="20" height="20" />Lighter</span>
      </div>

      <section>
        <p class="kicker">Everything in one place</p>
        <h2>Plan the trade. Control the position.</h2>
        <p class="lede">See the full position clearly. Adjust the size, update your targets and manage your risk from the same screen.</p>
        <div class="grid2">
          <div class="card">
            <h3>Enter with precision</h3>
            <p>Choose your direction, entry and position size from one panel.</p>
          </div>
          <div class="card">
            <h3>Manage the position</h3>
            <p>Add to your position, reduce it or close it whenever you need.</p>
          </div>
          <div class="card">
            <h3>Set your targets</h3>
            <p>Create and adjust take-profit levels as the market moves.</p>
          </div>
          <div class="card">
            <h3>Control your risk</h3>
            <p>Place your stop loss and keep every part of the trade visible.</p>
          </div>
        </div>
      </section>

      <section>
        <p class="kicker">Your exchange. Your funds.</p>
        <h2>Stay in control.</h2>
        <p class="lede">Your funds remain on your exchange. The Trading Panel helps you manage orders and positions without taking custody of your assets.</p>
      </section>

      <footer>
        <strong>Ten Figures Club</strong>
        <a class="mail" href="mailto:info@tenfigures.club">info@tenfigures.club</a>
      </footer>
    </div>
    <div id="early" class="overlay" hidden>
      <div class="overlay-back" data-close="1"></div>
      <div class="overlay-card" role="dialog" aria-labelledby="early-title" aria-modal="true">
        <button type="button" class="overlay-x" data-close="1" aria-label="Close">×</button>
        <h2 id="early-title">Early Access</h2>
        <p class="lede">First 100 get first month free and lock in 50% off subscription.</p>
        <form id="wait">
          <input type="email" name="email" required placeholder="you@email.com" autocomplete="email" />
          <button class="primary" type="submit">Get early access</button>
        </form>
        <p class="note" id="spots"></p>
        <p class="ok" id="ok" hidden></p>
        <p class="err" id="err" hidden></p>
      </div>
    </div>
    <script>
      const overlay = document.getElementById("early");
      const spots = document.getElementById("spots");
      const ok = document.getElementById("ok");
      const err = document.getElementById("err");
      const email = overlay.querySelector('input[name="email"]');
      function setSpots(n) {
        if (typeof n === "number") spots.textContent = n + " spots left.";
      }
      function openEarly(e) {
        if (e) e.preventDefault();
        overlay.hidden = false;
        document.body.classList.add("overlay-open");
        if (location.hash !== "#join") history.replaceState(null, "", "#join");
        email.focus();
      }
      function closeEarly() {
        overlay.hidden = true;
        document.body.classList.remove("overlay-open");
        if (location.hash === "#join") history.replaceState(null, "", location.pathname + location.search);
      }
      fetch("/api/waitlist").then((r) => r.json()).then((d) => setSpots(d.remaining)).catch(() => {});
      document.querySelectorAll(".js-early").forEach((el) => el.addEventListener("click", openEarly));
      overlay.addEventListener("click", (e) => {
        if (e.target.dataset.close) closeEarly();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !overlay.hidden) closeEarly();
      });
      if (location.hash === "#join") openEarly();
      document.getElementById("wait").addEventListener("submit", async (e) => {
        e.preventDefault();
        ok.hidden = true;
        err.hidden = true;
        const value = new FormData(e.target).get("email");
        try {
          const res = await fetch("/api/waitlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: value }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            err.textContent = data.error || "Could not join";
            err.hidden = false;
            return;
          }
          ok.textContent = data.already ? ${JSON.stringify(WAITLIST_ALREADY_MSG)} : ${JSON.stringify(WAITLIST_OK_MSG)};
          ok.hidden = false;
          setSpots(data.remaining);
        } catch (x) {
          err.textContent = "Could not join";
          err.hidden = false;
        }
      });
    </script>
    <script>
      window.$crisp = [];
      window.CRISP_WEBSITE_ID = "${CRISP_WEBSITE_ID}";
      (function () {
        var d = document;
        var s = d.createElement("script");
        s.src = "${CRISP_SCRIPT}";
        s.async = true;
        d.getElementsByTagName("head")[0].appendChild(s);
      })();
    </script>
  </body>
</html>`;
}
