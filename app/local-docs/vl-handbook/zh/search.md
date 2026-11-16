---
title: 搜索
description: "单仓库对话框与跨仓库整页搜索。"
---

# 搜索

Vellum 提供两种搜索界面，都在读者的浏览器里运行同一套搜索：

1. 一个 **命令面板对话框**（Ctrl K / Cmd K / `/`），作用范围限定为当前
   仓库。
2. 一个位于 `/{locale}/search` 的 **整页搜索**，会跨站点内的每个仓库展开。

## 索引是怎样工作的

构建时为每个仓库的每种语言写一份索引，位于
`/_vellum/search/{locale}/{repo}.json`
（[`src/build/search-index.ts`](https://github.com/siiway/vellum/blob/main/app/src/build/search-index.ts)）：

1. 取该仓库在该语言下的页面，也就是构建会渲染的那些页面。
2. 抽取每个页面的可搜索文本：frontmatter 的 `title` / `description` /
   hero 块 + 剥离了 markdown 标记的正文，并按标题切分成小节。
3. 每份索引最多保留 200 个页面，每个页面保留前 12,000 个字符。

第一次搜索时会拉取所需的索引；打分
（[`src/shared/search.ts`](https://github.com/siiway/vellum/blob/main/app/src/shared/search.ts)）
在浏览器里进行。打分代码是一个单独的小 chunk，只有在有人搜索时才会加载。

打分故意做得很简单：标题命中 5 分，正文命中 1 分。降序排序，
单仓库截到前 10，跨仓库截到前 30。

::: note 为什么不上花哨的索引器
一个 50 页仓库的完整索引不到 50KB。更聪明的打分（BM25、语义嵌入）
对这种规模收益有限，反而会让下载量和代码都变大。
:::

## 对话框

由 `Ctrl K`（macOS 上是 `Cmd K`）或 `/` 触发。实现位于
[`src/web/components/SearchDialog.tsx`](https://github.com/siiway/vellum/blob/main/app/src/web/components/SearchDialog.tsx)。

特性：

- 防抖查询（180 ms）——输入不限速，但每次击键不会都发请求。
- 键盘导航（↑ / ↓ / Enter / Esc）。
- 最近搜索记录持久化在 localStorage。
- 当结果来自多个仓库时按仓库分组（仅当从一个会展开的页面发起时）。
- "在所有仓库中搜索 …" 升级链接，跳到整页搜索。

## 整页搜索

URL：`/{locale}/search`（`/search` 会重定向到默认语言的搜索页）。这个页面是
构建为每种语言写出的空外壳——没有 markdown、没有侧边栏 / 大纲，占满整个视口。

作者可以链到一个预填查询：

```md
[Search for "OAuth"](../search?q=OAuth)
```

行为：

- `?q=…` 在加载时填进输入框。
- `?repo=<slug>` 把结果限定到单个仓库；省略（或设为 `*`）则跨仓库。
- 输入框下方的仓库筛选 chips 用来切换范围。
- URL 通过 `history.replaceState` 保持同步，刷新 / 分享时查询不丢失。
- 当前分组的 tab 选择通过 localStorage 持久化。

## 索引文件

`/_vellum/search/{locale}/{repo}.json` 是一个静态文件：

```json
{
  "docs": [
    {
      "url": "/en-US/repo-slug/page-path",
      "title": "Page title",
      "text": "Searchable text of the whole page…",
      "sections": [{ "slug": "install", "title": "Install", "offset": 120 }]
    }
  ]
}
```

`robots.txt` 会阻止爬虫访问 `/_vellum/`。

## 从搜索中排除页面

目前还没有显式的 `noindex` 标志。要从搜索中排除某页，二选一：

- 把它移出 `docsRoot`。
- 把它放进以 `_` 开头的目录（或以 `_` 开头命名）。构建把这些视为 partial：
  既不渲染，也不索引。

正式的 `frontmatter.noindex: true` 标志已在路线图上。

## 调优

如果你有大仓库（> 200 个 markdown 文件），把 `src/build/search-index.ts`
中的 `MAX_DOCS` 调大。这个限制是有意保守的，因为读者第一次搜索时要下载
整份索引。
