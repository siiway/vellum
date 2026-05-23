// Worker environment bindings. Mirrors wrangler.jsonc.

export interface Env {
  ASSETS: Fetcher;
  VELLUM_CACHE?: KVNamespace;
  VELLUM_GITHUB_TOKEN?: string;
  VELLUM_WEBHOOK_SECRET?: string;
  VELLUM_CACHE_TTL_SECONDS?: string;
  VELLUM_HTML_TTL_SECONDS?: string;
  // AI Summary (Microsoft Learn-style). The provider and model are selected
  // in vellum.config.json (site.aiSummary); credentials and the optional AI
  // binding live here so they can be scoped per-environment via wrangler
  // secrets without leaking into the public repo.
  //
  // - AI: Workers AI binding. Bound by wrangler when `[ai]` is set in
  //   wrangler.jsonc. Only consulted when provider === "workers-ai".
  // - VELLUM_AI_API_KEY: bearer / x-api-key for openai-compatible and
  //   anthropic providers. Sent as a wrangler secret in production.
  // - VELLUM_AI_BASE_URL: optional base URL override for openai-compatible
  //   providers; falls back to aiSummary.baseUrl, then to OpenAI's URL.
  // - VELLUM_TURNSTILE_SECRET: paired with aiSummary.turnstileSiteKey; when
  //   present, the summarize endpoint verifies the client token before
  //   touching the model.
  // - VELLUM_SESSION_SECRET: HMAC key used to sign Ask-AI session tokens.
  //   Random 32+ byte string; rotate to invalidate every active chat
  //   session. When missing, the worker falls back to a per-process
  //   ephemeral key — fine for single-isolate dev, broken at edge scale.
  AI?: { run: (model: string, input: unknown) => Promise<unknown> };
  VELLUM_AI_API_KEY?: string;
  VELLUM_AI_BASE_URL?: string;
  VELLUM_TURNSTILE_SECRET?: string;
  VELLUM_SESSION_SECRET?: string;
  // D1 binding for the translation cache. Optional at runtime: when missing,
  // the translation layer no-ops and locales declared only via
  // `site.translate.targets` will fall back to the default-locale source
  // until the binding is added. Create with
  //   wrangler d1 create vellum-translations
  // then point the database_id in wrangler.jsonc at the returned UUID and
  // apply ./migrations/*.sql via `wrangler d1 migrations apply`.
  VELLUM_TRANSLATION_DB?: D1Database;
}

export function ttlSeconds(env: Env, key: "raw" | "html"): number {
  const raw = key === "raw" ? env.VELLUM_CACHE_TTL_SECONDS : env.VELLUM_HTML_TTL_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return key === "raw" ? 300 : 60;
}
