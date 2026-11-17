---
title: Configuration reference
description: "Every field in vellum.config.json explained, with examples."
---

# Configuration reference

Vellum's build reads one file: `app/vellum.config.json`.
Its shape is fully described by a JSON Schema at
`src/shared/site-schema.json` — modern editors will autocomplete and validate
the config when you keep the `"$schema": "./src/shared/site-schema.json"` line
at the top.

The schema is generated from
[`src/shared/types.ts`](https://github.com/siiway/vellum/blob/main/app/src/shared/types.ts)
by `bun run gen:schema`; edit the types if you add new fields.

## Top-level shape

```json
{
  "$schema": "./src/shared/site-schema.json",
  "site": {
    /* SiteConfig */
  },
  "repos": [
    /* RepoConfig, ... */
  ],
  "nav": [
    /* NavItem, ... */
  ]
}
```

`site` and `repos` are required; `nav` is optional and is the **site-level**
top navigation (each repo can override it with `vellum.json#nav`).

## SiteConfig

| Field           | Required | Notes                                                                               |
| --------------- | :------: | ----------------------------------------------------------------------------------- |
| `title`         |    ✓     | Brand name in the NavBar and `<title>` suffix.                                      |
| `homepageRepo`  |    ✓     | Slug of the repo whose root is the landing page, served at `/{prefix}`.             |
| `defaultLocale` |    ✓     | Locale that URLs without a locale prefix go to, and `/` falls back to.              |
| `locales`       |    ✓     | `[ { code, label, prefix } ]`. An empty `prefix` serves the locale without one.     |
| `tagline`       |          | Shown on landing pages with the `home` layout.                                      |
| `logo`          |          | URL of the site logo.                                                               |
| `favicon`       |          | URL of the favicon.                                                                 |
| `themeColor`    |          | Accent hex (buttons, links, focus) and `<meta name="theme-color">`, e.g. `#0078d4`. |
| `footer`        |          | Footer text rendered below every page.                                              |
| `url`           |          | Public origin, e.g. `https://docs.example.com`. See below.                          |
| `socialLinks`   |          | NavBar icon links, `[ { icon, link, ariaLabel? } ]`, as in VitePress.               |
| `searchAliases` |          | Search synonyms, `{ term: [synonyms] }`. See [Search](./search#synonyms).           |
| `contentSignal` |          | How AI may use the content, `{ search, "ai-input", "ai-train" }`. See below.        |

`url` makes the canonical, Open Graph and hreflang URLs in each page's head
absolute, and is what the sitemap needs. Without it those URLs stay
root-relative, `og:url` is left out, and the build writes no `sitemap.xml`.

`contentSignal` states how AI may use the site's content, as a
[Content-Signal](https://contentsignals.org) line in `robots.txt`. Each of
`search` (search engines), `ai-input` (as input to an AI's answer) and
`ai-train` (training models) is `true` or `false`; one left out states no
preference.

```json
"contentSignal": { "search": true, "ai-input": true, "ai-train": false }
```

writes `Content-Signal: search=yes, ai-input=yes, ai-train=no`.

::: tip One homepage, many sources
Set `homepageRepo` to a local-source repo with `layout: ms-learn` if you want
a Microsoft Learn-style landing page (see [Layouts](./layouts)). The bundled
config does exactly this — the landing page lives in `local-docs/homepage/`.
:::

## RepoConfig

A repo is a slice of documentation — one section in the URL space
(`/{prefix}/{slug}/...`), one sidebar, one search index. You'll typically have one
RepoConfig per actual GitHub repo you're documenting, plus optional local
sources for your handbook and landing page.

| Field               | Required | Notes                                                                                  |
| ------------------- | :------: | -------------------------------------------------------------------------------------- |
| `slug`              |    ✓     | URL segment. Must match `^[a-z0-9][a-z0-9-]*$`.                                        |
| `displayName`       |    ✓     | Shown in the brand crumb and 404 suggestions.                                          |
| `docsRoot`          |    ✓     | Path inside the source to the docs tree. Empty string means the source root.           |
| `source`            |          | `"github"` (default) or `"local"`. See [Sources](./sources).                           |
| `owner`             |    ✓¹    | GitHub owner. Required when `source: "github"`.                                        |
| `repo`              |    ✓¹    | GitHub repo. Required when `source: "github"`.                                         |
| `branch`            |    ✓¹    | Branch the build clones. Required when `source: "github"`.                             |
| `localPath`         |          | Override for `local-docs/{slug}`. Local sources only.                                  |
| `description`       |          | Description of the repo's index page when its frontmatter sets none.                   |
| `logo`              |          | Per-repo logo URL.                                                                     |
| `editLinkPattern`   |          | Template for "Edit this page" — `:path` is replaced with the docs-root-relative path.  |
| `versions`          |          | `[ { label, branch, default? } ]`. Only the `default` entry (else the first) is built. |
| `localeDirs`        |          | Source directory per locale code. See [i18n](./i18n#per-repo-content-layout).          |
| `landingPage`       |          | Path the repo's root URL redirects to, e.g. `"v0.4"` for docs versioned by directory.  |
| `hideInBrand`       |          | Hides the repo's displayName crumb after the site title. Useful for the homepage repo. |
| `excludeFromSearch` |          | Leaves the repo out of cross-repo search, e.g. the homepage repo.                      |
| `socialLinks`       |          | NavBar icon links inside this repo, instead of the site's.                             |
| `searchAliases`     |          | Search synonyms for this repo, on top of the site's.                                   |

¹ Conditionally required: the JSON schema enforces `owner` / `repo` / `branch`
when `source` is `"github"` (or omitted).

::: details Full example

```json
{
  "slug": "prism",
  "owner": "siiway",
  "repo": "prism",
  "branch": "main",
  "docsRoot": "docs",
  "displayName": "Prism",
  "description": "Self-hosted OAuth 2.0 / OpenID Connect on Cloudflare Workers.",
  "logo": "https://icons.siiway.org/prism/icon.svg",
  "editLinkPattern": "https://github.com/siiway/prism/edit/main/docs/:path",
  "searchAliases": { "idp": ["identity provider", "oidc"] }
}
```

:::

## NavItem

The site-level top nav. Per-repo navs (from `vellum.json#nav` or VitePress
`themeConfig.nav`) take precedence when a reader is inside that repo.

| Field         | Required | Notes                                                                           |
| ------------- | :------: | ------------------------------------------------------------------------------- |
| `text`        |    ✓     | Label shown in the NavBar.                                                      |
| `link`        |    ✓²    | Destination URL or site-relative path. Either `link` or `items` is required.    |
| `items`       |    ✓²    | Sub-items, turning the entry into a dropdown.                                   |
| `activeMatch` |          | Regex against the page's path in the docs (`/zh/guide/intro`), as in VitePress. |

² Exactly one of `link` / `items` must be set (enforced by the JSON schema's `oneOf`).

## Environment variables

The build reads these from its environment:

| Var                   |      Default       | Purpose                                                                                     |
| --------------------- | :----------------: | ------------------------------------------------------------------------------------------- |
| `VELLUM_GITHUB_TOKEN` |       empty        | Token for cloning private repos. Public repos don't need it.                                |
| `VELLUM_KROKI_URL`    | `https://kroki.io` | Override the Kroki endpoint for mermaid rendering. Self-hosters can point at their own one. |

In GitHub Actions, set `VELLUM_GITHUB_TOKEN` as a repository secret; the
workflows pass it to the build. The deployed site needs no variables or
bindings: it's static assets only.

## Regenerating the schema

When you edit `src/shared/types.ts`:

```bash
bun run gen:schema
```

This re-derives `src/shared/site-schema.json` from the TypeScript types,
preserving the curated descriptions, regex patterns, and conditional
requireds defined in `scripts/gen-site-schema.ts`.
