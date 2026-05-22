---
title: React components in Markdown
description: "Drop FluentUI primitives into your .md files and they mount as real React components."
---

# React components in Markdown

Vellum recognises PascalCase HTML tags in your markdown and mounts them as
real React components instead of dropping them through `dangerouslySetInnerHTML`
as inert HTML. The set of recognised tags is a curated registry —
[`src/app/reactComponents.ts`](https://github.com/siiway/vellum/blob/main/src/app/reactComponents.ts)
— so authors can use them confidently without worrying about XSS.

## Registered components

The registry comes pre-loaded with FluentUI v9 primitives that are useful in
docs. Anything PascalCase in markdown that matches a key gets mounted:

| Component                                                                                                                                                                  | Notes                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Button`                                                                                                                                                                   | Buttons and call-to-actions.                                                                |
| `Card`                                                                                                                                                                     | Card containers.                                                                            |
| `Divider`                                                                                                                                                                  | Horizontal / vertical rules.                                                                |
| `Image`                                                                                                                                                                    | FluentUI image with `fit`, etc.                                                             |
| `Link`                                                                                                                                                                     | Themed link.                                                                                |
| `Tab` / `TabList`                                                                                                                                                          | Tabs (declared directly; for content-tabs use [DocFX tabs](./ops-extensions#tabs) instead). |
| `Tooltip`                                                                                                                                                                  | Tooltips.                                                                                   |
| `Avatar`, `Badge`, `CardFooter`, `CardHeader`, `CardPreview`, `CounterBadge`, `InfoLabel`, `Input`, `PresenceBadge`, `ProgressBar`, `Spinner`, `Switch`, `Tag`, `Textarea` | Lazy-loaded the first time a page uses one.                                                 |

The first set are in the main client bundle (they're used by the Vellum
shell anyway). The lazy ones live in a separate chunk so docs pages without
them pay nothing.

## Inline and block usage

Both inline and block forms work — Vellum's parser folds PascalCase
open/close pairs into a structured AST node, so you can write a button
mid-paragraph or as a standalone block:

```md
Click <Button appearance="primary">this button</Button> to continue,
or read the <Link href="/handbook/getting-started">getting started</Link>
guide first.

For a bigger call to action:

<Button appearance="primary" size="large">
  Sign me up
</Button>
```

Click <Button appearance="primary">this button</Button> to continue, or read
the <Link href="./getting-started">getting started</Link> guide first.

For a bigger call to action:

<Button appearance="primary" size="large">Sign me up</Button>

## Props

Attributes are coerced to plain JS values:

- `"true"` / `"false"` → boolean
- Numeric strings → number
- Everything else → string
- Bare attributes (no `=`) → `true`

`class` is rewritten to `className`; `for` to `htmlFor`. So:

```md
<Tag size="medium" appearance="brand">Production-ready</Tag>
<Spinner size="tiny" label="Loading" labelPosition="after" />
```

renders as:

<Tag size="medium" appearance="brand">Production-ready</Tag>

<Spinner size="tiny" label="Loading" labelPosition="after" />

## Self-closing tags

The parser handles `<Component />` and `<Component prop="x" />` directly:

```md
<Divider />

<Spinner size="medium" />
```

## Unknown tags

A PascalCase tag whose name isn't in the registry renders its **children**
as plain inline text — the props are dropped silently. This keeps the
content readable when an author typos a name (e.g. `<Buton>...</Buton>`)
while still flagging the problem visually (the styling is missing).

If you want unknown tags to render as raw HTML instead, lowercase the tag
(e.g. `<button>` falls through to a plain HTML button).

## Adding your own components

Edit `src/app/reactComponents.ts`. Two patterns:

```ts
// Eager: in the main bundle. Use when the component is small or used on most pages.
import { MyComponent } from "./MyComponent";

export const REACT_COMPONENTS = {
  ...,
  MyComponent,
};

// Lazy: pulled into a separate chunk on first use.
import { lazy } from "react";

const HeavyChart = lazy(() => import("./HeavyChart").then((m) => ({ default: m.HeavyChart })));

export const REACT_COMPONENTS = {
  ...,
  HeavyChart,
};
```

::: tip Mind the bundle
Eager-importing a heavy component means every page pays for it. Lazy import
unless the component is used everywhere in the chrome.
:::

## Safety

The registry is a closed set — authors cannot mount arbitrary React
components or arbitrary HTML elements by tag name. Inline HTML tags
(lowercase) still pass through `dangerouslySetInnerHTML` for things like
`<sub>`, `<kbd>`, etc., but they can't introduce `<script>` because the
markdown parser strips raw script tags before they reach the AST builder.

If you need a brand-new interactive primitive, add it to the registry
rather than encouraging authors to write inline `<script>` tags.
