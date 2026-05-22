---
title: 搜索
description: "单仓库对话框与跨仓库整页搜索。"
---

# 搜索

Vellum 提供两种搜索界面，背后是同一个 `/api/search` 端点：

1. 一个 **命令面板对话框**（Ctrl K / Cmd K / `/`），作用范围限定为当前
   仓库。
2. 一个位于 `/search` 的 **整页搜索**，会跨站点内的每个仓库展开。

## 索引是怎样工作的

`src/worker/search.ts` 在首次请求时按仓库 + 语言构建一份微型倒排索引：

1. 走源数据树（GitHub trees API 或本地的 `manifest.json`）。
2. 过滤出当前语言下、位于 `docsRoot` 内的 Markdown 文件。
3. 并发拉取每个文件（最多 200 个），抽取可搜索文本：frontmatter 的
   `title` / `description` / hero 块 + 剥离了 markdown 标记的正文。
4. 把结果缓存进 KV / Cache API，TTL 为 `VELLUM_CACHE_TTL_SECONDS × 4`，
   于是后续在同一仓库内的查询只花 O(query) 的时间。

打分故意做得很简单：标题命中 5 分，正文命中 1 分。降序排序，
单仓库截到前 10，跨仓库截到前 30。

::: note 为什么不上花哨的索引器
一个 50 页仓库的完整索引不到 50KB。更聪明的打分（BM25、语义嵌入）
对这种规模收益有限，反而会显著拉长冷启动。当前实现的冷启动约 500ms。
:::

## 对话框

由 `Ctrl K`（macOS 上是 `Cmd K`）或 `/` 触发。实现位于
[`src/app/components/SearchDialog.tsx`](https://github.com/siiway/vellum/blob/main/src/app/components/SearchDialog.tsx)。

特性：

- 防抖查询（180 ms）——输入不限速，但每次击键不会都发请求。
- 键盘导航（↑ / ↓ / Enter / Esc）。
- 最近搜索记录持久化在 localStorage。
- 当结果来自多个仓库时按仓库分组（仅当从一个会展开的页面发起时）。
- "在所有仓库中搜索 …" 升级链接，跳到整页搜索。

## 整页搜索

URL：`/search`（非默认语言下是 `/{locale}/search`）。这个页面由 worker
声明自己的布局——没有 markdown、没有侧边栏 / 大纲，占满整个视口。

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

## API 表面

`GET /api/search` 返回 JSON。参数：

| 参数     | 必填 | 说明                                                                       |
| -------- | :--: | -------------------------------------------------------------------------- |
| `q`      |  ✓   | 搜索关键字。                                                               |
| `repo`   |      | 限定到的仓库 slug，或 `*` 表示跨仓库。默认为 `homepageRepo`。               |
| `locale` |      | 语言代码。默认为 `defaultLocale`。                                         |
| `limit`  |      | 每个仓库的最大命中数（被限制在 1–50）。默认 10。                           |
| `all`    |      | 设为 `1` 是 `repo=*` 的快捷写法。                                          |

响应：

```json
{
  "hits": [
    {
      "url": "/repo-slug/page-path",
      "title": "Page title",
      "excerpt": "...<mark>highlighted term</mark>...",
      "repo": "repo-slug",
      "repoDisplayName": "Repo Display Name"
    }
  ]
}
```

## 从搜索中排除页面

目前还没有显式的 `noindex` 标志。要从搜索中排除某页，二选一：

- 把它移出 `docsRoot`。
- 在路径中标记为 `_internal`（索引器会跳过 `_*` 目录下的任何文件，
  假定它们是 partial 或私有产物——这不是硬约束，请用查询确认）。

正式的 `frontmatter.noindex: true` 标志已在路线图上。

## 调优

如果你有大仓库（> 200 个 markdown 文件），把 `src/worker/search.ts` 中
的 `MAX` 常量调大。当前的限制是有意保守的，因为冷启动时间随语料库
线性增长。
