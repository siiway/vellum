---
title: "Sources: GitHub & local"
description: "Where Vellum reads Markdown from, and how to choose."
---

# Sources

Every repo in `vellum.config.json` has a `source` field that decides where the
build reads its Markdown. Either way the repo ends up as a directory on disk,
and
[`src/build/sources.ts`](https://github.com/siiway/vellum/blob/main/app/src/build/sources.ts)
hides the difference from the rest of the build — pages, sidebar, search,
xref, and the OPS extensions all work identically for either source.

## GitHub source (`source: "github"`)

The default. The build clones the repo into `app/.sources/{slug}` at
`branch` (or the default entry of `versions`), and later builds update that
clone. It's a partial clone (`--filter=blob:none`): the full history, which
"last updated" needs, but only the files of the current commit.

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
Public repos clone unauthenticated. For private repos, set
`VELLUM_GITHUB_TOKEN` to a token that can read them (a fine-grained PAT with
Contents: read is enough). It's sent as a header, never stored in the clone.
:::

### Last-updated info

The page footer shows the most recent commit that touched the page's file,
from one `git log` pass over the clone per build.

### Picking up new commits

A build is a snapshot of each repo. `bun run update` re-renders only the
repos whose branch moved since the last build; the **Update content**
workflow runs it hourly and on demand. See
[Updating content](./updating-content).

## Local source (`source: "local"`)

Markdown lives in a directory under `app/`, in the same repository as Vellum:

```json
{
  "slug": "vl-handbook",
  "source": "local",
  "docsRoot": "",
  "displayName": "Vellum Handbook"
}
```

By default the build reads `local-docs/{slug}/`; override with `localPath`
if you want a different directory.

### Why use local sources

- **Docs that ship with Vellum.** This handbook is a local source.
- **Landing pages.** The `homepage` repo in the bundled config is local —
  it has structured `layout: ms-learn` frontmatter that doesn't make sense
  in a code repo.
- **Offline builds.** No clone, no network.
- **Tests / scaffolding.** Quick local content without committing to a
  separate repo first.

### What's different for local

| Affordance            | Status for local                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Last-updated footer   | Skipped — the build doesn't read this repository's history.                                                        |
| Edit-on-GitHub button | Skipped unless `editLinkPattern` is set (and even then, "edit" goes to GitHub, which would require a manual sync). |
| Publishing an edit    | Commit it here: the push deploys the site. An incremental update skips local repos.                                |

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
Slugs must be unique across the whole site — the build uses them as the
URL segment after the locale prefix, the clone directory, and the
search-index key. The JSON schema doesn't enforce this; lookups just pick the
first match.
:::

## Cross-source links

Markdown links between repos use the `@slug/path` shorthand, which the
build resolves to `/{prefix}/slug/path` regardless of source:

```md
See [the Prism quickstart](@prism/getting-started) for the OAuth flow.
```

xref (`<xref:Uid>` and `[text](xref:Uid)`) works the same way — the
xrefmap is loaded per-repo and resolution happens against whichever repo
the page belongs to.
