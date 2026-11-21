---
title: 搜索
description: "单仓库对话框与跨仓库整页搜索。"
---

# 搜索

Vellum 提供两种搜索界面，都在读者的浏览器里运行同一套搜索：

1. 一个 **命令面板对话框**（Ctrl K / Cmd K / `/`），作用范围限定为当前仓库。在不属于任何仓库的搜索页和语言页上，它搜索每个仓库（设置了 `excludeFromSearch` 的除外）。
2. 一个位于 `/{prefix}/search` 的 **整页搜索**，会跨站点内的每个仓库展开（设置了 `excludeFromSearch` 的仓库除外）。

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

::: note 为什么不上花哨的索引器
一个 50 页仓库的完整索引不到 50KB。更聪明的打分（BM25、语义嵌入）
对这种规模收益有限，反而会让下载量和代码都变大。
:::

## 查询语法

| 查询           | 找到                           |
| -------------- | ------------------------------ |
| `oauth setup`  | 标题或正文中包含每个词的页面   |
| `"exact text"` | 包含该短语的页面               |
| `-term`        | 排除包含该词的页面             |
| `title:foo`    | 标题包含 `foo` 的页面          |
| `repo:slug`    | 只搜该仓库（在整页搜索中有用） |

词出现在标题中得 5 分，正文中得 1 分；短语分别得 8 分和 3 分；
`title:` 词得 10 分。结果按分数排序：对话框显示前 10 条，整页搜索显示前 30 条。

整页搜索会在输入时补全限定符。一个词开始拼出限定符时（`ti`、`re`）会给出 `title:` 或 `repo:`，`repo:` 之后会列出跨仓库搜索覆盖的仓库 slug。按 Tab 采用建议，按 ↓ 再按 Enter 选择其他建议，按 Esc 隐藏。后面还没写内容的限定符会被忽略，所以在写完之前，查询其余部分的结果不受影响。

## 同义词

每个词也会匹配它的同义词，所以搜索 `latex` 能找到写着 `mathjax` 的页面。
同义词命中得分更低（标题 2 分，正文 0.4 分），所以使用原词的页面排在前面。
内置列表覆盖常见词（math、auth、config、install 等）。用 `searchAliases`
添加你自己的，可以写在站点上，也可以写在仓库上：

```json
"searchAliases": { "idp": ["identity provider", "oidc"] }
```

同名的键会替换内置条目，仓库的条目会替换站点的。同义词是单向的：
想要双向就把两个方向都写上。

## 对话框

由 `Ctrl K`（macOS 上是 `Cmd K`）或 `/` 触发。实现位于
[`src/web/components/SearchDialog.tsx`](https://github.com/siiway/vellum/blob/main/app/src/web/components/SearchDialog.tsx)。

特性：

- 防抖（180 ms）：输入停顿时才执行搜索。
- 键盘导航（↑ / ↓ / Enter / Esc）。
- 最近搜索记录持久化在 localStorage，最多 8 条。“清除”清空列表，× 移除一条。
- "在所有仓库中搜索 …" 升级链接，跳到整页搜索。

## 整页搜索

URL：`/{prefix}/search`（`/search` 会重定向到默认语言的搜索页）。这个页面是
构建为每种语言写出的空外壳——没有 markdown、没有侧边栏 / 大纲，占满整个视口。

作者可以链到一个预填查询：

```md
[Search for "OAuth"](../search?q=OAuth)
```

行为：

- 读者开始输入之前，页面显示起始屏：最近的搜索、每个仓库一张卡片（设了 `excludeFromSearch` 的除外，点击即把搜索限定到该仓库），以及查询语法。
- `?q=…` 在加载时填进输入框。
- `?repo=<slug>` 把结果限定到单个仓库；省略（或设为 `*`）则跨仓库。
- 有了查询或范围之后，输入框下方的仓库标签页用来切换范围。
- URL 通过 `history.replaceState` 保持同步，刷新 / 分享时查询不丢失。
- 最近搜索记录与对话框共用，清除和移除的方式也相同。

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

要让整个仓库不参与跨仓库搜索，在它上面设置 `excludeFromSearch`，自带配置对主页仓库就是这么做的。搜索页也不再为它显示卡片或标签页，但 `?repo=<slug>` 仍然能搜索它。针对单个页面的正式 `frontmatter.noindex: true` 标志已在路线图上。

## 调优

如果你有大仓库（> 200 个 markdown 文件），把 `src/build/search-index.ts`
中的 `MAX_DOCS` 调大。这个限制是有意保守的，因为读者第一次搜索时要下载
整份索引。
