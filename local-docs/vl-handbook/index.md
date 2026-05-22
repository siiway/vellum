---
title: Vellum Handbook
description: "The handbook for Vellum — a multi-repo documentation platform on Cloudflare Workers."
---

# Vellum Handbook

**Vellum** is the documentation platform that powers SiiWay's docs site. It
serves Markdown from one or more sources (GitHub repos or local files) through
a single Cloudflare Worker, with full VitePress-style markdown, the
Microsoft OPS / Learn extension set, and a FluentUI shell.

This handbook is itself written in Vellum, served from
[`local-docs/vl-handbook`](https://github.com/siiway/vellum/tree/main/local-docs/vl-handbook)
in the same repository as the worker.

## What's in the box

::: tip Architecture in one paragraph
A single Cloudflare Worker handles every request. On a cache miss it fetches
Markdown from GitHub (or reads a file bundled into the worker's assets), parses
it once on the server, renders the HTML, and streams it down. The same payload
is also serialised as JSON so the React client can hydrate without re-parsing.
Subsequent edits invalidate the cache via a GitHub webhook.
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
| **Theming**              | Light / dark / system, cookie-preserved.                                                             |
| **Components in MD**     | Drop FluentUI primitives (`<Button>`, `<Card>`, `<Spinner>`, …) directly into your `.md` files.      |
| **Edge caching**         | Cache API per PoP + optional KV namespace for cross-region durability.                               |
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
- [Caching & deployment](./caching-and-deployment)
  :::column-end:::
  :::column span="6":::

### Reference & tests

The [Feature tests](./tests/) section is a living showcase of every
renderer — use it as a visual regression suite while editing the worker.

- [Feature test index](./tests/)
  :::column-end:::
  :::row-end:::
