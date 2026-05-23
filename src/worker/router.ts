// HTTP request dispatcher. Resolves URL -> repo + locale + page,
// pulls markdown from GitHub, renders, and SSRs the React shell.

import type { Env } from "./env";
import type {
  BootstrapPayload,
  ErrorState,
  LocaleConfig,
  RepoConfig,
  RouteContext,
  VellumConfig,
} from "../shared/types";
import { expandLocalesFromTranslate, localeSourcePrefix } from "../shared/types";
import config from "../../vellum.config.json";
import {
  fetchSourceFile,
  fetchSourceTree,
  fetchSourceLastCommit,
  repoRef,
  docsRootPrefix,
} from "./sources";
import { normalizeInternal, renderMarkdown } from "./markdown/index";
import { renderMermaidThemed } from "./markdown/diagrams";
import { extractCodeSlice, type CodeIncludeMeta } from "./markdown/ops-includes";
import { loadXrefMap } from "./xrefmap";
import { highlightCode } from "./markdown/highlight";
import type { Block } from "../shared/markdown";
import type { LinkContext } from "./markdown/links";
import { loadRepoNav, loadRepoSocialLinks, loadSidebar, neighbors } from "./sidebar";
import { renderPage } from "./ssr";
import { readCache, writeCache } from "./cache";
import { ttlSeconds } from "./env";
import { handleWebhook } from "./webhook";
import { handleSearch } from "./search";
import { handleSummarize } from "./summarize";
import { handleAsk } from "./ask";
import {
  translate as mtTranslate,
  translateSiteConfig,
  translateUiStrings,
  listTranslatedLocalesForPage,
  isMtTarget,
} from "./translate";
import { handleMcp } from "./mcp";
import { handleTranslateRepo } from "./translate-repo";
import { handleAiSession } from "./session";
import { handleVueComponentRequest, loadVueComponents } from "./vue";
import { handleRobots, handleSitemap } from "./sitemap";
import { baseUiStrings, t as translate } from "../shared/i18n";

// Merge `site.translate.targets` into `site.locales` so the rest of the worker
// — router, sidebar, search, sitemap — treats machine-translated locales as
// first-class. Author-declared locales win on conflict; new entries get a
// label from BUILTIN_LOCALE_LABELS (or the code) and machineTranslated:true.
const SITE: VellumConfig = expandLocalesFromTranslate(config as VellumConfig);

export async function dispatch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // API surface.
  if (path === "/api/webhook" && request.method === "POST") return handleWebhook(request, env, ctx);
  if (path === "/api/search") return handleSearch(request, env, ctx, SITE);
  if (path === "/api/summarize") return handleSummarize(request, env, ctx, SITE);
  if (path === "/api/ask") return handleAsk(request, env, ctx, SITE);
  if (path === "/api/ai/session")
    return handleAiSession(request, env, SITE.site.aiChat?.turnstileSiteKey);
  if (path === "/api/mcp") return handleMcp(request, env, ctx, SITE);
  if (path === "/api/vue") return handleVueComponentRequest(request, env, ctx, SITE);
  if (path === "/api/translate-repo") return handleTranslateRepo(request, env, ctx, SITE);
  if (path === "/api/health") return Response.json({ ok: true, version: "0.1.0" });

  // SEO infrastructure. robots.txt is static and origin-aware; sitemap.xml
  // enumerates every localized page across every (non-search-excluded) repo
  // with hreflang alternates for translations.
  if (path === "/robots.txt") return handleRobots(request);
  if (path === "/sitemap.xml") return handleSitemap(request, env, ctx, SITE);

  // Static assets (JS, CSS, images bundled by Vite).
  if (path.startsWith("/assets/") || path === "/favicon.ico" || path.endsWith(".webmanifest")) {
    return env.ASSETS.fetch(request);
  }

  // `/` is the language-detect entry point. Cookie wins over Accept-Language
  // so a returning visitor who explicitly clicked into a different locale
  // doesn't get bounced back. The redirect persists the choice via cookie so
  // the same logic applies on every subsequent root visit.
  if (path === "/" || path === "") {
    const locale = pickLocale(request);
    return localeRedirect(url, `/${locale.prefix}`, locale.code);
  }

  // Bare locale `/{prefix}` (and `/{prefix}/`) renders the homepageRepo's
  // index. Canonical URL stays `/{prefix}` — never `/{prefix}/{homepageRepo}`
  // — so search engines see one address for the landing page per locale.
  const bareLocaleMatch = path.match(/^\/([a-zA-Z][a-zA-Z0-9-]*)\/?$/);
  if (bareLocaleMatch) {
    const candidate = bareLocaleMatch[1]!;
    const locale = SITE.site.locales.find((l) => l.prefix === candidate);
    if (locale) {
      const homepageRoute = makeHomepageIndexRoute(locale.code, locale.prefix);
      if (homepageRoute) return renderRoute(env, ctx, request, homepageRoute);
    }
  }

  // `/{prefix}/{homepageRepo}` (slug form of the landing page) redirects to
  // `/{prefix}` so the short form is the only canonical URL. Sub-pages
  // (`/{prefix}/{homepageRepo}/<slug>`) keep their slug-prefixed URL and
  // resolve normally via resolveRoute below.
  const homepageSlugRedirect = matchHomepageRepoIndex(path);
  if (homepageSlugRedirect) {
    const dest = new URL(homepageSlugRedirect, url.origin);
    url.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
    return Response.redirect(dest.toString(), 301);
  }

  // Legacy URL compatibility: the old URL shape put the locale AFTER the repo
  // (`/{repo}/{locale}/{page}`); the canonical shape now puts it first
  // (`/{locale}/{repo}/{page}`). Detect the old shape and 301 to the new one
  // so existing inbound links, bookmarks, and author-written absolute URLs in
  // old docs keep working without manual rewrites.
  const legacy = detectLegacyLocaleShape(path);
  if (legacy) {
    const dest = new URL(legacy, url.origin);
    url.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
    return Response.redirect(dest.toString(), 301);
  }

  // Legacy-prefix normalization: URLs that lead with a locale's short code
  // (`/en/...`, `/zh/...`) are 301'd to the canonical full prefix
  // (`/en-US/...`, `/zh-CN/...`). Lets old bookmarks and inbound links keep
  // working when a config tightens up its prefix to BCP47 form. Skipped when
  // code === prefix (the locale already uses its short code as the URL).
  const aliasTarget = detectLegacyLocalePrefixAlias(path);
  if (aliasTarget) {
    const dest = new URL(aliasTarget, url.origin);
    url.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
    return Response.redirect(dest.toString(), 301);
  }

  // Duplicate-locale-code normalization: URLs like `/{prefix}/{repo}/{code}/page`
  // where `code` is the locale code that differs from the URL prefix (e.g.
  // `/zh-CN/prism/zh/getting-started`). The locale is already encoded in the
  // prefix; the extra `/{code}` segment would double-up inside the source path
  // lookup and 404. Redirect to the form without the redundant segment.
  const dupLocale = detectDuplicateLocaleCode(path);
  if (dupLocale) {
    const dest = new URL(dupLocale, url.origin);
    url.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
    return Response.redirect(dest.toString(), 301);
  }

  // Force a locale prefix on every page URL. Anything that gets this far is a
  // page request (API / SEO / static-asset paths short-circuited above) — if
  // its first segment isn't a configured locale prefix, pick one and bounce
  // there. Folds the homepage-shortcut rewrite in too so `/getting-started`
  // lands directly at `/{prefix}/{homepageRepo}/getting-started` (instead of
  // chaining a second redirect through the unprefixed shortcut).
  if (!startsWithLocalePrefix(path)) {
    const locale = pickLocale(request);
    const target = addLocalePrefixToPath(path, locale.prefix);
    if (target !== path) return localeRedirect(url, target, locale.code);
  }

  // Full-page cross-repo search. `/{localePrefix}/search` is the canonical
  // form (the unprefixed `/search` would have been redirected above). The
  // page renders without touching GitHub, deferring all data fetches to the
  // SearchPage client component via `/api/search?repo=*`.
  const searchRoute = matchSearchRoute(path);
  if (searchRoute) {
    return renderSearchPage(env, ctx, request, searchRoute);
  }

  // Full-page locale chooser. `/{localePrefix}/languages` is the canonical
  // shape. The page is empty chrome — the LanguagesPage component reads
  // `?page=` from the URL on the client and builds locale-prefixed links
  // from the site config in the bootstrap payload.
  const languagesRoute = matchLanguagesRoute(path);
  if (languagesRoute) {
    return renderLanguagesPage(env, ctx, request, languagesRoute);
  }

  const route = resolveRoute(path);
  if (!route) {
    // Bare page like `/getting-started` or `/zh/getting-started` — redirect
    // under the homepage repo so site-rooted links work without needing every
    // author to type `/{homepageRepo}/{page}`.
    const shortcut = detectHomepageShortcut(path);
    if (shortcut && shortcut !== path) {
      const dest = new URL(shortcut, url.origin);
      url.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
      return Response.redirect(dest.toString(), 302);
    }

    // No repo / locale match - render a styled 404 with suggested repos.
    const locale = guessLocale(request, path);
    const localePrefix = SITE.site.locales.find((l) => l.code === locale)?.prefix ?? "";
    const repoPrefix = localePrefix ? `/${localePrefix}` : "";
    const suggestions = SITE.repos.slice(0, 5).map((r) => ({
      text: r.displayName,
      link: `${repoPrefix}/${r.slug}`,
    }));
    return errorPage(env, ctx, request, {
      status: 404,
      title: translate(locale, "ui.notFound.title"),
      message: translate(locale, "ui.notFound.message"),
      hint: `Tried to match: ${path}`,
      suggestions,
    });
  }

  return renderRoute(env, ctx, request, route);
}

// Best-effort locale detection for routes that don't resolve to a repo (so we don't
// have a RouteContext yet). Prefers the URL's locale segment, then Accept-Language.
function guessLocale(request: Request, path: string): string {
  const parts = path.split("/").filter(Boolean);
  for (const seg of parts) {
    const match = SITE.site.locales.find((l) => l.prefix === seg);
    if (match) return match.code;
  }
  return pickLocale(request).code;
}

// Cookie name used to remember an explicit locale choice. Persisted by the
// `/` detection redirect and by the client-side LocalePicker; honoured ahead
// of Accept-Language so a returning visitor isn't bounced to a different
// locale when their browser preferences drift.
const LOCALE_COOKIE = "vellum-locale";
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Pick the locale to serve for a request that doesn't already carry one in
// its URL. Resolution order:
//   1. `vellum-locale` cookie — explicit prior choice.
//   2. Accept-Language header, ranked by quality value, matched on the full
//      tag first (so `zh-Hant` beats `zh` when both are configured), then on
//      the primary subtag (`zh-CN` matches a configured `zh`).
//   3. The site's defaultLocale.
function pickLocale(request: Request): LocaleConfig {
  const fallback =
    SITE.site.locales.find((l) => l.code === SITE.site.defaultLocale) ?? SITE.site.locales[0]!;

  const cookies = parseCookies(request.headers.get("cookie"));
  const cookieCode = cookies[LOCALE_COOKIE];
  if (cookieCode) {
    const match = SITE.site.locales.find((l) => l.code === cookieCode);
    if (match) return match;
  }

  const tags = parseAcceptLanguage(request.headers.get("accept-language"));
  // Pass 1: exact tag match against locale.code (case-insensitive). Catches
  // things like `zh-Hant` if anyone configures it.
  for (const tag of tags) {
    const exact = SITE.site.locales.find((l) => l.code.toLowerCase() === tag);
    if (exact) return exact;
  }
  // Pass 2: primary subtag (the part before the first `-`). Catches the
  // common case of `zh-CN` / `en-US` against bare `zh` / `en` configs.
  for (const tag of tags) {
    const primary = tag.split("-")[0]!;
    const match = SITE.site.locales.find((l) => l.code.toLowerCase() === primary);
    if (match) return match;
  }
  return fallback;
}

// Parse an Accept-Language header into a list of lowercased BCP47 tags
// ranked by q-value (highest first). Missing q-values default to 1.0;
// malformed entries are dropped silently.
function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];
  const parsed = header
    .split(",")
    .map((raw) => {
      const [tag, ...params] = raw.trim().split(";");
      const lower = (tag ?? "").trim().toLowerCase();
      if (!lower || lower === "*") return null;
      let q = 1;
      for (const p of params) {
        const kv = p.trim().split("=");
        if (kv[0] === "q" && kv[1]) {
          const n = Number(kv[1]);
          if (Number.isFinite(n) && n >= 0 && n <= 1) q = n;
        }
      }
      return { tag: lower, q };
    })
    .filter((x): x is { tag: string; q: number } => x !== null && x.q > 0);
  // Stable sort by q descending — preserves header order within a q tier.
  return parsed.sort((a, b) => b.q - a.q).map((x) => x.tag);
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

// Detect a path whose first segment is the short *code* of a locale whose
// canonical URL prefix is something longer (e.g. `/en` for a locale with
// `code: "en"` and `prefix: "en-US"`). Returns the canonical-prefixed URL
// to 301 to, or null when the path is already canonical (or doesn't lead
// with a known short code). Region-coded aliases (`/en-us`, `/zh_cn`,
// `/en_US`) are matched too so any reasonable casing or separator a user
// might type collapses to the configured form.
function detectLegacyLocalePrefixAlias(pathname: string): string | null {
  const parts = pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0]!;
  const normalized = first.toLowerCase().replace(/_/g, "-");
  for (const l of SITE.site.locales) {
    if (!l.prefix) continue;
    if (l.prefix === first) return null; // already canonical
    const canonicalLower = l.prefix.toLowerCase();
    const codeLower = l.code.toLowerCase();
    if (normalized === canonicalLower || normalized === codeLower) {
      const rest = parts.slice(1);
      const suffix = rest.length ? `/${rest.join("/")}` : "";
      return `/${l.prefix}${suffix}`;
    }
  }
  return null;
}

function startsWithLocalePrefix(pathname: string): boolean {
  const first = pathname.replace(/^\/+/, "").split("/")[0];
  if (!first) return false;
  return SITE.site.locales.some((l) => l.prefix && l.prefix === first);
}

// Stitch a locale prefix onto an unprefixed path, optionally inserting the
// homepageRepo slug when the first segment isn't a known repo. Folds the
// classic "homepage shortcut" rewrite into the locale-prefixing step so we
// only redirect once for paths like `/getting-started`.
function addLocalePrefixToPath(pathname: string, prefix: string): string {
  const parts = pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length === 0) return `/${prefix}`;
  const first = parts[0]!;
  // Reserved: keep search/languages/api/sitemap/etc. routed to themselves
  // under the new prefix. `api` is already short-circuited; this is
  // belt-and-braces.
  const reserved = first === "search" || first === "languages" || first === "api";
  const isRepo = SITE.repos.some((r) => r.slug === first);
  if (reserved || isRepo) {
    return `/${prefix}/${parts.join("/")}`;
  }
  // Non-repo first segment → assume it's a homepage-repo sub-page.
  return `/${prefix}/${SITE.site.homepageRepo}/${parts.join("/")}`;
}

// Build a 302 to a locale-prefixed destination, preserving query params and
// stamping the locale cookie so the choice sticks for future entry-point
// hits. The response body is empty; the cookie is attached via headers
// (Response.redirect returns an immutable response, so we rebuild it).
function localeRedirect(sourceUrl: URL, destPath: string, localeCode: string): Response {
  const dest = new URL(destPath, sourceUrl.origin);
  sourceUrl.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
  const headers = new Headers({
    location: dest.toString(),
    "set-cookie": `${LOCALE_COOKIE}=${encodeURIComponent(localeCode)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`,
    "cache-control": "no-store",
  });
  return new Response(null, { status: 302, headers });
}

// Detect URLs whose first non-locale segment isn't a repo slug, and redirect
// them under the configured homepageRepo. Lets authors write site-rooted
// links like `/getting-started` and have them resolve to
// `/{lang}/{homepageRepo}/getting-started` automatically. Returns null when
// the URL already targets a repo (so normal resolution should handle it).
function detectHomepageShortcut(pathname: string): string | null {
  const parts = pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  if (!parts.length || !parts[0]) return null;

  let localePrefix = "";
  let rest = parts;
  const localeMatch = SITE.site.locales.find((l) => l.prefix && rest[0] === l.prefix);
  if (localeMatch) {
    localePrefix = localeMatch.prefix;
    rest = rest.slice(1);
  }

  if (!rest.length || !rest[0]) return null;
  // Reserved virtual routes — never rewrite these into the homepage repo.
  if (rest[0] === "search" || rest[0] === "languages" || rest[0] === "api") return null;

  // Bail when the first non-locale segment IS a real repo slug — normal
  // resolveRoute will handle it.
  if (SITE.repos.find((r) => r.slug === rest[0])) return null;

  const prefix = localePrefix ? `/${localePrefix}` : "";
  return `${prefix}/${SITE.site.homepageRepo}/${rest.join("/")}`;
}

// Detect URLs in the old `/{repo}/{locale}/{page}` shape and translate them to
// the new `/{locale}/{repo}/{page}` shape. Returns null when the URL doesn't
// look like the old shape, so we fall through to normal resolution.
//
// The disambiguation is unambiguous when no repo slug collides with a locale
// prefix (a constraint the config schema's slug pattern already enforces:
// slugs are lowercase-kebab, locale prefixes typically aren't).
function detectLegacyLocaleShape(pathname: string): string | null {
  const parts = pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  if (parts.length < 2) return null;
  // First segment must be an existing repo slug.
  if (!SITE.repos.find((r) => r.slug === parts[0])) return null;
  // Second segment must be a configured non-default locale prefix.
  const locale = SITE.site.locales.find((l) => l.prefix && l.prefix === parts[1]);
  if (!locale) return null;
  // Swap the first two segments: locale → repo → rest.
  const rest = parts.slice(2);
  const suffix = rest.length ? `/${rest.join("/")}` : "";
  return `/${locale.prefix}/${parts[0]}${suffix}`;
}

// Detect `/{localePrefix}/{repoSlug}/{localeCode}/...` where code !== prefix.
// This arises when authors write docs-root-relative links using the locale
// code (`/zh/getting-started`) inside a source file whose URL prefix is
// different (`zh-CN`). The link rewriter now strips these, but old cached
// pages / bookmarks may still carry the doubled form. Returns the corrected
// path or null.
function detectDuplicateLocaleCode(pathname: string): string | null {
  const parts = pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  if (parts.length < 3) return null;
  const locale = SITE.site.locales.find((l) => l.prefix && l.prefix === parts[0]);
  if (!locale) return null;
  const repo = SITE.repos.find((r) => r.slug === parts[1]);
  if (!repo) return null;
  // Third segment equals the locale code but not the prefix → redundant.
  if (parts[2] !== locale.code || locale.code === locale.prefix) return null;
  const rest = parts.slice(3);
  const suffix = rest.length ? `/${rest.join("/")}` : "";
  return `/${locale.prefix}/${repo.slug}${suffix}`;
}

// Build a RouteContext for the landing page (`/` or `/{localePrefix}`)
// pointing at the configured homepageRepo's index. The canonical URL is the
// short form so the URL bar / sitemap / `<link rel=canonical>` all agree.
// renderRoute detects this special case and feeds the link rewriter a
// `/{homepageRepo}` base so relative links still resolve under the slug.
function makeHomepageIndexRoute(localeCode: string, localePrefix: string): RouteContext | null {
  const repo = SITE.repos.find((r) => r.slug === SITE.site.homepageRepo);
  if (!repo) return null;
  const defaultBranch = repoRef(repo);
  const versions = repo.versions ?? [
    { label: defaultBranch, branch: defaultBranch, default: true },
  ];
  const version = versions.find((v) => v.default) ?? versions[0]!;
  const canonical = localePrefix ? `/${localePrefix}` : "/";
  return {
    repoSlug: repo.slug,
    repo,
    version,
    localeCode,
    pagePath: "index",
    canonicalUrl: canonical,
  };
}

// Matches `/{homepageRepo}` and `/{localePrefix}/{homepageRepo}` exactly
// (no sub-page). Returns the short canonical they should redirect to, or
// null when the path isn't a homepage-repo index.
function matchHomepageRepoIndex(pathname: string): string | null {
  const parts = pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  if (!parts.length || !parts[0]) return null;
  let localePrefix = "";
  let rest = parts;
  const locale = SITE.site.locales.find((l) => l.prefix && rest[0] === l.prefix);
  if (locale) {
    localePrefix = locale.prefix;
    rest = rest.slice(1);
  }
  if (rest.length !== 1 || rest[0] !== SITE.site.homepageRepo) return null;
  return localePrefix ? `/${localePrefix}` : "/";
}

function resolveRoute(pathname: string): RouteContext | null {
  const parts = pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  if (!parts.length || !parts[0]) return null;

  // Locale-first URL shape: `/{localePrefix}/{repoSlug}/{page}`. Mirrors the
  // Microsoft Learn convention. If the first segment is a non-default locale
  // prefix, consume it; otherwise the request is for the default locale and
  // the first segment is the repo slug directly.
  let rest = parts;
  let localeCode = SITE.site.defaultLocale;
  const localeMatch = SITE.site.locales.find((l) => l.prefix && rest[0] === l.prefix);
  if (localeMatch) {
    localeCode = localeMatch.code;
    rest = rest.slice(1);
  }

  if (!rest[0]) return null;

  const repoSlug = rest[0];
  const repo = SITE.repos.find((r) => r.slug === repoSlug);
  if (!repo) return null;

  const defaultBranch = repoRef(repo);
  const versions = repo.versions ?? [
    { label: defaultBranch, branch: defaultBranch, default: true },
  ];
  const version = versions.find((v) => v.default) ?? versions[0]!;

  rest = rest.slice(1);

  const pagePath = rest.length === 0 ? "index" : rest.join("/");
  const localePrefix = localeMatch ? `/${localeMatch.prefix}` : "";
  const canonical =
    `${localePrefix}/${repoSlug}/${pagePath === "index" ? "" : pagePath}`
      .replace(/\/+/g, "/")
      .replace(/\/$/, "") || `${localePrefix}/${repoSlug}`;

  return {
    repoSlug,
    repo,
    version,
    localeCode,
    pagePath,
    canonicalUrl: canonical,
  };
}

async function renderRoute(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  route: RouteContext,
): Promise<Response> {
  const url = new URL(request.url);
  // SPA navigation requests come in with `?_data=1` (or `Accept: application/json`)
  // and want the bootstrap payload without the HTML envelope.
  // JSON mode is signaled by `?_data=1` ONLY. We used to also accept Accept:
  // application/json, but that made the JSON-vs-HTML distinction invisible to
  // Cloudflare's edge cache (cache keys are URL-only by default), so a cached
  // JSON response could leak into a later HTML request for the same URL.
  // Keying by `_data=1` keeps the two cache entries cleanly separated.
  const wantsJson = url.searchParams.get("_data") === "1";

  // Cache key includes the hostname so multi-host deployments don't pollute
  // each other's cached HTML — the SEO head now embeds absolute URLs derived
  // from the request origin, so the rendered bytes are host-specific. Theme is
  // part of the key too: FluentUI's CSS-in-JS tokens are baked into the SSR
  // HTML, so a dark-mode page can't be reused for a light-mode visitor.
  const initialTheme = pickTheme(request);
  const htmlKey = `html3:${url.host}:${route.repoSlug}@${route.version.branch}:${route.localeCode}:${route.pagePath}:${initialTheme}`;
  if (!wantsJson) {
    const cachedHtml = await readCache<string>(env, htmlKey);
    if (cachedHtml) {
      return new Response(cachedHtml, {
        status: 200,
        headers: htmlHeaders(env),
      });
    }
  }

  // URL-side prefix (what appears in URLs and matches URL segments) and
  // source-side prefix (where files live on disk) are decoupled — the
  // default locale's files sit at the docs root regardless of whether its
  // URL prefix is set. See `localeSourcePrefix` for the rationale.
  const localeConfig = SITE.site.locales.find((l) => l.code === route.localeCode);
  const localeUrlPath = localeConfig?.prefix ?? "";
  const localeSrcPath = localeConfig
    ? localeSourcePrefix(localeConfig, SITE.site.defaultLocale)
    : "";
  const candidates = pageCandidates(route.repo, localeSrcPath, route.pagePath);

  let source: string | null = null;
  let matchedPath: string | null = null;
  let machineTranslated = false;
  let translationAttempted = false;
  // `${ep.id}:${model}` label of the provider that produced the
  // translation, surfaced on the banner so readers see which upstream
  // rendered their page when a failover chain is configured.
  let translatedBy: string | undefined;
  for (const c of candidates) {
    const s = await fetchSourceFile(env, route.repo, route.version.branch, c, {
      ctx,
    });
    if (s) {
      source = s;
      matchedPath = c;
      break;
    }
  }

  // Machine-translation fallback. When the requested locale is listed in
  // `site.translate.targets` and no hand-translated file was found, fetch
  // the default-locale source and run it through the translator. The
  // result is cached in D1 by (repoSlug@branch:pagePath, locale) so the
  // next read for the same page returns the cached row in one DB hop.
  //
  // mtTranslate falls back to the source string when the provider call
  // fails (no API key, network error, rate limit, …) — we compare the
  // returned content against the source to detect that path. Either way
  // we render the content we have (better than 404'ing the reader),
  // but only set `machineTranslated` when the returned text is actually
  // a translation. That keeps the "machine-translated" banner honest:
  // it shows up when the reader is actually seeing translated content,
  // and stays hidden when they're seeing the un-translated source under
  // their requested URL.
  if (!source && isMtTarget(SITE, route.localeCode)) {
    const defaultCandidates = pageCandidates(route.repo, "", route.pagePath);
    for (const c of defaultCandidates) {
      const s = await fetchSourceFile(env, route.repo, route.version.branch, c, { ctx });
      if (s) {
        translationAttempted = true;
        const result = await mtTranslate({
          env,
          ctx,
          site: SITE,
          kind: "page",
          key: `${route.repoSlug}@${route.version.branch}:${route.pagePath}`,
          locale: route.localeCode,
          source: s,
        });
        source = result.content;
        matchedPath = c;
        machineTranslated = !!result.content && result.content !== s;
        if (machineTranslated) {
          translatedBy = result.model;
        } else {
          console.warn(
            `[vellum][router] MT no-op for ${route.repoSlug}@${route.version.branch}:${route.pagePath} locale=${route.localeCode}; serving source unchanged`,
          );
        }
        break;
      }
    }
  }

  if (!source || !matchedPath) {
    // Build "did you mean" suggestions by scanning the repo tree for similarly-named pages.
    const suggestions = await suggestPages(env, ctx, route, localeSrcPath);
    return errorPage(
      env,
      ctx,
      request,
      {
        status: 404,
        title: translate(route.localeCode, "ui.notFound.title"),
        message: translate(route.localeCode, "ui.notFound.message"),
        hint: `Tried: ${candidates.map((c) => `${sourceLabel(route.repo)}:${c}`).join("\n       ")}`,
        suggestions,
      },
      route,
    );
  }

  // Locale-first base: `/{localeUrlPath}/{repoSlug}`. Cross-repo xrefs (`@slug/...`)
  // resolve into the SAME locale as the current page, so a zh page linking
  // `@prism/foo` lands on `/zh/prism/foo`.
  const repoUrlBase = `${localeUrlPath ? `/${localeUrlPath}` : ""}/${route.repoSlug}`;
  // For the landing page (canonical `/{localeUrlPath}` served from the
  // homepageRepo's index), the relative-link resolver still needs to anchor
  // at the repo slug — otherwise `./foo` becomes `/{prefix}/foo` instead of
  // `/{prefix}/{homepageRepo}/foo`. Use the slug-rooted URL here while
  // keeping the short canonical URL elsewhere (SEO, URL bar, sitemap).
  const isShortHomepageCanonical =
    route.repoSlug === SITE.site.homepageRepo &&
    route.pagePath === "index" &&
    (route.canonicalUrl === "/" || route.canonicalUrl === `/${localeUrlPath}`);
  const linkContext: LinkContext = {
    currentUrl: isShortHomepageCanonical ? repoUrlBase : route.canonicalUrl,
    repoUrlBase,
    localePrefix: localeUrlPath,
    localeCode: route.localeCode,
    pageIsIndex: route.pagePath === "index",
    resolveXref: (slug, rest) => {
      const r = SITE.repos.find((x) => x.slug === slug);
      if (!r) return null;
      const base = `${localeUrlPath ? `/${localeUrlPath}` : ""}/${r.slug}`;
      return `${base}/${rest.replace(/\.md$/, "")}`.replace(/\/+/g, "/");
    },
  };

  // OPS xrefmap loader — prefetched in parallel with the main page so the inline
  // xref resolver can be synchronous. Best-effort: a missing/malformed map just
  // means xref tokens render as monospace fallback text.
  const xrefMap = await loadXrefMap(env, route.repo, route.version.branch, ctx).catch(() => null);

  // OPS [!INCLUDE]: resolve a path relative to the current page back through
  // renderMarkdown so nested directives keep working. Guarded with a tiny
  // depth counter to stop accidental cycles. Same context is reused for code
  // includes — they only need the raw file bytes.
  const includeBaseDir = matchedPath.replace(/\/[^/]+$/, "");
  const rendered = await renderMarkdown({
    source,
    linkContext,
    // Render mermaid blocks server-side via Kroki — both light + dark palettes
    // so the client can swap instantly without a fresh fetch when the user
    // toggles theme. Either side may come back null on Kroki failure; the
    // client component falls back to its own mermaid bundle then.
    renderDiagram: (code) => renderMermaidThemed(code, env, ctx),
    resolveInclude: (path) =>
      resolveInclude(env, ctx, route, includeBaseDir, path, linkContext, xrefMap),
    resolveCodeInclude: (meta) => resolveCodeInclude(env, ctx, route, includeBaseDir, meta),
    resolveXref: xrefMap
      ? (uid) => {
          const hit = xrefMap.byUid[uid];
          return hit ? { href: hit.href, name: hit.name } : null;
        }
      : undefined,
  });

  // Frontmatter often carries page links (VitePress `hero.actions[].link`, `features[].link`)
  // that haven't gone through the markdown link rewriter. Resolve them so HomeLayout
  // doesn't have to know about the repo URL layout.
  rewriteFrontmatterLinks(rendered.frontmatter, linkContext);

  const [sidebar, repoNav, repoComponents, repoSocialFromSource] = await Promise.all([
    loadSidebar(
      env,
      route.repo,
      route.version.branch,
      localeConfig ?? { code: route.localeCode, label: route.localeCode, prefix: "" },
      SITE.site.defaultLocale,
      ctx,
      SITE,
    ),
    loadRepoNav(
      env,
      route.repo,
      route.version.branch,
      localeConfig ?? { code: route.localeCode, label: route.localeCode, prefix: "" },
      SITE.site.defaultLocale,
      ctx,
      SITE,
    ),
    loadVueComponents(env, route.repo, route.version.branch, ctx),
    loadRepoSocialLinks(env, route.repo, route.version.branch, ctx),
  ]);
  // Social-link resolution: prefer what we extracted from the repo's own
  // vellum.json / VitePress config; fall back to the per-repo config in
  // vellum.config.json (RepoConfig.socialLinks). The site-level fallback is
  // applied client-side in NavBar so we don't have to ship redundant data.
  const repoSocialLinks =
    repoSocialFromSource ?? (route.repo.socialLinks?.length ? route.repo.socialLinks : null);
  const { prev, next } = neighbors(sidebar, route);

  const editUrl = route.repo.editLinkPattern
    ? route.repo.editLinkPattern.replace(":path", relativeDocsPath(matchedPath, route.repo))
    : undefined;

  // Last updated: ask GitHub commits API in the background; don't block first paint on it.
  let lastUpdated: BootstrapPayload["page"]["meta"]["lastUpdated"] = null;
  try {
    const commit = await fetchSourceLastCommit(env, route.repo, route.version.branch, matchedPath, {
      ctx,
    });
    if (commit) lastUpdated = commit;
  } catch {
    // Non-fatal.
  }

  // `initialTheme` already computed above for the cache key — reused here.

  // Translate site config strings (tagline, repo displayName/description,
  // nav text) for machine-translated locales so the NavBar, brand crumb,
  // and home-page repo cards render in the reader's locale. site.title and
  // site.footer are intentionally not translated.
  // Translated UI dictionary baked into the bootstrap payload so the client
  // `t()` resolves shell strings (search labels, AI Summary chrome, etc.)
  // into the requested locale without a code change.
  const [localizedSite, uiStrings] = await Promise.all([
    translateSiteConfig(env, ctx, SITE, route.localeCode),
    translateUiStrings(env, ctx, SITE, route.localeCode, baseUiStrings as Record<string, string>),
  ]);

  // Title resolution:
  //   frontmatter.title > first h1 > hero.name (for `layout: home` pages) > repo display name (for index) > derived from path
  const heroObj = rendered.frontmatter?.hero;
  const heroName =
    heroObj && typeof heroObj === "object"
      ? ((heroObj as Record<string, unknown>).name as string | undefined)
      : undefined;
  // For the index page, fall back to the translated repo displayName so the
  // `<title>` and hero match the rest of the localized chrome.
  const localizedRepo = localizedSite.repos.find((r) => r.slug === route.repoSlug) ?? route.repo;
  const finalTitle =
    rendered.title ||
    heroName ||
    (route.pagePath === "index" ? localizedRepo.displayName : titleFromPath(route.pagePath));

  // Description: frontmatter.description > frontmatter.hero.tagline > repo.description
  const heroTagline =
    heroObj && typeof heroObj === "object"
      ? ((heroObj as Record<string, unknown>).tagline as string | undefined)
      : undefined;
  const finalDescription =
    rendered.description ||
    heroTagline ||
    (route.pagePath === "index" ? localizedRepo.description : undefined);

  const payload: BootstrapPayload = {
    config: localizedSite,
    route,
    sidebar,
    repoNav,
    uiStrings,
    repoSocialLinks,
    repoComponents,
    initialTheme,
    page: {
      ast: rendered.ast,
      meta: {
        title: finalTitle,
        description: finalDescription,
        frontmatter: rendered.frontmatter,
        outline: rendered.outline,
        editUrl,
        lastUpdated,
        prev,
        next,
        machineTranslated,
        translationAttempted,
        translatedBy,
        translatedLocales: await resolveTranslatedLocales(env, SITE, route),
      },
    },
  };

  if (wantsJson) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${ttlSeconds(env, "html")}`,
        // Belt and suspenders against any cache that does key on Accept.
        vary: "Accept",
        "x-vellum": "edge-json",
      },
    });
  }

  const html = await renderPage(env, payload, request);
  // Cache rendered HTML for a short window; webhooks bust it.
  ctx.waitUntil(writeCache(env, htmlKey, html, ttlSeconds(env, "html"), ctx));

  return new Response(html, {
    status: 200,
    headers: htmlHeaders(env),
  });
}

function htmlHeaders(env: Env): HeadersInit {
  const ttl = ttlSeconds(env, "html");
  return {
    "content-type": "text/html; charset=utf-8",
    // `private`: the SSR'd HTML is theme-personalized (cookies decide which
    // FluentUI tokens are baked in), so shared caches can't reuse it across
    // users. `no-cache`: the browser still stores the response but must
    // revalidate on every navigation — without this, a `location.replace()`
    // from the theme-detection pre-script returns the same cached light
    // HTML and the reload loop never escapes. The CDN edge layer keeps
    // `s-maxage` for repeated identical requests; the worker's own cache
    // (theme-keyed) handles the hot path on the server side.
    "cache-control": `private, no-cache, s-maxage=${ttl * 4}, stale-while-revalidate=${ttl * 10}`,
    vary: "Accept, Cookie",
    "x-vellum": "edge-ssr",
  };
}

// Build the list of locales that can resolve this page right now:
//   - The default locale (always — that's where the source lives).
//   - Every hand-curated non-default locale declared in `site.locales`.
//     We assume the author has shipped the page; if they didn't, the link
//     simply 404s — same outcome as the picker without this filter.
//   - Every machine-translated locale that has a cached row in D1 for this
//     specific page key. This skips MT locales that have never been
//     visited (and thus would trigger a fresh model call instead of
//     resolving instantly).
//
// Used to populate `PageMeta.translatedLocales`, consumed by the
// MachineTranslatedBanner so its inline "view this page in" list only
// advertises locales the reader can actually navigate to.
async function resolveTranslatedLocales(
  env: Env,
  site: VellumConfig,
  route: { repoSlug: string; version: { branch: string }; pagePath: string },
): Promise<string[]> {
  const handCurated = site.site.locales.filter((l) => !l.machineTranslated).map((l) => l.code);
  const cached = await listTranslatedLocalesForPage(
    env,
    route.repoSlug,
    route.version.branch,
    route.pagePath,
  );
  // De-dupe — the default locale is in handCurated; cached entries don't
  // include it since the source is the source, not a translation row.
  return [...new Set([...handCurated, ...cached])];
}

function pageCandidates(repo: RepoConfig, localePath: string, pagePath: string): string[] {
  const base = docsRootPrefix(repo.docsRoot);
  const loc = localePath ? `${localePath}/` : "";
  const path = pagePath.replace(/^\/+/, "");
  const list = new Set<string>();
  list.add(`${base}${loc}${path}.md`);
  list.add(`${base}${loc}${path}/index.md`);
  if (path === "index") {
    list.add(`${base}${loc}index.md`);
    list.add(`${base}${loc}README.md`);
  }
  return [...list].map((p) => p.replace(/\/+/g, "/"));
}

function relativeDocsPath(matched: string, repo: RepoConfig): string {
  const base = docsRootPrefix(repo.docsRoot);
  return matched.startsWith(base) ? matched.slice(base.length) : matched;
}

function titleFromPath(p: string): string {
  const name = p.split("/").pop() ?? p;
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickTheme(request: Request): "light" | "dark" {
  const cookie = request.headers.get("cookie") ?? "";
  // Explicit toggle wins — never override what the user clicked.
  const explicit = cookie.match(/(?:^|;\s*)vellum-theme=(light|dark)/);
  if (explicit) return explicit[1] as "light" | "dark";
  // Auto-detected (written by the head pre-script on a previous visit). Lets
  // SSR render the right FluentUI tokens so components don't flash on load.
  const auto = cookie.match(/(?:^|;\s*)vellum-theme-auto=(light|dark)/);
  if (auto) return auto[1] as "light" | "dark";
  // First visit, or non-cookie-aware client. The head pre-script will fix the
  // CSS-variable background immediately and write the auto cookie for next time.
  return "light";
}

// Stub route used to fill out the bootstrap payload for an error page.
function stubRoute(): RouteContext {
  const repo = SITE.repos[0]!;
  return {
    repoSlug: repo.slug,
    repo,
    version: (repo.versions?.find((v) => v.default) ?? {
      label: repoRef(repo),
      branch: repoRef(repo),
    }) as RouteContext["version"],
    localeCode: SITE.site.defaultLocale,
    pagePath: "index",
    canonicalUrl: "/",
  };
}

async function errorPage(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  error: ErrorState,
  route?: RouteContext,
): Promise<Response> {
  const initialTheme = pickTheme(request);
  const payload: BootstrapPayload = {
    config: SITE,
    route: route ?? stubRoute(),
    sidebar: [],
    initialTheme,
    error,
    page: {
      ast: { blocks: [] },
      meta: {
        title: error.title,
        description: error.message,
        frontmatter: {},
        outline: [],
      },
    },
  };

  const url = new URL(request.url);
  const wantsJson =
    url.searchParams.get("_data") === "1" ||
    (request.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) {
    return new Response(JSON.stringify(payload), {
      status: error.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-vellum": "edge-error-json",
      },
    });
  }

  const html = await renderPage(env, payload, request);
  return new Response(html, {
    status: error.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-vellum": "edge-error",
    },
  });
}

// "Did you mean ...?" — fuzzy-match the user's path against existing markdown files in the repo.
async function suggestPages(
  env: Env,
  ctx: ExecutionContext,
  route: RouteContext,
  srcPath: string,
): Promise<Array<{ text: string; link: string }>> {
  try {
    const tree = await fetchSourceTree(env, route.repo, route.version.branch, {
      ctx,
    });
    const docsPrefix = docsRootPrefix(route.repo.docsRoot);
    const locPrefix = srcPath ? `${srcPath}/` : "";
    const targets = tree
      .filter(
        (e) =>
          e.type === "blob" &&
          (!docsPrefix || e.path.startsWith(docsPrefix)) &&
          e.path.endsWith(".md"),
      )
      .map((e) =>
        (docsPrefix && e.path.startsWith(docsPrefix)
          ? e.path.slice(docsPrefix.length)
          : e.path
        ).replace(/\.md$/, ""),
      )
      .filter((p) =>
        locPrefix
          ? p.startsWith(locPrefix)
          : !SITE.site.locales.some((l) => l.prefix && p.startsWith(`${l.prefix}/`)),
      );

    const needle = route.pagePath.toLowerCase();
    const scored = targets
      .map((p) => ({ p, score: similarity(needle, p.toLowerCase()) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .filter((s) => s.score > 0);

    // Link construction uses the URL prefix (which can differ from the
    // source path — default locale lives at the docs root but its URL is
    // still locale-prefixed). Locale-first order matches the canonical
    // shape: `/{urlPrefix}/{repoSlug}/{rel}`.
    const urlPrefix = SITE.site.locales.find((l) => l.code === route.localeCode)?.prefix ?? "";
    const repoBase = `${urlPrefix ? `/${urlPrefix}` : ""}/${route.repoSlug}`;
    return scored.map((s) => {
      const rel = locPrefix && s.p.startsWith(locPrefix) ? s.p.slice(locPrefix.length) : s.p;
      const link =
        `${repoBase}/${rel === "index" ? "" : rel}`.replace(/\/+/g, "/").replace(/\/$/, "") ||
        repoBase;
      return { text: rel.replace(/\.md$/, "").replace(/[-_]/g, " "), link };
    });
  } catch {
    return [];
  }
}

// Walks frontmatter and rewrites any `link` property under hero.actions[] and features[].
// Mutates in place. External / hash / xref links are passed through by normalizeInternal.
function rewriteFrontmatterLinks(front: Record<string, unknown>, ctx: LinkContext): void {
  const hero = front.hero as { actions?: Array<{ link?: string }> } | undefined;
  if (hero?.actions) {
    for (const action of hero.actions) {
      if (typeof action.link === "string") action.link = normalizeInternal(action.link, ctx);
    }
  }
  const features = front.features as Array<{ link?: string }> | undefined;
  if (Array.isArray(features)) {
    for (const f of features) {
      if (typeof f.link === "string") f.link = normalizeInternal(f.link, ctx);
    }
  }
}

// Matches `/search` and `/{localePrefix}/search`. Returns the resolved locale code
// for that route; null when the path isn't a search route.
function matchSearchRoute(pathname: string): { localeCode: string; canonicalUrl: string } | null {
  const parts = pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  if (parts.length === 1 && parts[0] === "search") {
    return { localeCode: SITE.site.defaultLocale, canonicalUrl: "/search" };
  }
  if (parts.length === 2 && parts[1] === "search") {
    const locale = SITE.site.locales.find((l) => l.prefix && l.prefix === parts[0]);
    if (locale) {
      return {
        localeCode: locale.code,
        canonicalUrl: `/${locale.prefix}/search`,
      };
    }
  }
  return null;
}

async function renderSearchPage(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  match: { localeCode: string; canonicalUrl: string },
): Promise<Response> {
  const url = new URL(request.url);
  const wantsJson = url.searchParams.get("_data") === "1";
  const initialTheme = pickTheme(request);

  // Stub repo/route so the FluentUI shell, NavBar, and i18n machinery have something
  // to anchor on. The SearchPage component reads ?q= from window.location itself, so
  // we don't need to embed the query in the bootstrap payload.
  const stubRepo = SITE.repos[0]!;
  const stubVersion =
    stubRepo.versions?.find((v) => v.default) ??
    ({
      label: stubRepo.branch,
      branch: stubRepo.branch,
    } as RouteContext["version"]);

  const title = translate(match.localeCode, "ui.search.allRepos");
  const description = translate(match.localeCode, "ui.search.start");

  const payload: BootstrapPayload = {
    config: SITE,
    route: {
      repoSlug: stubRepo.slug,
      repo: stubRepo,
      version: stubVersion,
      localeCode: match.localeCode,
      pagePath: "search",
      canonicalUrl: match.canonicalUrl,
    },
    sidebar: [],
    initialTheme,
    page: {
      ast: { blocks: [] },
      meta: {
        title,
        description,
        // Layout switch consumed by Layout.tsx.
        frontmatter: { layout: "search" },
        outline: [],
      },
    },
  };

  if (wantsJson) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        vary: "Accept",
        "x-vellum": "edge-search-json",
      },
    });
  }

  const html = await renderPage(env, payload, request);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // No edge caching — the page is essentially empty chrome, and `?q=` lives in the
      // querystring on the client side, so cache hits would mask nothing useful.
      "cache-control": "no-store",
      "x-vellum": "edge-search",
    },
  });
}

// Matches `/languages` and `/{localePrefix}/languages`. Same shape as the
// search route; we return the resolved locale code so the page renders in
// the reader's language.
function matchLanguagesRoute(
  pathname: string,
): { localeCode: string; canonicalUrl: string } | null {
  const parts = pathname.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  if (parts.length === 1 && parts[0] === "languages") {
    return { localeCode: SITE.site.defaultLocale, canonicalUrl: "/languages" };
  }
  if (parts.length === 2 && parts[1] === "languages") {
    const locale = SITE.site.locales.find((l) => l.prefix && l.prefix === parts[0]);
    if (locale) {
      return {
        localeCode: locale.code,
        canonicalUrl: `/${locale.prefix}/languages`,
      };
    }
  }
  return null;
}

async function renderLanguagesPage(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  match: { localeCode: string; canonicalUrl: string },
): Promise<Response> {
  const url = new URL(request.url);
  const wantsJson = url.searchParams.get("_data") === "1";
  const initialTheme = pickTheme(request);

  // Stub repo/route exactly like the search page: the FluentUI shell + NavBar
  // need a route context to render against, but the LanguagesPage component
  // builds its own URLs from the bootstrap config and the `?page=` query.
  const stubRepo = SITE.repos[0]!;
  const stubVersion =
    stubRepo.versions?.find((v) => v.default) ??
    ({ label: stubRepo.branch, branch: stubRepo.branch } as RouteContext["version"]);

  // Per-locale title/description so the SSR <title> reads in the right language.
  const [localizedSite, uiStrings] = await Promise.all([
    translateSiteConfig(env, ctx, SITE, match.localeCode),
    translateUiStrings(env, ctx, SITE, match.localeCode, baseUiStrings as Record<string, string>),
  ]);

  // Parse ?page= to determine which page the reader came from, so we can
  // compute translatedLocales for that specific page. The languages page
  // uses this to show per-locale status badges (translated, not yet, etc.).
  let translatedLocales: string[] | undefined;
  const pageParam = url.searchParams.get("page");
  if (pageParam && pageParam.startsWith("/") && !pageParam.includes("..")) {
    const pageParts = pageParam.replace(/^\/+/, "").split("/").filter(Boolean);
    if (pageParts.length >= 1) {
      const targetRepo = SITE.repos.find((r) => r.slug === pageParts[0]);
      if (targetRepo) {
        const targetBranch = repoRef(targetRepo);
        const targetPage = pageParts.length > 1 ? pageParts.slice(1).join("/") : "index";
        translatedLocales = await resolveTranslatedLocales(env, SITE, {
          repoSlug: targetRepo.slug,
          version: { branch: targetBranch },
          pagePath: targetPage,
        });
      }
    }
  }

  const title = translate(match.localeCode, "ui.languages.title");
  const description = translate(match.localeCode, "ui.languages.subtitle");

  const payload: BootstrapPayload = {
    config: localizedSite,
    route: {
      repoSlug: stubRepo.slug,
      repo: stubRepo,
      version: stubVersion,
      localeCode: match.localeCode,
      pagePath: "languages",
      canonicalUrl: match.canonicalUrl,
    },
    sidebar: [],
    initialTheme,
    uiStrings,
    page: {
      ast: { blocks: [] },
      meta: {
        title,
        description,
        frontmatter: { layout: "languages" },
        outline: [],
        translatedLocales,
      },
    },
  };

  if (wantsJson) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        vary: "Accept",
        "x-vellum": "edge-languages-json",
      },
    });
  }

  const html = await renderPage(env, payload, request);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-vellum": "edge-languages",
    },
  });
}

// OPS [!INCLUDE]: fetch the referenced markdown and re-render through the
// same pipeline so directives nested inside the include (more includes,
// mermaid, xref, …) keep working. We pass `null` for xref/include resolvers
// after the first level to break runaway recursion cheaply — a real cycle
// guard would require threading a depth counter through the renderMarkdown
// API, which is overkill for a feature that authors rarely abuse.
async function resolveInclude(
  env: Env,
  ctx: ExecutionContext,
  route: RouteContext,
  baseDir: string,
  relPath: string,
  linkContext: LinkContext,
  xrefMap: { byUid: Record<string, { href: string; name?: string }> } | null,
): Promise<Block[] | null> {
  const path = resolveRelativePath(baseDir, relPath);
  if (!path) return null;
  const source = await fetchSourceFile(env, route.repo, route.version.branch, path, { ctx });
  if (!source) return null;

  const innerRendered = await renderMarkdown({
    source,
    linkContext,
    renderDiagram: (code) => renderMermaidThemed(code, env, ctx),
    // Deliberately omit recursive include resolvers — see comment above.
    resolveXref: xrefMap
      ? (uid) => {
          const hit = xrefMap.byUid[uid];
          return hit ? { href: hit.href, name: hit.name } : null;
        }
      : undefined,
  });
  return innerRendered.ast.blocks;
}

// OPS [!code-lang]: fetch the source file, slice per the directive, syntax-
// highlight, and return a code block ready to splice into the parent AST.
async function resolveCodeInclude(
  env: Env,
  ctx: ExecutionContext,
  route: RouteContext,
  baseDir: string,
  meta: CodeIncludeMeta,
): Promise<Extract<Block, { type: "code" }> | null> {
  const path = resolveRelativePath(baseDir, meta.path);
  if (!path) return null;
  const source = await fetchSourceFile(env, route.repo, route.version.branch, path, { ctx });
  if (!source) return null;

  const slice = extractCodeSlice(source, meta);
  const html = await highlightCode(slice.code, meta.lang);
  // highlightCode wraps in scaffolding; extract just the inner <pre> like ast.ts does.
  const start = html.indexOf("<pre");
  const end = html.lastIndexOf("</pre>");
  const inner = start >= 0 && end >= 0 ? html.slice(start, end + "</pre>".length) : html;

  return {
    type: "code",
    lang: meta.lang,
    filename: meta.filename ?? path.split("/").pop(),
    showLineNumbers: false,
    highlightLines: slice.highlightLines,
    code: slice.code,
    html: inner,
  };
}

// Human-readable source label for the 404 hint. "local:slug" for local repos
// and "owner/repo" for GitHub-backed ones — matches the way authors think of
// each in their config files.
function sourceLabel(repo: {
  source?: string;
  slug: string;
  owner?: string;
  repo?: string;
}): string {
  if (repo.source === "local") return `local:${repo.slug}`;
  return `${repo.owner ?? "?"}/${repo.repo ?? "?"}`;
}

// Collapse `../` segments against a docs-root-relative directory. Returns null
// when the result escapes the repo root (defence against `../../../etc/passwd`
// style traversal in author-controlled INCLUDE paths).
function resolveRelativePath(baseDir: string, relPath: string): string | null {
  const parts = `${baseDir}/${relPath}`.split("/").filter((p) => p && p !== ".");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") {
      if (!out.length) return null;
      out.pop();
    } else {
      out.push(p);
    }
  }
  return out.join("/");
}

function similarity(a: string, b: string): number {
  // Cheap shared-character heuristic; sufficient for "did you mean" hints.
  const aSet = new Set(a.split(/[/_\s-]+/).filter(Boolean));
  let hits = 0;
  for (const tok of b.split(/[/_\s-]+/).filter(Boolean)) {
    if (aSet.has(tok)) hits++;
    for (const t of aSet) if (t.length > 2 && tok.includes(t)) hits += 0.25;
  }
  return hits;
}
