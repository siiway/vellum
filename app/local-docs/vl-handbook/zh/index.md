---
title: Vellum 手册
description: "Vellum 使用手册——一个预渲染并由 Cloudflare Workers 托管的多仓库文档平台。"
---

# Vellum 手册

**Vellum** 是为 SiiWay 文档站点提供支持的文档平台。它把一个或多个源
（GitHub 仓库或本地文件）中的 Markdown 构建成静态站点，由 Cloudflare Workers 托管，
完整支持 VitePress 风格的 markdown、Microsoft OPS / Learn 扩展集，
以及一套基于 FluentUI 的页面外壳。

本手册本身就是用 Vellum 编写的，源文件位于 Vellum 同一仓库下的
[`local-docs/vl-handbook`](https://github.com/siiway/vellum/tree/main/app/local-docs/vl-handbook)。

## 开箱即用的能力

::: tip 一段话理解架构
构建时克隆每个 GitHub 仓库（或读取本地文件），把每个页面解析一次并写出 HTML。
Cloudflare 以静态资源的形式提供构建结果，每个请求都不运行任何代码。每个页面的数据
也会写成 JSON，让 React 客户端在 hydrate 时无需重新解析，并能无刷新切换页面。
文档仓库有变更时，增量更新只重新渲染该仓库并重新部署。
:::

| 能力                   | 你能得到什么                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| **数据源**             | 同一站点内既可使用 GitHub 仓库，也可使用本地文件；按仓库通过 `source: "github"` 或 `"local"` 切换。   |
| **VitePress markdown** | 容器（`::: tip`）、代码组、GFM 提示框、任务列表、脚注、目录大纲。                                     |
| **OPS / Learn**        | 三冒号语法的 image / video / row / column / zone / moniker；DocFX tabs；INCLUDE；code-include；xref。 |
| **代码高亮**           | 构建时由 Shiki 高亮。支持文件名、行号、高亮范围。                                                     |
| **Mermaid**            | 构建时由 Kroki 绘制浅色和深色两套图。                                                                 |
| **数学公式**           | MathJax 行内 + 行间公式，构建时渲染为 SVG。                                                           |
| **i18n**               | 全站统一的语言 URL 前缀（例如 `/zh-CN/...`）。站点外壳已完成翻译。                                    |
| **搜索**               | 单仓库对话框（Ctrl K）以及跨仓库的整页搜索，都在浏览器中运行。                                        |
| **主题**               | 浅色 / 深色 / 跟随系统，用 cookie 记住选择。                                                          |
| **在 MD 中使用组件**   | FluentUI 原语（`<Button>`、`<Card>` ……）和仓库 VitePress 主题中的 Vue 组件。                          |
| **静态输出**           | 预渲染的 HTML 托管在 Workers 静态资源上；增量更新只重新渲染有变更的仓库。                             |
| **SPA 式导航**         | 内部链接使用 `history.pushState` 并只重新拉取 JSON 数据。                                             |

## 接下来去哪里

:::row:::
:::column span="6":::

### 初次使用 Vellum

先看 [快速开始](./getting-started) 完成安装，再读
[配置](./configuration) 了解 `vellum.config.json`，最后看
[数据源](./sources) 了解如何指定内容来源。

- [快速开始](./getting-started)
- [配置参考](./configuration)
- [数据源：GitHub 与本地](./sources)
  :::column-end:::
  :::column span="6":::

### 撰写文档

先读 [Markdown 特性](./markdown) 了解 VitePress 词汇，再读
[OPS 扩展](./ops-extensions) 了解 Microsoft Learn 风格的工具。

- [Markdown 特性](./markdown)
- [OPS 扩展](./ops-extensions)
- [Markdown 中的 React 组件](./react-in-markdown)
  :::column-end:::
  :::row-end:::

:::row:::
:::column span="6":::

### 运维 Vellum

- [搜索](./search)
- [国际化](./i18n)
- [构建与部署](./build-and-deployment)
- [更新内容](./updating-content)
  :::column-end:::
  :::column span="6":::

### 参考与测试

[功能测试](./tests/) 一节是每种渲染器的"活样本"——你在
修改渲染器时可以把它当作可视化的回归测试套件。

- [功能测试索引](./tests/)
  :::column-end:::
  :::row-end:::
