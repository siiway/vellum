---
title: Build & deployment
description: "How Vellum builds a static site from your docs repos and deploys it to Cloudflare."
---

# Build & deployment

Vellum is a static site generator: the build renders every page ahead of
time, and Cloudflare serves the result as
[Workers static assets](https://developers.cloudflare.com/workers/static-assets/),
with no code running per request.

## The build

Run in `app/`:

| Command                          | What it does                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `bun run build`                  | `build:client`, then `build:pages`.                                                 |
| `bun run build:client`           | Vite builds the React client into `dist/client`.                                    |
| `bun run build:pages`            | Clones or updates every GitHub repo, then renders every page to `dist/site`.        |
| `bun run build:pages --no-fetch` | The same from the clones already in `.sources/`.                                    |
| `bun run update`                 | Re-renders only the repos that changed. See [Updating content](./updating-content). |
| `bun run deploy`                 | `bun run build`, then `wrangler deploy`.                                            |

`build:pages` needs the client build: every page links its hashed bundles.

### What it writes

```
dist/site/
  index.html                       / — picks a locale, then redirects
  404.html, {prefix}/404.html      the 404 page, per locale
  {prefix}/index.html              the landing page (homepage repo)
  {prefix}/{repo}/…/index.html     one per page
  {prefix}/search/, languages/     search and language pages
  _vellum/pages/{page}.json        each page's data, for client navigation
  _vellum/search/{locale}/{repo}.json   search indexes
  _vellum/vue/{repo}/{Name}.vue    Vue components the pages mount
  _redirects, _headers             applied by Cloudflare
  robots.txt, sitemap.xml
  .well-known/                     files for AI agents, see below
  assets/                          the client bundle
```

Each page's HTML is complete: pre-rendered markup, styles, SEO head and
the data the client hydrates from. Following a link inside the site fetches
only the next page's JSON from `_vellum/pages/`.

Pages are rendered in the light theme. A script in each page's head switches
to dark before the first paint when the reader picked dark, or their system
is dark.

The build is deterministic: rebuilding unchanged sources gives the same
files, apart from diagrams Kroki draws differently each time. `wrangler
deploy` uploads only files whose content changed.

### External services

| Service | Used for                             | Configurable                           |
| ------- | ------------------------------------ | -------------------------------------- |
| GitHub  | Cloning docs repos                   | `VELLUM_GITHUB_TOKEN` (private repos)  |
| Kroki   | Mermaid diagrams (both light + dark) | `VELLUM_KROKI_URL` env var (self-host) |

Both are only used by the build. If Kroki is unreachable, a diagram ships
without its SVG, and the reader's browser renders it with mermaid instead.

## Caching

`_headers` makes the hashed bundles under `/assets/` immutable for a year.
Everything else is served with Cloudflare's default for static assets: the
browser revalidates and gets a `304` while the file is unchanged. A deploy
is visible at once; there is no cache to purge.

## AI agents

The site tells AI agents what it holds and how they may use it, with static
files only:

- `robots.txt` states a [Content Signal](https://contentsignals.org), how AI
  may use the content, from
  [`site.contentSignal`](./configuration#siteconfig).
- `/.well-known/agent-skills/index.json` lists one
  [agent skill](https://agentskills.io), `{host}/SKILL.md`: which docs the
  site holds, in which languages, and how to find a page. `{host}` is the
  site's host with hyphens for dots, e.g. `docs-example-com`.
- `/.well-known/ai-catalog.json` is an
  [ARD](https://agenticresourcediscovery.org) catalog listing the same skill.
- `/` answers with `Link` headers pointing to both.
- Every page offers a `search_docs`
  [WebMCP](https://webmachinelearning.github.io/webmcp/) tool to agents
  working in the reader's browser. It runs the site search, and is skipped in
  browsers without WebMCP.

The `.well-known` files and the `Link` headers need `site.url`, like the
sitemap. All of it comes from the config, so `bun run update` leaves it as
it is.

Agent-readiness checkers also look for markdown served on
`Accept: text/markdown`, API and OAuth metadata, and MCP servers. Those need
code running per request, or an API the site doesn't have, so a Vellum site
has none of them.

## Deploying

```bash
bun run deploy
```

To deploy somewhere other than production, use the `preview` environment in
`wrangler.jsonc` (`workers.dev`, no custom domain):

```bash
bun run build && bunx wrangler deploy --env preview
```

### GitHub Actions

Two workflows deploy production:

| Workflow           | Runs on                                    | Does                                                        |
| ------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| **Deploy**         | Push to `main`, or a manual run (redeploy) | Checks, full build, deploy.                                 |
| **Update content** | Hourly, `repository_dispatch`, manual run  | Re-renders the docs repos that changed; deploys if any did. |

Both need `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, plus Workers
Routes:Edit and Zone:Read for custom domains), and `VELLUM_GITHUB_TOKEN`
for private docs repos. Update content skips itself while a Deploy is
running or queued, so the two never overlap. See
[Updating content](./updating-content) for how it works.
