---
title: OPS extensions
description: "Microsoft Learn / DocFX markdown extensions: tabs, image/video, row/column, zone, moniker, INCLUDE, code-include, xref."
---

# OPS extensions

The Microsoft **Open Publishing System** (OPS), now known as Microsoft Learn,
ships a set of Markdown extensions on top of CommonMark. Vellum implements
the full set so docs authored for Learn can render without modification.

| Extension          | Vellum support                                              |
| ------------------ | ----------------------------------------------------------- |
| Triple-colon image | ✓ — see [Image & video](#image--video)                      |
| Triple-colon video | ✓                                                           |
| Row / column grid  | ✓ — 12-col responsive grid, see [Grid layout](#grid-layout) |
| Zone pivots        | ✓ — see [Zones](#zones)                                     |
| Moniker ranges     | ✓ — see [Monikers](#monikers)                               |
| DocFX tabs         | ✓ — see [Tabs](#tabs)                                       |
| `[!INCLUDE]`       | ✓ — see [Includes](#includes)                               |
| `[!code-<lang>]`   | ✓ — see [Code includes](#code-includes)                     |
| `<xref:Uid>`       | ✓ — see [xref](#xref)                                       |

Every extension is exercised in the [Feature tests](./tests/) section with
working examples — open those pages alongside this reference.

## Image & video

```md
:::image source="img/screenshot.png" alt-text="The settings panel" type="content":::

:::image source="img/diagram.svg" alt-text="Architecture" border="true" lightbox="img/diagram-full.svg":::

:::video source="https://www.youtube.com/embed/dQw4w9WgXcQ":::
```

Attributes:

- `source` — image URL or video URL (required)
- `alt-text` / `alt` — alt text (images)
- `type` — `content` | `icon` | `complex`
- `border` — `"true"` to draw a subtle 1px border
- `lightbox` — URL to open when the image is clicked (opens in new tab)
- `title` — caption text on videos

The video renderer picks an `<iframe>` for hosted services (YouTube, Channel 9) and an HTML5 `<video controls>` for direct `.mp4` / `.webm` / `.ogg` URLs.

## Grid layout

The 12-column grid is opened with `:::row::: ... :::row-end:::` and filled
with `:::column span="N":::`. Sum your spans to 12 for a full row; sub-12
leaves empty space.

```md
:::row:::
:::column span="8":::

### Main column

Wider side — usually the primary content.
:::column-end:::
:::column span="4":::

### Aside

Narrower side panel.
:::column-end:::
:::row-end:::
```

Below 720px columns stack one per row.

## Zones

A zone pane shows only when the active pivot is in its comma-separated
`pivot=` list. Authors:

```md
:::zone pivot="dotnet,fsharp":::
.NET / F# specific instructions.
:::zone-end:::

:::zone pivot="python":::
Python-specific instructions.
:::zone-end:::
```

Readers pick a pivot via `?pivot=...` in the URL. With no pivot set, every
zone is visible so the page reads top-to-bottom — a deliberate design
choice for SSR-friendliness.

## Monikers

Moniker ranges scope content to a version. They always render with an
"Applies to: …" prefix so the reader knows the version they're looking at.

```md
:::moniker range=">=v2.0":::
What's new in v2.
:::moniker-end:::
```

A future version of Vellum will wire up a version selector that filters
non-matching moniker panes; for now, all panes render with the prefix.

## Tabs

DocFX-style tabs come from a run of same-level headings whose link href is
`#tab/<id>`. The group ends at a `---` divider or a heading without
`#tab/...`:

```md
# [Windows](#tab/windows)

Install via winget.

# [macOS](#tab/macos)

Install via Homebrew.

# [Linux](#tab/linux)

Install via apt / dnf.

---
```

Tab state is persisted per-group in `localStorage`, keyed by the
(deterministically ordered) set of tab ids — so unrelated groups stay
independent.

## Includes

`[!INCLUDE [label](path)]` fetches another Markdown file and splices its
parsed blocks into the current AST. Containers / code / xref inside the
include all keep working.

```md
[!INCLUDE [install snippet](../_includes/install.md)]
```

Paths are resolved relative to the current page's directory (just like
images). To prevent runaway recursion, Vellum drops the include-resolver
on the inner call — so an include can use mermaid, math, xref, etc., but
not another `[!INCLUDE]`.

When the resolver returns null (file missing, network error), a visible
"Failed to resolve INCLUDE" callout appears with the offending path so the
author can spot the broken reference.

## Code includes

`[!code-<lang>[label](path)]` embeds a code snippet from a source file.
The directive supports several query forms:

```md
[!code-csharp[](src/Program.cs)] <!-- whole file -->
[!code-csharp[](src/Program.cs?range=10-20)] <!-- line range -->
[!code-csharp[](src/Program.cs?range=10-20&highlight=2-3)] <!-- + highlights -->
[!code-csharp[](src/Program.cs?start=10&end=20)] <!-- alternate range form -->
[!code-csharp[](src/Program.cs#regionName)] <!-- #regionName shortcut -->
[!code-csharp[](src/Program.cs?region=regionName)] <!-- region query form -->
```

Region markers come in three flavours, picked in order:

1. `#region NAME` ... `#endregion` (C# preprocessor; also F#/VB)
2. `// <NAME>` ... `// </NAME>` (DocFX snippet markers; generic)
3. `// <region name="NAME">` ... `// </region>` (DocFX explicit-attribute form)

The markers themselves are stripped from the rendered snippet, and the
highlight ranges are 1-indexed within the slice (not the original file).

## xref

Vellum honours both autolink and explicit forms:

```md
The .NET <xref:System.Console.WriteLine> API.

For an example, see [the console docs](xref:System.Console).
```

Resolution comes from `xrefmap.yml` (or `.yaml` / `.json`) at the docs root.
The format is the DocFX standard:

```yaml
references:
  - uid: System.Console
    href: https://learn.microsoft.com/dotnet/api/system.console
    name: Console
```

Resolved uids render as external links; unresolved uids render as a dashed
monospace box so the author sees the broken reference at a glance.

::: tip Performance
The xrefmap is loaded once per page render in parallel with the markdown
fetch, then cached in KV / Cache API alongside the raw files. A page with
50 xrefs doesn't cost 50 round trips — they're all served from the
in-memory map.
:::
