---
title: 快速开始
description: "安装 Vellum，指向一个仓库，然后把文档站点部署到 Cloudflare。"
---

# 快速开始

本指南将带你从一次全新的 clone 开始，在大约十分钟内完成一个上线的文档站点。
我们假设你已经准备好：

- 已安装 **Node 22+** 和 **Bun 1.1+**（Bun 同时充当包管理器和脚本运行器，
  Vite 通过它运行）。
- 一个开启了 workers 子域名的 **Cloudflare 账号**。
- 一个具有 `repo` 权限的 **GitHub 个人访问令牌**（仅当你需要从私有仓库
  拉取时使用；公开仓库可以匿名访问）。

::: tip 直接使用箱内已有的内容
仓库自带的 `vellum.config.json` 已经接好了两个真实的 SiiWay 项目
（`siiway/prism`、`siiway/glint`）以及本地的这份手册。你可以直接用这份配置
跑起来 worker，在接入自己的内容之前先把功能玩一遍。
:::

## 1. 克隆并安装

```bash
git clone https://github.com/siiway/vellum.git
cd vellum
bun install
```

## 2. 本地开发

```bash
bun run dev
```

这条命令会先跑一次 `vite build`（确保客户端 bundle 和 `local-docs` 资源
存在磁盘上），然后启动 `wrangler dev` 监听 `http://127.0.0.1:8787`。
Worker 会自动重载；客户端 bundle 在你编辑 React 代码后需要再跑一次
`bun run build:client`。

::: note
对任何 GitHub 来源页面的首次请求会花费约 500ms，因为 worker 需要拉取
markdown 并跑一遍 Shiki + Mermaid。后续请求会命中边缘缓存，在个位数
毫秒内返回。
:::

## 3. 配置你的仓库

打开 [`vellum.config.json`](./configuration)，把自带的示例替换为你自己的。
一条最简的仓库配置长这样：

# [GitHub 源](#tab/github)

```json
{
  "slug": "my-docs",
  "owner": "your-github-org",
  "repo": "my-repo",
  "branch": "main",
  "docsRoot": "docs",
  "displayName": "My Docs"
}
```

Worker 会从
`https://raw.githubusercontent.com/your-github-org/my-repo/main/docs/...`
拉取 Markdown。

# [本地源](#tab/local)

```json
{
  "slug": "my-docs",
  "source": "local",
  "docsRoot": "",
  "displayName": "My Docs"
}
```

把 `.md` 文件放进 `local-docs/my-docs/`。Vite 插件会在构建时把它们打包
进 worker 的 `ASSETS`，并生成一份供 worker 枚举目录使用的 `manifest.json`。

---

完整对比和其它配置项见 [数据源](./sources)。

## 4. 写一个页面

新建 `docs/index.md`（或 `local-docs/my-docs/index.md`）：

````md
---
title: My Docs
description: A short tagline.
---

# Welcome

This page uses **Markdown**, plus a few Vellum extras:

::: tip
Callouts work like in VitePress.
:::

```mermaid
flowchart LR
  A --> B
```
````

`​``

````

刷新开发服务器——页面就在 `/my-docs/`。

## 5. 部署

准备好推到 Cloudflare 时：

```bash
bun run deploy
````

`bun run deploy` 会先跑客户端构建，再执行 `wrangler deploy`——后者会把
worker 和所有静态资源（包括打包进去的 `local-docs/...`）一并上传。
结束后你会看到一个 `https://vellum.<你的-subdomain>.workers.dev` 形式的 URL。

::: warning 配置 GitHub webhook 来让缓存失效
默认情况下边缘缓存会保留渲染好的 HTML 60 秒。如果你发布得很频繁，
建议在每个 GitHub 仓库上挂一个指向 `https://your-worker.example/api/webhook`
的 `push` webhook。Worker 会根据 payload 中的 `commits[]` 精准地失效
受影响的缓存条目。详见 [缓存与部署](./caching-and-deployment#webhooks)。
:::

## 各数据源支持的功能

| 功能                  | GitHub 源 | 本地源 |
| --------------------- | :-------: | :----: |
| Markdown 渲染         |     ✓     |   ✓    |
| 侧边栏发现            |     ✓     |   ✓    |
| 搜索索引              |     ✓     |   ✓    |
| OPS 扩展              |     ✓     |   ✓    |
| 通过 Kroki SSR Mermaid|     ✓     |   ✓    |
| 数学公式（MathJax）   |     ✓     |   ✓    |
| xref 解析             |     ✓     |   ✓    |
| "最近更新" 页脚       |     ✓     |   —    |
| 在 GitHub 上编辑按钮  |     ✓     |   —    |
| Webhook 缓存失效      |     ✓     |   —    |

本地仓库没有"最近更新"和编辑链接的功能，因为 worker 没有可以查询提交
信息的远端；它们的缓存通过重新构建 worker 来失效。

## 下一步

- 浏览 [配置参考](./configuration) 了解每一个设置项。
- 通读 [Markdown 特性](./markdown) 和 [OPS 扩展](./ops-extensions)，
  熟悉作者们能写的内容。
- 在添加非英语内容之前先看 [国际化](./i18n)——URL 前缀的形态最好在
  一开始就决定下来。
