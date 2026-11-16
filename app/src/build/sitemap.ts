// sitemap.xml and robots.txt. Crawlers (Google, Bing, etc.) use these to
// enumerate the site without scraping.
//
// The sitemap has one <url> entry per rendered page per locale, with
// <xhtml:link rel="alternate"> tags so search engines know which URLs are
// translations of which others. It needs absolute URLs, so it's only written
// when `site.url` is set.

import type { VellumConfig } from "../shared/types";
import { landingPath } from "../shared/paths";
import { localeBase, pageRoute } from "./routes";

interface SitemapUrl {
  loc: string;
  // Other localized versions of the same page, by language code.
  alternates: Record<string, string>;
  changefreq?: string;
  priority?: number;
}

// Disallow the build's data files (page payloads, search indexes) and the
// search page's query URLs, which have infinite crawl space.
export function buildRobots(origin: string | null): string {
  const lines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /_vellum/",
    "Disallow: /search?",
    "Disallow: /*/search?",
  ];
  if (origin) lines.push("", `Sitemap: ${origin}/sitemap.xml`);
  return `${lines.join("\n")}\n`;
}

// `pages` holds each repo's page paths per locale code.
export function buildSitemap(
  site: VellumConfig,
  origin: string,
  pages: Record<string, Record<string, string[]>>,
): string {
  // Each "page key" identifies a logical page across locales: the repo slug
  // plus the page path. URLs are collected per page key so translations can
  // point at each other.
  const byPageKey = new Map<string, Map<string, string>>();
  const home = site.repos.find((r) => r.slug === site.site.homepageRepo);
  const homeLanding = landingPath(home);

  for (const repo of site.repos) {
    if (repo.excludeFromSearch) continue;
    for (const locale of site.site.locales) {
      for (const pagePath of pages[repo.slug]?.[locale.code] ?? []) {
        // The landing page is listed below.
        if (repo === home && (pagePath === "index" || pagePath === homeLanding)) continue;
        const pageKey = `${repo.slug}/${pagePath}`;
        let perLocale = byPageKey.get(pageKey);
        if (!perLocale) byPageKey.set(pageKey, (perLocale = new Map()));
        perLocale.set(
          locale.code,
          `${origin}${pageRoute(site, repo, locale, pagePath).canonicalUrl}`,
        );
      }
    }
  }

  // The landing page of every locale, always listed even when the homepage
  // repo is excluded from search.
  const homepageKey = "__homepage__";
  const homepageLocales = new Map<string, string>();
  for (const locale of site.site.locales) {
    const url =
      home && homeLanding
        ? pageRoute(site, home, locale, homeLanding).canonicalUrl
        : localeBase(locale) || "/";
    homepageLocales.set(locale.code, `${origin}${url}`);
  }
  byPageKey.set(homepageKey, homepageLocales);

  // One <url> per locale, with hreflang alternates referencing the siblings.
  const out: SitemapUrl[] = [];
  for (const [pageKey, perLocale] of byPageKey) {
    const alternates = Object.fromEntries(perLocale);
    const isHomepage = pageKey === homepageKey;
    for (const url of perLocale.values()) {
      out.push({
        loc: url,
        alternates,
        // Homepages get a higher priority; everything else stays at default.
        // Most crawlers ignore priority, but it costs nothing to express.
        ...(isHomepage ? { priority: 1.0, changefreq: "daily" } : { changefreq: "weekly" }),
      });
    }
  }
  return renderSitemap(out);
}

// Renders to the standard sitemaps.org format with xhtml:link alternates.
// Stays under the 50k-URL / 50MB limit for any realistic doc site; if we
// ever blow that we'd switch to a sitemap index.
function renderSitemap(urls: SitemapUrl[]): string {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  );
  for (const u of urls) {
    parts.push("  <url>");
    parts.push(`    <loc>${escapeXml(u.loc)}</loc>`);
    if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`);
    if (u.priority !== undefined) parts.push(`    <priority>${u.priority.toFixed(1)}</priority>`);
    for (const [code, href] of Object.entries(u.alternates)) {
      parts.push(
        `    <xhtml:link rel="alternate" hreflang="${escapeXml(code)}" href="${escapeXml(href)}" />`,
      );
    }
    parts.push("  </url>");
  }
  parts.push("</urlset>");
  return `${parts.join("\n")}\n`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
