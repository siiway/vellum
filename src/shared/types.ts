// Shared types used by both the Worker (SSR) and the browser (hydration).

import ISO6391 from "iso-639-1";
import { countries, continents } from "countries-list";
import cldrAvailable from "cldr-core/availableLocales.json";

export interface LocaleConfig {
  code: string;
  label: string;
  // URL prefix segment for this locale (e.g. "en", "zh"). Used when matching
  // and building canonical URLs. Decoupled from the source-file layout —
  // see `localeSourcePrefix` below.
  prefix: string;
  // When true, this locale was synthesized from `site.translate.targets`
  // rather than declared explicitly. The UI uses this to badge translated
  // pages and to skip source-file lookups under a locale subdirectory the
  // repo doesn't actually ship. Set automatically at config load time —
  // authors should never set this by hand.
  machineTranslated?: boolean;
}

// Canonicalize a locale code into its BCP47 region-coded form. Uses CLDR's
// likely-subtags data via `Intl.Locale.maximize()` (`zh` → `zh-CN`,
// `pt` → `pt-BR`, `en` → `en-US`). Codes that are already region-coded
// pass through unchanged. Codes the runtime can't parse fall through too.
//
// Used at config load to normalize entries in `translate.targets` so the
// merged `site.locales` always uses the region-coded form internally,
// while authors can still type bare codes for backward compatibility.
export function canonicalLocaleCode(code: string): string {
  if (!code) return code;
  if (code.includes("-")) return code;
  try {
    const max = new Intl.Locale(code).maximize();
    return max.region ? `${max.language}-${max.region}` : max.language;
  } catch {
    return code;
  }
}

// Preferred display form for a locale's identifier. Returns the prefix
// (which is already BCP47 for author-declared locales like
// `{ code: "zh", prefix: "zh-CN" }`) or the canonical of the code.
// Used in card subtitles / picker tooltips so readers see `zh-CN`, not
// the internal bare `zh`.
export function displayLocaleCode(locale: LocaleConfig): string {
  if (locale.prefix && locale.prefix.includes("-")) return locale.prefix;
  return canonicalLocaleCode(locale.code);
}

// Map a locale to a continent code (one of "AS", "EU", "AF", "NA", "SA",
// "OC", "AN") using its CLDR-likely region. Returns null when neither the
// runtime nor the country data can produce a region. Continent data comes
// from the `countries-list` npm package — externally maintained, not
// hardcoded in this codebase.
type ContinentCode = "AF" | "AN" | "AS" | "EU" | "NA" | "OC" | "SA";

export function localeContinent(code: string): ContinentCode | null {
  let region: string | undefined;
  try {
    region = new Intl.Locale(code).maximize().region ?? undefined;
  } catch {
    return null;
  }
  if (!region) return null;
  const country = (countries as Record<string, { continent?: string }>)[region];
  return (country?.continent as ContinentCode | undefined) ?? null;
}

// Continent display name in English ("Asia", "Europe", …). Sourced from
// `countries-list`'s exported map; we keep the package as the source of
// truth rather than maintaining our own list.
export function continentName(code: ContinentCode | "OTHER"): string {
  if (code === "OTHER") return "Other";
  return (continents as Record<string, string>)[code] ?? code;
}

// Resolve a locale's display label. Resolution order:
//   1. `iso-639-1`'s native-name table for the bare-language code — IANA-
//      curated, ~180 entries (zh → 中文, ja → 日本語, …). Region-coded
//      BCP47 codes fall to step 2 via their primary subtag.
//   2. `Intl.DisplayNames` in the locale's own writing system, so a
//      region-coded code like `pt-BR` reads as "português (Brasil)" rather
//      than the bare-language fallback.
//   3. The code itself, as a last resort for codes neither package nor
//      runtime recognizes.
//
// No hardcoded label table in this codebase — the data comes from
// IANA / ISO 639-1 and the ICU data shipped with the JS runtime.
export function localeLabel(code: string): string {
  if (!code) return code;
  // Try Intl.DisplayNames first for region-coded codes — with
  // `languageDisplay: "dialect"` it produces idiomatic native names
  // like "简体中文", "português brasileiro", "American English" instead
  // of the technical "Chinese (Hans, CN)" form.
  if (code.includes("-")) {
    try {
      const dn = new Intl.DisplayNames([code], {
        type: "language",
        languageDisplay: "dialect",
      });
      const name = dn.of(code);
      if (name && name !== code) return name;
    } catch {
      // Fall through to the bare-language lookup.
    }
  }
  // Bare-language code (or region-coded with no Intl support): ask ISO 639-1.
  const primary = code.split("-")[0]!;
  const native = ISO6391.getNativeName(primary);
  if (native) return native;
  // Final fallback: ask Intl.DisplayNames with the bare code.
  try {
    const dn = new Intl.DisplayNames([code], { type: "language" });
    const name = dn.of(code);
    if (name && name !== code) return name;
  } catch {
    // ignore
  }
  return code;
}

// Enumerate the canonical locale set when `site.translate.targets === "all"`.
//
// Source: Unicode CLDR's full availableLocales list (~766 entries, from the
// `cldr-core` npm package), piped through `Intl.Locale.minimize()` to
// collapse script-tagged variants into the shortest equivalent BCP47 form.
// That turns CLDR's `zh-Hant-HK` into `zh-HK`, `zh-Hant` into `zh-TW`,
// and `pt-BR` into the bare `pt` (which expandLocalesFromTranslate then
// canonicalizes back to `pt-BR` via likely-subtags). The result is a clean
// list of every meaningful BCP47 locale variant readers might use:
// `zh-CN`, `zh-TW`, `zh-HK`, `pt-PT`, `en-GB`, `es-MX`, `fr-CA`, etc.
//
// Falls back to the iso-639-1 bare-language list if CLDR data ever fails
// to load — keeps the feature degrading gracefully.
export function allRuntimeLocales(): string[] {
  const raw = (cldrAvailable as { availableLocales?: { full?: string[] } })?.availableLocales?.full;
  if (!Array.isArray(raw) || !raw.length) return ISO6391.getAllCodes();
  const seen = new Set<string>();
  for (const code of raw) {
    if (!code) continue;
    let canonical = code;
    try {
      canonical = new Intl.Locale(code).minimize().toString();
    } catch {
      // Locale tag the runtime can't parse — surface the CLDR form so it
      // still ends up in the picker.
    }
    seen.add(canonical);
  }
  return [...seen].sort();
}

// Resolve `translate.targets` to an explicit code list. The literal sentinel
// "all" expands to whatever `Intl.supportedValuesOf("language")` reports
// (about 600 codes on modern V8) — no hardcoded list, the JS runtime is
// the source of truth. A user-supplied array is returned verbatim so
// authors can mix region-coded variants (`zh-CN`, `pt-BR`) with bare codes
// (`ja`, `ko`) however they like.
//
// Exported so tooling (the cron, the locale-picker preview, anyone
// curious about what would actually get translated) can ask without
// re-implementing the rules.
export function resolveTranslateTargets(translate: TranslateConfig | undefined): string[] {
  if (!translate) return [];
  if (translate.targets === "all") return allRuntimeLocales();
  return [...(translate.targets ?? [])];
}

// Resolve a VellumConfig by merging `site.translate.targets` into
// `site.locales`. Author-declared locales win on conflict — their label,
// prefix, and `machineTranslated:false` survive even when the code also
// appears in `targets`.
//
// Each target code is canonicalized via `canonicalLocaleCode()` (so a bare
// `"zh"` in targets becomes a `zh-CN` locale entry) and skipped when:
//   - the canonical or bare form is already a declared locale `code`;
//   - the canonical form is already a declared locale `prefix` (catches
//     e.g. existing `{ code: "zh", prefix: "zh-CN" }` colliding with a
//     `targets: ["zh-CN"]` entry).
//
// New entries get the canonical form as both `code` and `prefix`, so URLs
// for machine-translated locales are always region-coded (`/zh-CN/...`).
//
// Pure function: returns a new VellumConfig, doesn't mutate the input.
// Idempotent: calling twice yields the same result.
export function expandLocalesFromTranslate(config: VellumConfig): VellumConfig {
  const translate = config.site.translate;
  const targets = resolveTranslateTargets(translate);
  if (!targets.length) return config;

  const knownCodes = new Set(config.site.locales.map((l) => l.code));
  const knownPrefixes = new Set(
    config.site.locales.map((l) => l.prefix).filter((p): p is string => !!p),
  );
  const merged: LocaleConfig[] = config.site.locales.map((l) => ({ ...l }));

  for (const raw of targets) {
    const canonical = canonicalLocaleCode(raw);
    if (knownCodes.has(raw) || knownCodes.has(canonical)) continue;
    if (knownPrefixes.has(canonical)) continue;
    merged.push({
      code: canonical,
      label: localeLabel(canonical),
      prefix: canonical,
      machineTranslated: true,
    });
    knownCodes.add(canonical);
    knownPrefixes.add(canonical);
  }

  return {
    ...config,
    site: { ...config.site, locales: merged },
  };
}

// Where this locale's source markdown lives, relative to the repo's docsRoot.
// The default locale's content sits at the docs root with no subdirectory;
// every other locale lives under a subdir named after its short `code`
// (e.g. `docs/zh/`, `docs/ja/`) — the long-standing repo convention,
// preserved even when URLs use a richer BCP47 prefix like `zh-CN`.
//
// Machine-translated locales still get checked under their code subdir
// first so a hand-translated file shipped in the repo wins ("fill gaps
// only"). When that path returns nothing, the router falls back to the
// default-locale source and runs it through the translation service.
export function localeSourcePrefix(locale: LocaleConfig, defaultLocaleCode: string): string {
  return locale.code === defaultLocaleCode ? "" : locale.code;
}

export interface RepoVersion {
  label: string;
  branch: string;
  default?: boolean;
}

export interface RepoConfig {
  slug: string;
  // "github" (default) fetches content from raw.githubusercontent.com via the
  // GitHub source. "local" reads from a directory bundled into the worker's
  // ASSETS at build time — useful for docs that live next to the worker, for
  // air-gapped previews, or for content owned by the same repo as Vellum
  // itself. owner/repo/branch become optional when source === "local".
  source?: "github" | "local";
  // GitHub-source fields. Optional when source === "local".
  owner?: string;
  repo?: string;
  branch?: string;
  docsRoot: string;
  displayName: string;
  description?: string;
  logo?: string;
  editLinkPattern?: string;
  versions?: RepoVersion[];
  // Local-source field: directory under the project root that holds the
  // markdown tree. Optional — defaults to `local-docs/{slug}`. Path is
  // relative to the project root and is resolved at build time by the Vite
  // local-docs plugin, which copies the tree into the worker's ASSETS bundle
  // alongside a manifest.json the worker uses to enumerate pages.
  localPath?: string;
  // When true, the NavBar omits this repo's displayName crumb after the site
  // title. Useful for the homepageRepo where the second crumb is redundant
  // (the site title already represents the landing page).
  hideInBrand?: boolean;
  // When true, the repo is omitted from search results — both from the
  // per-repo dialog's scope picker and from the cross-repo full-page search.
  // Use for landing-page repos (the homepage) and other "system" content the
  // reader shouldn't be sent to by a query.
  excludeFromSearch?: boolean;
  // Per-repo override for site.socialLinks. Shown in the NavBar when the
  // reader is inside this repo. Same shape as the site-level field. Higher-
  // priority overrides come from the repo's own vellum.json#socialLinks or
  // VitePress themeConfig.socialLinks.
  socialLinks?: SocialLink[];
  // Per-repo search synonyms. Merged on top of site.searchAliases (and the
  // built-in baseline) when searching within this repo. Use it for
  // vocabulary that only makes sense for this product — e.g. mapping a
  // product code-name to its public-facing terminology.
  searchAliases?: Record<string, string[]>;
}

export interface NavItem {
  text: string;
  link?: string;
  items?: NavItem[];
  activeMatch?: string;
}

export interface VueComponentRef {
  name: string;
  // Repo-rooted path to the .vue source file, used as the `path` parameter to
  // the `/api/vue` endpoint.
  path: string;
}

// Icon names with a built-in SVG. Authors can also pass `{ svg: "<svg...>" }`
// for anything not in the table.
export type SocialIconName =
  | "github"
  | "gitlab"
  | "x"
  | "twitter"
  | "discord"
  | "slack"
  | "mastodon"
  | "bluesky"
  | "youtube"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "npm"
  | "rss"
  | "stackoverflow"
  | "reddit"
  | "twitch"
  | "telegram";

export interface SocialLink {
  // Either a known name (rendered from the built-in SVG table) or a `{ svg }`
  // wrapper carrying raw SVG markup. Matches the VitePress themeConfig.
  icon: SocialIconName | { svg: string };
  link: string;
  // Optional accessible label. Defaults to the capitalised icon name.
  ariaLabel?: string;
}

export interface SiteConfig {
  title: string;
  tagline?: string;
  logo?: string;
  favicon?: string;
  themeColor?: string;
  footer?: string;
  // Which repo's root acts as the site's landing page. The `/` route redirects
  // here, and the NavBar brand link points here (locale-preserved).
  homepageRepo: string;
  defaultLocale: string;
  locales: LocaleConfig[];
  // Icon-only links rendered in the NavBar after the locale picker and before
  // the theme toggle. Matches VitePress's themeConfig.socialLinks.
  socialLinks?: SocialLink[];
  // Microsoft Learn-style AI Summary button rendered below the page title on
  // doc pages. The worker proxies to the configured provider, streams tokens
  // back over SSE, and caches the final summary in KV per (repo, branch,
  // locale, page). Omit the whole block to disable the feature site-wide.
  aiSummary?: AiSummaryConfig;
  // "Ask AI about this docs" chat. Floating button + drawer that lets
  // visitors chat with an LLM that has tools to search and fetch the docs.
  // Same provider plumbing as aiSummary; configured independently so a
  // deployment can enable one without the other (e.g. summaries on, chat
  // off until you've reviewed bills).
  aiChat?: AiChatConfig;
  // Machine translation. When configured, the worker fills in every locale
  // listed in `targets` (auto-merged into `locales`) by running source
  // markdown, sidebar/nav labels, frontmatter strings, UI labels, and
  // repo display strings through the provider. Translations are cached in
  // the D1 binding `VELLUM_TRANSLATION_DB` and refreshed on webhook (per
  // repo) or after `refreshDays` (hourly cron tick). Hand-translated files
  // shipped in a repo's locale subdir always win over the machine output.
  // Omit the whole block to disable translation site-wide.
  translate?: TranslateConfig;
  // Search synonyms. Each key is a canonical or shorthand term; values are
  // the words the docs author is likely to have used for the same concept.
  // A reader searching for any of these terms will also match pages that
  // contain the others (alias hits score below primary hits so canonical
  // matches still win). Merged on top of a built-in baseline (latex/math,
  // auth/oauth, ws/websocket, …) so config only needs to spell out the
  // product-specific vocabulary.
  searchAliases?: Record<string, string[]>;
}

export interface AiSummaryConfig {
  // Which provider the worker should route through. Provider-specific secrets
  // (API keys) come from worker env vars, not this file.
  //   - "workers-ai": Cloudflare Workers AI binding (env.AI). No API key needed.
  //   - "openai-compatible": Anything that speaks OpenAI's /v1/chat/completions
  //     — OpenAI itself, OpenRouter, Together, Groq, a local llama.cpp, etc.
  //     Uses VELLUM_AI_API_KEY and VELLUM_AI_BASE_URL.
  //   - "anthropic": Anthropic's Messages API. Uses VELLUM_AI_API_KEY.
  provider: "workers-ai" | "openai-compatible" | "anthropic";
  // Model identifier passed to the provider. For workers-ai this is the
  // model id (e.g. "@cf/meta/llama-3.3-70b-instruct-fp8-fast"). For
  // openai-compatible / anthropic it's whatever the provider's API expects
  // (e.g. "openai/gpt-4o-mini" via OpenRouter, "claude-haiku-4-5").
  model?: string;
  // Base URL override for openai-compatible providers — lets you point at
  // OpenRouter ("https://openrouter.ai/api/v1"), a self-hosted gateway, etc.
  // When omitted the worker uses VELLUM_AI_BASE_URL, then OpenAI's URL.
  baseUrl?: string;
  // Cloudflare Turnstile site key. When set, the AI Summary button mounts an
  // invisible Turnstile widget, the client passes the token to /api/summarize,
  // and the worker verifies it against siteverify before calling the model.
  // Pairs with the VELLUM_TURNSTILE_SECRET env secret. Omit to disable
  // captcha (useful for local dev and trusted-network deploys).
  turnstileSiteKey?: string;
  // KV TTL for the cached summary in seconds. Defaults to 7 days. The webhook
  // doesn't currently bust these — a docs edit invalidates the rendered HTML
  // but the old summary survives until the TTL expires.
  cacheTtlSeconds?: number;
}

export interface TranslateConfig {
  // Same provider matrix as aiSummary / aiChat. Picks a smaller / cheaper
  // model than chat by default — translation is high-volume, batch-friendly,
  // and doesn't reward reasoning the way Q&A does.
  provider: "workers-ai" | "openai-compatible" | "anthropic";
  // Model id. Defaults: "@cf/meta/m2m100-1.2b" (workers-ai dedicated MT
  // model), "openai/gpt-4o-mini" (openai-compatible), "claude-haiku-4-5"
  // (anthropic).
  model?: string;
  // Base URL for openai-compatible providers; falls back to
  // VELLUM_AI_BASE_URL then OpenAI's URL. Reuses the same VELLUM_AI_API_KEY
  // secret as aiSummary / aiChat.
  baseUrl?: string;
  // Locale codes to auto-translate into. Pass an explicit list (e.g.
  // `["es", "fr", "ja", "zh-CN"]`) or the sentinel `"all"` to expand to
  // every language in the IANA-maintained ISO 639-1 registry (~180
  // bare-language codes, sourced via the `iso-639-1` npm package).
  //
  // Region-coded BCP47 variants like `zh-CN`, `pt-BR`, `es-MX` aren't in
  // the ISO 639-1 base set — list them explicitly when you want the
  // region-specific output. Mixed lists work: `["zh-CN", "zh-TW", "ja"]`
  // gives you Simplified+Traditional Chinese plus bare Japanese.
  //
  // Each resolved entry is merged into `site.locales` at config load with
  // `machineTranslated: true`, a label resolved by `localeLabel()` (ISO
  // 639-1 native name for bare-language codes, `Intl.DisplayNames` for
  // region-coded variants), and a URL prefix equal to the code — so
  // `"zh-CN"` produces `/zh-CN/...` URLs. Codes that already appear in
  // `site.locales` are skipped: author-declared locales win and keep
  // their hand-curated label / prefix.
  targets: string[] | "all";
  // How long a cached translation row is considered fresh. The hourly cron
  // tick re-runs the provider on rows older than this. Defaults to 5 days.
  // The webhook handler busts rows for a repo as soon as that repo pushes,
  // so this is the "background drift" interval, not the staleness ceiling
  // for actively-edited docs.
  refreshDays?: number;
  // Max in-flight translation calls per refresh tick. Defaults to 4. Tune
  // this against the provider's rate limits — Workers AI is happy with 8+,
  // OpenRouter rate-limits aggressively at the free tier.
  concurrency?: number;
  // Per-tick row budget for the scheduled refresher. Defaults to 50. Caps
  // CPU + outbound-fetch time per cron invocation so the Worker stays well
  // inside its 30s limit even when the table is huge.
  batchSize?: number;
}

export interface AiChatConfig {
  // Same set as AiSummaryConfig.provider — see there for the matrix. Note
  // that tool calling is only reliably supported by openai-compatible and
  // anthropic providers; "workers-ai" works but with a smaller tool-use
  // model menu (Llama 3.3 70B Fast is the default).
  provider: "workers-ai" | "openai-compatible" | "anthropic";
  // Model id. Defaults: "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  // (workers-ai), "openai/gpt-4o-mini" (openai-compatible),
  // "claude-haiku-4-5" (anthropic). Use a stronger model than for summaries
  // if you can afford it — chat answers benefit from more reasoning.
  model?: string;
  baseUrl?: string;
  // Cloudflare Turnstile site key. When set, the visitor solves one
  // (invisible) challenge per chat session; the worker issues a short-lived
  // signed session token that subsequent messages present in the
  // Authorization header. Pairs with VELLUM_TURNSTILE_SECRET.
  turnstileSiteKey?: string;
  // Maximum agentic loop iterations per user message before the worker
  // returns the partial response. Defaults to 6 — enough for "search →
  // fetch one or two pages → answer" while bounding cost.
  maxIterations?: number;
}

export interface VellumConfig {
  site: SiteConfig;
  repos: RepoConfig[];
  nav?: NavItem[];
}

// Per-repo TOC node, either explicit (from vellum.json / VitePress config) or derived from directory listing.
export interface SidebarItem {
  text: string;
  link?: string;
  items?: SidebarItem[];
  collapsed?: boolean;
}

export interface SidebarGroup {
  text: string;
  items: SidebarItem[];
  collapsed?: boolean;
}

// Outline / right-hand TOC built from headings.
// `text` is the plain heading content; `html` preserves inline formatting
// (code spans, emphasis, links) so the sidebar matches the page heading.
export interface OutlineNode {
  depth: number;
  text: string;
  html?: string;
  slug: string;
  children?: OutlineNode[];
}

export interface PageMeta {
  title: string;
  description?: string;
  frontmatter: Record<string, unknown>;
  outline: OutlineNode[];
  editUrl?: string;
  lastUpdated?: { iso: string; author?: string; sha: string } | null;
  prev?: { text: string; link: string } | null;
  next?: { text: string; link: string } | null;
  // True when this page's body was machine-translated from the default-
  // locale source rather than fetched as a hand-curated file. UI can surface
  // a "machine translation" badge.
  machineTranslated?: boolean;
  // True when the MT pipeline was triggered for this page (the requested
  // locale is an MT target and we found a default-locale source to feed
  // through the translator). When `translationAttempted` is true but
  // `machineTranslated` is false, the provider call no-op'd (no API key,
  // provider error, fall-back-to-source path) — the banner surfaces that
  // state separately so readers can tell "translation unavailable" from
  // "you are looking at a hand-curated locale".
  translationAttempted?: boolean;
  // Locale codes (from `site.locales`) the reader can switch to and find
  // this same page rendered. Includes:
  //   - the default locale (the source the translator translates from);
  //   - every hand-curated non-default locale declared in `site.locales`
  //     (we trust the author has shipped the page);
  //   - every machine-translated locale that already has a cached row
  //     for this page in the translation D1 (so links resolve immediately
  //     to a cached translation rather than triggering a fresh model call).
  // The MachineTranslatedBanner filters its inline list against this so
  // readers only see locales they can actually navigate to.
  translatedLocales?: string[];
}

// Forward declaration so types.ts doesn't have to import the markdown module.
export type { MarkdownAst } from "./markdown";

export interface RouteContext {
  repoSlug: string;
  repo: RepoConfig;
  version: RepoVersion;
  localeCode: string;
  // path relative to docsRoot (without locale prefix), no leading slash, no trailing .md
  pagePath: string;
  // canonical URL path inside the site, with leading slash and no trailing slash
  canonicalUrl: string;
}

export interface ErrorState {
  status: number;
  title: string;
  message: string;
  hint?: string;
  // Optional list of suggestions ("did you mean ...?") with site-relative URLs.
  suggestions?: Array<{ text: string; link: string }>;
}

// Bootstrap payload serialized into the SSR HTML and read by the hydration entry.
export interface BootstrapPayload {
  config: VellumConfig;
  route: RouteContext;
  page: {
    // AST shipped to the FluentUI renderer. Replaces the legacy html string.
    ast: import("./markdown").MarkdownAst;
    meta: PageMeta;
  };
  sidebar: SidebarGroup[];
  // Per-repo navigation pulled from the repo's VitePress themeConfig.nav (or
  // vellum.json `nav`). When null, the NavBar falls back to the site-level
  // `config.nav`. Localized so links land in the right repo+locale.
  repoNav?: NavItem[] | null;
  // Per-repo social links. Resolution order at render time:
  //   1. repo's vellum.json#socialLinks
  //   2. repo's VitePress themeConfig.socialLinks
  //   3. RepoConfig.socialLinks in vellum.config.json
  //   4. site.socialLinks  (site-wide fallback)
  // The router resolves 1–3 and stuffs the result here; null means the NavBar
  // should fall back to site-level.
  repoSocialLinks?: SocialLink[] | null;
  // Vue components registered in the repo's `.vitepress/theme/index.ts`. The
  // client uses this to (a) rewrite `<Name />` tags inside markdown HTML blocks
  // to mountable placeholders, and (b) lazy-load + mount the SFC at runtime.
  repoComponents?: VueComponentRef[];
  // The initial theme picked by the server based on cookies / prefers-color-scheme hint.
  initialTheme: "light" | "dark";
  // When set, the shell renders an ErrorPage instead of the doc body.
  error?: ErrorState;
  // Per-locale translation of the static UI dictionary (see src/shared/i18n.ts).
  // Populated server-side only when `site.translate` is configured and the
  // requested locale doesn't have a hand-curated dictionary entry. The client
  // `t()` consults this before falling back to the bundled dictionary, which
  // lets newly-added MT-target locales render with translated chrome without
  // a code change. Keys map onto the same `ui.*` namespace used by i18n.ts.
  uiStrings?: Record<string, string>;
}

declare global {
  interface Window {
    __VELLUM__?: BootstrapPayload;
  }
}
