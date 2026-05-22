---
title: Markdown 中的 React 组件
description: "把 FluentUI 原语直接写进 .md 文件，它们会作为真正的 React 组件挂载。"
---

# Markdown 中的 React 组件

Vellum 识别 markdown 中的 PascalCase HTML 标签，并把它们作为真正的
React 组件挂载，而不是通过 `dangerouslySetInnerHTML` 当作惰性 HTML 输出。
可识别的标签集合是一个精选注册表，位于
[`src/app/reactComponents.ts`](https://github.com/siiway/vellum/blob/main/src/app/reactComponents.ts)——
所以作者可以放心使用，无需担心 XSS。

## 已注册的组件

注册表预装了在文档里好用的 FluentUI v9 原语。markdown 里任何匹配 key 的
PascalCase 标签都会被挂载：

| 组件                                                                                                                                                                       | 说明                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Button`                                                                                                                                                                   | 按钮和行动号召。                                                                                    |
| `Card`                                                                                                                                                                     | 卡片容器。                                                                                          |
| `Divider`                                                                                                                                                                  | 横向 / 纵向分割线。                                                                                 |
| `Image`                                                                                                                                                                    | 带 `fit` 等属性的 FluentUI 图片。                                                                   |
| `Link`                                                                                                                                                                     | 主题化链接。                                                                                        |
| `Tab` / `TabList`                                                                                                                                                          | tabs（直接声明用；要做内容 tabs 请用 [DocFX tabs](./ops-extensions#tabs)）。                        |
| `Tooltip`                                                                                                                                                                  | 工具提示。                                                                                          |
| `Avatar`、`Badge`、`CardFooter`、`CardHeader`、`CardPreview`、`CounterBadge`、`InfoLabel`、`Input`、`PresenceBadge`、`ProgressBar`、`Spinner`、`Switch`、`Tag`、`Textarea` | 页面第一次使用时按需懒加载。                                                                        |

前面一组在主客户端 bundle 中（Vellum 外壳本来就在用）。懒加载的那一组
位于单独的 chunk，所以不使用它们的页面零开销。

## 行内与块级用法

行内和块级两种形式都可以——Vellum 的解析器会把 PascalCase 的开/闭对
折叠成一个结构化的 AST 节点，所以你可以在段落中间写按钮，也可以让
它独立成块：

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

## 属性

属性被强制转换为常见的 JS 值：

- `"true"` / `"false"` → boolean
- 全数字字符串 → number
- 其它 → string
- 没有 `=` 的裸属性 → `true`

`class` 被改写为 `className`；`for` 被改写为 `htmlFor`。例如：

```md
<Tag size="medium" appearance="brand">Production-ready</Tag>
<Spinner size="tiny" label="Loading" labelPosition="after" />
```

渲染为：

<Tag size="medium" appearance="brand">Production-ready</Tag>

<Spinner size="tiny" label="Loading" labelPosition="after" />

## 自闭合标签

解析器直接支持 `<Component />` 和 `<Component prop="x" />`：

```md
<Divider />

<Spinner size="medium" />
```

## 未知标签

不在注册表中的 PascalCase 标签会以纯行内文本形式渲染它的 **children**——
属性会被静默丢弃。这样在作者拼错名字（例如 `<Buton>...</Buton>`）时
内容仍可读，同时在视觉上明显能看出问题（缺少样式）。

如果你想让未知标签渲染成原始 HTML，使用小写形式
（例如 `<button>` 会落到普通 HTML 按钮上）。

## 添加自己的组件

编辑 `src/app/reactComponents.ts`。两种写法：

```ts
// 立即加载：进入主 bundle。组件很小或几乎所有页面都用时合适。
import { MyComponent } from "./MyComponent";

export const REACT_COMPONENTS = {
  ...,
  MyComponent,
};

// 懒加载：第一次使用时拉进独立 chunk。
import { lazy } from "react";

const HeavyChart = lazy(() => import("./HeavyChart").then((m) => ({ default: m.HeavyChart })));

export const REACT_COMPONENTS = {
  ...,
  HeavyChart,
};
```

::: tip 注意 bundle 体积
立即加载一个重组件意味着每个页面都要为它付出代价。除非组件被外壳
全局使用，否则懒加载。
:::

## 安全

注册表是一个封闭集合——作者无法通过标签名挂载任意 React 组件或任意
HTML 元素。行内 HTML 标签（小写）仍然通过 `dangerouslySetInnerHTML`
透传（用于 `<sub>`、`<kbd>` 等），但它们不能引入 `<script>`，
因为 markdown 解析器在到达 AST 构建器之前就把原始 script 标签剥掉了。

如果你需要一个全新的交互式原语，把它加进注册表，而不是鼓励作者
直接写行内 `<script>`。
