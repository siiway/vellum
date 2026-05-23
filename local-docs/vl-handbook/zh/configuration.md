---
title: 配置参考
description: "vellum.config.json 的每个字段都有解释，附带示例。"
---

# 配置参考

Vellum 启动时只读一个文件：项目根目录的 `vellum.config.json`。它的形状
被位于 `src/shared/site-schema.json` 的 JSON Schema 完整描述——只要在
文件顶部保留 `"$schema": "./src/shared/site-schema.json"` 这一行，现代
编辑器就会在编辑配置时自动补全和校验。

这份 schema 是由 `bun run gen:schema` 从
[`src/shared/types.ts`](https://github.com/siiway/vellum/blob/main/src/shared/types.ts)
生成的；当你新增字段时去改类型文件即可。

## 顶层结构

```json
{
  "$schema": "./src/shared/site-schema.json",
  "site": {
    /* SiteConfig */
  },
  "repos": [
    /* RepoConfig, ... */
  ],
  "nav": [
    /* NavItem, ... */
  ]
}
```

`site` 和 `repos` 必填；`nav` 可选，是 **站点级别** 的顶部导航
（每个仓库可以通过 `vellum.json#nav` 覆盖它）。

## SiteConfig

| 字段            | 必填 | 说明                                                                       |
| --------------- | :--: | -------------------------------------------------------------------------- |
| `title`         |  ✓   | NavBar 中的品牌名以及 `<title>` 后缀。                                     |
| `homepageRepo`  |  ✓   | 充当主页的仓库 slug。`/` 会重定向到这里。                                  |
| `defaultLocale` |  ✓   | URL 中没有语言前缀时使用的语言代码。                                       |
| `locales`       |  ✓   | `[ { code, label, prefix } ]`。`prefix` 为空表示该语言位于每个仓库的根。   |
| `tagline`       |      | 在 `home` 布局的落地页上显示。                                             |
| `logo`          |      | 站点 logo 的 URL。                                                         |
| `favicon`       |      | favicon 的 URL。                                                           |
| `themeColor`    |      | `<meta name="theme-color">` 的十六进制值，例如 `#0078d4`。                 |
| `footer`        |      | 每个页面底部展示的页脚文字。                                               |

::: tip 一个主页，多种来源
把 `homepageRepo` 指向一个使用 `layout: ms-learn` 的本地源仓库，就能得到
一个 Microsoft Learn 风格的落地页（见 [布局](./layouts)）。自带的配置
正是这么做的——落地页位于 `local-docs/homepage/`。
:::

## AI 摘要

对应 Microsoft Learn 的 "AI Summary" 按钮。配置了 `site.aiSummary` 之后，
每个文档页都会在标题下方出现一颗小药丸按钮，点击后会以 SSE 流式
方式生成一段 2–4 段的摘要并展开到卡片里。

```json
"site": {
  "aiSummary": {
    "provider": "openai-compatible",
    "model": "openai/gpt-4o-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "turnstileSiteKey": "0x4AAA...",
    "cacheTtlSeconds": 604800
  }
}
```

| 字段               |             必填             | 说明                                                                                                |
| ------------------ | :--------------------------: | --------------------------------------------------------------------------------------------------- |
| `provider`         |              ✓               | `"workers-ai"`、`"openai-compatible"` 或 `"anthropic"`。                                            |
| `model`            |                              | 模型 id。默认分别为 Llama 3.3 70B Fast / gpt-4o-mini / Haiku 4.5。                                  |
| `baseUrl`          |                              | OpenAI 兼容端点的 base URL（OpenRouter、Together、自建网关等）。`VELLUM_AI_BASE_URL` 优先级更高。   |
| `turnstileSiteKey` |                              | Cloudflare Turnstile 的 site key。配置后，按钮会在调用模型前向访客发起人机验证。                    |
| `cacheTtlSeconds`  |                              | 生成的摘要在 KV 中的存活时间，默认 7 天。                                                           |

凭据通过 worker 的环境变量配置，不写在 vellum.config.json 里：

- `VELLUM_AI_API_KEY` —— `openai-compatible` 和 `anthropic` 的 bearer /
  x-api-key。`workers-ai` 不需要。
- `VELLUM_AI_BASE_URL` —— 覆盖 `aiSummary.baseUrl`。当同一份配置部署到
  多个环境时很有用。
- `VELLUM_TURNSTILE_SECRET` —— 与 `turnstileSiteKey` 成对出现，二者必须
  同时配置；只配一半会被服务端拒绝。

如果使用 `workers-ai`，请确保 `wrangler.jsonc` 里有
`"ai": { "binding": "AI" }`。

## 问问 AI

由 NavBar 上的按钮触发的对话抽屉。访客提出问题，AI 通过文档工具进行
agent 循环并把答案流式回传。通过 `site.aiChat` 配置：

```json
"site": {
  "aiChat": {
    "provider": "openai-compatible",
    "model": "openai/gpt-4o-mini",
    "baseUrl": "https://openrouter.ai/api/v1",
    "turnstileSiteKey": "0x4AAA...",
    "maxIterations": 6
  }
}
```

| 字段               | 必填 | 说明                                                                              |
| ------------------ | :--: | --------------------------------------------------------------------------------- |
| `provider`         |  ✓   | 与 `aiSummary.provider` 矩阵相同。工具调用在 `openai-compatible` 和 `anthropic` 上最可靠。 |
| `model`            |      | 直接传给 provider 的模型 id。                                                     |
| `baseUrl`          |      | openai-compatible provider 的 base URL 覆盖。                                     |
| `turnstileSiteKey` |      | Cloudflare Turnstile 的 site key。每个对话只验证一次，服务端会发放 60 分钟有效的签名 token。 |
| `maxIterations`    |      | 每条用户消息允许的最大 agent 工具调用轮数。默认 6。                                |

AI 可自行调用以下工具：

- `search_docs(query, repo?, locale?)` —— 全文搜索，最多返回 10 条结果。
- `fetch_page(repo, page, locale?)` —— 读取指定页面的纯文本内容。
- `list_repos()` —— 列出站点上的所有仓库。
- `list_pages(repo, locale?)` —— 列出仓库内的所有页面。

凭据与 AI 摘要功能共用同一组环境变量（`VELLUM_AI_API_KEY`、
`VELLUM_AI_BASE_URL`、`VELLUM_TURNSTILE_SECRET`）。聊天功能多一个独有
secret：

- `VELLUM_SESSION_SECRET` —— 用于签发对话 session token 的 HMAC 密钥
  （建议 32 字节以上）。生产环境用 `wrangler secret put` 配置；轮换该密钥
  会让所有进行中的对话失效。

### MCP 服务器

上述文档工具也通过 **`/api/mcp`** 以 JSON-RPC 2.0 形式暴露出来，遵循
[Model Context Protocol](https://modelcontextprotocol.io) 规范。外部 MCP
客户端（Claude Desktop、ChatGPT Connectors、mcp-inspector、自建 agent）
可以直接连这个 URL 调用工具——文档站本来就是公开的，所以不需要 API key。

在 Claude Desktop 里加入下面的配置即可使用：

```json
{
  "mcpServers": {
    "vellum-docs": {
      "url": "https://docs.example.com/api/mcp"
    }
  }
}
```

该端点只读，实现了 `initialize`、`tools/list`、`tools/call` 和 `ping`，
不提供 resources、prompts 或 sampling。

## RepoConfig

一个仓库代表一段文档——URL 空间里的一个区段（`/<slug>/...`）、一份
侧边栏、一份搜索索引。通常每个你需要写文档的 GitHub 仓库对应一条
RepoConfig，外加几个可选的本地源用于手册和落地页。

| 字段              | 必填 | 说明                                                                          |
| ----------------- | :--: | ----------------------------------------------------------------------------- |
| `slug`            |  ✓   | URL 片段。必须匹配 `^[a-z0-9][a-z0-9-]*$`。                                   |
| `displayName`     |  ✓   | 显示在品牌面包屑和 404 建议里。                                               |
| `docsRoot`        |  ✓   | 数据源内到文档树的相对路径。空字符串表示数据源根目录。                        |
| `source`          |      | `"github"`（默认）或 `"local"`。详见 [数据源](./sources)。                    |
| `owner`           | ✓¹   | GitHub 用户/组织名。仅当 `source: "github"` 时必填。                          |
| `repo`            | ✓¹   | GitHub 仓库名。仅当 `source: "github"` 时必填。                               |
| `branch`          | ✓¹   | 默认分支。仅当 `source: "github"` 时必填。会用作缓存 key 的后缀。             |
| `localPath`       |      | 覆盖默认的 `local-docs/{slug}`。仅适用于本地源。                              |
| `description`     |      | 仓库主页上显示的简介，也是 SSR meta description 的回退。                      |
| `logo`            |      | 仓库级别的 logo URL。                                                         |
| `editLinkPattern` |      | "编辑此页面" 的模板——`:path` 会被替换成文档根的相对路径。                     |
| `versions`        |      | 可选的版本选择器。`[ { label, branch, default? } ]`。                         |
| `hideInBrand`     |      | 在站点标题后隐藏该仓库的 displayName 面包屑。对主页仓库很有用。               |

¹ 条件性必填：JSON Schema 在 `source` 为 `"github"`（或省略）时强制要求
`owner` / `repo` / `branch`。

::: details 完整示例

```json
{
  "slug": "prism",
  "owner": "siiway",
  "repo": "prism",
  "branch": "main",
  "docsRoot": "docs",
  "displayName": "Prism",
  "description": "Self-hosted OAuth 2.0 / OpenID Connect on Cloudflare Workers.",
  "logo": "https://icons.siiway.org/prism/icon.svg",
  "editLinkPattern": "https://github.com/siiway/prism/edit/main/docs/:path",
  "versions": [
    { "label": "main", "branch": "main", "default": true },
    { "label": "v1", "branch": "v1" }
  ]
}
```

:::

## NavItem

站点级别的顶部导航。当读者位于某个仓库内时，该仓库的 nav
（来自 `vellum.json#nav` 或 VitePress 的 `themeConfig.nav`）优先于站点级。

| 字段          | 必填 | 说明                                                                |
| ------------- | :--: | ------------------------------------------------------------------- |
| `text`        |  ✓   | NavBar 上显示的文字。                                               |
| `link`        | ✓²   | 目标 URL 或站点根相对路径。`link` 和 `items` 必须二选一。           |
| `items`       | ✓²   | 子项，把当前项变成下拉菜单。                                        |
| `activeMatch` |      | 一个针对仓库内相对路径的正则，匹配时把该项保持高亮。                |

² `link` / `items` 必须恰好二选一（由 JSON Schema 的 `oneOf` 强制）。

## 环境变量

把它们放进 `wrangler.jsonc#vars`（或对敏感数据使用 `wrangler secret put`）：

| 变量                       |       默认值       | 用途                                                                                                                                          |
| -------------------------- | :----------------: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `VELLUM_GITHUB_TOKEN`      |        空          | `raw.githubusercontent.com` 与 GitHub API 的鉴权 token。私有仓库必填；公开仓库设置后能避免触碰限流。                                          |
| `VELLUM_WEBHOOK_SECRET`    |        空          | `/api/webhook` 用于 HMAC 签名的共享密钥。需要 webhook 缓存失效时必填。                                                                        |
| `VELLUM_CACHE_TTL_SECONDS` |       `300`        | 原始 markdown / 文件树 / 侧边栏等条目的 TTL。                                                                                                 |
| `VELLUM_HTML_TTL_SECONDS`  |        `60`        | 渲染好的 HTML 的 TTL。                                                                                                                        |
| `VELLUM_KROKI_URL`         | `https://kroki.io` | 覆盖 mermaid SSR 使用的 Kroki 端点。自部署用户可以指向自己的实例。                                                                            |

KV 在 `wrangler.jsonc#kv_namespaces` 中单独绑定。没有 KV 时 worker
仍可工作——只会退化为仅使用 PoP 级别的 Cache API。

## 重新生成 schema

修改 `src/shared/types.ts` 之后：

```bash
bun run gen:schema
```

这会基于 TypeScript 类型重新生成 `src/shared/site-schema.json`，
同时保留 `scripts/gen-site-schema.ts` 里定义的描述、正则模式、
以及条件性必填规则。
