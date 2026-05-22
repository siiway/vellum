// Worker environment bindings. Mirrors wrangler.jsonc.

export interface Env {
  ASSETS: Fetcher;
  VELLUM_CACHE?: KVNamespace;
  VELLUM_GITHUB_TOKEN?: string;
  VELLUM_WEBHOOK_SECRET?: string;
  VELLUM_CACHE_TTL_SECONDS?: string;
  VELLUM_HTML_TTL_SECONDS?: string;
}

export function ttlSeconds(env: Env, key: "raw" | "html"): number {
  const raw = key === "raw" ? env.VELLUM_CACHE_TTL_SECONDS : env.VELLUM_HTML_TTL_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return key === "raw" ? 300 : 60;
}
