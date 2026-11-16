---
title: Search
description: "Per-repo dialog and full-page cross-repo search."
---

# Search

Vellum has two search surfaces, both running the same search in the
reader's browser:

1. A **command-palette dialog** (Ctrl K / Cmd K / `/`) scoped to the
   current repo.
2. A **full-page search** at `/{locale}/search` that fans out across every
   repo in the site.

## How the index works

The build writes one index per repo per locale, at
`/_vellum/search/{locale}/{repo}.json`
([`src/build/search-index.ts`](https://github.com/siiway/vellum/blob/main/app/src/build/search-index.ts)):

1. Takes the repo's pages in that locale, the same ones the build renders.
2. Extracts each page's searchable text: frontmatter `title` /
   `description` / hero blocks + the stripped Markdown body, split into
   sections at its headings.
3. Keeps up to 200 pages per index, and the first 12,000 characters of each.

The first search fetches the indexes it needs; scoring
([`src/shared/search.ts`](https://github.com/siiway/vellum/blob/main/app/src/shared/search.ts))
runs in the browser. The scoring code is its own small chunk, loaded only
when someone searches.

The scoring is intentionally simple: term match in title is worth 5,
match in body is worth 1. Sorted descending, capped at 10 (per-repo) or
30 (cross-repo).

::: note Why no fancy indexer
A 50-page repo's full index is < 50KB. Smarter scoring (BM25, semantic
embeddings) would buy little for this size, and would make the download and
the code bigger.
:::

## The dialog

Triggered by `Ctrl K` (`Cmd K` on macOS) or `/`. Implementation lives in
[`src/web/components/SearchDialog.tsx`](https://github.com/siiway/vellum/blob/main/app/src/web/components/SearchDialog.tsx).

Features:

- Debounced query (180 ms) — typing isn't ratelimited but each keystroke
  doesn't fire a request.
- Keyboard navigation (↑ / ↓ / Enter / Esc).
- Recent searches persisted in localStorage.
- Result grouping by repo (when results come from multiple repos — only
  happens when called from a page that fans out).
- "Search all repos for …" escalation link to the full-page search.

## The full-page search

URL: `/{locale}/search` (`/search` redirects to the default locale's). The
page is an empty shell the build writes for each locale — no markdown, no
sidebar/outline, full viewport.

Authors can link to a pre-populated query:

```md
[Search for "OAuth"](../search?q=OAuth)
```

Behaviour:

- `?q=…` populates the input on load.
- `?repo=<slug>` scopes results to a single repo; omit (or set `*`) for
  cross-repo.
- Repo filter chips below the input toggle the scope.
- URL stays in sync via `history.replaceState` so refresh / share keeps
  the query.
- Tab selection persists for the current group through localStorage.

## Index files

`/_vellum/search/{locale}/{repo}.json` is a static file:

```json
{
  "docs": [
    {
      "url": "/en-US/repo-slug/page-path",
      "title": "Page title",
      "text": "Searchable text of the whole page…",
      "sections": [{ "slug": "install", "title": "Install", "offset": 120 }]
    }
  ]
}
```

`robots.txt` keeps crawlers out of `/_vellum/`.

## Excluding pages from search

There's no explicit `noindex` flag yet. To exclude a page from search,
either:

- Move it out of `docsRoot`.
- Put it under a directory starting with `_` (or name it so). The build
  treats those as partials: it neither renders nor indexes them.

A real `frontmatter.noindex: true` flag is on the roadmap.

## Tuning

If you have a large repo (> 200 markdown files), bump `MAX_DOCS` in
`src/build/search-index.ts`. The limit is intentionally conservative because
readers download the whole index on their first search.
