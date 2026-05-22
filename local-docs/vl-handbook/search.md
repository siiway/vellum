---
title: Search
description: "Per-repo dialog and full-page cross-repo search."
---

# Search

Vellum has two search surfaces, both backed by the same `/api/search`
endpoint:

1. A **command-palette dialog** (Ctrl K / Cmd K / `/`) scoped to the
   current repo.
2. A **full-page search** at `/search` that fans out across every repo in
   the site.

## How the index works

`src/worker/search.ts` builds a tiny inverted index per repo + locale on
first request:

1. Walks the source tree (GitHub trees API or local `manifest.json`).
2. Filters to Markdown files under `docsRoot` for the current locale.
3. Fetches each file (in parallel, capped at 200) and extracts the
   searchable text: frontmatter `title` / `description` / hero blocks +
   the stripped Markdown body.
4. Caches the result in KV / Cache API for `VELLUM_CACHE_TTL_SECONDS × 4`
   so subsequent queries against the same repo are O(query).

The scoring is intentionally simple: term match in title is worth 5,
match in body is worth 1. Sorted descending, capped at 10 (per-repo) or
30 (cross-repo).

::: note Why no fancy indexer
A 50-page repo's full index is < 50KB. Smarter scoring (BM25, semantic
embeddings) would buy little for this size, and would push the cold-start
cost up. The current implementation cold-starts in ~500ms.
:::

## The dialog

Triggered by `Ctrl K` (`Cmd K` on macOS) or `/`. Implementation lives in
[`src/app/components/SearchDialog.tsx`](https://github.com/siiway/vellum/blob/main/src/app/components/SearchDialog.tsx).

Features:

- Debounced query (180 ms) — typing isn't ratelimited but each keystroke
  doesn't fire a request.
- Keyboard navigation (↑ / ↓ / Enter / Esc).
- Recent searches persisted in localStorage.
- Result grouping by repo (when results come from multiple repos — only
  happens when called from a page that fans out).
- "Search all repos for …" escalation link to the full-page search.

## The full-page search

URL: `/search` (or `/{locale}/search` for non-default locales). The page
declares its own layout via the worker — no markdown, no sidebar/outline,
full viewport.

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

## API surface

`GET /api/search` returns JSON. Parameters:

| Param    | Required | Notes                                                                     |
| -------- | :------: | ------------------------------------------------------------------------- |
| `q`      |    ✓     | Search query.                                                             |
| `repo`   |          | Repo slug to scope to, or `*` for cross-repo. Defaults to `homepageRepo`. |
| `locale` |          | Locale code. Defaults to `defaultLocale`.                                 |
| `limit`  |          | Max hits per repo (clamped to 1–50). Default 10.                          |
| `all`    |          | Set `1` as a shortcut for `repo=*`.                                       |

Response:

```json
{
  "hits": [
    {
      "url": "/repo-slug/page-path",
      "title": "Page title",
      "excerpt": "...<mark>highlighted term</mark>...",
      "repo": "repo-slug",
      "repoDisplayName": "Repo Display Name"
    }
  ]
}
```

## Excluding pages from search

There's no explicit `noindex` flag yet. To exclude a page from search,
either:

- Move it out of `docsRoot`.
- Mark it `_internal` in the path (the indexer skips anything under
  `_*` directories on the assumption it's a partial / private artifact —
  though this isn't strict; double-check by querying).

A real `frontmatter.noindex: true` flag is on the roadmap.

## Tuning

If you have a large repo (> 200 markdown files), bump the `MAX` constant in
`src/worker/search.ts`. The current limit is intentionally conservative
because cold-start time scales linearly with corpus size.
