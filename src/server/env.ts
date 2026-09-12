function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

function flag(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length ? v : fallback;
}

export function loadEnv() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const demo = flag("DEMO");
  return {
    nodeEnv,
    isProd: nodeEnv === "production",
    demo,
    publicBase: (process.env.PUBLIC_BASE ?? "").replace(/\/$/, ""),
    paperStartUsdt: Number(process.env.PAPER_START_USDT ?? 30000),
    gofundmeUrl: (process.env.GOFUNDME_URL ?? "").trim(),
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: required("DATABASE_URL"),
    authUsername: demo ? optional("AUTH_USERNAME", "demo") : required("AUTH_USERNAME"),
    authPassword: demo ? optional("AUTH_PASSWORD", "demo") : required("AUTH_PASSWORD"),
    sessionSecret: required("SESSION_SECRET"),
    keySecret: required("KEY_ENCRYPTION_SECRET"),
    workerIntervalMs: Number(process.env.WORKER_INTERVAL_MS ?? 2500),
    resendApiKey: (process.env.RESEND_API_KEY ?? "").trim(),
    resendFrom: optional("RESEND_FROM", '"Ten Figures" <info@tenfigures.club>'),
  };
}

export type AppEnv = ReturnType<typeof loadEnv>;
