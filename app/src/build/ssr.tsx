// SSR pipeline: render the React tree to a string, extract Griffel CSS, embed the bootstrap
// payload, and return a complete HTML document with a full SEO + social-graph head.

import { renderToString } from "react-dom/server";
import {
  RendererProvider,
  SSRProvider,
  createCSSRuleFromTheme,
  createDOMRenderer,
  renderToStyleElements,
} from "@fluentui/react-components";
import { App } from "../web/App";
import { createVellumTheme } from "../web/theme";
import type { BootstrapPayload, LocaleConfig, SocialLink, VellumConfig } from "../shared/types";
import type { ClientAssets } from "./assets";

export interface RenderOptions {
  assets: ClientAssets;
  // The site's origin (`site.url`) for absolute URLs in the head. Null leaves
  // them root-relative and drops the tags that must be absolute.
  origin: string | null;
}

// `markdownUrl` is where the page's Markdown is published, for a docs page.
export function renderPage(
  payload: BootstrapPayload,
  { assets, origin }: RenderOptions,
  markdownUrl: string | null = null,
): string {
  const renderer = createDOMRenderer();
  const html = renderToString(
    <RendererProvider renderer={renderer}>
      <SSRProvider>
        <App data={payload} />
      </SSRProvider>
    </RendererProvider>,
  );

  const styleElements = renderToStyleElements(renderer);
  const styleHtml = styleElements
    .map((el) => {
      const props = el.props as Record<string, unknown>;
      const id = props.id as string | undefined;
      const media = props.media as string | undefined;
      const css = (props.dangerouslySetInnerHTML as { __html: string } | undefined)?.__html ?? "";
      return `<style${id ? ` data-make-styles-bucket="${id}"` : ""}${media ? ` media="${media}"` : ""}>${css}</style>`;
    })
    .join("");

  const cssLinks = assets.css.map((href) => `<link rel="stylesheet" href="${href}">`).join("");
  // Module scripts never block parsing and run after it, so the entry goes in
  // <head> where the browser finds it first. The preloads fetch the chunks it
  // imports in parallel with it rather than after it has been parsed.
  const jsTags = [
    ...assets.preload.map((href) => `<link rel="modulepreload" href="${href}">`),
    ...assets.js.map((src) => `<script type="module" src="${src}"></script>`),
  ].join("");

  const { site } = payload.config;
  const themeColor = site.themeColor ?? "#0078d4";

  const seoHead = buildSeoHead(payload, origin, markdownUrl);

  const safePayload = JSON.stringify(payload).replace(/</g, "\\u003c");

  // Baseline reset + Shiki theme activation + print styles.
  // - Reset: kill browser default margins; pre-paint background so there's no flash.
  //   Background is keyed off [data-theme] (set by the head pre-script below) so that
  //   a user with prefers-color-scheme:dark doesn't see a flash of light before React
  //   hydrates.
  // - Shiki: highlighter emits `--shiki-light/--shiki-dark` CSS vars (so the same code
  //   block can theme-swap without re-render); activate them via [data-theme] selectors.
  // - Print: hide nav/sidebar/outline, give the content area full width, force light
  //   theme + page-friendly margins so "Save as PDF" produces a clean document.
  // --vellum-canvas is the one flat page colour that header, sidebar and
  // content share (same values as Prism's --prism-canvas); cards sit on it
  // with a hairline border. Keyed off [data-theme] so it applies before the
  // first paint.
  const baseCss = `
html{--vellum-canvas:#ffffff;color-scheme:light;}
html[data-theme="dark"]{--vellum-canvas:#1a1a1a;color-scheme:dark;}
html,body{margin:0;padding:0;min-height:100%;background:var(--vellum-canvas);color:#171717;}
html[data-theme="dark"],html[data-theme="dark"] body{color:#f0f0f0;}
html{box-sizing:border-box;-webkit-text-size-adjust:100%;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
*,*::before,*::after{box-sizing:inherit;}
body{font-family:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";}
#vellum-root{min-height:100vh;}
img,svg{vertical-align:middle;}
::selection{background:color-mix(in srgb,var(--colorBrandBackground,#0078d4) 22%,transparent);}

/* Fluent Badge must never wrap its label or shrink inside flex rows: CJK
   text otherwise collapses onto two lines on narrow viewports. */
.fui-Badge{white-space:nowrap;flex-shrink:0;}

/* Portalled Fluent surfaces sit outside the page containers. A hairline on
   top of their shadow keeps them distinct in dark mode, where a shadow on a
   near-black canvas barely registers. */
.fui-DialogSurface,.fui-MenuPopover,.fui-PopoverSurface,.fui-Listbox{border:1px solid var(--colorNeutralStroke2);}

/* Scrollbars: thin, transparent track, neutral thumb. */
::-webkit-scrollbar{width:8px;height:8px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.16);border-radius:4px;border:2px solid transparent;background-clip:padding-box;}
::-webkit-scrollbar-thumb:hover{background-color:rgba(0,0,0,0.32);}
html[data-theme="dark"] ::-webkit-scrollbar-thumb{background-color:rgba(255,255,255,0.14);}
html[data-theme="dark"] ::-webkit-scrollbar-thumb:hover{background-color:rgba(255,255,255,0.28);}

/* Code surface tokens: a shade off the canvas, hairline edge. */
:root{--vellum-code-bg:#fafafa;--vellum-code-border:#e8e8e8;--vellum-code-fg-muted:#6b6b6b;}
html[data-theme="dark"]{--vellum-code-bg:#1f1f1f;--vellum-code-border:#313131;--vellum-code-fg-muted:#a3a3a3;}

/* Shiki: light theme renders with direct inline colors (no CSS needed).
   For dark theme we bind --shiki-dark variables (which Shiki *does* emit) to color/bg.
   Background is forced transparent so the FluentUI Card chrome owns the surface color. */
.shiki{background:transparent !important;display:block;font-feature-settings:"calt","liga" !important;}
/* Shiki emits a literal newline between adjacent .line spans. With block-level
   lines those newlines would each render as an extra empty line inside the pre,
   doubling the gap between code rows. Collapsing line-height to 0 on .shiki code
   makes the inter-line whitespace contribute zero height; .line restores its own
   line-height so the actual code reads normally. */
.shiki code{background:transparent !important;display:block;line-height:0;}
html[data-theme="dark"] .shiki{color:var(--shiki-dark) !important;}
html[data-theme="dark"] .shiki span{color:var(--shiki-dark) !important;}
html[data-theme="dark"] .shiki span[style*="--shiki-dark-font-style"]{font-style:var(--shiki-dark-font-style) !important;}
html[data-theme="dark"] .shiki span[style*="--shiki-dark-font-weight"]{font-weight:var(--shiki-dark-font-weight) !important;}
html[data-theme="dark"] .shiki span[style*="--shiki-dark-text-decoration"]{text-decoration:var(--shiki-dark-text-decoration) !important;}
.shiki .line{display:block;line-height:1.55;min-height:1.25em;}
.vellum-line-highlight{background:#0078d420 !important;box-shadow:inset 3px 0 0 #0078d4;display:block;}

/* Line numbers (opt-in via .has-line-numbers on the pre). */
.shiki.has-line-numbers{counter-reset:line;}
.shiki.has-line-numbers .line::before{counter-increment:line;content:counter(line);display:inline-block;width:1.6em;margin-right:1em;text-align:right;color:var(--vellum-code-fg-muted);user-select:none;font-variant-numeric:tabular-nums;}

/* Shiki transformer notation classes — let authors annotate code with
   // [!code highlight], // [!code ++], // [!code focus], etc.
   See @shikijs/transformers for the full syntax. */
.shiki .line.highlighted{background:#0078d420;box-shadow:inset 3px 0 0 #0078d4;display:block;}
.shiki .line.diff.add{background:#1f883d20;box-shadow:inset 3px 0 0 #1f883d;display:block;}
.shiki .line.diff.add::before{content:"+";display:inline-block;width:1em;margin-right:0.5em;color:#1f883d;}
.shiki .line.diff.remove{background:#d1242f20;box-shadow:inset 3px 0 0 #d1242f;display:block;opacity:0.8;}
.shiki .line.diff.remove::before{content:"-";display:inline-block;width:1em;margin-right:0.5em;color:#d1242f;}
.shiki.has-focused .line:not(.focused){opacity:0.4;filter:blur(0.5px);transition:opacity 200ms ease, filter 200ms ease;}
.shiki.has-focused:hover .line:not(.focused){opacity:1;filter:none;}
.shiki .line.highlighted.error{background:#d1242f20;box-shadow:inset 3px 0 0 #d1242f;display:block;}
.shiki .line.highlighted.warning{background:#bf872720;box-shadow:inset 3px 0 0 #bf8727;display:block;}
.shiki .highlighted-word{background:#0078d433;padding:0 2px;border-radius:2px;}

@page{margin:18mm 16mm;}
@media print{
  html,body{background:#fff !important;color:#000 !important;}
  header,aside,.vellum-no-print{display:none !important;}
  main{padding:0 !important;}
  .vellum-grid{grid-template-columns:1fr !important;}
  a{color:#000 !important;text-decoration:underline;}
  a[href^="http"]::after{content:" (" attr(href) ")";font-size:0.85em;color:#444;}
  .vellum-code-block,pre{break-inside:avoid;}
  h1,h2,h3,h4{break-after:avoid;}
}
`;

  // Theme resolution runs synchronously in <head> before first paint and
  // sets <html data-theme>. Priority:
  //   1. Explicit `vellum-theme` cookie (set by the toggle button) — wins always.
  //   2. The OS preference.
  // When the result differs from the theme the page was rendered in, nothing
  // reloads: the page CSS keys off [data-theme], `themeTokenCss` below covers
  // FluentUI's tokens, and the client switches its own state after hydration.
  const pageTheme = payload.initialTheme;
  const themeScript = `(function(){var d=document.documentElement;try{var m=document.cookie.match(/(?:^|; )vellum-theme=(light|dark)/);if(m){d.dataset.theme=m[1];return;}d.dataset.theme=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}catch(e){d.dataset.theme=${JSON.stringify(pageTheme)};}})();`;

  // FluentProvider renders only the page theme's tokens. This rule carries
  // the other theme's, applied when the script above picked it. It outranks
  // FluentProvider's own `.fui-FluentProviderR0` rule, and once the client
  // has switched themes the two agree.
  const otherTheme = pageTheme === "dark" ? "light" : "dark";
  const themeTokenCss = createCSSRuleFromTheme(
    `html[data-theme="${otherTheme}"] .fui-FluentProvider`,
    createVellumTheme(otherTheme === "dark", site.themeColor),
  );

  return `<!doctype html>
<html lang="${escapeAttr(toBcp47(payload.route.localeCode, payload.config))}" data-theme="${payload.initialTheme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="${escapeAttr(themeColor)}">
  <script>${themeScript}</script>
${seoHead}
  ${site.favicon ? `<link rel="icon" type="image/svg+xml" href="${escapeAttr(site.favicon)}">` : ""}
  <style id="vellum-base">${baseCss}</style>
  ${styleHtml}
  <style id="vellum-theme-tokens">${themeTokenCss}</style>
  ${cssLinks}
  ${jsTags}
</head>
<body>
  <div id="vellum-root">${html}</div>
  <script id="__VELLUM_DATA__" type="application/json">${safePayload}</script>
</body>
</html>`;
}

// --- SEO head -------------------------------------------------------------

// Builds the title/description/canonical/OG/Twitter/JSON-LD bundle. Kept as
// one function so all of the head's metadata reasoning lives in one place
// instead of being scattered through template literal interpolations.
function buildSeoHead(
  payload: BootstrapPayload,
  siteOrigin: string | null,
  markdownUrl: string | null,
): string {
  const { config, route, page, error } = payload;
  const { site } = config;
  // Without `site.url` every URL below stays root-relative.
  const origin = siteOrigin ?? "";

  const frontmatter = (page.meta.frontmatter ?? {}) as Record<string, unknown>;

  const pageTitle = page.meta.title ? `${page.meta.title} · ${site.title}` : site.title;
  const description = (page.meta.description ?? site.tagline ?? "").toString().trim();

  // Canonical URL. Errors get no canonical (the URL is fictitious — pointing
  // search engines at it would propagate the bad link). Everything else
  // absolutizes the route's canonical path against the site origin.
  const canonicalAbsolute = error ? null : `${origin}${route.canonicalUrl}`;

  // OG image: page frontmatter wins, then repo logo, then site logo. The
  // value can be absolute (https://…), origin-relative (/…), or repo-
  // relative; we absolutize the latter two so the embed shows the right
  // image on third-party platforms.
  const rawImage =
    pickString(frontmatter, ["image", "cover", "ogImage", "og_image"]) ??
    route.repo?.logo ??
    site.logo ??
    null;
  const ogImage = rawImage ? absolutize(rawImage, origin, route.canonicalUrl) : null;
  const ogImageAlt =
    pickString(frontmatter, ["imageAlt", "ogImageAlt"]) ??
    (page.meta.title ? `${page.meta.title} — ${site.title}` : site.title);

  // Author + keywords from frontmatter, with `tags:` folded into keywords as
  // a courtesy (a lot of doc systems use the two interchangeably).
  const author = pickString(frontmatter, ["author"]) ?? page.meta.lastUpdated?.author ?? null;
  const keywords = collectKeywords(frontmatter);

  // article:* tags only make sense for actual article-shaped pages. The
  // homepage repo's index and the layout: home pages are website-shaped.
  const isHomepageIndex = route.repoSlug === site.homepageRepo && route.pagePath === "index";
  const layout = pickString(frontmatter, ["layout"]);
  const isWebsite = isHomepageIndex || layout === "home" || layout === "search";
  const ogType = isWebsite ? "website" : "article";

  const publishedTime = pickString(frontmatter, ["date", "publishedTime", "published"]) ?? null;
  const modifiedTime =
    pickString(frontmatter, ["lastUpdated", "modifiedTime", "modified"]) ??
    page.meta.lastUpdated?.iso ??
    null;

  // Robots: noindex on error pages and the search shell. Both are dynamic
  // or transient and have no SEO value (and the search page's content lives
  // in the querystring, which crawlers should not be encouraged to enumerate).
  const noIndex = !!error || layout === "search";

  // Twitter site handle: derive from the configured x/twitter social link if
  // one exists — saves authors from configuring the same handle twice.
  const twitterSiteHandle =
    pickTwitterHandle(route.repo?.socialLinks ?? null) ??
    pickTwitterHandle(site.socialLinks ?? null) ??
    null;

  // Locale + i18n alternates. We emit a hreflang per configured locale so
  // search engines can return the right translation to the right reader.
  // Alternates are emitted for every configured locale, translated or not,
  // and some may 404; this matches what MS Learn does and what Google
  // tolerates.
  const currentLocale = site.locales.find((l) => l.code === route.localeCode);
  const alternates =
    !error && currentLocale
      ? site.locales.map((loc) => ({
          loc,
          href: `${origin}${swapLocalePrefix(route.canonicalUrl, currentLocale, loc)}`,
        }))
      : [];
  const defaultLocaleConfig =
    site.locales.find((l) => l.code === site.defaultLocale) ?? currentLocale;

  // --- HTML emit ---------------------------------------------------------

  const lines: string[] = [];

  // Document basics.
  lines.push(`  <title>${escapeHtml(pageTitle)}</title>`);
  if (description) {
    lines.push(`  <meta name="description" content="${escapeAttr(description)}">`);
  }
  lines.push(`  <meta name="generator" content="Vellum">`);
  if (author) {
    lines.push(`  <meta name="author" content="${escapeAttr(author)}">`);
  }
  if (keywords) {
    lines.push(`  <meta name="keywords" content="${escapeAttr(keywords)}">`);
  }
  if (noIndex) {
    lines.push(`  <meta name="robots" content="noindex, nofollow">`);
  } else {
    lines.push(`  <meta name="robots" content="index, follow">`);
  }

  // Canonical + i18n alternates.
  if (canonicalAbsolute) {
    lines.push(`  <link rel="canonical" href="${escapeAttr(canonicalAbsolute)}">`);
  }
  for (const alt of alternates) {
    const tag = toBcp47(alt.loc.code, config);
    lines.push(
      `  <link rel="alternate" hreflang="${escapeAttr(tag)}" href="${escapeAttr(alt.href)}">`,
    );
  }
  if (defaultLocaleConfig && !error) {
    const defaultHref = `${origin}${swapLocalePrefix(route.canonicalUrl, currentLocale!, defaultLocaleConfig)}`;
    lines.push(`  <link rel="alternate" hreflang="x-default" href="${escapeAttr(defaultHref)}">`);
  }
  // The same page as Markdown, for agents.
  if (markdownUrl) {
    lines.push(
      `  <link rel="alternate" type="text/markdown" href="${escapeAttr(`${origin}${markdownUrl}`)}">`,
    );
  }

  // Open Graph.
  lines.push(`  <meta property="og:site_name" content="${escapeAttr(site.title)}">`);
  lines.push(`  <meta property="og:title" content="${escapeAttr(pageTitle)}">`);
  if (description) {
    lines.push(`  <meta property="og:description" content="${escapeAttr(description)}">`);
  }
  lines.push(`  <meta property="og:type" content="${ogType}">`);
  // og:url must be absolute, so it needs `site.url`.
  if (canonicalAbsolute && siteOrigin) {
    lines.push(`  <meta property="og:url" content="${escapeAttr(canonicalAbsolute)}">`);
  }
  if (currentLocale) {
    lines.push(
      `  <meta property="og:locale" content="${escapeAttr(toBcp47Underscore(currentLocale.code, config))}">`,
    );
    for (const loc of site.locales) {
      if (loc.code === currentLocale.code) continue;
      lines.push(
        `  <meta property="og:locale:alternate" content="${escapeAttr(toBcp47Underscore(loc.code, config))}">`,
      );
    }
  }
  if (ogImage) {
    lines.push(`  <meta property="og:image" content="${escapeAttr(ogImage)}">`);
    lines.push(`  <meta property="og:image:alt" content="${escapeAttr(ogImageAlt)}">`);
  }

  // article:* — only for article-shaped pages.
  if (!isWebsite && !error) {
    if (publishedTime) {
      lines.push(
        `  <meta property="article:published_time" content="${escapeAttr(publishedTime)}">`,
      );
    }
    if (modifiedTime) {
      lines.push(`  <meta property="article:modified_time" content="${escapeAttr(modifiedTime)}">`);
    }
    if (author) {
      lines.push(`  <meta property="article:author" content="${escapeAttr(author)}">`);
    }
    if (route.repo?.displayName) {
      lines.push(
        `  <meta property="article:section" content="${escapeAttr(route.repo.displayName)}">`,
      );
    }
    for (const tag of collectTags(frontmatter)) {
      lines.push(`  <meta property="article:tag" content="${escapeAttr(tag)}">`);
    }
  }

  // Twitter card. summary_large_image is the right default for docs — the
  // image is decorative, not a thumbnail of a small avatar.
  lines.push(`  <meta name="twitter:card" content="summary_large_image">`);
  lines.push(`  <meta name="twitter:title" content="${escapeAttr(pageTitle)}">`);
  if (description) {
    lines.push(`  <meta name="twitter:description" content="${escapeAttr(description)}">`);
  }
  if (ogImage) {
    lines.push(`  <meta name="twitter:image" content="${escapeAttr(ogImage)}">`);
  }
  if (twitterSiteHandle) {
    lines.push(`  <meta name="twitter:site" content="${escapeAttr(twitterSiteHandle)}">`);
    lines.push(`  <meta name="twitter:creator" content="${escapeAttr(twitterSiteHandle)}">`);
  }

  // JSON-LD structured data. Three blocks: site, breadcrumbs (when nested),
  // and the page itself (Article or WebPage). Search engines prefer the
  // schema.org vocabulary over scattering meta tags, and the marginal
  // bytes are negligible compared to the head's CSS.
  const ldBlocks: object[] = [];

  ldBlocks.push({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.title,
    url: origin || "/",
    ...(site.tagline ? { description: site.tagline } : {}),
    ...(site.logo ? { image: absolutize(site.logo, origin) } : {}),
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${origin}${currentLocale?.prefix ? `/${currentLocale.prefix}` : ""}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  });

  if (!error && !isWebsite) {
    const breadcrumbs = buildBreadcrumbs(payload, origin);
    if (breadcrumbs.length > 1) {
      ldBlocks.push({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbs.map((b, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: b.name,
          item: b.url,
        })),
      });
    }
  }

  if (!error) {
    const pageLd: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": isWebsite ? "WebPage" : "TechArticle",
      headline: page.meta.title || site.title,
      ...(description ? { description } : {}),
      ...(canonicalAbsolute ? { url: canonicalAbsolute, mainEntityOfPage: canonicalAbsolute } : {}),
      ...(ogImage ? { image: ogImage } : {}),
      ...(publishedTime ? { datePublished: publishedTime } : {}),
      ...(modifiedTime ? { dateModified: modifiedTime } : {}),
      ...(author ? { author: { "@type": "Person", name: author } } : {}),
      ...(currentLocale ? { inLanguage: toBcp47(currentLocale.code, config) } : {}),
      publisher: {
        "@type": "Organization",
        name: site.title,
        ...(site.logo
          ? { logo: { "@type": "ImageObject", url: absolutize(site.logo, origin) } }
          : {}),
      },
    };
    ldBlocks.push(pageLd);
  }

  for (const block of ldBlocks) {
    // </script> in the JSON would break out of the script context — escape
    // the forward slash so the browser's HTML parser leaves it alone.
    const json = JSON.stringify(block).replace(/</g, "\\u003c");
    lines.push(`  <script type="application/ld+json">${json}</script>`);
  }

  return lines.join("\n");
}

// --- helpers --------------------------------------------------------------

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Collects `keywords` (string or array) and `tags` from frontmatter into a
// single comma-separated meta value. Deduplicates and trims.
function collectKeywords(fm: Record<string, unknown>): string | null {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string") {
      v.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => out.add(s));
    } else if (Array.isArray(v)) {
      v.forEach((item) => typeof item === "string" && item.trim() && out.add(item.trim()));
    }
  };
  add(fm.keywords);
  add(fm.tags);
  return out.size ? Array.from(out).join(", ") : null;
}

function collectTags(fm: Record<string, unknown>): string[] {
  const out: string[] = [];
  const v = fm.tags;
  if (typeof v === "string") {
    v.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => out.push(s));
  } else if (Array.isArray(v)) {
    v.forEach((item) => typeof item === "string" && item.trim() && out.push(item.trim()));
  }
  return out;
}

// Locale-code → BCP-47 mapping. Our config uses bare ISO 639-1 codes ("en",
// "zh"). For HTML lang= and hreflang= we'd ideally use a full tag like
// "en-US" or "zh-CN" — but only when the author hasn't already given us one.
//
// Expansion uses CLDR's likely-subtags data via `Intl.Locale.maximize()`
// (built into the JS runtime — same Unicode-curated dataset every modern
// system uses, no hand-maintained alias table). `maximize()` returns
// language + script + region; we keep language + region and drop the
// script subtag, which HTML/hreflang readers don't expect. Codes the
// runtime can't parse fall through unchanged.
function toBcp47(code: string, _config: VellumConfig): string {
  if (code.includes("-")) return code;
  try {
    const max = new Intl.Locale(code).maximize();
    return max.region ? `${max.language}-${max.region}` : max.language;
  } catch {
    return code;
  }
}

// og:locale wants underscore, not dash ("en_US" not "en-US"). Same mapping.
function toBcp47Underscore(code: string, config: VellumConfig): string {
  return toBcp47(code, config).replace("-", "_");
}

// Swaps the locale prefix of a canonical URL path. "/zh/prism/foo" with
// from=zh, to=en (prefix="") becomes "/prism/foo"; the reverse direction
// re-prepends "/zh". Used to build hreflang alternates.
function swapLocalePrefix(canonicalUrl: string, from: LocaleConfig, to: LocaleConfig): string {
  let stripped = canonicalUrl;
  if (from.prefix) {
    const re = new RegExp(`^/${escapeRegExp(from.prefix)}(?=/|$)`);
    stripped = canonicalUrl.replace(re, "");
    if (stripped === "") stripped = "/";
  }
  if (!to.prefix) return stripped || "/";
  return `/${to.prefix}${stripped === "/" ? "" : stripped}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Absolutize a URL string against the request origin. Already-absolute URLs
// (https://…, //…, data:…, mailto:…) pass through unchanged. Origin-rooted
// paths (/foo) get the origin prepended. Anything else is treated as
// relative to the current page URL.
function absolutize(url: string, origin: string, currentPath?: string): string {
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith("//") || url.startsWith("data:")) {
    return url;
  }
  if (url.startsWith("/")) return `${origin}${url}`;
  const base = currentPath ?? "/";
  // For a page at /repo/foo, a relative "img.png" resolves to /repo/img.png.
  const baseDir = base.endsWith("/") ? base : base.replace(/\/[^/]*$/, "/");
  return `${origin}${baseDir}${url}`;
}

// Find a twitter/x social link and return its handle prefixed with `@`.
// Returns null when there's no matching link or the URL doesn't look like
// a profile URL we can parse.
function pickTwitterHandle(links: SocialLink[] | null | undefined): string | null {
  if (!links?.length) return null;
  for (const link of links) {
    const icon = typeof link.icon === "string" ? link.icon : null;
    if (icon !== "twitter" && icon !== "x") continue;
    const m = link.link.match(/(?:twitter\.com|x\.com)\/(?:#!\/)?@?([A-Za-z0-9_]+)/);
    if (m?.[1]) return `@${m[1]}`;
  }
  return null;
}

interface Crumb {
  name: string;
  url: string;
}

// Build a Home → Repo → Page breadcrumb trail. The URLs stay locale-prefixed
// so the trail makes sense for the reader's current locale.
function buildBreadcrumbs(payload: BootstrapPayload, origin: string): Crumb[] {
  const { route, config } = payload;
  const { site } = config;
  const locale = site.locales.find((l) => l.code === route.localeCode);
  const prefix = locale?.prefix ? `/${locale.prefix}` : "";

  const out: Crumb[] = [{ name: site.title, url: `${origin}${prefix || "/"}` }];

  if (route.repo && route.repoSlug !== site.homepageRepo) {
    out.push({
      name: route.repo.displayName,
      url: `${origin}${prefix}/${route.repoSlug}`,
    });
  }

  if (route.pagePath && route.pagePath !== "index") {
    out.push({
      name: payload.page.meta.title || route.pagePath,
      url: `${origin}${route.canonicalUrl}`,
    });
  }

  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
