// Docs page assembly: finds the page's source file, renders it, and gathers
// the chrome around it (sidebar, nav, translated config, last commit) into
// one bootstrap payload.
//
// The source file is the only thing the rest waits on. The chrome loaders
// start together with the source fetch, the last-commit lookup starts as
// soon as the file is found, and both overlap the markdown render.
//
// `loadPage` puts the build behind the page cache: a fresh payload comes
// straight from cache, a stale one is served and rebuilt in the background.
// The router turns the payload into JSON (client-side navigation) or HTML.

import type { Env } from "./env";
import { staleSeconds, ttlSeconds } from "./env";
import type { BootstrapPayload, RepoConfig, RouteContext, VellumConfig } from "../shared/types";
import { localeSourcePrefix } from "../shared/types";
import { baseUiStrings } from "../shared/i18n";
import type { Block } from "../shared/markdown";
import { swr, type SwrResult } from "./cache";
import {
  docsRootPrefix,
  fetchFirstSourceFile,
  fetchSourceFile,
  fetchSourceLastCommit,
} from "./sources";
import { normalizeInternal, renderMarkdown } from "./markdown/index";
import { renderMermaidThemed } from "./markdown/diagrams";
import { extractCodeSlice, type CodeIncludeMeta } from "./markdown/ops-includes";
import { highlightCode } from "./markdown/highlight";
import type { LinkContext } from "./markdown/links";
import { loadXrefMap, type XrefMap } from "./xrefmap";
import { loadRepoNav, loadRepoSocialLinks, loadSidebar, neighbors } from "./sidebar";
import { loadVueComponents } from "./vue";
import {
  isMtTarget,
  listTranslatedLocalesForPage,
  readCachedTranslation,
  translateSiteConfig,
  translateUiStrings,
} from "./translate";
import { triggerSmartTranslation } from "./translate-repo";
import { pageCacheKey } from "./page-key";

export type PageBuild =
  | { found: true; payload: BootstrapPayload }
  // `candidates` are the source paths that were tried, for the 404 hint.
  | { found: false; candidates: string[] };

// The page's payload through the stale-while-revalidate cache. 404s aren't
// cached. The payload's `initialTheme` is a placeholder; callers set it per
// request.
export function loadPage(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  route: RouteContext,
): Promise<SwrResult<PageBuild>> {
  const fresh = ttlSeconds(env, "html");
  return swr(env, ctx, pageCacheKey(route), {
    freshSeconds: fresh,
    ttlSeconds: fresh + staleSeconds(env),
    build: async () => {
      const value = await buildPagePayload(env, ctx, site, route);
      return { value, store: value.found };
    },
  });
}

export async function buildPagePayload(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  route: RouteContext,
): Promise<PageBuild> {
  const branch = route.version.branch;
  const defaultLocale = site.site.defaultLocale;

  // URL-side prefix (what appears in URLs and matches URL segments) and
  // source-side prefix (where files live on disk) are decoupled — the
  // default locale's files sit at the docs root regardless of whether its
  // URL prefix is set. See `localeSourcePrefix` for the rationale.
  const localeConfig = site.site.locales.find((l) => l.code === route.localeCode);
  const chromeLocale = localeConfig ?? {
    code: route.localeCode,
    label: route.localeCode,
    prefix: "",
  };
  const localeUrlPath = localeConfig?.prefix ?? "";
  const localeSrcPath = localeConfig
    ? localeSourcePrefix(localeConfig, defaultLocale, route.repo)
    : "";
  const defaultSrcPath = localeSourcePrefix({ code: defaultLocale }, defaultLocale, route.repo);
  const candidates = pageCandidates(route.repo, localeSrcPath, route.pagePath);

  // Nothing below needs the page source, so it all starts now.
  //
  // OPS xrefmap: best-effort. A missing or malformed map means xref tokens
  // render as monospace fallback text.
  const xrefMapP = loadXrefMap(env, route.repo, branch, ctx).catch(() => null);
  // Translated site config strings (tagline, repo displayName/description,
  // nav text) and UI dictionary for machine-translated locales, so the
  // NavBar, brand crumb, home-page repo cards and client `t()` render in the
  // reader's locale. site.title and site.footer are intentionally not
  // translated.
  const chromeP = Promise.all([
    loadSidebar(env, route.repo, branch, chromeLocale, defaultLocale, ctx, site),
    loadRepoNav(env, route.repo, branch, chromeLocale, defaultLocale, ctx, site),
    loadVueComponents(env, route.repo, branch, ctx),
    loadRepoSocialLinks(env, route.repo, branch, ctx),
    translateSiteConfig(env, ctx, site, route.localeCode),
    translateUiStrings(env, ctx, site, route.localeCode, baseUiStrings as Record<string, string>),
    resolveTranslatedLocales(env, site, route),
  ]);
  // A 404 returns without awaiting it.
  chromeP.catch(() => {});

  const ownP = fetchFirstSourceFile(env, route.repo, branch, candidates, { ctx });
  // Machine-translated locales usually have no file of their own and fall
  // back to the default locale's, so fetch that alongside instead of after.
  const fallbackP = isMtTarget(site, route.localeCode)
    ? fetchFirstSourceFile(
        env,
        route.repo,
        branch,
        pageCandidates(route.repo, defaultSrcPath, route.pagePath),
        { ctx },
      )
    : null;
  fallbackP?.catch(() => {});

  const resolved = await resolveSource(env, ctx, site, route, ownP, fallbackP);
  if (!resolved) return { found: false, candidates };
  const { source, matchedPath, machineTranslated, translationAttempted } = resolved;

  // Last updated. Overlaps the markdown render; a failure only drops the
  // "last updated" line.
  const lastUpdatedP = fetchSourceLastCommit(env, route.repo, branch, matchedPath, { ctx }).catch(
    () => null,
  );

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
    route.repoSlug === site.site.homepageRepo &&
    route.pagePath === "index" &&
    (route.canonicalUrl === "/" || route.canonicalUrl === `/${localeUrlPath}`);
  const linkContext: LinkContext = {
    currentUrl: isShortHomepageCanonical ? repoUrlBase : route.canonicalUrl,
    repoUrlBase,
    localePrefix: localeUrlPath,
    localeCode: route.localeCode,
    // The directory the page was read from; the MT fallback reads the
    // default locale's.
    localeSrcDir: translationAttempted ? defaultSrcPath : localeSrcPath,
    // `drivers/index.md` served at `/repo/drivers` is a directory page too.
    pageIsIndex: route.pagePath === "index" || matchedPath.endsWith("/index.md"),
    resolveXref: (slug, rest) => {
      const r = site.repos.find((x) => x.slug === slug);
      if (!r) return null;
      const base = `${localeUrlPath ? `/${localeUrlPath}` : ""}/${r.slug}`;
      return `${base}/${rest.replace(/\.md$/, "")}`.replace(/\/+/g, "/");
    },
  };

  const xrefMap = await xrefMapP;

  // OPS [!INCLUDE]: resolve a path relative to the current page back through
  // renderMarkdown so nested directives keep working. Same base directory
  // for code includes — they only need the raw file bytes.
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
    resolveXref: xrefResolver(xrefMap),
  });

  // Frontmatter often carries page links (VitePress `hero.actions[].link`, `features[].link`)
  // that haven't gone through the markdown link rewriter. Resolve them so HomeLayout
  // doesn't have to know about the repo URL layout.
  rewriteFrontmatterLinks(rendered.frontmatter, linkContext);

  const [
    [
      sidebar,
      repoNav,
      repoComponents,
      repoSocialFromSource,
      localizedSite,
      uiStrings,
      translatedLocales,
    ],
    lastUpdated,
  ] = await Promise.all([chromeP, lastUpdatedP]);

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

  return {
    found: true,
    payload: {
      config: localizedSite,
      route,
      sidebar,
      repoNav,
      uiStrings,
      repoSocialLinks,
      repoComponents,
      // Set per request by the router.
      initialTheme: "light",
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
          translatedLocales,
        },
      },
    },
  };
}

interface ResolvedSource {
  source: string;
  matchedPath: string;
  machineTranslated: boolean;
  translationAttempted: boolean;
}

// The page's own file when it exists. Otherwise, for machine-translated
// locales, the default locale's file: the D1 translation when one is
// cached, else the untranslated source while a background translation
// fills the cache for the next visit. The banner shows "Translating, you
// can view this page in …" meanwhile.
async function resolveSource(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  route: RouteContext,
  ownP: Promise<{ path: string; text: string } | null>,
  fallbackP: Promise<{ path: string; text: string } | null> | null,
): Promise<ResolvedSource | null> {
  const own = await ownP;
  if (own) {
    return {
      source: own.text,
      matchedPath: own.path,
      machineTranslated: false,
      translationAttempted: false,
    };
  }
  const fallback = fallbackP ? await fallbackP : null;
  if (!fallback) return null;

  const pageKey = `${route.repoSlug}@${route.version.branch}:${route.pagePath}`;
  const translated = await readCachedTranslation(env, "page", pageKey, route.localeCode);
  if (!translated) ctx.waitUntil(triggerSmartTranslation(env, ctx, site, route, fallback.text));
  return {
    source: translated ?? fallback.text,
    matchedPath: fallback.path,
    machineTranslated: !!translated,
    translationAttempted: true,
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
export async function resolveTranslatedLocales(
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

function xrefResolver(xrefMap: XrefMap | null) {
  if (!xrefMap) return undefined;
  return (uid: string) => {
    const hit = xrefMap.byUid[uid];
    return hit ? { href: hit.href, name: hit.name } : null;
  };
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
  xrefMap: XrefMap | null,
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
    resolveXref: xrefResolver(xrefMap),
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
