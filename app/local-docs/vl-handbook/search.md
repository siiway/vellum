---
title: Search
description: "Per-repo dialog and full-page cross-repo search."
---

# Search

Vellum has two search surfaces, both running the same search in the
reader's browser:

1. A **command-palette dialog** (Ctrl K / Cmd K / `/`) scoped to the
   current repo.
2. A **full-page search** at `/{prefix}/search` that fans out across every
   repo in the site, except those with `excludeFromSearch`.

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

::: note Why no fancy indexer
A 50-page repo's full index is < 50KB. Smarter scoring (BM25, semantic
embeddings) would buy little for this size, and would make the download and
the code bigger.
:::

## Query syntax

| Query          | Finds                                           |
| -------------- | ----------------------------------------------- |
| `oauth setup`  | pages with every word, in the title or body     |
| `"exact text"` | pages containing the phrase                     |
| `-term`        | leaves out pages containing the term            |
| `title:foo`    | pages whose title contains `foo`                |
| `repo:slug`    | only that repo (useful in the full-page search) |

A word in the title scores 5 and in the body 1; a phrase scores 8 and 3; a
`title:` term scores 10. Results are sorted by score: the dialog shows the
top 10, the full-page search the top 30.

## Synonyms

Each word also matches its synonyms, so a search for `latex` finds pages
that say `mathjax`. A synonym match scores less (2 in the title, 0.4 in the
body), so pages using the word itself come first. A built-in list covers
common terms (math, auth, config, install, …). Add your own with
`searchAliases`, on the site or on a repo:

```json
"searchAliases": { "idp": ["identity provider", "oidc"] }
```

A key replaces the built-in entry of the same name, and a repo's entries
replace the site's. Synonyms work one way: list both directions if you want
both.

## The dialog

Triggered by `Ctrl K` (`Cmd K` on macOS) or `/`. Implementation lives in
[`src/web/components/SearchDialog.tsx`](https://github.com/siiway/vellum/blob/main/app/src/web/components/SearchDialog.tsx).

Features:

- Debounced (180 ms): the search runs when typing pauses.
- Keyboard navigation (↑ / ↓ / Enter / Esc).
- Recent searches persisted in localStorage.
- "Search all repos for …" escalation link to the full-page search.

## The full-page search

URL: `/{prefix}/search` (`/search` redirects to the default locale's). The
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
- Recent searches are shared with the dialog.

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

To leave a whole repo out of cross-repo search, set `excludeFromSearch` on
it, as the bundled config does for the homepage repo. A real
`frontmatter.noindex: true` flag for single pages is on the roadmap.

## Tuning

If you have a large repo (> 200 markdown files), bump `MAX_DOCS` in
`src/build/search-index.ts`. The limit is intentionally conservative because
readers download the whole index on their first search.
