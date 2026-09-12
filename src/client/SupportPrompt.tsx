import { useEffect, useState } from "react";
import { GfmEmbed } from "./GfmEmbed.tsx";

const KEY = "tradr.supportPrompt";
const DELAY_MS = 45_000;

export function SupportPrompt({ url }: { url: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(KEY) === "1") return;
    const t = window.setTimeout(() => setOpen(true), DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function dismiss() {
    sessionStorage.setItem(KEY, "1");
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div className="modal-back support-back" onClick={dismiss}>
      <div
        className="modal support-modal"
        role="dialog"
        aria-labelledby="support-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="support-x" onClick={dismiss} aria-label="Close">
          ×
        </button>
        <h2 id="support-title">Lifetime Access</h2>
        <p className="muted">Help fund the setup of the Ten Figures Trading Panel.</p>
        <p className="muted">
          Contribute and receive lifetime access, plus free membership in the Ten Figures Club.
        </p>
        <GfmEmbed size="large" fallbackHref={url} />
      </div>
    </div>
  );
}
