---
title: 构建与部署
description: "Vellum 如何把文档仓库构建成静态站点并部署到 Cloudflare。"
---

# 构建与部署

Vellum 是一个静态站点生成器：构建时预先渲染好每个页面，Cloudflare 以
[Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)
的形式提供构建结果，每个请求都不运行任何代码。

## 构建

在 `app/` 下运行：

| 命令                             | 作用                                                           |
| -------------------------------- | -------------------------------------------------------------- |
| `bun run build`                  | 先 `build:client`，再 `build:pages`。                          |
| `bun run build:client`           | Vite 把 React 客户端构建到 `dist/client`。                     |
| `bun run build:pages`            | 克隆或更新每个 GitHub 仓库，然后把每个页面渲染到 `dist/site`。 |
| `bun run build:pages --no-fetch` | 同上，但使用 `.sources/` 中已有的克隆。                        |
| `bun run update`                 | 只重新渲染有变更的仓库。详见 [更新内容](./updating-content)。  |
| `bun run deploy`                 | 先 `bun run build`，再 `wrangler deploy`。                     |

`build:pages` 需要客户端构建：每个页面都会引用带 hash 的 bundle。

### 构建产物

```
dist/site/
  index.html                       / —— 选择语言后重定向
  404.html, {prefix}/404.html      各语言的 404 页面
  {prefix}/index.html              落地页（主页仓库）
  {prefix}/{repo}/…/index.html     每个页面一个
  {prefix}/search/, languages/     搜索页和语言页
  _vellum/pages/{page}.json        每个页面的数据，供客户端导航使用
  _vellum/search/{locale}/{repo}.json   搜索索引
  _vellum/vue/{repo}/{Name}.vue    页面挂载的 Vue 组件
  _redirects, _headers             由 Cloudflare 应用
  robots.txt, sitemap.xml
  assets/                          客户端 bundle
```

每个页面的 HTML 都是完整的：服务端渲染的标记、样式、SEO head，以及客户端
hydrate 所用的数据。在站内点击链接时，只会从 `_vellum/pages/` 拉取下一个页面的
JSON。

页面以浅色主题渲染。当读者选择了深色，或系统是深色时，每个页面 head 中的脚本会在
首次绘制之前切换到深色。

构建是确定性的：用未变更的源重新构建会得到相同的文件，只有 Kroki 每次绘制都略有
不同的图表例外。`wrangler deploy` 只上传内容有变化的文件。

### 外部服务

| 服务   | 用途                        | 可配置项                              |
| ------ | --------------------------- | ------------------------------------- |
| GitHub | 克隆文档仓库                | `VELLUM_GITHUB_TOKEN`（私有仓库）     |
| Kroki  | Mermaid 图表（浅色 + 深色） | `VELLUM_KROKI_URL` 环境变量（自部署） |

两者都只在构建时使用。如果 Kroki 不可达，图表会不带 SVG 发布，由读者的浏览器用
mermaid 渲染。

## 缓存

`_headers` 让 `/assets/` 下带 hash 的 bundle 在一年内不可变。其它文件使用
Cloudflare 对静态资源的默认设置：浏览器会重新验证，文件未变时得到 `304`。部署
立即可见，没有需要清除的缓存。

## 部署

```bash
bun run deploy
```

要部署到生产环境以外的地方，使用 `wrangler.jsonc` 中的 `preview` 环境
（`workers.dev`，不绑定自定义域名）：

```bash
bun run build && bunx wrangler deploy --env preview
```

### GitHub Actions

两个工作流负责部署生产环境：

| 工作流             | 触发时机                                | 作用                                       |
| ------------------ | --------------------------------------- | ------------------------------------------ |
| **Deploy**         | 推送到 `main`，或手动运行（重新部署）   | 检查、完整构建、部署。                     |
| **Update content** | 每小时、`repository_dispatch`、手动运行 | 重新渲染有变更的文档仓库；有变更时才部署。 |

两者都需要 `CLOUDFLARE_API_TOKEN`（Workers Scripts:Edit，自定义域名还需要
Workers Routes:Edit 与 Zone:Read），私有文档仓库还需要 `VELLUM_GITHUB_TOKEN`。
它们共享同一个并发组，因此不会重叠。第二个工作流的原理见
[更新内容](./updating-content)。
