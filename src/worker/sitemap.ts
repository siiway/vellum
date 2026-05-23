// Sitemap + robots.txt endpoints. Crawlers (Google, Bing, etc.) use these
// to enumerate the site without scraping; serving them is table-stakes for
// SEO and lets a fresh page get indexed in hours instead of weeks.
//
// The sitemap walks each repo's source tree, produces one <url> entry per
// localized markdown page, and includes <xhtml:link rel="alternate"> tags
// so search engines know which URLs are translations of which others.

import type { Env } from "./env";
import type { VellumConfig } from "../shared/types";
import { localeSourcePrefix } from "../shared/types";
import { fetchSourceTree, docsRootPrefix, repoRef } from "./sources";
import { readCache, writeCache } from "./cache";
import { ttlSeconds } from "./env";

interface SitemapUrl {
  loc: string;
  // Other localized versions of the same page, by language code.
  alternates: Record<string, string>;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

// robots.txt — Allow all, declare the sitemap. Disallow the JSON variants
// of pages (callers append `?_data=1`) so crawlers don't fan out into our
// SPA-navigation transport. Same for the search endpoint, which is paginated
// by querystring and has infinite crawl space.
export function handleRobots(request: Request): Response {
  const origin = new URL(request.url).origin;
  const body = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /*?_data=1
Disallow: /search?
Disallow: /*/search?

Sitemap: ${origin}/sitemap.xml
`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-vellum": "edge-robots",
    },
  });
}

export async function handleSitemap(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const cacheKey = `sitemap2:${new URL(request.url).host}`;
  const cached = await readCache<string>(env, cacheKey);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: sitemapHeaders(),
    });
  }

  const urls = await buildSitemapUrls(env, ctx, site, origin);
  const xml = renderSitemap(urls);
  ctx.waitUntil(writeCache(env, cacheKey, xml, ttlSeconds(env, "raw") * 4, ctx));

  return new Response(xml, {
    status: 200,
    headers: sitemapHeaders(),
  });
}

function sitemapHeaders(): HeadersInit {
  return {
    "content-type": "application/xml; charset=utf-8",
    "cache-control": "public, max-age=3600",
    "x-vellum": "edge-sitemap",
  };
}

// Walk each (repo, locale) pair, collect the markdown blob paths, dedupe by
// canonical page URL across locales (so we can emit hreflang alternates for
// the same logical page).
async function buildSitemapUrls(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  origin: string,
): Promise<SitemapUrl[]> {
  // Each "page key" identifies a logical page across locales: it's the part
  // of the URL after the locale prefix. We collect localized URLs per page
  // key so we can emit hreflang alternates pointing to siblings.
  const byPageKey = new Map<string, Map<string, string>>();

  // Repo enumeration runs in parallel; per-repo we serialize to keep memory
  // and the upstream-fetch rate manageable.
  await Promise.all(
    site.repos
      .filter((r) => !r.excludeFromSearch)
      .map(async (repo) => {
        const branch = repoRef(
          repo,
          repo.versions?.find((v) => v.default),
        );
        let tree;
        try {
          tree = await fetchSourceTree(env, repo, branch, { ctx });
        } catch {
          // A single repo failing (e.g. transient GitHub API hiccup) should
          // not nuke the entire sitemap. Skip and continue.
          return;
        }
        const rootPrefix = docsRootPrefix(repo.docsRoot);

        for (const entry of tree) {
          if (entry.type !== "blob") continue;
          if (!entry.path.endsWith(".md")) continue;
          if (rootPrefix && !entry.path.startsWith(rootPrefix)) continue;

          // Path relative to the docs root, minus .md.
          const relWithLocale = (
            rootPrefix ? entry.path.slice(rootPrefix.length) : entry.path
          ).replace(/\.md$/, "");

          // Skip directory names starting with `_` — convention for include
          // partials (`_includes/foo.md`), drafts (`_drafts/...`), and other
          // non-page assets. Matches VitePress/Jekyll behaviour.
          if (relWithLocale.split("/").some((seg) => seg.startsWith("_"))) continue;

          // Determine the locale this file belongs to. The first path segment
          // matches a configured locale.prefix → that's the locale; otherwise
          // it's the default locale.
          const segments = relWithLocale.split("/");
          const firstSeg = segments[0] ?? "";
          const matchedLocale = site.site.locales.find((l) => l.prefix && l.prefix === firstSeg);
          const locale =
            matchedLocale ?? site.site.locales.find((l) => l.code === site.site.defaultLocale);
          if (!locale) continue;

          // Strip the locale segment if present, leaving the "page path"
          // (e.g. "getting-started" or "index"). This becomes the page key.
          const pageRel = matchedLocale ? segments.slice(1).join("/") : relWithLocale;
          if (!pageRel) continue;

          const pageKey = `${repo.slug}/${pageRel}`;
          const finalSlug = pageRel === "index" ? "" : pageRel;

          // The homepageRepo's index page lives at the short canonical URL
          // (`/` and `/{localePrefix}`) — the dedicated homepage block below
          // emits those entries, and the slug form (`/{homepageRepo}`) is a
          // 301 redirect. Skip here so we don't duplicate or sitemap a URL
          // that just bounces.
          if (repo.slug === site.site.homepageRepo && pageRel === "index") continue;

          // Build the absolute URL for this locale.
          const localePart = locale.prefix ? `/${locale.prefix}` : "";
          const tail = finalSlug ? `/${finalSlug}` : "";
          const url = `${origin}${localePart}/${repo.slug}${tail}`;

          let perLocale = byPageKey.get(pageKey);
          if (!perLocale) {
            perLocale = new Map();
            byPageKey.set(pageKey, perLocale);
          }
          perLocale.set(locale.code, url);
        }
      }),
  );

  // Always include the site root + bare locale homepages so the homepage is
  // crawlable even when it's a local-source repo with no markdown tree
  // entry that walks into. The landing URL is the short canonical form
  // (`/` and `/{localePrefix}`) — the slug form `/{homepageRepo}` is a 301
  // redirect and would be wasted budget for crawlers.
  const homepageKey = `__homepage__`;
  const homepageLocales = new Map<string, string>();
  for (const locale of site.site.locales) {
    const localePart = locale.prefix ? `/${locale.prefix}` : "";
    homepageLocales.set(locale.code, `${origin}${localePart || "/"}`);
  }
  byPageKey.set(homepageKey, homepageLocales);

  // Convert the keyed map into the flat SitemapUrl list. For each page key
  // we emit one <url> per locale, with hreflang alternates referencing the
  // sibling URLs.
  const out: SitemapUrl[] = [];
  for (const [pageKey, perLocale] of byPageKey) {
    const alternates: Record<string, string> = {};
    for (const [code, url] of perLocale) alternates[code] = url;

    const isHomepage = pageKey === homepageKey;
    for (const [code, url] of perLocale) {
      out.push({
        loc: url,
        alternates,
        // Homepages get a higher priority; everything else stays at default.
        // Real-world impact is minor — most crawlers ignore priority —
        // but it costs nothing to express the intent.
        ...(isHomepage ? { priority: 1.0, changefreq: "daily" } : { changefreq: "weekly" }),
      });
    }
  }

  return out;
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
    if (u.lastmod) parts.push(`    <lastmod>${escapeXml(u.lastmod)}</lastmod>`);
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
  return parts.join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
