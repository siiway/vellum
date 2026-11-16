---
title: Vellum Handbook
description: "The handbook for Vellum — a multi-repo documentation platform, pre-rendered and served from Cloudflare Workers."
---

# Vellum Handbook

**Vellum** is the documentation platform that powers SiiWay's docs site. It
builds Markdown from one or more sources (GitHub repos or local files) into a
static site served from Cloudflare Workers, with full VitePress-style markdown,
the Microsoft OPS / Learn extension set, and a FluentUI shell.

This handbook is itself written in Vellum, served from
[`local-docs/vl-handbook`](https://github.com/siiway/vellum/tree/main/app/local-docs/vl-handbook)
in the same repository as Vellum itself.

## What's in the box

::: tip Architecture in one paragraph
The build clones each GitHub repo (or reads local files), parses every page
once, and writes its HTML. Cloudflare serves the result as static assets, with
no code running per request. Each page's data is also written as JSON, so the
React client hydrates without re-parsing and swaps pages without a reload.
When a docs repo changes, an incremental update re-renders just that repo and
redeploys.
:::

| Feature                  | What you get                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Sources**              | GitHub repos and local files in the same site; switch per-repo via `source: "github"` or `"local"`.  |
| **VitePress markdown**   | Containers (`::: tip`), code groups, GFM alerts, task lists, footnotes, table of contents.           |
| **OPS / Learn**          | Triple-colon image / video / row / column / zone / moniker; DocFX tabs; INCLUDE; code-include; xref. |
| **Code highlighting**    | Shiki, server-rendered. Filename, line numbers, highlight ranges.                                    |
| **Mermaid**              | Rendered server-side via Kroki in both light and dark palettes.                                      |
| **Math**                 | MathJax inline + display, server-rendered to SVG.                                                    |
| **i18n**                 | Per-repo locales with URL prefixes (e.g. `/zh/...`). Site chrome is translated.                      |
| **Search**               | Per-repo dialog (Ctrl K) and full-page cross-repo search at `/search`.                               |
| **Theming**              | Light / dark / system, remembered in a cookie.                                                       |
| **Components in MD**     | Drop FluentUI primitives (`<Button>`, `<Card>`, `<Spinner>`, …) directly into your `.md` files.      |
| **Static output**        | Pre-rendered HTML on Workers static assets; incremental updates re-render only changed repos.        |
| **SPA-style navigation** | Internal links use `history.pushState` and refetch only the JSON payload.                            |

## Where to go next

:::row:::
:::column span="6":::

### New to Vellum

Start with [Getting started](./getting-started) for installation, then
[Configuration](./configuration) for `vellum.config.json` and
[Sources](./sources) for how to point at content.

- [Getting started](./getting-started)
- [Configuration reference](./configuration)
- [Sources: GitHub & local](./sources)
  :::column-end:::
  :::column span="6":::

### Authoring docs

Start with [Markdown features](./markdown) for the VitePress vocabulary, then
[OPS extensions](./ops-extensions) for the Microsoft Learn-style tooling.

- [Markdown features](./markdown)
- [OPS extensions](./ops-extensions)
- [React components in Markdown](./react-in-markdown)
  :::column-end:::
  :::row-end:::

:::row:::
:::column span="6":::

### Operating Vellum

- [Search](./search)
- [Internationalisation](./i18n)
- [Build & deployment](./caching-and-deployment)
- [Updating content](./updating-content)
  :::column-end:::
  :::column span="6":::

### Reference & tests

The [Feature tests](./tests/) section is a living showcase of every
renderer — use it as a visual regression suite while editing the renderer.

- [Feature test index](./tests/)
  :::column-end:::
  :::row-end:::
