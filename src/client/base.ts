export const APP_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export function appPath(p: string): string {
  const path = p.startsWith("/") ? p : `/${p}`;
  return `${APP_BASE}${path}`;
}

export function routePath(pathname = window.location.pathname): string {
  if (
    APP_BASE &&
    (pathname === APP_BASE || pathname.startsWith(`${APP_BASE}/`))
  ) {
    return pathname.slice(APP_BASE.length) || "/";
  }
  return pathname || "/";
}
