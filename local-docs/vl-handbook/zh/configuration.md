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
