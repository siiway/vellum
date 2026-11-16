---
title: "数据源：GitHub 与本地"
description: "Vellum 从哪里读取 Markdown，以及如何选择。"
---

# 数据源

`vellum.config.json` 中的每个仓库都有一个 `source` 字段，决定构建时从哪里读
markdown。无论哪种，仓库最终都是磁盘上的一个目录，位于
[`src/build/sources.ts`](https://github.com/siiway/vellum/blob/main/app/src/build/sources.ts)
的代码把这种差异对构建的其它部分屏蔽——页面、侧边栏、搜索、xref、OPS 扩展对
两种数据源的工作方式完全一致。

## GitHub 源（`source: "github"`）

默认值。构建时会把仓库的 `branch`（或 `versions` 中的默认项）克隆到
`app/.sources/{slug}`，之后的构建会更新这个克隆。它是部分克隆
（`--filter=blob:none`）：包含"最近更新"所需的完整历史，但只包含当前提交的文件。

```json
{
  "slug": "prism",
  "owner": "siiway",
  "repo": "prism",
  "branch": "main",
  "docsRoot": "docs",
  "displayName": "Prism"
}
```

::: tip 鉴权
公开仓库可以匿名克隆。私有仓库需要把 `VELLUM_GITHUB_TOKEN` 设置成能读取它们的
令牌（具有 Contents: read 权限的细粒度 PAT 即可）。令牌以请求头发送，不会存进克隆。
:::

### 最近更新信息

页脚显示最近一次修改该页面文件的提交，数据来自每次构建对克隆执行的一次
`git log`。

### 获取新的提交

一次构建是每个仓库的快照。`bun run update` 只重新渲染自上次构建以来分支有
变动的仓库；**Update content** 工作流每小时以及按需运行它。详见
[更新内容](./updating-content)。

## 本地源（`source: "local"`）

Markdown 位于 `app/` 下的某个目录中，与 Vellum 在同一个仓库：

```json
{
  "slug": "vl-handbook",
  "source": "local",
  "docsRoot": "",
  "displayName": "Vellum Handbook"
}
```

默认构建会读取 `local-docs/{slug}/`；想用别的目录请通过 `localPath` 覆盖。

### 为什么使用本地源

- **与 Vellum 一起发布的文档。** 本手册就是一个本地源。
- **落地页。** 自带配置里的 `homepage` 仓库就是本地源——它使用结构化的
  `layout: ms-learn` frontmatter，那种东西放在代码仓库里很别扭。
- **离线构建。** 不需要克隆，也不需要网络。
- **测试 / 脚手架。** 在另外建仓库之前快速放点本地内容。

### 本地源与远程的区别

| 能力                  | 本地源的状态                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| 最近更新页脚          | 跳过——构建不读取本仓库的历史。                                                                                |
| 在 GitHub 上编辑按钮  | 默认跳过；除非设置了 `editLinkPattern`（即便如此，"编辑" 也指向 GitHub，需要手动同步）。                      |
| 发布修改              | 在本仓库提交：推送会部署站点。增量更新会跳过本地仓库。                                                        |

## 混用数据源

同一站点可以任意混合 GitHub 与本地仓库。自带配置就是这么做的：

```json
{
  "repos": [
    {
      "slug": "prism",
      "source": "github",
      "owner": "siiway",
      "repo": "prism",
      "branch": "main",
      "docsRoot": "docs",
      "displayName": "Prism"
    },
    {
      "slug": "glint",
      "source": "github",
      "owner": "siiway",
      "repo": "glint",
      "branch": "main",
      "docsRoot": "docs",
      "displayName": "Glint"
    },
    {
      "slug": "vl-handbook",
      "source": "local",
      "docsRoot": "",
      "displayName": "Vellum Handbook"
    },
    {
      "slug": "homepage",
      "source": "local",
      "docsRoot": "",
      "displayName": "SiiWay Documentation",
      "hideInBrand": true
    }
  ]
}
```

::: note Slug 的唯一性
slug 必须在整个站点内唯一——构建用它作为语言前缀之后的 URL 段、克隆目录名
和搜索索引 key。JSON Schema 不强制这点；查找时只会取第一条匹配。
:::

## 跨仓库链接

仓库之间的 markdown 链接使用 `@slug/path` 简写形式，无论数据源类型
构建都会把它解析为 `/{prefix}/slug/path`：

```md
See [the Prism quickstart](@prism/getting-started) for the OAuth flow.
```

xref（`<xref:Uid>` 与 `[text](xref:Uid)`）方式相同——xrefmap 按仓库加载，
解析时按当前页面所属的仓库进行。
