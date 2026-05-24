// Machine-translation service. Sits between the router/sidebar/SSR layers
// and the configured AI provider. One code path serves every kind of
// translation the worker does — page bodies, sidebar labels, repo nav,
// frontmatter strings, UI dictionary entries, top-level config text — so
// the caching + provider + prompt code lives in one place.
//
// Read path:
//   1. Hash the source.
//   2. SELECT FROM translations WHERE (kind, key, locale, source_hash) match.
//   3. Hit → return cached content. Miss or stale → call provider, write
//      row, return.
//
// Write path: lazy on first request. Webhook + scheduled cron handlers
// bust + refresh rows; see webhook.ts and the scheduled() export in
// index.ts. When the D1 binding is missing or `site.translate` is unset,
// translate() returns the source unchanged so the rest of the worker
// keeps working in dev with no extra setup.
//
// Provider matrix matches aiSummary / aiChat:
//   - workers-ai        → env.AI binding (chat model; m2m100 is a future
//                          enhancement that needs a separate call shape)
//   - openai-compatible → bearer POST to {baseUrl}/chat/completions
//   - anthropic         → x-api-key POST to /v1/messages
//
// All three are run NON-streaming here — translations are short and we want
// the full string before writing the D1 row, so there's nothing to gain
// from SSE plumbing.

import type { Env } from "./env";
import type { NavItem, TranslateConfig, VellumConfig } from "../shared/types";
import { resolveEndpoints, runWithFailover, type ResolvedEndpoint } from "./ai-endpoints";

// --- Public types ---------------------------------------------------------

// What's being translated. The kind picks the system prompt and how strict
// the syntax-preservation rules are.
//
//   page         : full markdown body. Heaviest call; keeps code blocks,
//                  link targets, frontmatter, and OPS / VitePress directives
//                  verbatim.
//   frontmatter  : a JSON object with selected string values to translate.
//                  Keys stay intact; non-string leaves stay verbatim.
//   sidebar      : a JSON object (see TranslateBundle below) of short labels.
//                  Often dozens per repo — batched into one call.
//   repo-nav     : same shape as sidebar.
//   ui           : the static UI dictionary from src/shared/i18n.ts.
//   config       : top-level config strings (repo displayName/description,
//                  taglines, nav.text).
export type TranslateKind = "page" | "frontmatter" | "sidebar" | "repo-nav" | "ui" | "config";

// Bundle shape used for kinds that translate many short strings in one
// model call. `entries` is an ordered map; the model is asked to return a
// JSON object with the same keys and translated values. Order is preserved
// across the round-trip so callers can re-zip the results back into their
// original data structure.
export interface TranslateBundle {
  entries: Record<string, string>;
}

export interface TranslateArgs {
  env: Env;
  ctx: ExecutionContext;
  site: VellumConfig;
  kind: TranslateKind;
  key: string;
  locale: string;
  source: string;
}

// --- Public entrypoints ---------------------------------------------------

// Outcome of a translate() call. `content` is what callers should
// render; `model` is the `${ep.id}:${model}` label that produced the
// content (undefined when translation was skipped or fell back to
// source); `attempted` is true when the MT pipeline ran at all
// (whether or not it produced a translation).
export interface TranslateResult {
  content: string;
  model?: string;
  apiKeyHint?: string;
  attempted: boolean;
}

// Translate a single source string (markdown for `page`, JSON for `sidebar`/
// `repo-nav`/`frontmatter`/`ui`/`config`, plain text otherwise) into the
// requested locale. Returns the source unchanged when translation is
// disabled, when the locale isn't a configured target, when the D1 binding
// is missing, or when the provider call fails — so callers never have to
// special-case "no translation available".
export async function translate(args: TranslateArgs): Promise<TranslateResult> {
  const translateConfig = args.site.site.translate;
  const tag = `[vellum][translate] kind=${args.kind} key=${args.key} locale=${args.locale}`;

  if (!translateConfig) {
    console.log(`${tag} skip: site.translate not configured`);
    return { content: args.source, attempted: false };
  }

  // Translating into the default locale or a locale not listed as an MT
  // target is a no-op. Hand-curated locales (declared in `site.locales`
  // without being in `targets`) skip the service too — author content wins.
  if (args.locale === args.site.site.defaultLocale) {
    console.log(`${tag} skip: locale is the default`);
    return { content: args.source, attempted: false };
  }
  if (!isMtTarget(args.site, args.locale)) {
    console.log(`${tag} skip: locale is hand-curated, not an MT target`);
    return { content: args.source, attempted: false };
  }

  const db = args.env.VELLUM_TRANSLATION_DB;
  if (!db) {
    // No DB binding — fall through to a one-shot un-cached translation if
    // we have a provider configured. That keeps preview environments
    // functional without provisioning D1, at the cost of paying for every
    // request. Production should always have the binding bound.
    console.warn(`${tag} no D1 binding (VELLUM_TRANSLATION_DB); running uncached provider call`);
    try {
      const result = await runProvider(
        args.env,
        args.site,
        translateConfig,
        args.kind,
        args.locale,
        args.source,
      );
      console.log(
        `${tag} provider ok (uncached) model=${result.model} bytes_in=${args.source.length} bytes_out=${result.content.length}`,
      );
      return {
        content: result.content,
        model: result.model,
        apiKeyHint: result.apiKeyHint,
        attempted: true,
      };
    } catch (err) {
      console.warn(`${tag} provider failed (uncached): ${(err as Error).message}`);
      return { content: args.source, attempted: true };
    }
  }

  const sourceHash = await sha256Hex(args.source);
  const cached = await readRow(db, args.kind, args.key, args.locale);
  if (cached && cached.source_hash === sourceHash) {
    console.log(`${tag} cache hit model=${cached.model ?? "?"}`);
    return {
      content: cached.content,
      model: cached.model ?? undefined,
      attempted: true,
    };
  }

  console.log(
    cached
      ? `${tag} cache stale (source changed); re-translating`
      : `${tag} cache miss; calling provider`,
  );

  try {
    const result = await runProvider(
      args.env,
      args.site,
      translateConfig,
      args.kind,
      args.locale,
      args.source,
    );
    console.log(
      `${tag} provider ok model=${result.model} bytes_in=${args.source.length} bytes_out=${result.content.length}`,
    );
    // Write-through. waitUntil so callers don't block on the DB round-trip.
    args.ctx.waitUntil(
      writeRow(db, {
        kind: args.kind,
        key: args.key,
        locale: args.locale,
        source_hash: sourceHash,
        content: result.content,
        model: result.model,
        refreshed_at: Date.now(),
      })
        .then(() => console.log(`${tag} cached`))
        .catch((err) => console.warn(`${tag} cache write failed: ${(err as Error).message}`)),
    );
    return {
      content: result.content,
      model: result.model,
      apiKeyHint: result.apiKeyHint,
      attempted: true,
    };
  } catch (err) {
    console.warn(`${tag} provider failed: ${(err as Error).message}`);
    if (cached) {
      console.log(`${tag} serving stale cache as fallback`);
      return {
        content: cached.content,
        model: cached.model ?? undefined,
        attempted: true,
      };
    }
    return { content: args.source, attempted: true };
  }
}

// Translate many short strings into one locale in a single model call. The
// model sees a JSON object of `{ key: source }` pairs and is asked to return
// the same shape with values translated. Cheaper than N round-trips for
// sidebar / nav / UI dictionary work. Results are cached as a single row
// per (kind, key, locale).
export async function translateBundle(args: {
  env: Env;
  ctx: ExecutionContext;
  site: VellumConfig;
  kind: TranslateKind;
  key: string;
  locale: string;
  entries: Record<string, string>;
}): Promise<Record<string, string>> {
  const source = JSON.stringify({ entries: args.entries });
  const result = await translate({
    env: args.env,
    ctx: args.ctx,
    site: args.site,
    kind: args.kind,
    key: args.key,
    locale: args.locale,
    source,
  });
  if (result.content === source) return args.entries;
  try {
    const parsed = JSON.parse(result.content) as TranslateBundle;
    const out: Record<string, string> = {};
    // Preserve the original keyset — drop anything the model invented and
    // fill missing keys from the source so the caller always sees a
    // complete map.
    for (const [k, v] of Object.entries(args.entries)) {
      const cand = parsed.entries?.[k];
      out[k] = typeof cand === "string" && cand.length > 0 ? cand : v;
    }
    return out;
  } catch {
    return args.entries;
  }
}

// Return a copy of the site config with user-visible string fields
// translated into `localeCode`. Translates: site.tagline, every repo's
// displayName and description, and every nav[].text (recursively, including
// `items[].text`). Deliberately leaves site.title and site.footer alone —
// they're brand-level and the project owner asked them to stay verbatim.
//
// Reuses the bundle pipeline so the entire site config translation is one
// model call + one D1 row per locale.
export async function translateSiteConfig(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  localeCode: string,
): Promise<VellumConfig> {
  if (!isMtTarget(site, localeCode)) return site;
  if (localeCode === site.site.defaultLocale) return site;

  const entries: Record<string, string> = {};
  if (site.site.tagline) entries["site.tagline"] = site.site.tagline;
  site.repos.forEach((r, i) => {
    if (r.displayName) entries[`repos.${i}.displayName`] = r.displayName;
    if (r.description) entries[`repos.${i}.description`] = r.description;
  });
  function walkNav(items: NavItem[] | undefined, base: string) {
    items?.forEach((item, i) => {
      if (item.text) entries[`${base}.${i}.t`] = item.text;
      if (item.items) walkNav(item.items, `${base}.${i}.items`);
    });
  }
  walkNav(site.nav, "nav");

  if (!Object.keys(entries).length) return site;

  const translated = await translateBundle({
    env,
    ctx,
    site,
    kind: "config",
    key: "site:v1",
    locale: localeCode,
    entries,
  });

  // Reapply.
  const copy: VellumConfig = {
    ...site,
    site: { ...site.site, tagline: translated["site.tagline"] ?? site.site.tagline },
    repos: site.repos.map((r, i) => ({
      ...r,
      displayName: translated[`repos.${i}.displayName`] ?? r.displayName,
      description: translated[`repos.${i}.description`] ?? r.description,
    })),
    nav: site.nav ? cloneNavWithTranslations(site.nav, translated, "nav") : site.nav,
  };
  return copy;
}

function cloneNavWithTranslations(
  items: NavItem[],
  translated: Record<string, string>,
  base: string,
): NavItem[] {
  return items.map((item, i) => ({
    ...item,
    text: translated[`${base}.${i}.t`] ?? item.text,
    items: item.items
      ? cloneNavWithTranslations(item.items, translated, `${base}.${i}.items`)
      : item.items,
  }));
}

// Translate a flat string-keyed dictionary (e.g. the UI strings from
// src/shared/i18n.ts) into the requested locale. Used by the SSR layer to
// bake a translated UI dictionary into the bootstrap payload so the
// client-side `t()` can resolve new MT locales without a code change.
// Returns the original dictionary when translation is disabled or the
// locale is the default / not an MT target.
export async function translateUiStrings(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  localeCode: string,
  source: Record<string, string>,
): Promise<Record<string, string> | undefined> {
  if (!isMtTarget(site, localeCode)) return undefined;
  if (localeCode === site.site.defaultLocale) return undefined;
  if (!Object.keys(source).length) return undefined;
  return translateBundle({
    env,
    ctx,
    site,
    kind: "ui",
    key: "ui:v1",
    locale: localeCode,
    entries: source,
  });
}

// True when the given locale is machine-translated rather than hand-curated.
// Reads the resolved `LocaleConfig.machineTranslated` flag set by
// `expandLocalesFromTranslate()`, which is the post-canonicalization
// signal — important because the raw `targets` list may contain bare
// codes like `ab` that got expanded to `ab-GE` in the resolved locales.
// Checking against `targets` directly misses those canonicalized entries.
export function isMtTarget(site: VellumConfig, localeCode: string): boolean {
  if (!site.site.translate) return false;
  const locale = site.site.locales.find((l) => l.code === localeCode);
  return locale?.machineTranslated === true;
}

// Resolve the locale's `LocaleConfig` if present. Helper for callers that
// otherwise duplicate this lookup all over the place.
export function findLocale(site: VellumConfig, code: string) {
  return site.site.locales.find((l) => l.code === code);
}

// Read a cached translation from D1. Returns the translated content string
// or null when no cached row exists. Used by the bulk-translate endpoint to
// look up existing translations for variant-source fallback (e.g. using
// zh-CN content as the source for zh-HK instead of the default locale).
export async function readCachedTranslation(
  env: Env,
  kind: TranslateKind,
  key: string,
  locale: string,
): Promise<string | null> {
  const db = env.VELLUM_TRANSLATION_DB;
  if (!db) return null;
  const row = await readRow(db, kind, key, locale);
  return row?.content ?? null;
}

// --- D1 row helpers -------------------------------------------------------

interface TranslationRow {
  kind: string;
  key: string;
  locale: string;
  source_hash: string;
  content: string;
  model: string | null;
  refreshed_at: number;
}

async function readRow(
  db: D1Database,
  kind: string,
  key: string,
  locale: string,
): Promise<TranslationRow | null> {
  try {
    const row = await db
      .prepare(
        "SELECT kind, key, locale, source_hash, content, model, refreshed_at FROM translations WHERE kind = ?1 AND key = ?2 AND locale = ?3",
      )
      .bind(kind, key, locale)
      .first<TranslationRow>();
    return row ?? null;
  } catch {
    return null;
  }
}

async function writeRow(db: D1Database, row: TranslationRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO translations (kind, key, locale, source_hash, content, model, refreshed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(kind, key, locale) DO UPDATE SET
         source_hash = excluded.source_hash,
         content = excluded.content,
         model = excluded.model,
         refreshed_at = excluded.refreshed_at`,
    )
    .bind(row.kind, row.key, row.locale, row.source_hash, row.content, row.model, row.refreshed_at)
    .run();
}

// Bulk invalidate. Called by the webhook handler when a repo pushes so the
// next read regenerates. Returns the number of rows deleted.
export async function invalidateForRepo(
  env: Env,
  repoSlug: string,
  branch?: string,
): Promise<number> {
  const db = env.VELLUM_TRANSLATION_DB;
  if (!db) return 0;
  // Keys for page/frontmatter/sidebar/repo-nav all start with `{repoSlug}@`.
  // Top-level kinds (ui, config) aren't repo-scoped — leave them alone here;
  // the scheduled refresher will eventually re-translate them when stale.
  const prefix = branch ? `${repoSlug}@${branch}:` : `${repoSlug}@`;
  try {
    const res = await db
      .prepare(
        // GLOB is the SQLite-flavoured wildcard. LIKE would need ESCAPE
        // gymnastics for repos whose slug contains an underscore.
        "DELETE FROM translations WHERE key GLOB ?1",
      )
      .bind(`${prefix}*`)
      .run();
    return (res.meta?.changes as number | undefined) ?? 0;
  } catch {
    return 0;
  }
}

// List every locale that has a cached `page`-kind translation row for the
// given page key. Used by the router to build PageMeta.translatedLocales,
// which the banner then filters its inline "view this page in" list by —
// so we only advertise locales the reader can actually navigate to.
//
// Returns an empty array when the binding is missing or the query fails,
// which collapses cleanly to "no known translations" without breaking
// the page render.
export async function listTranslatedLocalesForPage(
  env: Env,
  repoSlug: string,
  branch: string,
  pagePath: string,
): Promise<string[]> {
  const db = env.VELLUM_TRANSLATION_DB;
  if (!db) return [];
  try {
    const res = await db
      .prepare("SELECT locale FROM translations WHERE kind = 'page' AND key = ?1")
      .bind(`${repoSlug}@${branch}:${pagePath}`)
      .all<{ locale: string }>();
    return (res.results ?? []).map((r) => r.locale);
  } catch {
    return [];
  }
}

// Pull up to `limit` rows whose `refreshed_at` is older than the staleness
// cutoff. Used by the scheduled cron tick. Returns just the keys the caller
// needs to re-resolve the source for and call `translate` again.
export async function listStaleRows(
  env: Env,
  cutoffMs: number,
  limit: number,
): Promise<
  Array<{
    kind: string;
    key: string;
    locale: string;
    source_hash: string;
  }>
> {
  const db = env.VELLUM_TRANSLATION_DB;
  if (!db) return [];
  try {
    const res = await db
      .prepare(
        "SELECT kind, key, locale, source_hash FROM translations WHERE refreshed_at < ?1 ORDER BY refreshed_at ASC LIMIT ?2",
      )
      .bind(cutoffMs, limit)
      .all<{ kind: string; key: string; locale: string; source_hash: string }>();
    return res.results ?? [];
  } catch {
    return [];
  }
}

// Delete up to `limit` rows whose `refreshed_at` is older than the cutoff.
// Used by the scheduled cron tick. Deleting rather than re-translating in
// place is intentional: re-fetching the source per kind from the cron
// handler would mean re-implementing every source-resolver here. Instead,
// the deletion is a no-op for cold paths and a warm-up for hot paths —
// the next request for an affected page/sidebar/etc re-translates via
// the lazy `translate()` write-through.
//
// Returns the count of rows deleted.
export async function pruneStaleRows(env: Env, cutoffMs: number, limit: number): Promise<number> {
  const db = env.VELLUM_TRANSLATION_DB;
  if (!db) return 0;
  try {
    // SQLite doesn't support LIMIT on DELETE without the SQLITE_ENABLE_UPDATE_DELETE_LIMIT
    // compile flag (D1 doesn't ship it), so we do a select-then-delete in one
    // round trip. Capped by `limit` so a giant table doesn't blow the cron tick.
    const stmt = db.prepare(
      `DELETE FROM translations
       WHERE rowid IN (
         SELECT rowid FROM translations
         WHERE refreshed_at < ?1
         ORDER BY refreshed_at ASC
         LIMIT ?2
       )`,
    );
    const res = await stmt.bind(cutoffMs, limit).run();
    return (res.meta?.changes as number | undefined) ?? 0;
  } catch {
    return 0;
  }
}

// Read the translation config — handy for the scheduled handler that
// doesn't have direct access to the SITE singleton (it lives in router.ts).
export function getTranslateConfig(site: VellumConfig): TranslateConfig | undefined {
  return site.site.translate;
}

// --- Hashing --------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

// --- Provider plumbing ----------------------------------------------------

interface ProviderResult {
  content: string;
  model: string;
  apiKeyHint: string;
}

async function runProvider(
  env: Env,
  site: VellumConfig,
  cfg: TranslateConfig,
  kind: TranslateKind,
  locale: string,
  source: string,
): Promise<ProviderResult> {
  const { system, user } = buildPrompt(kind, locale, source);
  const endpoints = resolveEndpoints(cfg, site, env);
  const tag = `[vellum][translate] kind=${kind} locale=${locale}`;

  return runWithFailover(tag, endpoints, async (ep) => {
    const model = ep.model ?? defaultModelFor(ep.provider);
    const label = `${ep.id}:${model}`;
    const hint = ep.apiKey ? `…${ep.apiKey.slice(-4)}` : "";
    let content: string;
    if (ep.provider === "workers-ai") content = await runWorkersAi(env, ep, model, system, user);
    else if (ep.provider === "anthropic") content = await runAnthropic(ep, model, system, user);
    else content = await runOpenAi(ep, model, system, user);
    return { content, model: label, apiKeyHint: hint };
  });
}

function defaultModelFor(provider: "workers-ai" | "openai-compatible" | "anthropic"): string {
  switch (provider) {
    case "workers-ai":
      return "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    case "openai-compatible":
      return "openai/gpt-4o-mini";
    case "anthropic":
      return "claude-haiku-4-5";
  }
}

async function runWorkersAi(
  env: Env,
  ep: ResolvedEndpoint,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  if (!env.AI) {
    throw new Error("AI binding not available. Add [ai] to wrangler.jsonc.");
  }
  const result = (await env.AI.run(model, {
    max_tokens: 4096,
    ...(ep.extraBody ?? {}),
    // Structural fields win over extraBody.
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  })) as { response?: string };
  const text = result?.response;
  if (!text) throw new Error("Workers AI returned no response.");
  return stripFences(text);
}

async function runOpenAi(
  ep: ResolvedEndpoint,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  if (!ep.apiKey) {
    throw new Error(`OpenAI-compatible API key is not set (expected env var ${ep.apiKeyEnv}).`);
  }
  const baseUrl = (ep.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ep.apiKey}`,
      "http-referer": "https://github.com/siiway/vellum",
      "x-title": "Vellum Translate",
    },
    body: JSON.stringify({
      // Tunable defaults first. extraBody can override these for
      // provider-specific tuning (e.g. translate at temperature 0.3 to
      // reduce mistakes on idiomatic phrases) or to enable
      // provider-specific features (deepseek's chat_template_kwargs,
      // top_p, presence_penalty, …).
      temperature: 0,
      max_tokens: 4096,
      ...(ep.extraBody ?? {}),
      // Structural fields — always win so the worker's streaming
      // / message-shape assumptions can't be accidentally broken via
      // extraBody.
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status}: ${errText.slice(0, 200) || res.statusText}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error("Translation provider returned an empty response.");
  return stripFences(text);
}

async function runAnthropic(
  ep: ResolvedEndpoint,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  if (!ep.apiKey) {
    throw new Error(`Anthropic API key is not set (expected env var ${ep.apiKeyEnv}).`);
  }
  const baseUrl = (ep.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ep.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      max_tokens: 4096,
      ...(ep.extraBody ?? {}),
      // Structural fields win over extraBody.
      model,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status}: ${errText.slice(0, 200) || res.statusText}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text =
    json.content?.find((c) => c.type === "text")?.text ?? json.content?.[0]?.text ?? null;
  if (!text) throw new Error("Anthropic returned an empty response.");
  return stripFences(text);
}

// Models occasionally wrap the answer in a ```json … ``` or ``` … ``` fence
// even when told not to. Strip a single surrounding fence; leave inner code
// blocks (which should stay verbatim in markdown translations) alone.
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
  if (fence) return fence[1]!;
  return trimmed;
}

// --- Prompts --------------------------------------------------------------

function buildPrompt(
  kind: TranslateKind,
  locale: string,
  source: string,
): { system: string; user: string } {
  const localeHint = localeInstruction(locale);

  if (kind === "page") {
    const system = [
      "You are a professional documentation translator.",
      `Translate the following Markdown source into ${localeHint}.`,
      "",
      "STRICT REQUIREMENTS:",
      "- Preserve ALL Markdown syntax exactly: headings, links, images, lists, tables, blockquotes.",
      "- Preserve ALL code blocks (```…```), inline code (`…`), and HTML tags VERBATIM. Do not translate code, identifiers, function names, command flags, or anything inside backticks / code fences.",
      "- Preserve link URLs (`[text](url)`) and image URLs verbatim — translate only the link/alt text.",
      "- Preserve YAML frontmatter delimiters (`---`); inside the frontmatter, translate ONLY the values of `title`, `description`, `tagline`, `text`, `name`, `details`, `linkText` — leave every other key and all non-string values untouched.",
      "- Preserve VitePress / OPS containers (`::: tip`, `::: warning`, `[!INCLUDE …]`, `[!code-…]`, `[!NOTE]`) — translate inner text but never the directive token.",
      "- Preserve `<` `>` HTML and Vue component tags exactly; translate only inner text nodes.",
      "- Preserve xref tokens like `@xref:uid` and cross-repo `@slug/...` links verbatim.",
      "- Do NOT add any explanation, preamble, or trailing notes. Output ONLY the translated Markdown.",
      "- Do NOT wrap your output in a ```markdown fence — return the raw Markdown.",
    ].join("\n");
    return { system, user: source };
  }

  if (
    kind === "frontmatter" ||
    kind === "sidebar" ||
    kind === "repo-nav" ||
    kind === "ui" ||
    kind === "config"
  ) {
    const system = [
      "You are a professional documentation translator.",
      `Translate the string values in the following JSON into ${localeHint}.`,
      "",
      "STRICT REQUIREMENTS:",
      '- The input has the shape `{ "entries": { key: string, ... } }`. Return the same JSON shape with the SAME keys and translated string values.',
      "- Preserve key names exactly.",
      "- Preserve placeholder tokens like `{name}`, `{count}`, `%s`, and HTML entities verbatim.",
      '- Preserve inline code (`…`), URLs, file paths, and proper nouns (product names, e.g. "GitHub", "Cloudflare", "Vellum").',
      "- Output ONLY the JSON object. No commentary, no markdown fence.",
    ].join("\n");
    return { system, user: source };
  }

  // Unknown kind — fall back to a "translate this text" prompt.
  return {
    system: `Translate the following text into ${localeHint}. Output only the translation, no explanation.`,
    user: source,
  };
}

// Resolve a locale code to a phrase the model can route on. Uses
// `Intl.DisplayNames` in English so region-coded BCP47 codes resolve into
// natural phrases the model already understands ("Chinese (Simplified,
// China)", "Portuguese (Brazil)", "Spanish (Mexico)"). The trailing BCP47
// code is appended verbatim so the model sees both forms — frontier
// models cross-check, which improves the variant chosen when ICU's English
// label is ambiguous.
//
// Codes the runtime can't resolve fall back to the bare BCP47 code; the
// model still copes with that for most living languages.
function localeInstruction(code: string): string {
  try {
    const dn = new Intl.DisplayNames(["en"], {
      type: "language",
      // "dialect" so `zh-Hans-CN` reads as "Simplified Chinese (China)"
      // instead of the technical "Chinese (Hans, China)".
      languageDisplay: "dialect",
    });
    const name = dn.of(code);
    if (name && name !== code) return `${name} (${code})`;
  } catch {
    // Runtimes without Intl.DisplayNames — fall through.
  }
  return `the language whose BCP47 code is "${code}"`;
}
