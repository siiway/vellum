// Docs page assembly: finds the page's source file, renders it, and gathers
// the chrome around it (sidebar, nav, last commit) into one bootstrap
// payload, which the build writes out as the page's HTML and JSON.
//
// The chrome loaders start together with the source read and the last-commit
// lookup starts as soon as the file is found; both overlap the markdown
// render. The loaders are memoized per repo, so every page after the first
// gets them for free.

import type { BootstrapPayload, RepoConfig, RouteContext, VellumConfig } from "../shared/types";
import { localeSourcePrefix } from "../shared/types";
import type { Block } from "../shared/markdown";
import { docsRootPrefix, fetchFirstSourceFile, readSourceFile, lastCommit } from "./sources";
import { normalizeInternal, renderMarkdown } from "./markdown/index";
import { renderMermaidThemed } from "./markdown/diagrams";
import { extractCodeSlice, type CodeIncludeMeta } from "./markdown/ops-includes";
import { highlightCode } from "./markdown/highlight";
import type { LinkContext } from "./markdown/links";
import { loadXrefMap, type XrefMap } from "./xrefmap";
import { loadRepoNav, loadRepoSocialLinks, loadSidebar, neighbors } from "./sidebar";
import { loadVueComponents } from "./vue";
import { pageMarkdown } from "./page-markdown";

export type PageBuild =
  | {
      found: true;
      payload: BootstrapPayload;
      sourcePath: string;
      source: string;
      // The page's Markdown (page-markdown.ts).
      markdown: string;
    }
  // `candidates` are the source paths that were tried.
  | { found: false; candidates: string[] };

export async function buildPagePayload(
  site: VellumConfig,
  route: RouteContext,
): Promise<PageBuild> {
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
  const candidates = pageCandidates(route.repo, localeSrcPath, route.pagePath);

  // Nothing below needs the page source, so it all starts now.
  //
  // OPS xrefmap: best-effort. A missing or malformed map means xref tokens
  // render as monospace fallback text.
  const xrefMapP = loadXrefMap(route.repo).catch(() => null);
  const chromeP = Promise.all([
    loadSidebar(route.repo, chromeLocale, defaultLocale, site),
    loadRepoNav(route.repo, chromeLocale, defaultLocale),
    loadVueComponents(route.repo),
    loadRepoSocialLinks(route.repo),
  ]);
  // A missing page returns without awaiting it.
  chromeP.catch(() => {});

  const own = await fetchFirstSourceFile(route.repo, candidates);
  if (!own) return { found: false, candidates };
  const source = own.text;
  const matchedPath = own.path;

  // Last updated. Overlaps the markdown render; a failure only drops the
  // "last updated" line.
  const lastUpdatedP = lastCommit(route.repo, matchedPath).catch(() => null);

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
    // The directory the page was read from.
    localeSrcDir: localeSrcPath,
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
    // Render mermaid blocks via Kroki at build time — both light + dark palettes
    // so the client can swap instantly without a fresh fetch when the user
    // toggles theme. Either side may come back null on Kroki failure; the
    // client component falls back to its own mermaid bundle then.
    renderDiagram: (code) => renderMermaidThemed(code),
    resolveInclude: (path) => resolveInclude(route, includeBaseDir, path, linkContext, xrefMap),
    resolveCodeInclude: (meta) => resolveCodeInclude(route, includeBaseDir, meta),
    resolveXref: xrefResolver(xrefMap),
  });

  // Frontmatter often carries page links (VitePress `hero.actions[].link`, `features[].link`)
  // that haven't gone through the markdown link rewriter. Resolve them so HomeLayout
  // doesn't have to know about the repo URL layout.
  rewriteFrontmatterLinks(rendered.frontmatter, linkContext);

  const [[sidebar, repoNav, repoComponents, repoSocialFromSource], lastUpdated] = await Promise.all(
    [chromeP, lastUpdatedP],
  );

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
  const finalTitle =
    rendered.title ||
    heroName ||
    (route.pagePath === "index" ? route.repo.displayName : titleFromPath(route.pagePath));

  // Description: frontmatter.description > frontmatter.hero.tagline > repo.description
  const heroTagline =
    heroObj && typeof heroObj === "object"
      ? ((heroObj as Record<string, unknown>).tagline as string | undefined)
      : undefined;
  const finalDescription =
    rendered.description ||
    heroTagline ||
    (route.pagePath === "index" ? route.repo.description : undefined);

  return {
    found: true,
    sourcePath: matchedPath,
    source,
    markdown: pageMarkdown(source, rendered, linkContext),
    payload: {
      config: site,
      route,
      sidebar,
      repoNav,
      repoSocialLinks,
      repoComponents,
      // Pages are rendered light; the head script switches before first paint.
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
        },
      },
    },
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
  route: RouteContext,
  baseDir: string,
  relPath: string,
  linkContext: LinkContext,
  xrefMap: XrefMap | null,
): Promise<Block[] | null> {
  const path = resolveRelativePath(baseDir, relPath);
  if (!path) return null;
  const source = await readSourceFile(route.repo, path);
  if (!source) return null;

  const innerRendered = await renderMarkdown({
    source,
    linkContext,
    renderDiagram: (code) => renderMermaidThemed(code),
    // Deliberately omit recursive include resolvers — see comment above.
    resolveXref: xrefResolver(xrefMap),
  });
  return innerRendered.ast.blocks;
}

// OPS [!code-lang]: fetch the source file, slice per the directive, syntax-
// highlight, and return a code block ready to splice into the parent AST.
async function resolveCodeInclude(
  route: RouteContext,
  baseDir: string,
  meta: CodeIncludeMeta,
): Promise<Extract<Block, { type: "code" }> | null> {
  const path = resolveRelativePath(baseDir, meta.path);
  if (!path) return null;
  const source = await readSourceFile(route.repo, path);
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
