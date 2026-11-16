// Where the build publishes the files the client reads at runtime. The build
// writes them and the client fetches them, so both use these.

import type { VellumConfig } from "./types";

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

  if (parts[0] === homepageRepo && (parts.length === 1 || (parts[1] === "index" && !parts[2]))) {
    return (base || "/") + suffix;
  }
  const landing = config.repos
    .find((r) => r.slug === parts[0])
    ?.landingPage?.replace(/^\/+|\/+$/g, "");
  if (parts.length === 1 && landing && landing !== "index") parts.push(landing);
  return (parts.length ? `${base}/${parts.join("/")}` : base || "/") + suffix;
}

// A page's bootstrap payload, used for client-side navigation. `pathname` is
// the page URL's path; trailing slashes don't matter.
export function payloadPath(pathname: string): string {
  const page = pathname.replace(/^\/+|\/+$/g, "") || "index";
  return `/_vellum/pages/${page}.json`;
}

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
