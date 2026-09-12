export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function sharpe(daily: number[]): number | null {
  if (daily.length < 2) return null;
  const sd = stdev(daily);
  if (sd === 0) return 0;
  return (mean(daily) / sd) * Math.sqrt(365);
}

export function sortino(daily: number[]): number | null {
  if (daily.length < 2) return null;
  const downside = daily.filter((x) => x < 0);
  if (!downside.length) return null;
  const dd = stdev(downside);
  if (dd === 0) return 0;
  return (mean(daily) / dd) * Math.sqrt(365);
}

export function dailyReturns(points: { at: Date; usd: number }[]): number[] {
  const byDay = new Map<string, { at: Date; usd: number }>();
  for (const p of points) {
    const key = p.at.toISOString().slice(0, 10);
    const prev = byDay.get(key);
    if (!prev || p.at > prev.at) byDay.set(key, p);
  }
  const ordered = [...byDay.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!.usd;
    const cur = ordered[i]!.usd;
    if (prev > 0) out.push((cur - prev) / prev);
  }
  return out;
}
