// Worker environment bindings. Mirrors wrangler.jsonc.

export interface Env {
  ASSETS: Fetcher;
  VELLUM_CACHE?: KVNamespace;
  VELLUM_GITHUB_TOKEN?: string;
  VELLUM_WEBHOOK_SECRET?: string;
  VELLUM_CACHE_TTL_SECONDS?: string;
  VELLUM_HTML_TTL_SECONDS?: string;
  // How long a page outlives VELLUM_HTML_TTL_SECONDS in the page cache. In
  // that window it's served at once and rebuilt in the background. "0"
  // always rebuilds on the request.
  VELLUM_STALE_TTL_SECONDS?: string;
}

export function ttlSeconds(env: Env, key: "raw" | "html"): number {
  const raw = key === "raw" ? env.VELLUM_CACHE_TTL_SECONDS : env.VELLUM_HTML_TTL_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return key === "raw" ? 300 : 60;
}

// Seconds a page may be served stale past its fresh window. Default one day.
export function staleSeconds(env: Env): number {
  const raw = env.VELLUM_STALE_TTL_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return 86400;
}
