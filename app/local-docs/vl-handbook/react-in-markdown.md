---
title: React components in Markdown
description: "Drop FluentUI primitives into your .md files and they mount as real React components."
---

# React components in Markdown

Vellum recognises PascalCase HTML tags in your markdown and mounts them as
real React components instead of dropping them through `dangerouslySetInnerHTML`
as inert HTML. The set of recognised tags is a curated registry —
[`src/web/reactComponents.ts`](https://github.com/siiway/vellum/blob/main/app/src/web/reactComponents.ts)
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
or read the <Link href="/vl-handbook/getting-started">getting started</Link>
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

Edit `src/web/reactComponents.ts`. Two patterns:

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

## Vue components

A docs repo written for VitePress keeps the Vue components it registers in
`.vitepress/theme/index.ts` under its docs root:

```ts
// .vitepress/theme/index.ts
import DefaultTheme from "vitepress/theme";
import ScopeBuilder from "./ScopeBuilder.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("ScopeBuilder", ScopeBuilder);
  },
};
```

The build reads that file without running it, takes each
`app.component("Name", X)` whose `X` is imported from a `.vue` file, and
publishes that file at `/_vellum/vue/{repo}/{Name}.vue`. A `<ScopeBuilder />`
in a page becomes a placeholder, and the reader's browser loads Vue and
`vue3-sfc-loader` (only on pages that have one) and mounts the component in
it.

- Only registered components load, and a component can import only `vue`
  and `vitepress`.
- From `vitepress`, `useData()` and `useRoute()` exist, with the page's
  locale, title, frontmatter and theme; nothing else does.
- Attributes become props (numbers and booleans converted); children and
  slots are dropped.
- The component renders only in the browser, so it's not in the
  pre-rendered HTML or in search.

## Safety

The registry is a closed set: a tag name mounts only a component listed in
it. That doesn't sandbox the rest of the page, though. Raw HTML (`<sub>`,
`<kbd>`, …) is kept as written, `<script>` tags and event handlers
included, and ends up in the pre-rendered page. Vellum doesn't sanitize
docs content, so only publish repos whose authors you trust with the
site.

If you need a brand-new interactive primitive, add it to the registry
rather than having authors write inline `<script>` tags.
