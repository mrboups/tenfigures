export function rawError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function friendlyExchangeError(
  venue: string,
  err: unknown,
  outboundIp?: string | null,
): string {
  const raw = rawError(err);
  const lower = raw.toLowerCase();
  const ipHint = outboundIp
    ? `add ${outboundIp} (this server right now) or turn IP restriction off`
    : "add this server’s outbound IP or turn IP restriction off";
  if (
    (venue === "kraken" || venue === "krakenfutures") &&
    /permission denied/i.test(raw)
  ) {
    return `Kraken signed the key then blocked the balance call. That is either missing Query Funds on the key, or an IP lock that does not match this host. Enable Query Funds (and Open/Closed Orders + Create/Cancel Orders for trading). Leave Withdraw off. If the key is IP-restricted, ${ipHint}.`;
  }
  if (/invalid key|invalid signature|invalid nonce|user or api wallet/i.test(lower)) {
    return venue === "hyperliquid" || venue === "lighter"
      ? `This ${venue} wallet was rejected. Check the address and private key, then save again.`
      : `This ${venue} key was rejected. Check the API key and secret, then save again.`;
  }
  if (/ip/i.test(lower) && /restrict|whitelist|allowlist/i.test(lower)) {
    return `This ${venue} key is locked to other IPs. Add this server’s outbound IP or disable IP restriction.`;
  }
  return raw.replace(/^kraken\s+/i, "").trim() || raw;
}
