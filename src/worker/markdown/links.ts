// Link rewriting:
//   - `.md` suffixes inside the docs are stripped so navigation goes through the SPA router
//   - relative paths are resolved against the current page's path within the repo
//   - external links get target=_blank and a small icon
//   - cross-repo xrefs of the form `@repo-slug/path/to/page` are rewritten to site-absolute URLs

import type MarkdownIt from "markdown-it";

export interface LinkContext {
  // canonical URL of the current page, e.g. "/prism/getting-started"
  currentUrl: string;
  // base URL prefix for this repo, e.g. "/prism" or "/prism/zh" when localized
  repoUrlBase: string;
  // active locale prefix, e.g. "zh"; empty string for the root locale. Used by
  // normalizeInternal to detect and dedupe author-written `/zh/...` paths on a
  // page whose repoUrlBase already ends with `/zh`.
  localePrefix: string;
  // True when the current page renders an index file (its URL is a
  // directory in URL space — e.g. "/vl-handbook" maps to
  // vl-handbook/index.md). Relative links from an index resolve INSIDE
  // that directory; without this flag, the trailing-slash-less canonical
  // URL would make `./foo` resolve to `/foo` instead of `/repo/foo`.
  pageIsIndex: boolean;
  // resolve a cross-repo xref `@otherRepo/page` to a site URL, or null if unknown.
  resolveXref: (slug: string, rest: string) => string | null;
}

function isExternal(href: string): boolean {
  return /^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:");
}

function isAnchor(href: string): boolean {
  return href.startsWith("#");
}

export function applyLinks(md: MarkdownIt, ctx: () => LinkContext) {
  const defaultRender =
    md.renderer.rules.link_open ||
    function (tokens, idx, opts, _env, self) {
      return self.renderToken(tokens, idx, opts);
    };

  md.renderer.rules.link_open = function (tokens, idx, opts, env, self) {
    const c = ctx();
    const token = tokens[idx]!;
    const hrefAttr = token.attrGet("href");
    if (hrefAttr) {
      // Cross-repo xref.
      if (hrefAttr.startsWith("@")) {
        const m = hrefAttr.match(/^@([a-z0-9-]+)\/(.*)$/i);
        if (m) {
          const resolved = c.resolveXref(m[1]!, m[2]!);
          if (resolved) token.attrSet("href", resolved);
        }
      } else if (isExternal(hrefAttr)) {
        token.attrSet("target", "_blank");
        token.attrSet("rel", "noopener noreferrer");
        token.attrJoin("class", "vellum-external-link");
      } else if (!isAnchor(hrefAttr)) {
        token.attrSet("href", normalizeInternal(hrefAttr, c));
        token.attrJoin("class", "vellum-internal-link");
      } else {
        token.attrJoin("class", "vellum-anchor-link");
      }
    }
    return defaultRender(tokens, idx, opts, env, self);
  };
}

function normalizeInternal(href: string, c: LinkContext): string {
  // Strip query / hash, preserve to reattach.
  const hashIdx = href.indexOf("#");
  const queryIdx = href.indexOf("?");
  let path = href;
  let suffix = "";
  if (hashIdx >= 0 || queryIdx >= 0) {
    const cut = [hashIdx, queryIdx]
      .filter((n) => n >= 0)
      .reduce((a, b) => Math.min(a, b), Infinity);
    path = href.slice(0, cut);
    suffix = href.slice(cut);
  }

  // Drop trailing .md and /index suffixes.
  path = path.replace(/\.md$/i, "").replace(/\/index$/i, "/");

  if (path.startsWith("/")) {
    return `${path}${suffix}`;
  }

  // Resolve relative to the current page's directory. The router strips
  // trailing slashes from canonical URLs, so we have to figure out
  // ourselves whether the URL points at a file or a directory:
  //   - Index page (URL like `/vl-handbook`)  → URL IS the directory.
  //   - Sub-page  (URL like `/vl-handbook/x`) → directory is the URL up
  //     to and including the last slash.
  // Without this index check, `./foo` from /vl-handbook would resolve to
  // /foo (treating the slug like a file in the root) instead of the
  // intended /vl-handbook/foo.
  let base: string;
  if (c.pageIsIndex) {
    base = c.currentUrl.endsWith("/") ? c.currentUrl : `${c.currentUrl}/`;
  } else if (c.currentUrl.endsWith("/")) {
    base = c.currentUrl;
  } else {
    base = c.currentUrl.slice(0, c.currentUrl.lastIndexOf("/") + 1);
  }
  const url = new URL(path, `https://x${base}`);
  return `${url.pathname}${suffix}`;
}
