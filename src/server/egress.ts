let cached: { at: number; ip: string | null } = { at: 0, ip: null };

export async function getOutboundIp(): Promise<string | null> {
  if (cached.ip && Date.now() - cached.at < 60_000) return cached.ip;
  try {
    const res = await fetch("https://api.ipify.org", {
      signal: AbortSignal.timeout(4000),
    });
    const ip = (await res.text()).trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      cached = { at: Date.now(), ip };
      return ip;
    }
  } catch {
    /* keep last */
  }
  return cached.ip;
}
