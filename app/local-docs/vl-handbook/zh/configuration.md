---
title: 配置参考
description: "vellum.config.json 的每个字段都有解释，附带示例。"
---

# 配置参考

Vellum 的构建只读一个文件：`app/vellum.config.json`。它的形状
被位于 `src/shared/site-schema.json` 的 JSON Schema 完整描述——只要在
文件顶部保留 `"$schema": "./src/shared/site-schema.json"` 这一行，现代
编辑器就会在编辑配置时自动补全和校验。

这份 schema 是由 `bun run gen:schema` 从
[`src/shared/types.ts`](https://github.com/siiway/vellum/blob/main/app/src/shared/types.ts)
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
| `homepageRepo`  |  ✓   | 充当主页的仓库 slug，主页位于 `/{prefix}`。                                |
| `defaultLocale` |  ✓   | 没有语言前缀的 URL 所去的语言，也是 `/` 最后的回退。                       |
| `locales`       |  ✓   | `[ { code, label, prefix } ]`。`prefix` 为空表示该语言的 URL 不带前缀。    |
| `tagline`       |      | 在 `home` 布局的落地页上显示。                                             |
| `logo`          |      | 站点 logo 的 URL。                                                         |
| `favicon`       |      | favicon 的 URL。                                                           |
| `themeColor`    |      | 强调色（按钮、链接、焦点）及 `<meta name="theme-color">`，例如 `#0078d4`。 |
| `footer`        |      | 每个页面底部展示的页脚文字。                                               |
| `url`           |      | 站点的公开源地址，例如 `https://docs.example.com`。见下文。                |
| `socialLinks`   |      | NavBar 中的图标链接，`[ { icon, link, ariaLabel? } ]`，同 VitePress。      |
| `searchAliases` |      | 搜索同义词，`{ 词: [同义词] }`。见 [搜索](./search#同义词)。               |

`url` 让每个页面 head 中的 canonical、Open Graph 和 hreflang URL 成为绝对地址，
sitemap 也需要它。没有它时这些 URL 保持为以根开头的相对地址，`og:url` 会被省略，
构建也不会写出 `sitemap.xml`。

::: tip 一个主页，多种来源
把 `homepageRepo` 指向一个使用 `layout: ms-learn` 的本地源仓库，就能得到
一个 Microsoft Learn 风格的落地页（见 [布局](./layouts)）。自带的配置
正是这么做的——落地页位于 `local-docs/homepage/`。
:::

## RepoConfig

一个仓库代表一段文档——URL 空间里的一个区段（`/{prefix}/{slug}/...`）、一份
侧边栏、一份搜索索引。通常每个你需要写文档的 GitHub 仓库对应一条
RepoConfig，外加几个可选的本地源用于手册和落地页。

| 字段                | 必填 | 说明                                                                             |
| ------------------- | :--: | -------------------------------------------------------------------------------- |
| `slug`              |  ✓   | URL 片段。必须匹配 `^[a-z0-9][a-z0-9-]*$`。                                      |
| `displayName`       |  ✓   | 显示在品牌面包屑和 404 建议里。                                                  |
| `docsRoot`          |  ✓   | 数据源内到文档树的相对路径。空字符串表示数据源根目录。                           |
| `source`            |      | `"github"`（默认）或 `"local"`。详见 [数据源](./sources)。                       |
| `owner`             |  ✓¹  | GitHub 用户/组织名。仅当 `source: "github"` 时必填。                             |
| `repo`              |  ✓¹  | GitHub 仓库名。仅当 `source: "github"` 时必填。                                  |
| `branch`            |  ✓¹  | 构建克隆的分支。仅当 `source: "github"` 时必填。                                 |
| `localPath`         |      | 覆盖默认的 `local-docs/{slug}`。仅适用于本地源。                                 |
| `description`       |      | 仓库首页的 frontmatter 没有设置描述时，用作它的描述。                            |
| `logo`              |      | 仓库级别的 logo URL。                                                            |
| `editLinkPattern`   |      | "编辑此页面" 的模板——`:path` 会被替换成文档根的相对路径。                        |
| `versions`          |      | `[ { label, branch, default? } ]`。只构建 `default` 的那一项（没有则取第一项）。 |
| `localeDirs`        |      | 各语言代码对应的源目录。详见 [国际化](./i18n#每个仓库的内容布局)。               |
| `landingPage`       |      | 仓库根 URL 重定向到的路径，例如按目录分版本的文档用 `"v0.4"`。                   |
| `hideInBrand`       |      | 在站点标题后隐藏该仓库的 displayName 面包屑。对主页仓库很有用。                  |
| `excludeFromSearch` |      | 不参与跨仓库搜索，例如主页仓库。                                                 |
| `socialLinks`       |      | 读者位于该仓库内时 NavBar 显示的图标链接，替代站点级的。                         |
| `searchAliases`     |      | 该仓库的搜索同义词，叠加在站点级之上。                                           |

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
  "searchAliases": { "idp": ["identity provider", "oidc"] }
}
```

:::

## NavItem

站点级别的顶部导航。当读者位于某个仓库内时，该仓库的 nav
（来自 `vellum.json#nav` 或 VitePress 的 `themeConfig.nav`）优先于站点级。

| 字段          | 必填 | 说明                                                                 |
| ------------- | :--: | -------------------------------------------------------------------- |
| `text`        |  ✓   | NavBar 上显示的文字。                                                |
| `link`        |  ✓²  | 目标 URL 或站点根相对路径。`link` 和 `items` 必须二选一。            |
| `items`       |  ✓²  | 子项，把当前项变成下拉菜单。                                         |
| `activeMatch` |      | 针对页面在文档中路径（`/zh/guide/intro`）的正则，与 VitePress 相同。 |

² `link` / `items` 必须恰好二选一（由 JSON Schema 的 `oneOf` 强制）。

## 环境变量

构建时从环境中读取这些变量：

| 变量                  |       默认值       | 用途                                                               |
| --------------------- | :----------------: | ------------------------------------------------------------------ |
| `VELLUM_GITHUB_TOKEN` |         空         | 克隆私有仓库用的令牌。公开仓库不需要。                             |
| `VELLUM_KROKI_URL`    | `https://kroki.io` | 覆盖渲染 mermaid 使用的 Kroki 端点。自部署用户可以指向自己的实例。 |

在 GitHub Actions 中，把 `VELLUM_GITHUB_TOKEN` 设为仓库 secret，工作流会把它
传给构建。部署后的站点不需要任何变量或绑定：它只有静态资源。

## 重新生成 schema

修改 `src/shared/types.ts` 之后：

```bash
bun run gen:schema
```

这会基于 TypeScript 类型重新生成 `src/shared/site-schema.json`，
同时保留 `scripts/gen-site-schema.ts` 里定义的描述、正则模式、
以及条件性必填规则。
