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
  {prefix}.md, {prefix}/{repo}/….md   每个页面的 Markdown，见下文
  {prefix}/search/, languages/     搜索页和语言页
  _vellum/pages/{page}.json        每个页面的数据，见下文
  _vellum/404/{locale}.json        404 页面的数据
  _vellum/search/{locale}/{repo}.json   搜索索引
  _vellum/vue/{repo}/{Name}.vue    页面挂载的 Vue 组件
  _redirects, _headers             由 Cloudflare 应用
  robots.txt, sitemap.xml
  .well-known/                     给 AI 智能体的文件，见下文
  assets/                          客户端 bundle
```

每个页面的 HTML 都是完整的：预渲染的标记、样式和 SEO head，不运行 JavaScript
也能阅读。客户端 hydrate 所用的数据不在页面里，而在 `_vellum/pages/` 下该页面的
JSON 中，由页面的 head 预加载。在站内点击链接时，只会拉取下一个页面的 JSON。

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

## AI 智能体

站点只用静态文件告诉 AI 智能体它有哪些内容、可以如何使用：

- 每个文档页面也以 Markdown 发布，地址是页面 URL 加上 `.md`：
  `/en-US/glint/guide` 的位于 `/en-US/glint/guide.md`，落地页 `/en-US` 的位于
  `/en-US.md`。页面的 head 会链接它（`<link rel="alternate" type="text/markdown">`），
  读者在站内点击链接时，它会一直指向当前显示的页面。Markdown 会把它的页面声明为
  canonical（`Link: rel="canonical"` 头），这样搜索引擎只会收录页面一次。把一个页面
  重定向到另一个页面的规则也会同样重定向它的 Markdown。
- `robots.txt` 声明 [Content Signal](https://contentsignals.org)，即 AI 可以
  如何使用内容，取自 [`site.contentSignal`](./configuration#siteconfig)。
- `/.well-known/agent-skills/index.json` 列出一个
  [agent skill](https://agentskills.io)，`{host}/SKILL.md`：站点有哪些文档、
  有哪些语言、怎样找到并阅读一个页面。`{host}` 是站点的主机名，点换成连字符，
  例如 `docs-example-com`。
- `/.well-known/ard.json` 是一个
  [ARD](https://agenticresourcediscovery.org) 目录，列出同一个 skill。
  它也位于 `/.well-known/ai-catalog.json`，即 ARD 前身的路径，较旧的读取方和
  智能体就绪检查会查找这里。
- `/` 的响应带有指向 skills 索引和该目录的 `Link` 头。
- 每个页面都向在读者浏览器中工作的智能体提供一个 `search_docs`
  [WebMCP](https://webmachinelearning.github.io/webmcp/) 工具。它运行站内搜索；
  不支持 WebMCP 的浏览器会跳过它。

`.well-known` 下的文件和 `Link` 头与 sitemap 一样需要 `site.url`。它们全部来自
配置，所以 `bun run update` 不会改动它们。

页面的 Markdown 就是它的源文件原样，只改了一处：链接按 HTML 页面的方式解析。指向
其他页面的链接指向那些页面的 Markdown（`./setup.md` → `/en-US/glint/guide/setup.md`），
指向其他文件的链接则指向页面所链接的 URL。这个文件发布的位置不是源文件所在的位置
（`guide/index.md` 变成 `guide.md`），所以相对链接会落空。段落里的 `<a href>` 也一样。
图片保持原路径，和页面上一样。代码、HTML 块、frontmatter 里的链接、include 和 OPS
`xref:` 链接都保持原样。

智能体就绪检查还会查找对 `Accept: text/markdown` 返回的 markdown、API 与 OAuth
元数据以及 MCP 服务器。这些需要按请求运行的代码，或站点并没有的 API，所以 Vellum
站点都不提供。它的 Markdown 改由 `.md` URL 提供。

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
有 Deploy 正在运行或排队时，Update content 会跳过自己，因此两者不会重叠。它的原理见
[更新内容](./updating-content)。
