---
title: Feature Tests
description: One page per feature so you can spot regressions visually.
---

# Feature Tests

These pages exercise every renderer the worker supports. Open them in pairs
(light + dark, en + zh) and skim for visual regressions when working on the
renderer or markdown pipeline.

## Coverage

- **[Basic Markdown](./basic-markdown)** — headings, lists, links, tables, blockquotes.
- **[Code Blocks](./code-blocks)** — fenced, with langs, line numbers, highlights, filenames, code-group tabs.
- **[Containers & Alerts](./containers)** — VitePress containers, GFM alerts.
- **[Mermaid Diagrams](./mermaid)** — SSR via Kroki (light + dark) with client fallback.
- **[Math & Emoji](./math)** — MathJax inline + display, GitHub emoji shortcodes, task lists, footnotes.
- **[OPS Tabs](./ops-tabs)** — DocFX `# [Title](#tab/id)` heading-based tab groups.
- **[OPS Image & Video](./ops-image-video)** — `:::image:::` and `:::video:::` self-closing blocks.
- **[OPS Row & Column](./ops-row-column)** — 12-column grid via `:::row::: :::column:::`.
- **[OPS Zone & Moniker](./ops-zone-moniker)** — pivot zones + moniker (version) ranges.
- **[OPS Includes](./ops-includes)** — `[!INCLUDE]` and `[!code-lang]` directives.
- **[OPS xref](./ops-xref)** — `<xref:Uid>` autolinks + `[text](xref:Uid)` link form.

## Status legend

When a feature has known limitations on local repos, the page notes them at
the top. Examples:

::: tip
"Last updated" timestamps are GitHub-only — local pages skip the affordance.
:::

::: warning
The mermaid SSR is a network call to kroki.io. If you're offline, the client
will fall back to rendering mermaid in-browser, which loads a ~600KB chunk.
:::
