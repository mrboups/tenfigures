let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function unlockTradeAlerts(): void {
  audio();
}

function beep(freq: number, start: number, dur: number) {
  const c = audio();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

export function playFilled(): void {
  beep(880, 0, 0.1);
  beep(1320, 0.12, 0.16);
}

export function playClosed(): void {
  beep(620, 0, 0.12);
  beep(380, 0.14, 0.2);
}
