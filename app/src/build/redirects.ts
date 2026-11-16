// The `_redirects` file. Static hosting can't redirect from code, so the URL
// forms the site answers with a redirect are spelled out here. Cloudflare
// applies the first rule that matches.

import type { VellumConfig } from "../shared/types";
import { landingPath } from "../shared/paths";
import { localeBase } from "./routes";

export function buildRedirects(site: VellumConfig): string {
  const lines: string[] = [];
  const add = (from: string, to: string, status: 301 | 302) =>
    lines.push(`${from} ${to} ${status}`);
  // A path with and without a trailing slash; rules match the path exactly.
  const exact = (from: string, to: string, status: 301 | 302) => {
    add(from, to, status);
    add(`${from}/`, to, status);
  };
  const { locales, homepageRepo } = site.site;
  const slugs = new Set(site.repos.map((r) => r.slug));

  // A locale's short code leads to its canonical prefix: /en/... → /en-US/...
  for (const l of locales) {
    if (!l.prefix || l.code === l.prefix || slugs.has(l.code)) continue;
    if (locales.some((other) => other.prefix === l.code)) continue;
    add(`/${l.code}`, `/${l.prefix}`, 301);
    add(`/${l.code}/*`, `/${l.prefix}/:splat`, 301);
  }

  // The landing page has one URL: /{prefix}, not /{prefix}/{homepageRepo}.
  // When the homepage repo has a `landingPage`, /{prefix} has no page and
  // all three go there.
  const homeLanding = landingPath(site.repos.find((r) => r.slug === homepageRepo));
  for (const l of locales) {
    const base = localeBase(l);
    if (homeLanding) {
      const target = `${base}/${homepageRepo}/${homeLanding}`;
      if (base) exact(base, target, 302);
      else add("/", target, 302);
      exact(`${base}/${homepageRepo}`, target, 302);
      exact(`${base}/${homepageRepo}/index`, target, 302);
    } else {
      exact(`${base}/${homepageRepo}`, base || "/", 301);
      exact(`${base}/${homepageRepo}/index`, base || "/", 301);
    }
  }

  // A repo without a home page of its own sends its root to its landing page.
  for (const repo of site.repos) {
    const landing = landingPath(repo);
    if (!landing || repo.slug === homepageRepo) continue;
    for (const l of locales) {
      const base = localeBase(l);
      exact(`${base}/${repo.slug}`, `${base}/${repo.slug}/${landing}`, 302);
    }
  }

  // URLs without a locale go to the default one.
  const fallback = locales.find((l) => l.code === site.site.defaultLocale) ?? locales[0];
  if (fallback?.prefix) {
    for (const repo of site.repos) {
      // Straight to the page, not through a second redirect.
      const landing = landingPath(repo);
      const root =
        repo.slug === homepageRepo && !landing
          ? ""
          : `/${repo.slug}${landing ? `/${landing}` : ""}`;
      exact(`/${repo.slug}`, `/${fallback.prefix}${root}`, 302);
      add(`/${repo.slug}/*`, `/${fallback.prefix}/${repo.slug}/:splat`, 302);
    }
    exact("/search", `/${fallback.prefix}/search`, 302);
    exact("/languages", `/${fallback.prefix}/languages`, 302);
  }

  return `${lines.join("\n")}\n`;
}
