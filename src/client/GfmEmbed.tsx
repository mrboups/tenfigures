import { useEffect, useRef, useState } from "react";
import { GFM_WIDGET_LARGE, GFM_WIDGET_SMALL, gfmIframeSrc } from "../shared/gofundme.ts";

const HEIGHT = { small: 70, large: 500 } as const;

export function GfmEmbed({
  size,
  fallbackHref,
}: {
  size: "small" | "large";
  fallbackHref?: string;
}) {
  const url = size === "small" ? GFM_WIDGET_SMALL : GFM_WIDGET_LARGE;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState("");

  useEffect(() => {
    setSrc(gfmIframeSrc(url, window.location.hostname || "none"));
    function onMsg(event: MessageEvent) {
      if (event.data?.type !== "gfm-embed-widget-resize") return;
      const h = event.data.offsetHeight;
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow === event.source && typeof h === "number") {
        iframe.height = String(h);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [url]);

  if (!src) {
    return fallbackHref ? (
      <a className="primary" href={fallbackHref} target="_blank" rel="noopener noreferrer">
        GoFundMe
      </a>
    ) : null;
  }

  return (
    <div className="gfm-embed" data-url={url}>
      <iframe
        ref={iframeRef}
        className="gfm-embed-iframe"
        title="Support Ten Figures on GoFundMe"
        src={src}
        width="100%"
        height={HEIGHT[size]}
        frameBorder={0}
        scrolling="no"
      />
    </div>
  );
}
