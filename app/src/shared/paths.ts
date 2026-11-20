// Where the build publishes the files the client reads at runtime. The build
// writes them and the client fetches them, so both use these.

import type { RepoConfig, VellumConfig } from "./types";

// The page a repo's root URL redirects to (its `landingPage`), relative to
// the repo, or null when the root is the repo's own index.
export function landingPath(repo: Pick<RepoConfig, "landingPage"> | undefined): string | null {
  const path = repo?.landingPage?.replace(/^\/+|\/+$/g, "");
  return path && path !== "index" ? path : null;
}

// The canonical form of an internal link, so the client can load its page
// directly instead of through a redirect. Follows the same rules as the
// build's `_redirects` (src/build/redirects.ts), except that a link without a
// locale gets the reader's locale (`localeCode`) rather than the default one.
// Links it doesn't recognise come back unchanged.
export function canonicalHref(href: string, config: VellumConfig, localeCode: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  const suffix = cut < 0 ? "" : href.slice(cut);
  const { locales, homepageRepo } = config.site;
  const parts = path.split("/").filter(Boolean);

  let locale = locales.find((l) => l.prefix && l.prefix === parts[0]);
  if (!locale) locale = locales.find((l) => l.prefix && l.code === parts[0]);
  if (locale) {
    parts.shift();
  } else {
    const first = parts[0];
    const known =
      !first ||
      first === "search" ||
      first === "languages" ||
      config.repos.some((r) => r.slug === first);
    if (!known) return href;
    // A locale without a prefix owns the unprefixed URLs.
    locale = locales.find((l) => !l.prefix) ?? locales.find((l) => l.code === localeCode);
  }
  const base = locale?.prefix ? `/${locale.prefix}` : "";

  // The landing page: /{prefix}, or its own landing page when the homepage
  // repo has one.
  const home =
    parts.length === 0 ||
    (parts[0] === homepageRepo && (parts.length === 1 || (parts[1] === "index" && !parts[2])));
  if (home) {
    const landing = landingPath(config.repos.find((r) => r.slug === homepageRepo));
    return (landing ? `${base}/${homepageRepo}/${landing}` : base || "/") + suffix;
  }
  const landing = landingPath(config.repos.find((r) => r.slug === parts[0]));
  if (parts.length === 1 && landing) parts.push(landing);
  return `${base}/${parts.join("/")}` + suffix;
}

// A page's bootstrap payload, used for client-side navigation. `pathname` is
// the page URL's path; trailing slashes don't matter.
export function payloadPath(pathname: string): string {
  return `/_vellum/pages/${pageFile(pathname)}.json`;
}

// The payload the client hydrates a page from: the page's payload without
// what its HTML already holds (leanAst).
export function hydrationPath(pathname: string): string {
  return `/_vellum/hydrate/${pageFile(pathname)}.json`;
}

// The file name a page's payloads take after: its path, `index` for `/`.
function pageFile(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, "") || "index";
}

// The payload the client hydrates the 404 page from in one locale. It has a
// path of its own because the page is served at every URL without a page.
export function notFoundPayloadPath(localeCode: string): string {
  return `/_vellum/404/${encodeURIComponent(localeCode)}.json`;
}

// The id of the link in a page's head to the payload the client hydrates the
// page from.
export const PAYLOAD_LINK_ID = "vellum-payload";

// The search index of one repo in one locale.
export function searchIndexPath(localeCode: string, repoSlug: string): string {
  return `/_vellum/search/${encodeURIComponent(localeCode)}/${encodeURIComponent(repoSlug)}.json`;
}

// The directory of a repo's published Vue components.
export function vueDir(repoSlug: string): string {
  return `/_vellum/vue/${encodeURIComponent(repoSlug)}`;
}

// The source of a registered Vue component.
export function vueComponentPath(repoSlug: string, name: string): string {
  return `${vueDir(repoSlug)}/${encodeURIComponent(name)}.vue`;
}

// The directory of a repo's published React components.
export function reactDir(repoSlug: string): string {
  return `/_vellum/react/${encodeURIComponent(repoSlug)}`;
}

// A file the build bundled a repo's React components into: a component's
// module (`{Name}.js`), a chunk they share or a stylesheet
// (ReactComponentFiles).
export function reactFilePath(repoSlug: string, file: string): string {
  return `${reactDir(repoSlug)}/${encodeURIComponent(file)}`;
}
