---
title: 布局
description: "默认文档页、hero 主页，以及 Microsoft Learn 风格主页。"
---

# 布局

每个页面都通过 frontmatter 的 `layout` 字段挑选自己的布局。内置三种。

## `default` —— 文档页

默认值。三列网格——侧边栏在左、正文居中、大纲在右。任何没有显式指定
其它布局的页面都使用它。

```yaml
---
title: My page
description: Optional tagline shown under the H1.
---
```

正文列最大宽度 780px，采用标准的正文排版：

- 鼠标悬停时显示的标题锚点
- 浅色背景的行内代码
- 表格允许横向滚动
- `:::` 与 GFM 提示框

侧边栏来自文档根的 `vellum.json#groups`，或回退到目录列表。
大纲由当前页面的标题层级生成。

## `home` —— VitePress 风格 hero

Frontmatter 声明 hero 块、可选的行动按钮，以及一份特性网格。
没有侧边栏 / 大纲；内容占满整行。

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

Frontmatter 之后的任何 Markdown 都会渲染在特性网格下方。

## `ms-learn` —— Microsoft Learn 风格落地页

一种参照
[learn.microsoft.com](https://learn.microsoft.com) 的更丰富的落地页：
带居中搜索框的 hero，下方是 "Get started"、产品、角色、资源四组卡片。

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

::: tip 图标命名
get-started / role / resource 项的 `icon` 是导出自
`@fluentui/react-icons` 的某个组件名（例如 `Rocket24Regular`、
`Code24Regular`，PascalCase）。对于 products，使用 URL——它会作为 logo
图片渲染，而不是图标 chip。未知图标名会回退为占位符，
保证卡片仍能正常布局。
:::

如果你想看一份实际工作的参照，自带的主页位于 `local-docs/homepage/index.md`。

## 自定义布局

新增一种布局：

1. 起一个名字（例如 `gallery`）。
2. 在 `src/app/components/Layout.tsx` 里新增一条匹配
   `frontmatter.layout === "gallery"` 的分支，渲染你的组件。
3. 用 FluentUI 原语来构建组件，参考 `HomeLayout.tsx` 和
   `MSLearnHome.tsx` 的写法。

两个内置布局组件在存在正文内容时都会用 `data.page.ast` 渲染
`MarkdownAst`，所以作者可以在结构化的 frontmatter 之下继续插入
[React 组件](./react-in-markdown)（或任何其它 markdown 特性）。
