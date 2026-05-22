---
title: Getting Started
description: "Install Vellum, point it at a repo, and ship a docs site to Cloudflare."
---

# Getting Started

This guide walks from a fresh clone to a deployed docs site in about ten
minutes. We assume you already have:

- **Node 22+** and **Bun 1.1+** installed (Bun is the package manager + script
  runner; Vite runs through it).
- A **Cloudflare account** with a workers subdomain enabled.
- A **GitHub personal access token** with `repo` scope (only if you'll fetch
  from private repos; public repos work unauthenticated).

::: tip Use what's already in the box
The default `vellum.config.json` in the repo wires up two real SiiWay projects
(`siiway/prism`, `siiway/glint`) plus this local handbook. You can run the
worker against that config with no edits and play with the surface before
plugging in your own content.
:::

## 1. Clone and install

```bash
git clone https://github.com/siiway/vellum.git
cd vellum
bun install
```

## 2. Develop locally

```bash
bun run dev
```

This runs `vite build` once (so the client bundle and `local-docs` assets are
on disk), then starts `wrangler dev` on `http://127.0.0.1:8787`. The worker
auto-reloads on changes; the client bundle needs another `bun run build:client`
when you edit React code.

::: note
The first request to any GitHub-backed page takes ~500ms while the worker
fetches the markdown and runs Shiki + Mermaid. Subsequent requests hit the
edge cache and return in single-digit milliseconds.
:::

## 3. Configure your repos

Open [`vellum.config.json`](./configuration) and replace the bundled examples
with your own. The minimum viable repo entry is:

# [GitHub source](#tab/github)

```json
{
  "slug": "my-docs",
  "owner": "your-github-org",
  "repo": "my-repo",
  "branch": "main",
  "docsRoot": "docs",
  "displayName": "My Docs"
}
```

The worker pulls Markdown from
`https://raw.githubusercontent.com/your-github-org/my-repo/main/docs/...`.

# [Local source](#tab/local)

```json
{
  "slug": "my-docs",
  "source": "local",
  "docsRoot": "",
  "displayName": "My Docs"
}
```

Drop `.md` files into `local-docs/my-docs/`. The Vite plugin bundles them
into the worker's `ASSETS` at build time and emits a `manifest.json` that the
worker uses for tree enumeration.

---

See [Sources](./sources) for the full comparison and other config options.

## 4. Author a page

Create `docs/index.md` (or `local-docs/my-docs/index.md`):

````md
---
title: My Docs
description: A short tagline.
---

# Welcome

This page uses **Markdown**, plus a few Vellum extras:

::: tip
Callouts work like in VitePress.
:::

```mermaid
flowchart LR
  A --> B
```
````

`​``

````

Reload the dev server — the page is at `/my-docs/`.

## 5. Deploy

When you're ready to push to Cloudflare:

```bash
bun run deploy
````

`bun run deploy` runs the client build, then `wrangler deploy` which uploads
both the worker and the static assets (including bundled `local-docs/...`).
You'll see a `https://vellum.<your-subdomain>.workers.dev` URL when it
finishes.

::: warning Set up GitHub webhook for cache invalidation
By default the edge cache holds rendered HTML for 60 seconds. If you publish
often, point a `push` webhook from each GitHub-backed repo at
`https://your-worker.example/api/webhook`. The worker uses the payload's
`commits[]` to invalidate exactly the touched cache entries.
See [Caching & deployment](./caching-and-deployment#webhooks).
:::

## What works for which source

| Feature               | GitHub source | Local source |
| --------------------- | :-----------: | :----------: |
| Markdown render       |       ✓       |      ✓       |
| Sidebar discovery     |       ✓       |      ✓       |
| Search index          |       ✓       |      ✓       |
| OPS extensions        |       ✓       |      ✓       |
| Mermaid SSR via Kroki |       ✓       |      ✓       |
| Math (MathJax)        |       ✓       |      ✓       |
| xref resolution       |       ✓       |      ✓       |
| "Last updated" footer |       ✓       |      —       |
| Edit-on-GitHub button |       ✓       |      —       |
| Webhook cache busting |       ✓       |      —       |

Local repos skip last-updated and edit-link affordances because there's no
remote to ask about commits, and they're cache-busted by rebuilding the
worker rather than via webhook.

## Next steps

- Browse the [Configuration reference](./configuration) for every setting.
- Skim [Markdown features](./markdown) and [OPS extensions](./ops-extensions)
  to learn what your authors can write.
- See [Internationalisation](./i18n) before adding non-English content — the
  URL prefix shape is best decided up front.
