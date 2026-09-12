export const GFM_CAMPAIGN =
  "https://www.gofundme.com/f/ten-figures-club-trading-panel-secure-hosting";
export const GFM_WIDGET_SMALL =
  "https://www.gofundme.com/f/ten-figures-club-trading-panel-secure-hosting/widget/small?attribution_id=sl%3A12e9ce13-93b3-42e4-abc6-edb595231abb";
export const GFM_WIDGET_LARGE =
  "https://www.gofundme.com/f/ten-figures-club-trading-panel-secure-hosting/widget/large?attribution_id=sl%3A12e9ce13-93b3-42e4-abc6-edb595231abb";
export const GFM_EMBED_JS = "https://www.gofundme.com/static/js/embed.js";

export function gfmIframeSrc(widgetUrl: string, hostname = "none"): string {
  const parsed = new URL(widgetUrl);
  parsed.searchParams.set("utm_content", hostname);
  parsed.searchParams.set("utm_medium", "referral");
  parsed.searchParams.set("utm_source", "widget");
  return `${parsed.toString()}#:~:tcm-regime=GDPR&tcm-prompt=Hidden`;
}
