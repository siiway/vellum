---
title: Vellum 手册
description: "Vellum 使用手册——一个运行在 Cloudflare Workers 上的多仓库文档平台。"
---

# Vellum 手册

**Vellum** 是为 SiiWay 文档站点提供支持的文档平台。它通过一个 Cloudflare Worker
从一个或多个源（GitHub 仓库或本地文件）提供 Markdown 服务，
完整支持 VitePress 风格的 markdown、Microsoft OPS / Learn 扩展集，
以及一套基于 FluentUI 的页面外壳。

本手册本身就是用 Vellum 编写的，源文件位于 worker 同一仓库下的
[`local-docs/vl-handbook`](https://github.com/siiway/vellum/tree/main/local-docs/vl-handbook)。

## 开箱即用的能力

::: tip 一段话理解架构
所有请求都由一个 Cloudflare Worker 处理。缓存未命中时，它会从 GitHub 拉取
Markdown（或读取打包进 worker 资源的文件），在服务端一次性解析、渲染 HTML，
然后流式返回。同一份数据也会序列化为 JSON，让 React 客户端在 hydrate 时无需
重新解析。后续的编辑通过 GitHub webhook 让缓存失效。
:::

| 能力                     | 你能得到什么                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| **数据源**               | 同一站点内既可使用 GitHub 仓库，也可使用本地文件；按仓库通过 `source: "github"` 或 `"local"` 切换。   |
| **VitePress markdown**   | 容器（`::: tip`）、代码组、GFM 提示框、任务列表、脚注、目录大纲。                                     |
| **OPS / Learn**          | 三冒号语法的 image / video / row / column / zone / moniker；DocFX tabs；INCLUDE；code-include；xref。 |
| **代码高亮**             | 服务端渲染的 Shiki。支持文件名、行号、高亮范围。                                                      |
| **Mermaid**              | 通过 Kroki 在服务端预渲染浅色和深色两套图。                                                           |
| **数学公式**             | MathJax 行内 + 行间公式，服务端渲染为 SVG。                                                           |
| **i18n**                 | 按仓库的语言路径前缀（例如 `/zh/...`）。站点外壳已完成翻译。                                          |
| **搜索**                 | 单仓库对话框（Ctrl K）以及位于 `/search` 的全站跨仓库整页搜索。                                       |
| **主题**                 | 浅色 / 深色 / 跟随系统，cookie 持久化。                                                               |
| **在 MD 中使用组件**     | 直接在 `.md` 文件里写 FluentUI 原语（`<Button>`、`<Card>`、`<Spinner>` ……）。                         |
| **边缘缓存**             | 按 PoP 的 Cache API + 可选的 KV 命名空间实现跨区域持久缓存。                                          |
| **SPA 式导航**           | 内部链接使用 `history.pushState` 并只重新拉取 JSON 数据。                                             |

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
- [缓存与部署](./caching-and-deployment)
  :::column-end:::
  :::column span="6":::

### 参考与测试

[功能测试](./tests/) 一节是每种渲染器的"活样本"——你在
修改 worker 时可以把它当作可视化的回归测试套件。

- [功能测试索引](./tests/)
  :::column-end:::
  :::row-end:::
