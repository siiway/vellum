// HTTP request dispatcher. Resolves URL -> repo + locale + page,
// pulls markdown from GitHub, renders, and SSRs the React shell.

import type { Env } from "./env";
import type {
  BootstrapPayload,
  ErrorState,
  RepoConfig,
  RouteContext,
  VellumConfig,
} from "../shared/types";
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
import { handleMcp } from "./mcp";
import { handleAiSession } from "./session";
import { handleVueComponentRequest, loadVueComponents } from "./vue";
import { handleRobots, handleSitemap } from "./sitemap";
import { t as translate } from "../shared/i18n";

const SITE: VellumConfig = config as VellumConfig;

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

  // Home page -> redirect to the configured homepage repo (default locale).
  // Preserve query string so callers like the SPA navigator (which appends
  // `?_data=1`) keep their mode after the redirect.
  if (path === "/" || path === "") {
    const dest = new URL(`/${SITE.site.homepageRepo}`, url.origin);
    url.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
    return Response.redirect(dest.toString(), 302);
  }

  // A bare locale prefix (`/zh`, `/zh/`) redirects to the homepage in that
  // locale. Matches Microsoft Learn's behaviour where `/{lang}/` is always
  // a homepage URL.
  const bareLocaleMatch = path.match(/^\/([a-zA-Z][a-zA-Z0-9-]*)\/?$/);
  if (bareLocaleMatch) {
    const candidate = bareLocaleMatch[1]!;
    const locale = SITE.site.locales.find((l) => l.prefix === candidate);
    if (locale) {
      const dest = new URL(`/${locale.prefix}/${SITE.site.homepageRepo}`, url.origin);
      url.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
      return Response.redirect(dest.toString(), 302);
    }
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

  // Full-page cross-repo search. `/search` and `/{localePrefix}/search` are reserved
  // pseudo-pages: they render without touching GitHub, deferring all data fetches
  // to the SearchPage client component via `/api/search?repo=*`.
  const searchRoute = matchSearchRoute(path);
  if (searchRoute) {
    return renderSearchPage(env, ctx, request, searchRoute);
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
    const suggestions = SITE.repos.slice(0, 5).map((r) => ({
      text: r.displayName,
      link: `/${r.slug}`,
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
  const accept = request.headers.get("accept-language") ?? "";
  for (const code of accept.split(",").map((s) => s.split(";")[0]!.trim().toLowerCase())) {
    for (const l of SITE.site.locales) {
      if (code === l.code.toLowerCase() || code.startsWith(`${l.code.toLowerCase()}-`))
        return l.code;
    }
  }
  return SITE.site.defaultLocale;
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
  if (rest[0] === "search" || rest[0] === "api") return null;

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
  // from the request origin, so the rendered bytes are host-specific.
  const htmlKey = `html2:${url.host}:${route.repoSlug}@${route.version.branch}:${route.localeCode}:${route.pagePath}`;
  if (!wantsJson) {
    const cachedHtml = await readCache<string>(env, htmlKey);
    if (cachedHtml) {
      return new Response(cachedHtml, {
        status: 200,
        headers: htmlHeaders(env),
      });
    }
  }

  const localePath = SITE.site.locales.find((l) => l.code === route.localeCode)?.prefix ?? "";
  const candidates = pageCandidates(route.repo, localePath, route.pagePath);

  let source: string | null = null;
  let matchedPath: string | null = null;
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

  if (!source || !matchedPath) {
    // Build "did you mean" suggestions by scanning the repo tree for similarly-named pages.
    const suggestions = await suggestPages(env, ctx, route, localePath);
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

  // Locale-first base: `/{localePrefix}/{repoSlug}`. Cross-repo xrefs (`@slug/...`)
  // resolve into the SAME locale as the current page, so a zh page linking
  // `@prism/foo` lands on `/zh/prism/foo`.
  const repoUrlBase = `${localePath ? `/${localePath}` : ""}/${route.repoSlug}`;
  const linkContext: LinkContext = {
    currentUrl: route.canonicalUrl,
    repoUrlBase,
    localePrefix: localePath,
    resolveXref: (slug, rest) => {
      const r = SITE.repos.find((x) => x.slug === slug);
      if (!r) return null;
      const base = `${localePath ? `/${localePath}` : ""}/${r.slug}`;
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
      route.localeCode,
      ctx,
      SITE.site.defaultLocale,
    ),
    loadRepoNav(env, route.repo, route.version.branch, route.localeCode, ctx),
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

  const initialTheme = pickTheme(request);

  // Title resolution:
  //   frontmatter.title > first h1 > hero.name (for `layout: home` pages) > repo display name (for index) > derived from path
  const heroName =
    rendered.frontmatter && typeof (rendered.frontmatter as any).hero === "object"
      ? ((rendered.frontmatter as any).hero?.name as string | undefined)
      : undefined;
  const finalTitle =
    rendered.title ||
    heroName ||
    (route.pagePath === "index" ? route.repo.displayName : titleFromPath(route.pagePath));

  // Description: frontmatter.description > frontmatter.hero.tagline > repo.description
  const heroTagline =
    rendered.frontmatter && typeof (rendered.frontmatter as any).hero === "object"
      ? ((rendered.frontmatter as any).hero?.tagline as string | undefined)
      : undefined;
  const finalDescription =
    rendered.description ||
    heroTagline ||
    (route.pagePath === "index" ? route.repo.description : undefined);

  const payload: BootstrapPayload = {
    config: SITE,
    route,
    sidebar,
    repoNav,
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
    "cache-control": `public, max-age=${ttl}, s-maxage=${ttl * 4}, stale-while-revalidate=${ttl * 10}`,
    vary: "Accept",
    "x-vellum": "edge-ssr",
  };
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
  const m = cookie.match(/(?:^|;\s*)vellum-theme=(light|dark)/);
  if (m) return m[1] as "light" | "dark";
  // Server can't see prefers-color-scheme; default to light and let client swap.
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
  localePath: string,
): Promise<Array<{ text: string; link: string }>> {
  try {
    const tree = await fetchSourceTree(env, route.repo, route.version.branch, {
      ctx,
    });
    const docsPrefix = docsRootPrefix(route.repo.docsRoot);
    const locPrefix = localePath ? `${localePath}/` : "";
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

    const repoBase = `/${route.repoSlug}${localePath ? `/${localePath}` : ""}`;
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
