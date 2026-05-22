---
title: "数据源：GitHub 与本地"
description: "Vellum 从哪里读取 Markdown，以及如何选择。"
---

# 数据源

`vellum.config.json` 中的每个仓库都有一个 `source` 字段，决定 worker
从哪里读 markdown。位于
[`src/worker/sources.ts`](https://github.com/siiway/vellum/blob/main/src/worker/sources.ts)
的 dispatcher 把这种差异对 worker 的其它部分屏蔽——路由、侧边栏、搜索、
xref、OPS 扩展对两种数据源的工作方式完全一致。

## GitHub 源（`source: "github"`）

默认值。Worker 从
`https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}` 拉取
原始文件，并把响应缓存到 Cache API（绑定 KV 时也会缓存到 KV）。

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
公开仓库可以匿名访问，但在开发中你会很快撞到 GitHub 的 60 次/小时
匿名限流。把 `VELLUM_GITHUB_TOKEN` 设置成一个具有 `repo`（私有仓库）
或仅 `public_repo`（公开仓库）权限的 PAT。
:::

### 文件树枚举

侧边栏回退和搜索索引都需要列出 `docsRoot` 下的全部 Markdown 文件。
我们使用 GitHub 的
[git/trees API](https://docs.github.com/en/rest/git/trees)
加上 `?recursive=1`，并把结果和原始文件一并缓存。

### 最近更新信息

`fetchSourceLastCommit` 会调用 `GET /repos/{owner}/{repo}/commits?path=…`
并把最近一次提交显示在页脚。缓存 TTL 与原始文件一致。

### 缓存失效

通过 webhook 跟踪——详见 [缓存与部署](./caching-and-deployment#webhooks)。

## 本地源（`source: "local"`）

Markdown 位于项目根下的某个目录中，并在构建期被打包进 worker 的 `ASSETS`：

```json
{
  "slug": "vl-handbook",
  "source": "local",
  "docsRoot": "",
  "displayName": "Vellum Handbook"
}
```

默认 worker 会查找 `local-docs/{slug}/`；想用别的目录请通过 `localPath`
覆盖。

### Vite 插件

`scripts/vite-local-docs.ts` 在 `bun run build:client` 期间运行。它会：

1. 扫描 `local-docs/` 下的每个目录。
2. 把每个文件作为 Vite 资源发布到
   `dist/client/local-docs/{slug}/{relpath}`——不加 Rollup hash，
   这样 worker 才能按字面路径取到。
3. 在每个仓库目录旁写一份列出所有文件路径与大小的 `manifest.json`。

Worker 通过 `env.ASSETS.fetch("/local-docs/{slug}/{path}")` 取文件，
通过 `manifest.json` 枚举文件树。

### 为什么使用本地源

- **与 worker 一起发布的文档。** 本手册就是一个本地源。
- **落地页。** 自带配置里的 `homepage` 仓库就是本地源——它使用结构化的
  `layout: ms-learn` frontmatter，那种东西放在代码仓库里很别扭。
- **断网部署。** Worker 无法访问 github.com 时。
- **测试 / 脚手架。** 在另外建仓库之前快速放点本地内容。

### 本地源与远程的区别

| 能力                  | 本地源的状态                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| 最近更新页脚          | 跳过——worker 无法访问 git 历史。                                                                              |
| 在 GitHub 上编辑按钮  | 默认跳过；除非设置了 `editLinkPattern`（即便如此，"编辑" 也指向 GitHub，需要手动同步）。                      |
| Webhook 缓存失效      | 不适用——重新构建并部署 worker 即可。                                                                          |
| 文件树枚举            | 读 `manifest.json` 而非 GitHub tree API。                                                                     |
| 单文件读取            | `env.ASSETS.fetch()`（同 region、亚毫秒级）而非 `raw.githubusercontent.com`。                                 |

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
slug 必须在整个站点内唯一——worker 用它作为顶级 URL 段、缓存 key
前缀和搜索索引 key。JSON Schema 不强制这点；dispatcher 里的
`find()` 只会取第一条匹配。
:::

## 跨仓库链接

仓库之间的 markdown 链接使用 `@slug/path` 简写形式，无论数据源类型
worker 都会把它解析为 `/slug/path`：

```md
See [the Prism quickstart](@prism/getting-started) for the OAuth flow.
```

xref（`<xref:Uid>` 与 `[text](xref:Uid)`）方式相同——xrefmap 按仓库加载，
解析时按当前页面所属的仓库进行。
