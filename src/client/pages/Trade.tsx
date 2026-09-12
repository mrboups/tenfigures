import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { Coin, Err, HelpLink, IconRefresh, IconStar, Seg, TfStack, Toggle } from "../ui.tsx";
import { SplitTargetsModal } from "../SplitTargets.tsx";
import { OrderChart } from "../OrderChart.tsx";
import type { TpTarget } from "../../shared/types.ts";
import {
  formatNum,
  formatSignedQuote,
  percentFromPrices,
  pnl,
  priceFromPercent,
  protectForSide,
} from "../../shared/money.ts";
import type {
  BalanceInfo,
  CreateTradeBody,
  EntryType,
  ExchangeAccount,
  LeverageCaps,
  MarginMode,
  MarketInfo,
  OpenPosition,
  Side,
  SlType,
  TickerInfo,
  TpType,
} from "../../shared/types.ts";
import { allowedLeverageSteps, marketTypeLabel, PANEL_MAX_LEVERAGE } from "../../shared/types.ts";
import {
  INDICATORS,
  emptyTfBias,
  type IndicatorId,
  type TfBias,
} from "../../shared/demark.ts";
import { onIndicatorChange, readIndicators } from "../indicator.ts";
import {
  isStarred,
  labelPair,
  onStarsChange,
  OPEN_TRADE,
  readStars,
  toggleStar,
} from "../stars.ts";

function displayPair(symbol: string): string {
  return labelPair(symbol);
}

function PairPicker({
  exchangeId,
  value,
  markets,
  owned,
  balanceLabel,
  onChange,
}: {
  exchangeId: string;
  value: string;
  markets: MarketInfo[];
  owned: (base: string) => string;
  balanceLabel: string;
  onChange: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [stars, setStars] = useState(() => readStars());
  const wrap = useRef<HTMLDivElement>(null);
  const market = markets.find((m) => m.symbol === value);
  const starred = Boolean(exchangeId && value && isStarred(exchangeId, value));

  useEffect(() => onStarsChange(() => setStars(readStars())), []);

  useEffect(() => {
    if (!open) return;
    function down(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const qn = q.trim().toLowerCase();
  const filtered = markets.filter((m) => {
    if (!qn) return true;
    return (
      displayPair(m.symbol).toLowerCase().includes(qn) || m.base.toLowerCase().includes(qn)
    );
  });
  const starSet = new Set(
    stars.filter((s) => s.exchangeId === exchangeId).map((s) => s.symbol),
  );
  const rows = [
    ...filtered.filter((m) => starSet.has(m.symbol)),
    ...filtered.filter((m) => !starSet.has(m.symbol)),
  ];

  return (
    <div className={`sel pair-sel${open ? " open" : ""}`} ref={wrap}>
      <Coin symbol={market?.base || "P"} />
      <button type="button" className="pair-trigger" onClick={() => setOpen((o) => !o)}>
        {value ? displayPair(value) : "Select pair"}
      </button>
      {value && exchangeId && (
        <button
          type="button"
          className={`star-btn${starred ? " on" : ""}`}
          title={starred ? "Unstar" : "Star this pair"}
          onClick={() => toggleStar(exchangeId, value)}
        >
          <IconStar on={starred} />
        </button>
      )}
      <span className="bal">{balanceLabel}</span>
      {open && (
        <div className="pair-drop">
          <input
            autoFocus
            placeholder="Search pair"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="pair-list">
            {rows.length === 0 && <div className="pair-empty">No pairs</div>}
            {rows.map((m) => {
              const on = starSet.has(m.symbol);
              return (
                <div key={m.symbol} className={`pair-row${m.symbol === value ? " on" : ""}`}>
                  <button
                    type="button"
                    className="pair-pick"
                    onClick={() => {
                      onChange(m.symbol);
                      setOpen(false);
                      setQ("");
                    }}
                  >
                    <span className="pair-pick-name">
                      <Coin symbol={m.base} />
                      <span>{displayPair(m.symbol)}</span>
                    </span>
                    <span className="muted">{owned(m.base)}</span>
                  </button>
                  <button
                    type="button"
                    className={`star-btn${on ? " on" : ""}`}
                    title={on ? "Unstar" : "Star"}
                    onClick={() => toggleStar(exchangeId, m.symbol)}
                  >
                    <IconStar on={on} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function pickQuote(quotes: string[], prev: string): string {
  if (prev && quotes.includes(prev)) return prev;
  if (quotes.includes("USDT")) return "USDT";
  if (quotes.includes("USD")) return "USD";
  if (quotes.includes("BTC")) return "BTC";
  return quotes[0] ?? "";
}

const TRADE_SESSION = "tradr.trade";

type TradeSession = { exchangeId?: string; quote?: string; pair?: string };

function readTradeSession(): TradeSession {
  try {
    return JSON.parse(sessionStorage.getItem(TRADE_SESSION) || "{}") as TradeSession;
  } catch {
    return {};
  }
}

function writeTradeSession(next: TradeSession) {
  try {
    sessionStorage.setItem(TRADE_SESSION, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function fmt(n: number | null | undefined, d = 8): string {
  if (n == null || !Number.isFinite(n)) return "0";
  return formatNum(n, d);
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtOwned(n: number): string {
  if (!(n > 0)) return "0";
  if (n >= 10000) return formatNum(n, 0);
  if (n >= 100) return formatNum(n, 2);
  if (n >= 1) return formatNum(n, 4);
  return formatNum(n, 6);
}

function quotePnl(side: Side, entry: number, exit: number, amount: number): number {
  if (!(amount > 0) || !(entry > 0) || !(exit > 0)) return 0;
  return pnl(side, entry, exit, amount).quote;
}

function PctInput({
  value,
  onChange,
  quoteAmt,
  quote,
}: {
  value: string;
  onChange: (v: string) => void;
  quoteAmt: number;
  quote: string;
}) {
  const neg = quoteAmt < 0 || (quoteAmt === 0 && num(value) < 0);
  return (
    <div className="input-wrap pct-field">
      <input className="mono" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className={`suffix-pct${neg ? " neg" : ""}`}>
        {formatSignedQuote(quoteAmt, quote)}
      </span>
      <span className="unit">%</span>
    </div>
  );
}

function ownedOf(bal: BalanceInfo | null, asset: string): number {
  return bal?.byAsset[asset]?.total ?? 0;
}

function orientTpsl(
  orderSide: Side,
  entry: number,
  tpPrice: string,
  slPrice: string,
  tpPct: string,
  slPct: string,
  trailTpPct: string,
) {
  const tpP = Math.abs(num(tpPct)) || 0;
  const slP = Math.abs(num(slPct)) || 0;
  const trailP = Math.abs(num(trailTpPct)) || 0;
  if (orderSide === "buy") {
    return {
      tpPrice: num(tpPrice) > entry ? tpPrice : fmt(priceFromPercent(entry, tpP), 8),
      slPrice: num(slPrice) > 0 && num(slPrice) < entry ? slPrice : fmt(priceFromPercent(entry, -slP), 8),
      tpPct: fmt(tpP, 2),
      slPct: fmt(-slP, 2),
      trailTpPct: fmt(-trailP, 2),
    };
  }
  return {
    tpPrice: num(tpPrice) > 0 && num(tpPrice) < entry ? tpPrice : fmt(priceFromPercent(entry, -tpP), 8),
    slPrice: num(slPrice) > entry ? slPrice : fmt(priceFromPercent(entry, slP), 8),
    tpPct: fmt(-tpP, 2),
    slPct: fmt(slP, 2),
    trailTpPct: fmt(trailP, 2),
  };
}

export function TradePage({ go }: { go: (p: string) => void }) {
  const [accounts, setAccounts] = useState<ExchangeAccount[]>([]);
  const [exchangeId, setExchangeId] = useState("");
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [quotes, setQuotes] = useState<string[]>([]);
  const [quote, setQuote] = useState("");
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [pair, setPair] = useState("");
  const [ticker, setTicker] = useState<TickerInfo | null>(null);
  const [orderSide, setOrderSide] = useState<Side>("buy");
  const [plainMode, setPlainMode] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<CreateTradeBody | null>(null);

  const [useExisting, setUseExisting] = useState(false);
  const [coldStart, setColdStart] = useState(true);
  const [amount, setAmount] = useState("0");
  const [totalStr, setTotalStr] = useState("0");
  const [sizeEdit, setSizeEdit] = useState<"amount" | "total">("amount");
  const [entryType, setEntryType] = useState<EntryType>("market");
  const [entryPrice, setEntryPrice] = useState("");
  const [trailBuy, setTrailBuy] = useState(false);
  const [trailBuyPct, setTrailBuyPct] = useState("1");

  const [tpOn, setTpOn] = useState(true);
  const [tpType, setTpType] = useState<TpType>("market");
  const [tpPrice, setTpPrice] = useState("");
  const [tpPct, setTpPct] = useState("10");
  const [trailTp, setTrailTp] = useState(false);
  const [trailTpPct, setTrailTpPct] = useState("-5");
  const [tpReduceOnly, setTpReduceOnly] = useState(true);
  const [tpSplits, setTpSplits] = useState<TpTarget[]>([]);
  const [splitOpen, setSplitOpen] = useState(false);

  const [slOn, setSlOn] = useState(true);
  const [slType, setSlType] = useState<SlType>("cond_market");
  const [slPrice, setSlPrice] = useState("");
  const [slPct, setSlPct] = useState("-5");
  const [slReduceOnly, setSlReduceOnly] = useState(true);
  const [slTimeout, setSlTimeout] = useState(false);
  const [slTimeoutSec, setSlTimeoutSec] = useState("300");
  const [trailSl, setTrailSl] = useState(false);
  const [breakeven, setBreakeven] = useState(false);
  const [leverage, setLeverage] = useState(3);
  const [marginMode, setMarginMode] = useState<MarginMode>("isolated");
  const [held, setHeld] = useState(0);
  const [heldNote, setHeldNote] = useState("");
  const [heldErr, setHeldErr] = useState("");
  const [heldSide, setHeldSide] = useState<Side | null>(null);
  const [heldBusy, setHeldBusy] = useState(false);
  const [tickerBusy, setTickerBusy] = useState(false);
  const [caps, setCaps] = useState<LeverageCaps | null>(null);
  const [bias, setBias] = useState<Partial<Record<IndicatorId, TfBias[]>>>({});
  const [indicators, setIndicators] = useState(() => readIndicators());

  const account = accounts.find((a) => a.id === exchangeId);
  const isFutures = account?.marketType === "swap";
  const isPlain = !isFutures && plainMode;
  const market = markets.find((m) => m.symbol === pair);
  const base = market?.base ?? (pair.split("/")[0] || "");
  const side: Side = orderSide;
  const pairTitle = base && quote ? `${base} / ${quote}` : base || quote || "—";
  const last = ticker?.last ?? 0;
  const refPrice =
    entryType === "market"
      ? isFutures
        ? last
        : side === "buy"
          ? ticker?.ask ?? last
          : ticker?.bid ?? last
      : num(entryPrice) || last;
  const total = num(amount) * (refPrice || 0);
  const tpQuoteAmt = quotePnl(side, refPrice, num(tpPrice), num(amount));
  const slQuoteAmt = quotePnl(side, refPrice, num(slPrice), num(amount));
  const quoteFree = balance?.byAsset[quote]?.free ?? 0;
  const baseFree = balance?.byAsset[base]?.free ?? 0;

  const minAmtErr =
    !useExisting &&
    market?.minAmount != null &&
    num(amount) > 0 &&
    num(amount) < market.minAmount
      ? `Trade does not meet minimum requirements: ${market.minAmount} ${base}`
      : "";
  const minCostErr =
    !useExisting &&
    market?.minCost != null &&
    total > 0 &&
    total < market.minCost
      ? `Trade does not meet minimum requirements: ${market.minCost} ${quote}`
      : "";
  const tooSmall = num(amount) <= 0 ? "Amount is too small to make an order" : "";
  const leverageMax = Math.min(
    PANEL_MAX_LEVERAGE,
    Math.max(
      1,
      Math.floor(
        (marginMode === "cross" ? caps?.crossMax : caps?.isolatedMax) ??
          market?.maxLeverage ??
          PANEL_MAX_LEVERAGE,
      ),
    ),
  );
  const leverageSteps = allowedLeverageSteps(leverageMax);

  useEffect(() => {
    api.exchanges().then((r) => {
      setAccounts(r.exchanges);
      if (!r.exchanges.length || exchangeId) return;
      const saved = readTradeSession();
      const match = r.exchanges.find((a) => a.id === saved.exchangeId);
      setExchangeId(match?.id ?? r.exchanges[0]!.id);
    });
  }, []);

  useEffect(() => {
    if (!exchangeId) return;
    let live = true;
    setError("");
    setMarkets([]);
    setTicker(null);
    setBalance(null);
    const saved = readTradeSession();
    const keepQuote = saved.exchangeId === exchangeId ? saved.quote ?? "" : "";
    api
      .balance(exchangeId)
      .then((b) => {
        if (live) setBalance(b);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    api
      .markets(exchangeId)
      .then((r) => {
        if (!live) return;
        setQuotes(r.quotes);
        setQuote((prev) => pickQuote(r.quotes, prev || keepQuote));
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [exchangeId]);

  useEffect(() => {
    if (!exchangeId || !quote) return;
    let live = true;
    const saved = readTradeSession();
    const keepPair = saved.exchangeId === exchangeId ? saved.pair ?? "" : "";
    api
      .markets(exchangeId, quote)
      .then((r) => {
        if (!live) return;
        const list = r.markets.filter((m) => m.active);
        setMarkets(list);
        setPair((prev) => {
          if (prev && list.some((m) => m.symbol === prev)) return prev;
          if (keepPair && list.some((m) => m.symbol === keepPair)) return keepPair;
          return list[0]?.symbol ?? "";
        });
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [exchangeId, quote]);

  useEffect(() => {
    if (!exchangeId || !pair) return;
    writeTradeSession({ exchangeId, quote, pair });
  }, [exchangeId, quote, pair]);

  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent<{ exchangeId: string; symbol: string }>).detail;
      if (!d?.exchangeId || !d.symbol) return;
      const q = d.symbol.replace(/:.*$/, "").split("/")[1] ?? "";
      setExchangeId(d.exchangeId);
      if (q) setQuote(q);
      setPair(d.symbol);
      setTicker(null);
      setEntryPrice("");
    }
    window.addEventListener(OPEN_TRADE, onOpen);
    return () => window.removeEventListener(OPEN_TRADE, onOpen);
  }, []);

  useEffect(() => {
    setLeverage((prev) => {
      if (leverageSteps.includes(prev)) return prev;
      const lower = leverageSteps.filter((s) => s <= prev);
      return lower[lower.length - 1] ?? leverageSteps[0] ?? 2;
    });
  }, [pair, marginMode, leverageSteps.join(",")]);

  useEffect(() => {
    if (isFutures) {
      setUseExisting(false);
      setPlainMode(false);
    }
  }, [isFutures]);

  useEffect(() => {
    if (tpSplits.length < 2) setBreakeven(false);
  }, [tpSplits.length]);

  useEffect(() => {
    if (!isFutures || !exchangeId || !pair) {
      setCaps(null);
      return;
    }
    let live = true;
    api
      .leverage(exchangeId, pair)
      .then((r) => {
        if (live) setCaps(r.caps);
      })
      .catch(() => {
        if (live) setCaps(null);
      });
    return () => {
      live = false;
    };
  }, [isFutures, exchangeId, pair]);

  useEffect(() => {
    if (!useExisting || !exchangeId || !pair) {
      setHeld(0);
      setHeldNote("");
      setHeldErr("");
      setHeldSide(null);
      return;
    }
    let live = true;
    setHeldBusy(true);
    setHeldErr("");
    api
      .position(exchangeId, pair)
      .then((r) => {
        if (!live) return;
        applyHeld(r.position);
      })
      .catch((e) => {
        if (!live) return;
        setHeld(0);
        setHeldNote("");
        setHeldSide(null);
        setHeldErr(e instanceof Error ? e.message : "Could not read position");
      })
      .finally(() => {
        if (live) setHeldBusy(false);
      });
    return () => {
      live = false;
    };
  }, [useExisting, exchangeId, pair]);

  useEffect(() => {
    if (!exchangeId || !pair) return;
    if (!markets.some((m) => m.symbol === pair)) return;
    let live = true;
    const load = (manual = false) => {
      if (manual) setTickerBusy(true);
      return api
        .ticker(exchangeId, pair)
        .then((r) => {
          if (!live) return;
          setTicker(r.ticker);
        })
        .finally(() => {
          if (manual && live) setTickerBusy(false);
        });
    };
    load().catch((e) => {
      if (live) setError(e.message);
    });
    const es = new EventSource(
      `/api/stream/ticker?exchangeId=${encodeURIComponent(exchangeId)}&symbol=${encodeURIComponent(pair)}`,
    );
    es.addEventListener("ticker", (ev) => {
      if (!live) return;
      try {
        setTicker(JSON.parse((ev as MessageEvent).data) as TickerInfo);
      } catch {
        /* ignore */
      }
    });
    const t = setInterval(() => load().catch(() => undefined), 8000);
    return () => {
      live = false;
      es.close();
      clearInterval(t);
    };
  }, [exchangeId, pair, markets]);

  useEffect(() => onIndicatorChange(() => setIndicators(readIndicators())), []);

  useEffect(() => {
    if (!exchangeId || !pair) {
      setBias({});
      return;
    }
    if (!indicators.length) {
      setBias({});
      return;
    }
    if (!markets.some((m) => m.symbol === pair)) return;
    let live = true;
    setBias({});
    const apply = (byIndicator?: Partial<Record<IndicatorId, TfBias[]>>) => {
      if (live) setBias(byIndicator ?? {});
    };
    api
      .biasMany([{ exchangeId, symbol: pair }], indicators)
      .then((r) => apply(r.results[0]?.byIndicator))
      .catch(() => apply({}));
    const t = setInterval(() => {
      api
        .biasMany([{ exchangeId, symbol: pair }], indicators)
        .then((r) => apply(r.results[0]?.byIndicator))
        .catch(() => undefined);
    }, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [exchangeId, pair, markets, indicators]);

  useEffect(() => {
    if (!ticker) return;
    const px = side === "buy" ? ticker.ask || ticker.last : ticker.bid || ticker.last;
    setEntryPrice(fmt(px, 8));
    if (!(px > 0)) return;
    if (tpOn && tpPct) setTpPrice(fmt(priceFromPercent(px, num(tpPct)), 8));
    if (slOn && slPct) setSlPrice(fmt(priceFromPercent(px, num(slPct)), 8));
  }, [ticker?.symbol]);

  useEffect(() => {
    const px = refPrice;
    if (!(px > 0)) return;
    if (sizeEdit === "total") {
      const t = num(totalStr);
      if (t > 0) setAmount(fmt(t / px, 8));
    } else {
      setTotalStr(fmt(num(amount) * px, 8));
    }
  }, [refPrice]);

  function setSizeFromAmount(v: string) {
    setSizeEdit("amount");
    setAmount(v);
    const px = refPrice || last;
    setTotalStr(px > 0 ? fmt(num(v) * px, 8) : "0");
  }

  function setSizeFromTotal(v: string) {
    setSizeEdit("total");
    setTotalStr(v);
    const px = refPrice || last;
    setAmount(px > 0 ? fmt(num(v) / px, 8) : "0");
  }

  function applyHeld(pos: OpenPosition | null) {
    if (!pos || !(pos.amount > 0)) {
      setHeld(0);
      setHeldNote("");
      setHeldSide(null);
      setHeldErr(
        isFutures
          ? `No open position on ${displayPair(pair)}`
          : `No ${base} holdings on this account`,
      );
      return;
    }
    setHeldErr("");
    setHeld(pos.amount);
    setHeldSide(pos.side);
    setOrderSide(pos.side);
    setSizeFromAmount(fmt(pos.amount, 8));
    setTrailBuy(false);
    if (pos.entryPrice != null && pos.entryPrice > 0) {
      onEntryPrice(fmt(pos.entryPrice, 8));
    }
    if (pos.leverage != null && pos.leverage >= 1) {
      const rounded = Math.round(pos.leverage);
      const lower = leverageSteps.filter((s) => s <= rounded);
      setLeverage(lower[lower.length - 1] ?? leverageSteps[0] ?? 2);
    }
    if (pos.marginMode) setMarginMode(pos.marginMode);
    const sideLabel = pos.side === "sell" ? "Short" : "Long";
    const px =
      pos.entryPrice != null && pos.entryPrice > 0 ? ` @ ${fmt(pos.entryPrice, 8)} ${quote}` : "";
    setHeldNote(`${sideLabel} ${fmt(pos.amount, 8)} ${base}${px}`);
  }

  async function refreshPrice() {
    if (!exchangeId || !pair) return;
    setTickerBusy(true);
    try {
      const r = await api.ticker(exchangeId, pair);
      setTicker(r.ticker);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh price");
    } finally {
      setTickerBusy(false);
    }
  }

  function onEntryPrice(v: string) {
    setEntryPrice(v);
    const entry = num(v);
    if (!entry) return;
    if (tpOn) setTpPrice(fmt(priceFromPercent(entry, num(tpPct)), 8));
    if (slOn) setSlPrice(fmt(priceFromPercent(entry, num(slPct)), 8));
  }

  function onChartPrice(price: number) {
    if (entryType === "market" || entryType === "signal") setEntryType("limit");
    onEntryPrice(fmt(price, 8));
  }

  function onChartPosition(p: { side: Side; entry: number; tp: number; sl: number }) {
    if (entryType === "market" || entryType === "signal") setEntryType("limit");
    setOrderSide(p.side);
    onEntryPrice(fmt(p.entry, 8));
    setTpOn(true);
    setTpPrice(fmt(p.tp, 8));
    setTpPct(fmt(percentFromPrices(p.entry, p.tp), 2));
    setSlOn(true);
    setSlPrice(fmt(p.sl, 8));
    setSlPct(fmt(percentFromPrices(p.entry, p.sl), 2));
  }

  function applyOrderSide(next: Side) {
    if (next === orderSide) return;
    setOrderSide(next);
    const marketPx =
      next === "buy" ? ticker?.ask ?? last : ticker?.bid ?? last;
    const entry =
      entryType === "market"
        ? (isFutures ? last : marketPx) || last
        : num(entryPrice) || marketPx || last;
    if (entryType === "market" && entry > 0) setEntryPrice(fmt(entry, 8));
    if (!(entry > 0)) return;
    const levels = protectForSide(next, entry, num(tpPct), num(slPct));
    if (levels.tpPrice != null) {
      setTpPrice(fmt(levels.tpPrice, 8));
      setTpPct(fmt(levels.tpPercent ?? 0, 2));
    }
    if (levels.slPrice != null) {
      setSlPrice(fmt(levels.slPrice, 8));
      setSlPct(fmt(levels.slPercent ?? 0, 2));
    }
    const trailAbs = Math.abs(num(trailTpPct)) || 0;
    setTrailTpPct(fmt(next === "buy" ? -trailAbs : trailAbs, 2));
    setTpSplits((prev) =>
      prev.map((t) => {
        const pctAbs = Math.abs(
          t.percent != null && t.percent !== ""
            ? num(t.percent)
            : percentFromPrices(entry, num(t.price)),
        );
        const lv = protectForSide(next, entry, pctAbs, null);
        return {
          ...t,
          price: lv.tpPrice != null ? fmt(lv.tpPrice, 8) : t.price,
          percent: lv.tpPercent != null ? fmt(lv.tpPercent, 2) : t.percent,
        };
      }),
    );
  }

  function onTpPrice(v: string) {
    setTpPrice(v);
    const entry = refPrice;
    if (entry) setTpPct(fmt(percentFromPrices(entry, num(v)), 2));
  }
  function onTpPct(v: string) {
    setTpPct(v);
    if (refPrice) setTpPrice(fmt(priceFromPercent(refPrice, num(v)), 8));
  }
  function onSlPrice(v: string) {
    setSlPrice(v);
    if (refPrice) setSlPct(fmt(percentFromPrices(refPrice, num(v)), 2));
  }
  function onSlPct(v: string) {
    setSlPct(v);
    if (refPrice) setSlPrice(fmt(priceFromPercent(refPrice, num(v)), 8));
  }

  function applyPct(p: number) {
    const px = refPrice || last;
    if (!px) return;
    const lev = isFutures ? Math.max(1, leverage) : 1;
    const spend = quoteFree * (p / 100) * lev;
    const amt = useExisting ? (held || baseFree) * (p / 100) : spend / px;
    setSizeFromAmount(fmt(amt, 8));
  }

  const usd =
    balance?.totalUsd != null
      ? `$${balance.totalUsd.toFixed(2)}`
      : quote
        ? `${fmt(quoteFree, 4)} ${quote}`
        : "—";

  function makeBody(orderSide: Side): CreateTradeBody {
    const px =
      entryType === "market"
        ? orderSide === "buy"
          ? ticker?.ask ?? last
          : ticker?.bid ?? last
        : num(entryPrice) || last;
    const levels =
      px > 0
        ? orientTpsl(orderSide, px, tpPrice, slPrice, tpPct, slPct, trailTpPct)
        : {
            tpPrice,
            slPrice,
            tpPct,
            slPct,
            trailTpPct,
          };
    const withTpsl = !isPlain;
    return {
      exchangeId,
      pair,
      side: orderSide,
      kind: isPlain
        ? "simple"
        : isFutures
          ? "smart"
          : orderSide === "sell"
            ? "cover"
            : "smart",
      amount,
      useExistingAssets: isFutures ? false : useExisting,
      entryType:
        entryType === "signal"
          ? "signal"
          : trailBuy && !useExisting
            ? "conditional"
            : entryType,
      signalIndicator: entryType === "signal" ? null : undefined,
      entryPrice:
        trailBuy && !useExisting
          ? entryPrice
          : entryType === "market"
            ? String(px)
            : entryPrice,
      trailingEntryEnabled: useExisting || entryType === "signal" ? false : trailBuy,
      trailingEntryPercent: trailBuy && entryType !== "signal" ? trailBuyPct : null,
      tpEnabled: withTpsl ? tpOn : false,
      tpType: withTpsl && tpOn ? tpType : null,
      tpPrice: withTpsl && tpOn ? (tpSplits[0]?.price ?? levels.tpPrice) : null,
      tpPercent: withTpsl && tpOn ? (tpSplits[0]?.percent ?? levels.tpPct) : null,
      tpTargets: withTpsl && tpOn && tpSplits.length ? tpSplits : undefined,
      trailingTpEnabled: trailTp && tpSplits.length <= 1,
      trailingTpPercent: trailTp ? levels.trailTpPct : null,
      tpReduceOnly: isFutures && withTpsl && tpOn ? tpReduceOnly : false,
      slEnabled: withTpsl ? slOn : false,
      slType: withTpsl && slOn ? slType : null,
      slTrigger: "last",
      slPrice: withTpsl && slOn ? levels.slPrice : null,
      slPercent: withTpsl && slOn ? levels.slPct : null,
      slTimeoutEnabled: slTimeout,
      slTimeoutSec: slTimeout ? Number(slTimeoutSec) : null,
      trailingSlEnabled: trailSl,
      slReduceOnly: isFutures && withTpsl && slOn ? slReduceOnly : false,
      moveToBreakeven: breakeven && tpSplits.length >= 2,
      leverage: isFutures ? leverage : null,
      marginMode: isFutures ? marginMode : null,
      coldStart: isPlain ? false : entryType === "signal" ? true : coldStart,
    };
  }

  function makeSignalBody(id: IndicatorId): CreateTradeBody {
    return {
      ...makeBody("buy"),
      kind: "smart",
      entryType: "signal",
      signalIndicator: id,
      coldStart: true,
      trailingEntryEnabled: false,
      trailingEntryPercent: null,
    };
  }

  async function submit() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      if (confirm.kind === "simple") {
        await api.simpleOrder({
          exchangeId: confirm.exchangeId,
          pair: confirm.pair,
          side: confirm.side,
          type: confirm.entryType === "limit" ? "limit" : "market",
          amount: confirm.amount,
          price: confirm.entryType === "limit" ? (confirm.entryPrice ?? null) : null,
          leverage: confirm.leverage ?? null,
          marginMode: confirm.marginMode ?? null,
        });
      } else {
        await api.createTrade(confirm);
      }
      setConfirm(null);
      go("/positions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  if (!accounts.length) {
    return (
      <div className="page">
        <div className="empty">
          Connect an exchange first.
          <div style={{ marginTop: 12 }}>
            <button className="primary" style={{ width: "auto" }} onClick={() => go("/exchanges")}>
              Connect exchange
            </button>
          </div>
        </div>
      </div>
    );
  }

  const helperEntry = useExisting
    ? "No new entry is sent. Take-profit and stop-loss use this price as the fill."
    : entryType === "market"
      ? isFutures
        ? "Opens at the market price after the trade is created"
        : "Will buy at actual rates after the trade is created"
      : entryType === "conditional"
        ? "The order is placed when the last price reaches the entry"
        : entryType === "signal"
          ? "Waits until every timeframe of the indicator is green (Long) or red (Short), then enters at market"
          : "Limit rests on the exchange order book";

  return (
    <div className="page">
      {error && <div className="banner">{error}</div>}
      <div
        className={`ticket-head${isFutures ? " has-lev" : ""} has-cold`}
      >
        <div>
          <div className="sel-label">Exchange</div>
          <div className="sel">
            <Coin symbol={account?.venue ?? "X"} />
            <select
              value={exchangeId}
              onChange={(e) => {
                setExchangeId(e.target.value);
                setPair("");
                setQuote("");
                setMarkets([]);
                setTicker(null);
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} | {a.venue} {marketTypeLabel(a.marketType)}
                </option>
              ))}
            </select>
            <span className="bal">{usd}</span>
          </div>
        </div>
        <div>
          <div className="sel-label">Market</div>
          <div className="sel">
            <Coin symbol={quote || "Q"} />
            <select value={quote} onChange={(e) => setQuote(e.target.value)}>
              {quotes.map((q) => (
                <option key={q} value={q}>
                  {q} · {fmtOwned(ownedOf(balance, q))}
                </option>
              ))}
            </select>
            <span className="bal">
              {fmt(quoteFree, 6)} {quote}
            </span>
          </div>
        </div>
        <div>
          <div className="sel-label">Trading Pair</div>
          <PairPicker
            exchangeId={exchangeId}
            value={pair}
            markets={markets}
            owned={(b) => fmtOwned(ownedOf(balance, b))}
            balanceLabel={`${fmt(baseFree, 6)} ${base}`}
            onChange={setPair}
          />
        </div>
        {isFutures && (
          <div>
            <div className="sel-label">
              Leverage
              <span className="muted"> · max {leverageMax}x</span>
            </div>
            <div className="sel lev-inline">
              <select
                value={marginMode}
                onChange={(e) => setMarginMode(e.target.value as MarginMode)}
              >
                <option value="isolated">Isolated</option>
                <option value="cross">Cross</option>
              </select>
              <input
                className="lev-range"
                type="range"
                min={0}
                max={Math.max(0, leverageSteps.length - 1)}
                step={1}
                value={Math.max(0, leverageSteps.indexOf(leverage))}
                onChange={(e) => {
                  const next = leverageSteps[Number(e.target.value)];
                  if (next != null) setLeverage(next);
                }}
                title={`${leverage}x`}
              />
              <span className="bal">{leverage}x</span>
            </div>
          </div>
        )}
        <div className="head-toggles">
          <div className="cold-head">
            <div className="sel-label">Cold start</div>
            <div className="sel cold-sel">
              <Toggle
                on={!isPlain && (entryType === "signal" || coldStart)}
                onChange={(v) => {
                  setColdStart(v);
                  if (v) {
                    setUseExisting(false);
                    setPlainMode(false);
                  }
                }}
                disabled={isPlain || useExisting || entryType === "signal"}
              />
            </div>
          </div>
          {!isFutures && (
            <div className="cold-head">
              <div className="sel-label">Trade/Convert</div>
              <div className="sel cold-sel">
                <Toggle
                  on={plainMode}
                  onChange={(v) => {
                    setPlainMode(v);
                    if (v) {
                      setColdStart(false);
                      if (entryType === "signal") setEntryType("market");
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={`columns${isPlain ? " no-tpsl" : ""}`}>
        <section className="card order-chart-card">
          <OrderChart
            exchangeId={exchangeId}
            pair={pair}
            last={last}
            entry={num(entryPrice) || last}
            tp={!isPlain && tpOn ? num(tpPrice) : 0}
            sl={!isPlain && slOn ? num(slPrice) : 0}
            onPickPrice={onChartPrice}
            onPickPosition={onChartPosition}
          />
        </section>
        <section className="card">
          <div className="card-h">
            <span className="card-ticker">
              {base ? <Coin symbol={base} /> : null}
              {pairTitle}
            </span>
            <span className="wallet-mini">
              {fmt(useExisting ? held || baseFree : baseFree, 8)} {base}
            </span>
          </div>
          {!isFutures && (
            <>
              <div className="row-toggle">
                <span className="row-label">
                  Use Existing Assets
                  <HelpLink
                    href="/help/use-existing-assets"
                    label="How Use Existing Assets works"
                  />
                </span>
                <Toggle
                  on={useExisting}
                  onChange={(v) => {
                    setUseExisting(v);
                    if (v) setColdStart(false);
                  }}
                  disabled={heldBusy}
                />
              </div>
              {useExisting && heldBusy && (
                <div className="muted" style={{ margin: "6px 0 8px" }}>
                  Reading position…
                </div>
              )}
              {useExisting && heldNote && !heldBusy && (
                <div className="muted" style={{ margin: "6px 0 8px" }}>
                  {heldNote}
                </div>
              )}
              {useExisting && <Err>{heldErr}</Err>}
            </>
          )}
          <div className={`input-wrap${minAmtErr ? " error" : ""}`}>
            <input
              className="mono"
              value={amount}
              onChange={(e) => setSizeFromAmount(e.target.value)}
            />
            <span className="unit">{base}</span>
          </div>
          <Err>{minAmtErr || (num(amount) === 0 ? tooSmall : "")}</Err>

          <div className="card-h" style={{ marginTop: 10 }}>
            {entryType === "signal"
              ? "Signal"
              : isFutures
                ? "Entry Price"
                : side === "buy"
                  ? "Buy Price"
                  : "Sell Price"}
          </div>
          {!useExisting && (
          <Seg
            value={entryType}
            onChange={(id) => {
              setEntryType(id as EntryType);
              if (id !== "conditional") setTrailBuy(false);
              if (id === "signal") {
                setTrailBuy(false);
                setColdStart(true);
                setUseExisting(false);
              }
            }}
            options={
              isPlain
                ? [
                    { id: "limit", label: "Limit" },
                    { id: "market", label: "Market" },
                    { id: "conditional", label: "Cond." },
                  ]
                : [
                    { id: "limit", label: "Limit" },
                    { id: "market", label: "Market" },
                    { id: "conditional", label: "Cond." },
                    { id: "signal", label: "Signal" },
                  ]
            }
          />
          )}
          <p className="hint">
            {helperEntry}
            {entryType === "signal" && (
              <HelpLink href="/help/signal" label="How Signal entry works" />
            )}
          </p>
          {(useExisting || (entryType !== "market" && entryType !== "signal")) && (
            <div className="input-wrap">
              <input
                className="mono"
                value={entryPrice}
                onChange={(e) => onEntryPrice(e.target.value)}
              />
              <span className="unit">{quote}</span>
            </div>
          )}
          {entryType === "signal" && !useExisting && (
            <div className="signal-list">
              {INDICATORS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={busy || !pair || num(amount) <= 0 || !!minAmtErr || !!minCostErr}
                  onClick={() => setConfirm(makeSignalBody(item.id))}
                >
                  <span className="indi-name">{item.label}</span>
                  <span className="indi-hint">{item.hint}</span>
                </button>
              ))}
            </div>
          )}
          {(entryType === "market" || entryType === "signal") && !useExisting && (
            <div className="price-live">
              <div className="input-wrap">
                <input className="mono" value={fmt(refPrice, 8)} readOnly />
                <span className="unit">{quote}</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                title="Refresh price"
                disabled={tickerBusy || !pair}
                onClick={() => void refreshPrice()}
              >
                <IconRefresh />
              </button>
            </div>
          )}
          {ticker && (
            <div className="bidask">
              <span className="green">Bid: {fmt(ticker.bid, 8)}</span>
              <span className="red">Ask: {fmt(ticker.ask, 8)}</span>
              <span className="muted">{quote}</span>
            </div>
          )}
          {!useExisting && entryType !== "signal" && (
          <div className="row-toggle">
            <span className="row-label">
              Trailing {isFutures ? "entry" : side === "buy" ? "buy" : "sell"}
              <HelpLink href="/help/trailing-buy" label="How trailing buy works" />
            </span>
            <Toggle
              on={trailBuy}
              onChange={(v) => {
                setTrailBuy(v);
                if (v) setEntryType("conditional");
              }}
            />
          </div>
          )}
          {!useExisting && entryType !== "signal" && trailBuy && (
            <div className="stepper">
              <button type="button" onClick={() => setTrailBuyPct(String(Math.max(0.1, num(trailBuyPct) - 0.1)))}>
                −
              </button>
              <input value={trailBuyPct} onChange={(e) => setTrailBuyPct(e.target.value)} />
              <span className="muted">%</span>
              <button type="button" onClick={() => setTrailBuyPct(String(num(trailBuyPct) + 0.1))}>
                +
              </button>
            </div>
          )}

          <div className="card-h" style={{ marginTop: 10 }}>
            Total
          </div>
          <div className={`input-wrap${minCostErr ? " error" : ""}`}>
            <input
              className="mono"
              value={totalStr}
              onChange={(e) => setSizeFromTotal(e.target.value)}
            />
            <span className="unit">{quote}</span>
          </div>
          <Err>{minCostErr}</Err>
          <div className="muted" style={{ marginTop: 6 }}>
            Size from available amount
          </div>
          <div className="pct-row">
            {[5, 10, 25, 50, 100].map((p) => (
              <button key={p} type="button" onClick={() => applyPct(p)}>
                {p}%
              </button>
            ))}
          </div>
          {entryType !== "signal" && (
            <Seg
              className="side-switch"
              value={orderSide}
              onChange={(id) => applyOrderSide(id as Side)}
              options={
                isPlain
                  ? [
                      { id: "buy", label: "Buy" },
                      { id: "sell", label: "Sell" },
                    ]
                  : isFutures
                    ? [
                        { id: "buy", label: "Long" },
                        { id: "sell", label: "Short" },
                      ]
                    : [
                        { id: "buy", label: "Smart Buy" },
                        { id: "sell", label: "Smart Cover" },
                      ]
              }
            />
          )}
        </section>

        {!isPlain && (
          <>
            <section className="card">
              <div className="card-h">
                Take Profit
                <Toggle on={tpOn} onChange={setTpOn} />
              </div>
              {tpOn && (
                <>
                  {isFutures && (
                    <div className="row-toggle">
                      Reduce only
                      <Toggle on={tpReduceOnly} onChange={setTpReduceOnly} />
                    </div>
                  )}
                  <Seg
                    value={tpType}
                    onChange={(id) => setTpType(id as TpType)}
                    options={[
                      { id: "limit", label: "Limit Order" },
                      { id: "market", label: "Market Order" },
                    ]}
                  />
                  <p className="hint">
                    {tpType === "limit"
                      ? "The order will be placed on the exchange order book beforehand"
                      : isFutures && tpReduceOnly
                        ? "A reduce-only take-profit rests on the exchange until price hits"
                        : isFutures
                          ? "The server closes at market when the last price reaches take-profit"
                          : "The server sells at market when the last price reaches take-profit"}
                  </p>
                  <div className={`input-wrap${tooSmall ? " error" : ""}`}>
                    <input
                      className="mono"
                      value={tpPrice}
                      onChange={(e) => onTpPrice(e.target.value)}
                    />
                    <span className="unit">{quote}</span>
                    <span className={`suffix-pct${num(tpPct) < 0 ? " neg" : ""}`} style={{ right: 52 }}>
                      {num(tpPct) > 0 ? "+" : ""}
                      {fmt(num(tpPct), 2)}%
                    </span>
                  </div>
                  <PctInput
                    value={tpPct}
                    onChange={onTpPct}
                    quoteAmt={tpQuoteAmt}
                    quote={quote}
                  />
                  <Err>{num(amount) <= 0 ? "Amount is too small to make an order" : ""}</Err>
                  <button
                    type="button"
                    className={`split${tpSplits.length ? " on" : ""}`}
                    onClick={() => setSplitOpen(true)}
                  >
                    {tpSplits.length
                      ? `Split Targets · ${tpSplits.length}`
                      : "Split Targets"}
                  </button>
                  <div className="row-toggle">
                    <span className="row-label">
                      Trailing Take Profit
                      <HelpLink
                        href="/help/trailing-take-profit"
                        label="How trailing take profit works"
                      />
                    </span>
                    <Toggle
                      on={trailTp && tpSplits.length <= 1}
                      onChange={setTrailTp}
                      disabled={tpSplits.length > 1}
                    />
                  </div>
                  {trailTp && (
                    <>
                      <div className="muted" style={{ marginBottom: 8 }}>
                        {side === "buy"
                          ? "Follow max price with deviation (%)"
                          : "Follow min price with deviation (%)"}
                      </div>
                      <div className="trail-row">
                        <input
                          className="range"
                          type="range"
                          min={side === "buy" ? -20 : 0.1}
                          max={side === "buy" ? -0.1 : 20}
                          step={0.1}
                          value={num(trailTpPct)}
                          onChange={(e) => setTrailTpPct(e.target.value)}
                        />
                        <input
                          value={trailTpPct}
                          onChange={(e) => setTrailTpPct(e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </section>

            <section className="card">
              <div className="card-h">
                Stop Loss
                <Toggle on={slOn} onChange={setSlOn} />
              </div>
              {slOn && (
                <>
                  {isFutures && (
                    <div className="row-toggle">
                      Reduce only
                      <Toggle on={slReduceOnly} onChange={setSlReduceOnly} />
                    </div>
                  )}
                  <Seg
                    value={slType}
                    onChange={(id) => setSlType(id as SlType)}
                    options={[
                      { id: "cond_limit", label: "Cond. Limit Order" },
                      { id: "cond_market", label: "Cond. Market Order" },
                    ]}
                  />
                  <p className="hint">
                    {isFutures && slReduceOnly && !slTimeout
                      ? "A reduce-only stop rests on the exchange until price hits"
                      : "The order will be executed when the price meets stop-loss conditions"}
                  </p>
                  <div className="input-wrap">
                    <input
                      className="mono"
                      value={slPrice}
                      onChange={(e) => onSlPrice(e.target.value)}
                    />
                    <span className="unit">{quote}</span>
                    <span className="suffix-pct neg" style={{ right: 52 }}>
                      {fmt(num(slPct), 2)}%
                    </span>
                  </div>
                  <PctInput
                    value={slPct}
                    onChange={onSlPct}
                    quoteAmt={slQuoteAmt}
                    quote={quote}
                  />
                  <Err>{num(amount) <= 0 ? "Amount is too small to make an order" : ""}</Err>
                  <div className="row-toggle" style={{ marginTop: 6 }}>
                    <span className="row-label">
                      Stop Loss timeout
                      <HelpLink
                        href="/help/stop-loss-timeout"
                        label="How stop loss timeout works"
                      />
                    </span>
                    <Toggle on={slTimeout} onChange={setSlTimeout} />
                  </div>
                  {slTimeout && (
                    <div className="stepper">
                      <input
                        value={slTimeoutSec}
                        onChange={(e) => setSlTimeoutSec(e.target.value)}
                      />
                      <span className="muted">Sec</span>
                      <button
                        type="button"
                        onClick={() =>
                          setSlTimeoutSec(String(Math.max(0, Number(slTimeoutSec) - 10)))
                        }
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() => setSlTimeoutSec(String(Number(slTimeoutSec) + 10))}
                      >
                        +
                      </button>
                    </div>
                  )}
                  <div className="row-toggle">
                    <span className="row-label">
                      Trailing Stop Loss
                      <HelpLink
                        href="/help/trailing-stop-loss"
                        label="How trailing stop loss works"
                      />
                    </span>
                    <Toggle on={trailSl} onChange={setTrailSl} />
                  </div>
                  <div className="row-toggle">
                    <span className="row-label">
                      Move to Breakeven
                      <HelpLink
                        href="/help/move-to-breakeven"
                        label="How move to breakeven works"
                      />
                    </span>
                    <Toggle
                      on={breakeven && tpSplits.length >= 2}
                      onChange={setBreakeven}
                      disabled={tpSplits.length < 2}
                    />
                  </div>
                  {tpSplits.length < 2 && (
                    <p className="hint">Needs two take-profit targets</p>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>

      <div className="foot with-tf">
        {entryType === "signal" ? (
          indicators.length > 0 ? (
            <TfStack
              rows={indicators.map((id) => ({
                id,
                frames: bias[id] ?? emptyTfBias(),
              }))}
            />
          ) : null
        ) : (
          <>
            {indicators.length > 0 && (
              <TfStack
                rows={indicators.map((id) => ({
                  id,
                  frames: bias[id] ?? emptyTfBias(),
                }))}
              />
            )}
            <button
              className={side === "buy" ? "primary buy" : "danger"}
              disabled={busy || !pair || num(amount) <= 0}
              onClick={() => setConfirm(makeBody(side))}
            >
              {isPlain
                ? side === "buy"
                  ? "Place buy"
                  : "Place sell"
                : isFutures
                  ? coldStart
                    ? side === "buy"
                      ? "Cold start Long"
                      : "Cold start Short"
                    : side === "buy"
                      ? "Long"
                      : "Short"
                  : coldStart
                    ? side === "buy"
                      ? "Cold start Smart Buy"
                      : "Cold start Smart Cover"
                    : side === "buy"
                      ? "Smart Buy"
                      : "Smart Cover"}
            </button>
          </>
        )}
      </div>

      {splitOpen && (
        <SplitTargetsModal
          quote={quote}
          base={base}
          last={last}
          entry={refPrice || last}
          side={side}
          amount={num(amount)}
          targets={tpSplits}
          onChange={setTpSplits}
          onClose={() => setSplitOpen(false)}
        />
      )}
      {confirm && (
        <div className="modal-back" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              {confirm.entryType === "signal"
                ? "Start signal wait"
                : confirm.kind === "simple"
                  ? confirm.side === "buy"
                    ? "Place buy"
                    : "Place sell"
                  : confirm.coldStart
                    ? isFutures
                      ? confirm.side === "buy"
                        ? "Cold start Long"
                        : "Cold start Short"
                      : confirm.side === "buy"
                        ? "Cold start Smart Buy"
                        : "Cold start Smart Cover"
                    : isFutures
                      ? confirm.side === "buy"
                        ? "Open Long"
                        : "Open Short"
                      : confirm.side === "buy"
                        ? "Create Smart Buy"
                        : "Create Smart Cover"}
            </h2>
            {account?.venue === "paper" && (
              <p className="hint" style={{ textAlign: "left" }}>
                Demo — fake money, public prices. No live order is sent.
              </p>
            )}
            {confirm.entryType === "signal" ? (
              <p className="hint" style={{ textAlign: "left" }}>
                No order is sent. The trade waits until every 1D, 4H, 1H, 15M and 5M of{" "}
                {INDICATORS.find((x) => x.id === confirm.signalIndicator)?.label ?? "the indicator"}{" "}
                is green (Long) or red (Short), then enters at market.
              </p>
            ) : confirm.coldStart ? (
              <p className="hint" style={{ textAlign: "left" }}>
                No order is sent. The setup waits on Positions until you Fire up.
              </p>
            ) : null}
            <dl>
              <dt>Account</dt>
              <dd>{account?.label}</dd>
              <dt>Pair</dt>
              <dd>{confirm.pair}</dd>
              <dt>Side</dt>
              <dd>
                {confirm.entryType === "signal"
                  ? "Long if green, Short if red"
                  : confirm.kind === "simple"
                    ? confirm.side === "buy"
                      ? "Buy"
                      : "Sell"
                    : isFutures
                      ? confirm.side === "buy"
                        ? "Long"
                        : "Short"
                      : confirm.side === "buy"
                        ? "Smart Buy"
                        : "Smart Cover"}
              </dd>
              <dt>Amount</dt>
              <dd>
                {confirm.amount} {base}
              </dd>
              {isFutures && (
                <>
                  <dt>Leverage</dt>
                  <dd>
                    {confirm.leverage}x {confirm.marginMode}
                  </dd>
                </>
              )}
              <dt>Entry</dt>
              <dd>
                {confirm.entryType === "signal"
                  ? `Signal · ${INDICATORS.find((x) => x.id === confirm.signalIndicator)?.label ?? ""}`
                  : `${confirm.entryType} ${confirm.entryType === "market" ? "" : confirm.entryPrice ?? ""}`}
              </dd>
              {confirm.tpEnabled && (
                <>
                  <dt>Take profit</dt>
                  <dd>
                    {confirm.tpTargets && confirm.tpTargets.length
                      ? confirm.tpTargets
                          .map((t) => `${t.qtyPct}% @ ${t.price}`)
                          .join(" · ")
                      : `${confirm.tpType} ${confirm.tpPrice}`}
                    {confirm.tpReduceOnly ? " · reduce only" : ""}
                  </dd>
                </>
              )}
              {confirm.slEnabled && (
                <>
                  <dt>Stop loss</dt>
                  <dd>
                    {confirm.slType} {confirm.slPrice}
                    {confirm.slReduceOnly ? " · reduce only" : ""}
                  </dd>
                </>
              )}
            </dl>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirm(null)}>
                Back
              </button>
              <button className="primary" style={{ width: "auto" }} disabled={busy} onClick={submit}>
                {busy
                  ? "Sending…"
                  : confirm.entryType === "signal"
                    ? "Save signal"
                    : confirm.coldStart
                      ? "Save cold start"
                      : account?.venue === "paper"
                        ? "Confirm demo"
                        : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
