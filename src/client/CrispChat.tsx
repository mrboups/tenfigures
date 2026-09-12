import { useEffect } from "react";
import { CRISP_SCRIPT, CRISP_WEBSITE_ID } from "../shared/crisp.ts";

declare global {
  interface Window {
    $crisp?: unknown[];
    CRISP_WEBSITE_ID?: string;
  }
}

export function CrispChat() {
  useEffect(() => {
    if (window.CRISP_WEBSITE_ID) return;
    window.$crisp = window.$crisp ?? [];
    window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;
    const s = document.createElement("script");
    s.src = CRISP_SCRIPT;
    s.async = true;
    document.head.appendChild(s);
  }, []);
  return null;
}
