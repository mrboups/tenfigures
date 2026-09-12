import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { createPool, initSchema } from "./db.ts";
import { loadEnv } from "./env.ts";
import { landingHtml } from "./landing.ts";
import { attachPaper } from "./paper.ts";
import { startWorker } from "./worker.ts";

function loadDotEnv() {
  if (!existsSync(".env")) return;
  const text = readFileSync(".env", "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadDotEnv();

const env = loadEnv();
const pool = createPool(env);
await initSchema(pool);
attachPaper(pool, env);

const app = createApp(pool, env);

app.use("/screens/*", serveStatic({ root: "." }));

if (env.isProd) {
  const prefix = env.publicBase;
  const assets = prefix ? `${prefix}/assets/*` : "/assets/*";
  app.use(
    assets,
    serveStatic({
      root: "./dist",
      rewriteRequestPath: prefix
        ? (path) => path.slice(prefix.length) || "/"
        : (path) => path,
    }),
  );
  if (prefix) {
    app.get("/", (c) => c.html(landingHtml(env)));
  }
  app.get("*", async (c, next) => {
    const p = c.req.path;
    if (p.startsWith("/api") || p === "/health" || p.startsWith("/screens")) return next();
    if (prefix && p !== prefix && !p.startsWith(`${prefix}/`)) {
      if (p === "/" || p.startsWith("/api")) return next();
      return c.redirect(`${prefix}${p}`);
    }
    const html = readFileSync("dist/index.html", "utf8");
    return c.html(html);
  });
}

startWorker(pool, env);

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`tradr listening on :${info.port}`);
});
