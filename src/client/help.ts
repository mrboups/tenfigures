export type HelpArticle = {
  slug: string;
  title: string;
  summary: string;
  sections: { heading?: string; paragraphs: string[]; example?: string[] }[];
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "use-existing-assets",
    title: "Use Existing Assets",
    summary: "Attach take-profit and stop-loss to coins you already hold. No new buy is sent.",
    sections: [
      {
        paragraphs: [
          "Turn this on when the coins are already in the account and you only want to sell them with a plan.",
          "Spot only. Perpetual futures have no bag of coins sitting in the wallet, so this switch is hidden there.",
        ],
      },
      {
        heading: "What you enter",
        paragraphs: [
          "Amount — how many coins to cover.",
          "Were bought for — the price you paid. Take-profit and stop-loss percents are measured from this price. It does not place a buy.",
        ],
      },
      {
        heading: "What happens",
        paragraphs: [
          "The trade opens already in position. Only the take-profit and stop-loss you set are sent.",
          "If you want to buy first, leave this off and use SmartTrade as usual.",
        ],
        example: [
          "You hold 2 BNB bought at 213 USDT.",
          "Pair BNB/USDT, turn Use Existing Assets on, amount 2, bought-for 213.",
          "Set take-profit at 350. Profit % is from 213, not from the current price.",
        ],
      },
    ],
  },
  {
    slug: "trailing-buy",
    title: "Trailing Buy",
    summary: "Wait for your price, then follow the market and enter on the turn.",
    sections: [
      {
        paragraphs: [
          "Trailing starts only after the last price reaches the price you set. Until then, nothing is sent.",
          "The trail stays a fixed percent away from the best price after that.",
        ],
      },
      {
        heading: "Direction",
        paragraphs: [
          "SmartTrade — follows the price down, then buys when it bounces by your percent.",
          "Smart Cover — follows the price up, then sells when it drops by your percent.",
        ],
      },
      {
        heading: "How to set it",
        paragraphs: [
          "Set a trigger price, turn Trailing on, pick the percent. The order type switches to Conditional.",
        ],
        example: [
          "Buy trigger 400, trail 10%.",
          "Price hits 400 — trailing starts.",
          "Price falls to 350, then rises 10% to 385 — the buy is sent at the market.",
        ],
      },
    ],
  },
  {
    slug: "trailing-take-profit",
    title: "Trailing Take Profit",
    summary: "After the take-profit price is reached, follow the move and close on the pullback.",
    sections: [
      {
        paragraphs: [
          "Trailing take-profit waits until price first hits your take-profit. Then it follows the market and keeps a fixed gap from the best price.",
          "SmartTrade follows price up. Smart Cover follows price down. The gap is the deviation you set, in percent of price.",
          "It cannot run together with more than one take-profit target.",
        ],
      },
      {
        heading: "Example",
        paragraphs: [
          "Take-profit 10 000, trail 2%. The gap is 200.",
          "Price runs to 15 000. The close sits 200 below, at 14 800.",
          "If price then drops through 14 800, the position is closed. That drop from 15 000 is 1.333%, not 2% of the original take-profit.",
        ],
      },
    ],
  },
  {
    slug: "stop-loss-timeout",
    title: "Stop Loss Timeout",
    summary: "A second check before the stop-loss fires.",
    sections: [
      {
        paragraphs: [
          "When price first hits the stop, the clock starts. After the number of seconds you set, the stop is checked again.",
          "If price is still through the stop, the close is sent. If it has recovered, the stop is not sent and the clock resets.",
        ],
      },
      {
        heading: "Trade-off",
        paragraphs: [
          "A short delay filters a quick wick. A long delay can let the loss grow while you wait.",
        ],
        example: [
          "Stop at 95, timeout 30 seconds.",
          "Price prints 94 — wait.",
          "30 seconds later it is 96 — no close.",
          "If it is still 94, the stop is sent.",
        ],
      },
    ],
  },
  {
    slug: "trailing-stop-loss",
    title: "Trailing Stop Loss",
    summary: "Once you are in the trade, the stop follows price at a fixed distance.",
    sections: [
      {
        paragraphs: [
          "Trailing stop-loss starts after the entry has filled — after SmartTrade has bought, or after Smart Cover has sold.",
          "The stop stays the same percent away from the best price reached.",
        ],
      },
      {
        heading: "Direction",
        paragraphs: [
          "SmartTrade — follows price up. The stop only moves up.",
          "Smart Cover — follows price down. The stop only moves down.",
        ],
        example: [
          "Long, stop 5% below.",
          "Entry 100, stop 95. Price runs to 120, stop becomes 114.",
          "Price then drops to 114 — the stop closes the trade.",
        ],
      },
    ],
  },
  {
    slug: "move-to-breakeven",
    title: "Move to Breakeven",
    summary: "After the first take-profit target fills, the stop moves to your average entry.",
    sections: [
      {
        paragraphs: [
          "Needs at least two take-profit targets. Turn it on in Stop Loss, then add the targets under Split Targets.",
          "When the first target fills, stop-loss is moved to the average entry price. The rest of the position stays open for the later targets.",
        ],
      },
      {
        heading: "Example",
        paragraphs: [
          "Entry 100. Two targets: 25% at 110, 75% at 120. Stop 95. Move to breakeven on.",
          "First target fills at 110. Stop on the remaining 75% moves to 100.",
        ],
      },
    ],
  },
  {
    slug: "signal",
    title: "Signal entry",
    summary: "Park a trade until every timeframe of an indicator is green or red, then enter Long or Short at market.",
    sections: [
      {
        paragraphs: [
          "On the ticket, pick Signal next to Limit, Market and Cond. Choose TDPR, TDPR cross or Donchian Trend.",
          "Nothing is sent to the exchange yet. The trade sits on Positions and watches 1D, 4H, 1H, 15M and 5M.",
        ],
      },
      {
        heading: "When it enters",
        paragraphs: [
          "All five timeframes green — Long (buy) at market.",
          "All five timeframes red — Short (sell) at market.",
          "Mixed or still loading — it keeps waiting. Take-profit and stop-loss percents are applied to the side that fired.",
        ],
        example: [
          "Amount 100, leverage 3x, take-profit 10%, stop 5%.",
          "Signal → Donchian Trend. Save.",
          "Later every dot turns green — a 3x long opens, take-profit 10% above, stop 5% below.",
        ],
      },
    ],
  },
];

export function helpBySlug(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}
