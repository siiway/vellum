---
title: Updating content
description: "Publish new commits from docs repos with an incremental update."
---

# Updating content

A build is a snapshot of every docs repo. When a GitHub-backed repo gets new
commits, an **incremental update** publishes them: it re-renders only the
repos that changed and keeps every other page from the last build.

::: tip Local repos
Local repos live in this repository, so their edits ship with a deploy of
the app (a push to `main`), not with an update.
:::

## How it works

```bash
bun run update
```

1. Reads `dist/state.json`, which the last build left: the commit it was
   built from, and for each repo the commit and the pages it rendered.
2. Asks GitHub for each repo's current commit (`git ls-remote`, no clone).
3. For each repo whose commit moved: fetches it, deletes its old pages,
   search indexes and Vue components, and renders it again.
4. Rewrites `sitemap.xml` and the state.

Unchanged repos aren't fetched or rendered, so an update with nothing to do
takes a few seconds. A whole repo is re-rendered rather than single pages,
because a page also depends on its repo's sidebar, its neighbours, its
includes and the repo's config.

When there's no last build, or it was built from another commit of this
repository (the app, the config or a local doc changed), only a full build
is correct, and `bun run update` runs one.

Then deploy as usual: `bunx wrangler deploy` uploads only the files that
changed.

## The Update content workflow

`.github/workflows/update-content.yml` runs the update in GitHub Actions and
deploys when something changed:

- **Hourly**, so new commits show up within the hour with no setup in the
  docs repos.
- **On `repository_dispatch`** with the type `update-content`, so a docs repo
  can publish right after a push (below).
- **By hand**, from the Actions tab.

It restores the last build from the Actions cache, where the **Deploy**
workflow (or its own previous run) left it, and checks out the commit of
this repository that build was made from, so it doesn't ship app changes
that haven't been through Deploy. Without a cached build (the cache was
evicted), it runs a full build of `main`.

## Publishing on push

To publish a docs repo's commits right away, add this workflow to it:

```yaml
# .github/workflows/vellum.yml in the docs repo
name: Publish docs
on:
  push:
    branches: [main]
    paths: ["docs/**"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: gh api repos/siiway/vellum/dispatches -f event_type=update-content
        env:
          GH_TOKEN: ${{ secrets.VELLUM_DISPATCH_TOKEN }}
```

`VELLUM_DISPATCH_TOKEN` is a secret in the docs repo: a fine-grained token
with **Contents: Read and write** on the Vellum repository (that's what
`repository_dispatch` requires). Change `paths` to the repo's `docsRoot`.

Several pushes in a row are fine: a run that starts while another is going
waits for it, and a run that finds nothing new doesn't deploy.

## Troubleshooting

::: details A new commit isn't on the site
Check the latest **Update content** run. Its log names the repos it
re-rendered, or says nothing changed. If the repo isn't listed, check that
the commit is on the branch in `vellum.config.json` (or the default entry
of `versions`).
:::

::: details I want to rebuild everything
Run the **Deploy** workflow by hand. It builds every page from scratch, and
its build becomes the one the next update starts from.
:::
