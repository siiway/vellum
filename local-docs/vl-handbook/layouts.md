---
title: Layouts
description: "default doc page, hero home, and Microsoft Learn-style home."
---

# Layouts

Every page picks a layout via its frontmatter `layout` field. Three are
built in.

## `default` — doc page

The default. Three-column grid with the sidebar on the left, article in the
middle, and outline on the right. Used by every page that doesn't opt into
another layout.

```yaml
---
title: My page
description: Optional tagline shown under the H1.
---
```

The article column maxes at 780px and has the standard prose styling:

- Heading anchors that appear on hover
- Inline code with a subtle background tint
- Tables wrapped for horizontal overflow
- Callouts via `:::` and GFM alerts

The sidebar comes from `vellum.json#groups` at the docs root, or falls back
to the directory listing. The outline is generated from the page's headings.

## `home` — VitePress-style hero

Frontmatter declares a hero block, optional action buttons, and a feature
grid. No sidebar / outline; full-width content.

```yaml
---
layout: home
hero:
  name: Project Name
  text: Tagline goes here
  tagline: "A longer description below the tagline"
  image:
    src: https://example.com/hero.svg
    alt: Hero illustration
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/example/repo
features:
  - icon: 🚀
    title: Fast
    details: Sub-millisecond responses from the edge.
  - icon: 🔒
    title: Secure
    details: OAuth, OIDC, CSRF, the works.
  - icon: 📦
    title: Small
    details: Worker bundle under 1 MB gzipped.
---
```

Any Markdown after the frontmatter is rendered below the features grid.

## `ms-learn` — Microsoft Learn-style landing

A richer landing page modelled on
[learn.microsoft.com](https://learn.microsoft.com): hero with a centred
search bar, then card grids for get-started, products, roles, and resources.

```yaml
---
layout: ms-learn
hero:
  title: SiiWay Documentation
  tagline: "Build, ship, and run apps at the edge."
  searchPlaceholder: Search SiiWay docs
  actions:
    - text: Get started
      theme: brand
      link: /handbook/getting-started
getStarted:
  title: Get started
  description: Pick a path.
  items:
    - title: Quickstart
      description: Spin up your first project in five minutes.
      icon: Rocket24Regular
      link: /handbook/getting-started
products:
  title: Browse our products
  items:
    - title: Prism
      description: "OAuth 2.0 / OIDC on Cloudflare Workers."
      icon: https://icons.siiway.org/prism/icon.svg
      link: /prism/
roles:
  title: Browse by role
  items:
    - title: Developers
      description: Build apps with SiiWay's primitives.
      icon: Code24Regular
      link: /handbook/
resources:
  title: More resources
  items:
    - title: GitHub
      description: Source, issues, discussions.
      icon: BranchFork24Regular
      link: https://github.com/siiway
---

## Custom content

Anything below the frontmatter is rendered through the regular markdown
pipeline, so you can mix in your own React components:

<Button appearance="primary" size="large">Primary call to action</Button>
```

::: tip Icon naming
`icon` on get-started / role / resource items is the PascalCase name of an
exported `@fluentui/react-icons` component (e.g. `Rocket24Regular`,
`Code24Regular`). For products, use a URL — it renders as a logo image
instead of an icon chip. Unknown icon names fall back to a placeholder so
the card still lays out.
:::

The handbook's own home is bundled at `local-docs/homepage/index.md` if you
want a working reference.

## Custom layouts

To add a new layout:

1. Pick a name (e.g. `gallery`).
2. Add a new branch in `src/app/components/Layout.tsx` that matches
   `frontmatter.layout === "gallery"` and renders your component.
3. Build the component using FluentUI primitives, following the patterns
   in `HomeLayout.tsx` and `MSLearnHome.tsx`.

Both built-in layout components render `MarkdownAst` over `data.page.ast`
when there's body content, so authors can drop in [React
components](./react-in-markdown) (or any other markdown feature) under the
structured frontmatter.
