---
title: Configuration reference
description: "Every field in vellum.config.json explained, with examples."
---

# Configuration reference

Vellum reads one file at startup: `vellum.config.json` at the project root.
Its shape is fully described by a JSON Schema at
`src/shared/site-schema.json` — modern editors will autocomplete and validate
the config when you keep the `"$schema": "./src/shared/site-schema.json"` line
at the top.

The schema is generated from
[`src/shared/types.ts`](https://github.com/siiway/vellum/blob/main/src/shared/types.ts)
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

| Field           | Required | Notes                                                                              |
| --------------- | :------: | ---------------------------------------------------------------------------------- |
| `title`         |    ✓     | Brand name in the NavBar and `<title>` suffix.                                     |
| `homepageRepo`  |    ✓     | Slug of the repo whose root is the landing page. `/` redirects here.               |
| `defaultLocale` |    ✓     | Locale code used when the URL has no locale prefix.                                |
| `locales`       |    ✓     | `[ { code, label, prefix } ]`. Empty `prefix` means the locale lives at repo root. |
| `tagline`       |          | Shown on landing pages with the `home` layout.                                     |
| `logo`          |          | URL of the site logo.                                                              |
| `favicon`       |          | URL of the favicon.                                                                |
| `themeColor`    |          | `<meta name="theme-color">` hex value, e.g. `#0078d4`.                             |
| `footer`        |          | Footer text rendered below every page.                                             |

::: tip One homepage, many sources
Set `homepageRepo` to a local-source repo with `layout: ms-learn` if you want
a Microsoft Learn-style landing page (see [Layouts](./layouts)). The bundled
config does exactly this — the landing page lives in `local-docs/homepage/`.
:::

## RepoConfig

A repo is a slice of documentation — one section in the URL space
(`/<slug>/...`), one sidebar, one search index. You'll typically have one
RepoConfig per actual GitHub repo you're documenting, plus optional local
sources for your handbook and landing page.

| Field             | Required | Notes                                                                                  |
| ----------------- | :------: | -------------------------------------------------------------------------------------- |
| `slug`            |    ✓     | URL segment. Must match `^[a-z0-9][a-z0-9-]*$`.                                        |
| `displayName`     |    ✓     | Shown in the brand crumb and 404 suggestions.                                          |
| `docsRoot`        |    ✓     | Path inside the source to the docs tree. Empty string means the source root.           |
| `source`          |          | `"github"` (default) or `"local"`. See [Sources](./sources).                           |
| `owner`           |    ✓¹    | GitHub owner. Required when `source: "github"`.                                        |
| `repo`            |    ✓¹    | GitHub repo. Required when `source: "github"`.                                         |
| `branch`          |    ✓¹    | Default branch. Required when `source: "github"`. Used as the cache-key suffix.        |
| `localPath`       |          | Override for `local-docs/{slug}`. Local sources only.                                  |
| `description`     |          | Tagline shown on the repo home page and SSR meta description fallback.                 |
| `logo`            |          | Per-repo logo URL.                                                                     |
| `editLinkPattern` |          | Template for "Edit this page" — `:path` is replaced with the docs-root-relative path.  |
| `versions`        |          | Optional version picker. `[ { label, branch, default? } ]`.                            |
| `hideInBrand`     |          | Hides the repo's displayName crumb after the site title. Useful for the homepage repo. |

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
  "versions": [
    { "label": "main", "branch": "main", "default": true },
    { "label": "v1", "branch": "v1" }
  ]
}
```

:::

## NavItem

The site-level top nav. Per-repo navs (from `vellum.json#nav` or VitePress
`themeConfig.nav`) take precedence when a reader is inside that repo.

| Field         | Required | Notes                                                                               |
| ------------- | :------: | ----------------------------------------------------------------------------------- |
| `text`        |    ✓     | Label shown in the NavBar.                                                          |
| `link`        |    ✓²    | Destination URL or site-relative path. Either `link` or `items` is required.        |
| `items`       |    ✓²    | Sub-items, turning the entry into a dropdown.                                       |
| `activeMatch` |          | Regex against the repo-relative path that keeps the entry highlighted in a section. |

² Exactly one of `link` / `items` must be set (enforced by the JSON schema's `oneOf`).

## Environment variables

Set these in `wrangler.jsonc#vars` (or `wrangler secret put` for secrets):

| Var                        |      Default       | Purpose                                                                                                                                |
| -------------------------- | :----------------: | -------------------------------------------------------------------------------------------------------------------------------------- |
| `VELLUM_GITHUB_TOKEN`      |       empty        | Bearer token for `raw.githubusercontent.com` and the GitHub API. Required for private repos and helps with rate limits on public ones. |
| `VELLUM_WEBHOOK_SECRET`    |       empty        | Shared secret for `/api/webhook` HMAC signing. Required for webhook cache busting.                                                     |
| `VELLUM_CACHE_TTL_SECONDS` |       `300`        | TTL for raw markdown / tree / sidebar entries.                                                                                         |
| `VELLUM_HTML_TTL_SECONDS`  |        `60`        | TTL for rendered HTML.                                                                                                                 |
| `VELLUM_KROKI_URL`         | `https://kroki.io` | Override the Kroki endpoint for mermaid SSR. Self-hosters can point at their own instance.                                             |

KV is bound separately in `wrangler.jsonc#kv_namespaces`. Without it, the
worker falls back to the per-edge Cache API alone.

## Regenerating the schema

When you edit `src/shared/types.ts`:

```bash
bun run gen:schema
```

This re-derives `src/shared/site-schema.json` from the TypeScript types,
preserving the curated descriptions, regex patterns, and conditional
requireds defined in `scripts/gen-site-schema.ts`.
