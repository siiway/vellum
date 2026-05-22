---
title: "Sources: GitHub & local"
description: "Where Vellum reads Markdown from, and how to choose."
---

# Sources

Every repo in `vellum.config.json` has a `source` field that decides where the
worker reads its Markdown. The dispatcher in
[`src/worker/sources.ts`](https://github.com/siiway/vellum/blob/main/src/worker/sources.ts)
hides the difference from the rest of the worker — routing, sidebar, search,
xref, and the OPS extensions all work identically for either source.

## GitHub source (`source: "github"`)

The default. The worker fetches raw files from
`https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}` and caches
the response in the Cache API (and KV when bound).

```json
{
  "slug": "prism",
  "owner": "siiway",
  "repo": "prism",
  "branch": "main",
  "docsRoot": "docs",
  "displayName": "Prism"
}
```

::: tip Auth
Public repos work unauthenticated, but you'll hit GitHub's 60 req/hour
unauthenticated rate limit fast in dev. Set `VELLUM_GITHUB_TOKEN` to a PAT
with `repo` scope (private repos) or just `public_repo` (public).
:::

### Tree enumeration

The sidebar fallback and search index need to list every Markdown file in
`docsRoot`. We use GitHub's
[git/trees API](https://docs.github.com/en/rest/git/trees) with
`?recursive=1` and cache the result alongside the raw files.

### Last-updated info

`fetchSourceLastCommit` calls `GET /repos/{owner}/{repo}/commits?path=…` and
displays the most recent commit on the page footer. Cached for the same TTL
as raw files.

### Cache invalidation

Tracked via webhook — see [Caching & deployment](./caching-and-deployment#webhooks).

## Local source (`source: "local"`)

Markdown lives in a directory under the project root and is bundled into the
worker's `ASSETS` at build time:

```json
{
  "slug": "vl-handbook",
  "source": "local",
  "docsRoot": "",
  "displayName": "Vellum Handbook"
}
```

By default the worker looks under `local-docs/{slug}/`; override with
`localPath` if you want a different directory.

### The Vite plugin

`scripts/vite-local-docs.ts` runs during `bun run build:client`. It:

1. Scans every directory under `local-docs/`.
2. Emits each file as a Vite asset at `dist/client/local-docs/{slug}/{relpath}` —
   no Rollup hashing so the worker can fetch by literal path.
3. Writes a `manifest.json` next to each repo that lists every file path and size.

The worker reads files via `env.ASSETS.fetch("/local-docs/{slug}/{path}")` and
reads `manifest.json` for tree enumeration.

### Why use local sources

- **Docs that ship with the worker.** This handbook is a local source.
- **Landing pages.** The `homepage` repo in the bundled config is local —
  it has structured `layout: ms-learn` frontmatter that doesn't make sense
  in a code repo.
- **Air-gapped deploys.** When the worker can't reach github.com.
- **Tests / scaffolding.** Quick local content without committing to a
  separate repo first.

### What's different for local

| Affordance            | Status for local                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Last-updated footer   | Skipped — no git history available to the worker.                                                                  |
| Edit-on-GitHub button | Skipped unless `editLinkPattern` is set (and even then, "edit" goes to GitHub, which would require a manual sync). |
| Webhook cache busting | N/A — invalidate by rebuilding and redeploying the worker.                                                         |
| Tree listing          | Reads `manifest.json` instead of the GitHub tree API.                                                              |
| Per-file fetch        | `env.ASSETS.fetch()` (in-region, sub-ms) instead of `raw.githubusercontent.com`.                                   |

## Mixing sources

You can have any combination of GitHub and local repos in the same site.
The bundled config has both:

```json
{
  "repos": [
    {
      "slug": "prism",
      "source": "github",
      "owner": "siiway",
      "repo": "prism",
      "branch": "main",
      "docsRoot": "docs",
      "displayName": "Prism"
    },
    {
      "slug": "glint",
      "source": "github",
      "owner": "siiway",
      "repo": "glint",
      "branch": "main",
      "docsRoot": "docs",
      "displayName": "Glint"
    },
    {
      "slug": "vl-handbook",
      "source": "local",
      "docsRoot": "",
      "displayName": "Vellum Handbook"
    },
    {
      "slug": "homepage",
      "source": "local",
      "docsRoot": "",
      "displayName": "SiiWay Documentation",
      "hideInBrand": true
    }
  ]
}
```

::: note Slug uniqueness
Slugs must be unique across the whole site — the worker uses them as the
top-level URL segment, the cache-key prefix, and the search-index key.
The JSON schema doesn't enforce this; the dispatcher's `find()` just picks
the first match.
:::

## Cross-source links

Markdown links between repos use the `@slug/path` shorthand, which the
worker resolves to `/slug/path` regardless of source:

```md
See [the Prism quickstart](@prism/getting-started) for the OAuth flow.
```

xref (`<xref:Uid>` and `[text](xref:Uid)`) works the same way — the
xrefmap is loaded per-repo and resolution happens against whichever repo
the page belongs to.
