---
title: React components in Markdown
description: "Drop FluentUI primitives, or your docs repo's own components, into your .md files and they mount as real React components."
---

# React components in Markdown

Vellum recognises PascalCase HTML tags in your markdown and mounts them as
real React components instead of dropping them through `dangerouslySetInnerHTML`
as inert HTML. The set of recognised tags is a curated registry —
[`src/web/reactComponents.ts`](https://github.com/siiway/vellum/blob/main/app/src/web/reactComponents.ts)
— plus the [components the docs repo lists](#components-from-the-docs-repo),
so authors can use them confidently without worrying about XSS.

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
them pay nothing. Both are in the page's pre-rendered HTML: the build loads
the lazy ones before it renders, and a page that uses one loads its chunk
before it hydrates.

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

A PascalCase tag whose name isn't in the registry or among the repo's
components renders its **children** as plain inline text — the props are
dropped silently. This keeps the content readable when an author typos a
name (e.g. `<Buton>...</Buton>`) while still flagging the problem visually
(the styling is missing).

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

// Lazy: in a chunk of its own, loaded on the pages that use it.
const HeavyChart = lazyComponent(() => import("./HeavyChart").then((m) => m.HeavyChart));

export const REACT_COMPONENTS = {
  ...,
  HeavyChart,
};
```

::: tip Mind the bundle
Eager-importing a heavy component means every page pays for it. Lazy import
unless the component is used everywhere in the chrome.
:::

## Components from the docs repo

A docs repo can bring its own React components, without changing Vellum.
List them in `vellum.json` at the docs root, each name with its file,
relative to the docs root:

```json
{
  "components": {
    "Counter": "_components/Counter.tsx",
    "Feedback": "_components/Feedback.tsx"
  }
}
```

The file's default export (or its export named like the component) is the
component. This handbook's `Counter`:

```tsx
// _components/Counter.tsx
import { useState, type ReactNode } from "react";
import { usePage } from "vellum";
import "./Counter.css";

export default function Counter({ start = 0, children }: { start?: number; children?: ReactNode }) {
  const [count, setCount] = useState(start);
  const { lang } = usePage();
  const label = children ?? (lang === "zh" ? "点击次数" : "Clicks");
  return (
    <button type="button" className="vl-counter" onClick={() => setCount((n) => n + 1)}>
      {label}: {count}
    </button>
  );
}
```

A page uses it like any other tag:

```md
<Counter start="3" />
```

<Counter start="3" />

The component renders in the page's own React tree, so the page's theme
applies and FluentUI's CSS variables (`var(--colorNeutralForeground1)`, …)
work in its styles.

- Names are PascalCase. A repo's component replaces a registered one of the
  same name on the repo's pages; a name its VitePress theme also registers
  stays the Vue component.
- A component imports React and Fluent UI from [the engine](#the-engine),
  the repo's `.tsx`, `.ts`, `.jsx`, `.js`, `.json` and `.css` files by
  relative path, and the [packages](#packages) the docs root installs.
- A stylesheet it imports applies to the whole page, so give its class names
  a prefix. CSS modules aren't supported. For styles of the component's own,
  use `makeStyles` from Fluent or Griffel.
- From `vellum`, `usePage()` returns the page's `lang`, `isDark`, `accent`
  (the site's accent colour, as `#rrggbb`), `path`, `title`, `description`
  and `frontmatter`, and follows theme switches.
- Attributes become props as above, and the tag's content its children.
- The build renders the component into the page's HTML, light themed, so
  it shows before the page's scripts load, and without JavaScript. Search
  has the tag's content.
- Since the build runs it, a component renders without `window` or
  `document` (use them in effects), and the same each time: no
  `Date.now()` or `Math.random()` in what it renders.
- A component that doesn't build, packages that don't install, or a
  component that throws while the build renders it fail the repo's build, as
  a page that doesn't render does, so `bun run update` keeps the repo's last
  pages. One that throws in the reader's browser shows the error in its
  place.

### The engine

React, Griffel and every Fluent UI v9 package come from Vellum's client
build, its engine, rather than from each repo's bundle. The engine has each
as a module of its own with all its exports, and uses the page's code where
the page has it. So a component's Fluent is the page's: it follows the
page's theme, its tooltips and popovers open in the page's portal with that
theme, and its styles join the page's own, each rule once. The code the page
doesn't have is the engine's own and loads only on a page with a component:
the page's bundle stays as it would be without the engine, but for the names
the engine imports from it. Of a module the page uses only part of, the
engine has a copy of its own if the module holds no state (data such as
Fluent's tokens, style hooks, icons), so the page needn't keep the rest of
it. A component imports them by their usual names, without a
`package.json`:

- `react`, `react/jsx-runtime`, `react-dom`
- `@fluentui/react-components`, the `@fluentui/react-*` packages it's made
  of, `@griffel/react` and `@griffel/core`
- `vellum`

An import of `@fluentui/react-components` becomes imports of the packages it
re-exports, those the component uses. Fluent's icons
(`@fluentui/react-icons`) aren't in the engine: a component bundles the few
it uses, from its packages. Other paths of the engine's packages, such as
`react-dom/client`, can't be imported.

This handbook's `Feedback` uses Fluent's Button, Tooltip and Popover. Its
module is 1.5 KB:

```tsx
// _components/Feedback.tsx
import { useState } from "react";
import {
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { usePage } from "vellum";

const useStyles = makeStyles({
  answers: { display: "flex", gap: tokens.spacingHorizontalS },
});

export default function Feedback() {
  const { lang } = usePage();
  const zh = lang === "zh";
  const styles = useStyles();
  const [answered, setAnswered] = useState(false);
  if (answered) {
    return (
      <Button appearance="primary" disabled>
        {zh ? "谢谢你的反馈！" : "Thanks for your feedback!"}
      </Button>
    );
  }
  return (
    <Popover withArrow>
      <PopoverTrigger disableButtonEnhancement>
        <Tooltip
          content={zh ? "告诉我们这一页写得怎么样" : "Tell us how this page did"}
          relationship="description"
        >
          <Button appearance="primary">{zh ? "这一页有帮助吗？" : "Was this page helpful?"}</Button>
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface className={styles.answers}>
        <Button onClick={() => setAnswered(true)}>{zh ? "有帮助" : "Yes"}</Button>
        <Button onClick={() => setAnswered(true)}>{zh ? "没有" : "No"}</Button>
      </PopoverSurface>
    </Popover>
  );
}
```

<Feedback />

The engine has Vellum's version of each package. When the repo's packages
have a newer one, the build fails, as code written for that version could
use what the engine's lacks. Pin it to the engine's version or older, with
`overrides` in `package.json`; the error says which version that is.

### Packages

For anything else, such as a component library or Fluent's icons, put a
`package.json` and its `bun.lock` at the docs root. The build installs them
with `bun install --frozen-lockfile --production --ignore-scripts`: the
dependencies, not the devDependencies, and without running any package's
scripts. Only those two files are copied for the install, so a `bunfig.toml`
or `.npmrc` of the repo doesn't apply. The install is kept between builds and
redone when either file changes. Packages come from a registry or a URL; a
local path (`file:`, `link:`, a workspace) fails the build.

A package's imports of the engine's packages, as a library built on Fluent
has, get the engine's too.

### How it loads

The build bundles all of the repo's components in one go, into
`/_vellum/react/{repo}/`: a module for each, `{Name}.js`, the chunks they
share, `chunk-{hash}.js`, and a file for each stylesheet they import. Code
that several components use is in one chunk and loads once.

The head of a page that uses a component preloads its module, its chunks and
the engine's modules they import, which download alongside the page's own
scripts, and links its stylesheets, which apply from the first paint. Pages
without one load none of these. The page hydrates once the modules have
loaded. After a client-side navigation to such a page, they load then, and
the tag shows its content until they have.

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
it. That doesn't sandbox the rest of the page, though. `<script>` tags are
dropped, as in VitePress, but other raw HTML (`<sub>`, `<kbd>`, …) is kept
as written, and a repo's Vue and React components, with the packages they
use, are its own code running in the reader's browser. Vellum doesn't
sanitize docs content, so only publish repos whose authors you trust with
the site.

The build runs a repo's React components too, to render them: their code
runs on the build machine, with the build's environment (its
`VELLUM_GITHUB_TOKEN`) and files, and can change what the build writes. The
workflows keep the Cloudflare token out of its reach: they build in a job
without it, and deploy from another that runs none of the build's code (see
[GitHub Actions](./build-and-deployment#github-actions)). A build on your
own machine runs as you, so its components can read what you can, wrangler's
login included. Only list repos with components whose authors you trust with
those as well.

If you need a brand-new interactive primitive, add it to the registry or
to the repo's components: a `<script>` in markdown doesn't run.
