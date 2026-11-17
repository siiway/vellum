---
title: Markdown 特性
description: "Vellum 支持的、与 VitePress 兼容的 markdown 词汇表。"
---

# Markdown 特性

Vellum 的解析器是 [markdown-it](https://github.com/markdown-it/markdown-it)
加上一套精选的插件集合。大部分 VitePress 的 markdown 写法在这里效果相同，
OPS 扩展叠加在它之上（见 [OPS 扩展](./ops-extensions)）。

每个特性都有完整的视觉测试，详见 [功能测试](./tests/) 一节。

## 标准 markdown

完整支持 GitHub Flavored Markdown：

- 标题、段落、强调、删除线、链接、图片。
- 列表（有序、无序、嵌套）、任务列表。
- 带对齐的表格。
- 引用块。
- 围栏代码块。
- 行内 HTML——包括会解析为 React 组件的 PascalCase 标签。

## 容器

VitePress 风格的 `:::` 语法会产生有类型的提示框。内置 8 种：
`tip`、`info`、`note`、`warning`、`caution`、`danger`、`important`、`details`。

```md
::: tip
A green tip. Optional title: `::: tip Heads up`
:::

::: warning
A yellow warning.
:::

::: danger
A red danger. Same chrome as ::: important.
:::

::: details Show example
A collapsible disclosure block. Click the summary to expand.
:::
```

::: tip Heads up
A green tip. Optional title: `::: tip Heads up`
:::

::: warning
A yellow warning.
:::

::: danger
A red danger. Same chrome as `::: important`.
:::

::: details Show example
A collapsible disclosure block. Click the summary to expand.
:::

### 嵌套容器

Vellum 的解析器支持任意嵌套不同类型的容器。即便内层容器使用了相同
数量的冒号，标准的 `:::` 也能正常工作：

```md
::: details Expand for the inner example
::: warning
Nested warning inside a details. Both close with their own `:::`.
:::
:::
```

::: details Expand for the inner example
::: warning
Nested warning inside a details. Both close with their own `:::`.
:::
:::

::: note 内部细节
标准的 `markdown-it-container` 不考虑嵌套，只往前扫到下一个 `:::`
就关闭，所以 VitePress 的常见绕过办法是用四个冒号写外层。
Vellum 的
[`containers.ts`](https://github.com/siiway/vellum/blob/main/app/src/build/markdown/containers.ts)
用一个深度跟踪的解析器替换了它，所以纯 `:::` 就能按作者预期工作。
:::

## GFM 提示

GitHub 的 `> [!KIND]` 语法被重写到同一套提示框原语上：

```md
> [!NOTE]
> Equivalent to ::: note.

> [!TIP]
> Equivalent to ::: tip.

> [!IMPORTANT]
> Equivalent to ::: important.

> [!WARNING]
> Equivalent to ::: warning.

> [!CAUTION]
> Equivalent to ::: caution.
```

## 代码块

围栏代码块在构建时由 Shiki 高亮。fence 信息串支持
语言、文件名、行号、高亮范围：

````md
```ts:line-numbers [src/build/sources.ts] {2,4-6}
export async function readSourceFile(repo: RepoConfig, path: string) {
  const root = await realpath(repoDir(repo));
  const full = await realpath(resolve(root, path));
  // A symlink out of the repo reads as missing.
  if (!isInside(root, full)) return null;
  return await readFile(full, "utf8");
}
```
````

只要设置了 `filename` 或 `lang`，就会出现卡片样式的顶栏（文件名 +
语言徽章 + 复制按钮）；否则仅显示代码区域，鼠标悬停时出现浮动的
复制按钮。

### 代码组

`::: code-group` 把多个 fence 包装成一个 tab 条：

````md
::: code-group

```ts [TypeScript]
console.log("ts");
```

```py [Python]
print("py")
```

:::
````

::: code-group

```ts [TypeScript]
console.log("ts");
```

```py [Python]
print("py")
```

:::

## 表格

支持带可选对齐的标准 pipe 表格：

| Column A | Centered | Right-aligned |
| :------- | :------: | ------------: |
| `code`   |   mid    |          1.23 |
| **bold** |   data   |        42,000 |

## Mermaid

`mermaid` 语言的围栏代码块会通过
[Kroki](./build-and-deployment#外部服务) 在构建时 **同时**
预渲染浅色和深色两个版本。页面同时包含两者，由 CSS 显示当前主题对应的那个，
所以图表不需要任何 JavaScript，切换主题也是瞬时的。

````md
```mermaid
flowchart LR
  A[Build] --> B{Source?}
  B -->|github| C[git clone]
  B -->|local| D[local-docs/]
  C & D --> E[Render]
  E --> F[Static HTML]
```
````

```mermaid
flowchart LR
  A[Build] --> B{Source?}
  B -->|github| C[git clone]
  B -->|local| D[local-docs/]
  C & D --> E[Render]
  E --> F[Static HTML]
```

如果构建时 Kroki 不可达，图表发布时不带 SVG，读者的浏览器会按需懒加载
~600KB 的 mermaid 运行时来绘制——优雅降级而非显示空白卡片。

## 数学公式

`$inline$` 与 `$$display$$` 形式的数学公式由
[markdown-it-mathjax3](https://www.npmjs.com/package/markdown-it-mathjax3)
在构建时渲染为行内 SVG。不需要任何客户端库。

```md
The Pythagorean theorem is $a^2 + b^2 = c^2$.

$$
e^{i\pi} + 1 = 0
$$
```

The Pythagorean theorem is $a^2 + b^2 = c^2$.

$$
e^{i\pi} + 1 = 0
$$

## 其它好东西

- **任务列表**：`- [x] done`、`- [ ] todo`（由 `markdown-it-task-lists` 支持）。
- **脚注**：`Text[^1]` ... `[^1]: Footnote body`（由 `markdown-it-footnote` 支持）。
- **Emoji**：`:rocket:` → 🚀（由 `markdown-it-emoji` 支持 GitHub 简写码）。
- **属性列表**：标题和其它块元素可以加 `{#anchor .class data-x="y"}`
  （由 `markdown-it-attrs` 支持，带安全允许列表）。
- **自动生成大纲**：根据标题层级生成，驱动右侧的 TOC。

以上的可工作示例都在 [功能测试](./tests/) 里。
