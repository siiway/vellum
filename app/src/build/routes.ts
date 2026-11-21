// The pages the build renders: every markdown file of every repo, per locale,
// with the canonical URL it's served at.
//
// URLs are locale-first: `/{localePrefix}/{repoSlug}/{page}`. The homepage
// repo's index is the landing page at `/{localePrefix}`.

import type { LocaleConfig, RepoConfig, RouteContext, VellumConfig } from "../shared/types";
import { sourceLocale } from "../shared/types";
import { landingPath } from "../shared/paths";
import { defaultVersion, docsRootPrefix, listSourceFiles } from "./sources";

// `/{prefix}`, or "" for a locale without one.
export function localeBase(locale: Pick<LocaleConfig, "prefix"> | undefined): string {
  return locale?.prefix ? `/${locale.prefix}` : "";
}

// The route of a page. `pagePath` is relative to the locale's source
// directory, without `.md`; "index" is the repo's root page.
export function pageRoute(
  site: VellumConfig,
  repo: RepoConfig,
  locale: LocaleConfig,
  pagePath: string,
): RouteContext {
  const base = localeBase(locale);
  const canonicalUrl =
    repo.slug === site.site.homepageRepo && pagePath === "index"
      ? base || "/"
      : `${base}/${repo.slug}${pagePath === "index" ? "" : `/${pagePath}`}`.replace(/\/+/g, "/");
  return {
    repoSlug: repo.slug,
    repo,
    version: defaultVersion(repo),
    localeCode: locale.code,
    pagePath,
    canonicalUrl,
  };
}

// A route for pages that belong to no repo (search, languages, 404): the
// shell needs one to render against.
export function stubRoute(
  site: VellumConfig,
  locale: LocaleConfig,
  pagePath: string,
  canonicalUrl: string,
): RouteContext {
  const repo = site.repos[0]!;
  return {
    repoSlug: repo.slug,
    repo,
    version: defaultVersion(repo),
    localeCode: locale.code,
    pagePath,
    canonicalUrl,
  };
}

// The repo's pages, as sorted page paths per locale code, from the files
// isPagePath allows. `x/index.md` is the page `x`; a locale's `README.md` is
// its index when there's no `index.md`. A repo with a `landingPage` has no
// index page: its root URL redirects.
export async function listRepoPages(
  site: VellumConfig,
  repo: RepoConfig,
): Promise<Record<string, string[]>> {
  const prefix = docsRootPrefix(repo.docsRoot);
  const landing = landingPath(repo);
  const byLocale = new Map<string, Set<string>>();
  for (const path of await listSourceFiles(repo)) {
    if (!path.endsWith(".md") || !path.startsWith(prefix)) continue;
    const rel = path.slice(prefix.length, -".md".length);
    if (!isPagePath(rel)) continue;
    const owner = sourceLocale(rel, site.site.locales, site.site.defaultLocale, repo);
    if (!owner) continue;
    const page = pagePathOf(owner.path);
    if (page === "index" && landing) continue;
    let pages = byLocale.get(owner.code);
    if (!pages) byLocale.set(owner.code, (pages = new Set()));
    pages.add(page);
  }
  const out: Record<string, string[]> = {};
  for (const locale of site.site.locales) {
    out[locale.code] = [...(byLocale.get(locale.code) ?? [])].sort();
  }
  return out;
}

// The locale a page is shown in where it isn't translated: the default
// locale when it has the page, else the first locale that does, in config
// order. Undefined when no locale has it.
export function fallbackLocale(
  site: VellumConfig,
  has: (localeCode: string) => boolean,
): LocaleConfig | undefined {
  const { locales, defaultLocale } = site.site;
  const preferred = locales.find((l) => l.code === defaultLocale);
  if (preferred && has(preferred.code)) return preferred;
  return locales.find((l) => has(l.code));
}

// Whether a source file is a page. `rel` is relative to the docs root,
// without `.md`. A file under a directory, or with a name, starting with `_`
// (includes, drafts) or `.` (`.vitepress`) isn't.
export function isPagePath(rel: string): boolean {
  return !rel.split("/").some((seg) => seg.startsWith("_") || seg.startsWith("."));
}

function pagePathOf(path: string): string {
  if (path === "index" || path === "README") return "index";
  if (path.endsWith("/index")) return path.slice(0, -"/index".length);
  return path;
}

// Where a page's HTML goes in the output: `{canonical}/index.html`, which
// the assets server answers at `{canonical}` (html_handling:
// "drop-trailing-slash").
export function htmlFile(canonicalUrl: string): string {
  const path = canonicalUrl.replace(/^\/+|\/+$/g, "");
  return path ? `${path}/index.html` : "index.html";
}

// The URL of a page's Markdown: the page's URL plus `.md`, and `/index.md`
// for a page at `/`.
export function markdownUrl(canonicalUrl: string): string {
  const path = canonicalUrl.replace(/^\/+|\/+$/g, "");
  return `/${path || "index"}.md`;
}
