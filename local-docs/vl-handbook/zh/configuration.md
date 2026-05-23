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
| `aiProviders`   |      | 全局 AI 提供商池。见 [AI 提供商](#ai-提供商全局池)。                       |
| `aiSummary`     |      | Microsoft Learn 风格的逐页摘要按钮。见 [AI 摘要](#ai-摘要)。              |
| `aiChat`        |      | Ask-AI 聊天抽屉。见 [Ask AI](#ask-ai)。                                    |
| `translate`     |      | 机器翻译。见 [机器翻译](#机器翻译)。                                       |

::: tip 一个主页，多种来源
把 `homepageRepo` 指向一个使用 `layout: ms-learn` 的本地源仓库，就能得到
一个 Microsoft Learn 风格的落地页（见 [布局](./layouts)）。自带的配置
正是这么做的——落地页位于 `local-docs/homepage/`。
:::

## AI 提供商（全局池）

三个 AI 功能（AI 摘要、问问 AI、机器翻译）都从 `site.aiProviders` 这
份共享的提供商池里取端点。每一条都是完整声明的端点——provider、
model、base URL 和 API key 的 env 变量名都在自己身上。功能要么消费
整个池，要么用自身的 `providers` 白名单挑一个子集。

顺序很关键：worker 按声明顺序从左到右尝试端点，遇到可重试错误
（HTTP 401/402/403/429/5xx 或网络故障）就切到下一个。详见
[故障转移行为](#故障转移行为)。

```jsonc
"site": {
  "aiProviders": [
    {
      "id": "openrouter",
      "provider": "openai-compatible",
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "openai/gpt-4o-mini",
      "apiKeyEnv": "VELLUM_AI_API_KEY"     // 可选，默认值
    },
    {
      "id": "openrouter-backup",
      "provider": "openai-compatible",
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "openai/gpt-4o-mini",
      "apiKeyEnv": "VELLUM_AI_API_KEY_BACKUP"
    },
    {
      "id": "anthropic",
      "provider": "anthropic",
      "model": "claude-haiku-4-5",
      "apiKeyEnv": "VELLUM_AI_API_KEY_ANTHROPIC"
    },
    {
      "id": "workers-ai",
      "provider": "workers-ai",
      "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
    }
  ]
}
```

| 字段        | 必填 | 说明                                                                                                                |
| ----------- | :--: | ------------------------------------------------------------------------------------------------------------------- |
| `id`        |  ✓   | 短标识符（小写 kebab）。功能级 `providers` 过滤通过 id 引用它。                                                     |
| `provider`  |  ✓   | `"workers-ai"`、`"openai-compatible"` 或 `"anthropic"`。                                                            |
| `model`     |      | 该端点的默认模型 id。默认值：Llama 3.3 70B Fast / gpt-4o-mini / Haiku 4.5。功能可以用自己的 `model` 字段覆盖。      |
| `baseUrl`   |      | OpenAI 兼容端点的 base URL（OpenRouter、Together、自建网关等）。`workers-ai` / `anthropic` 忽略此字段。            |
| `apiKeyEnv` |      | API key 的 env 变量名——或者 **数组**，表示同一端点挂多把 key。默认 `VELLUM_AI_API_KEY`。见 [同端点多 key](#同端点多-key)。 |
| `extraBody` |      | 合并进 provider 请求体的 JSON，用来开启 provider 特有的特性（DeepSeek 思考模式、Anthropic 扩展思考、额外采样参数）。见 [provider 请求体扩展](#provider-请求体扩展)。 |

凭据通过 worker 的环境变量配置，不写在 vellum.config.json 里：

- `VELLUM_AI_API_KEY` —— `openai-compatible` 和 `anthropic` 的 bearer /
  x-api-key。`workers-ai` 不需要。在端点上设 `apiKeyEnv` 来切换到别的
  env 变量。
- `VELLUM_AI_BASE_URL` —— 全局覆盖。设了就比每个端点的 `baseUrl` 都
  优先。同一份配置在多个环境共享同一网关时有用。
- `VELLUM_TURNSTILE_SECRET` —— 与功能上的 `turnstileSiteKey` 成对出现，
  二者必须同时配置；只配一半会被服务端拒绝。

如果使用 `workers-ai`，请确保 `wrangler.jsonc` 里有
`"ai": { "binding": "AI" }`。

### 同端点多 key

当同一个 provider 下挂着多把独立配额的 key（OpenRouter / Together /
Groq 免费档常见），Vellum 提供两种用法，结果都会展开成多个故障
转移尝试。

**用法 A——env 变量名数组。** 每个名字独立展开成一个尝试，其他
字段共享。

```jsonc
{
  "id": "openrouter",
  "provider": "openai-compatible",
  "baseUrl": "https://openrouter.ai/api/v1",
  "model": "openai/gpt-4o-mini",
  "apiKeyEnv": [
    "VELLUM_AI_API_KEY",
    "VELLUM_AI_API_KEY_BACKUP",
    "VELLUM_AI_API_KEY_THIRD"
  ]
}
```

**用法 B——单个 env 变量，每行一把 key。** 不想为 N 把 key 各配
一个 secret 时更方便。env 变量的值按换行（LF / CRLF / CR 全支持）
切分，每行非空字符串各算一把 key，日志里以 `${envName}#1`、`#2`
…… 区分。

```jsonc
{
  "id": "openrouter",
  "provider": "openai-compatible",
  "baseUrl": "https://openrouter.ai/api/v1",
  "model": "openai/gpt-4o-mini",
  "apiKeyEnv": "VELLUM_AI_API_KEYS"
}
```

```bash
wrangler secret put VELLUM_AI_API_KEYS
# 在提示符里直接粘贴：
# sk-or-v1-abc...
# sk-or-v1-def...
# sk-or-v1-ghi...
```

两种用法可以叠加：`apiKeyEnv: ["FOO", "BAR"]`，其中 FOO 是两行
key、BAR 是一行，最终展开成 4 个尝试（FOO#1、FOO#2、BAR）。worker
按从左到右的顺序依次尝试，遇到可重试错误就切到下一把 key。

### provider 请求体扩展

有些 provider 的特性 Vellum 没有为它专门设字段——DeepSeek 思考模式、
Anthropic 的扩展思考、额外的采样参数、OpenRouter 的路由 header 等。
AiProvider 上的 `extraBody` 字段会原样合并进 provider 的请求体（在
worker 控制的必填字段之前）：

```jsonc
[
  // DeepSeek 通过 vLLM 风格的 kwargs 开启思考模式。
  {
    "id": "deepseek-reasoning",
    "provider": "openai-compatible",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-chat",
    "apiKeyEnv": "VELLUM_AI_API_KEY_DEEPSEEK",
    "extraBody": {
      "chat_template_kwargs": { "enable_thinking": true }
    }
  },
  // Anthropic 扩展思考——原样透传到 /v1/messages。
  {
    "id": "claude-thinking",
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "apiKeyEnv": "VELLUM_AI_API_KEY_ANTHROPIC",
    "extraBody": {
      "thinking": { "type": "enabled", "budget_tokens": 4000 }
    }
  },
  // worker 没有直接暴露的额外采样参数。
  {
    "id": "openrouter-creative",
    "provider": "openai-compatible",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "openai/gpt-4o",
    "apiKeyEnv": "VELLUM_AI_API_KEY",
    "extraBody": {
      "top_p": 0.95,
      "presence_penalty": 0.1
    }
  }
]
```

`extraBody` 的优先级**低于** worker 的结构性字段——`model`、
`messages`、`stream`、`system`、`tools` 永远胜出，避免一个野生的
`extraBody.model` 把流式输出弄坏。可调参数（`temperature`、
`max_tokens`、`top_p` 等）优先级高于运行器的默认值，所以
`extraBody.temperature` 能覆盖翻译路径默认的 `temperature: 0`。

`workers-ai` 端点上的 `extraBody` 会被合并进 `env.AI.run` 的输入，
优先级规则一样。

## AI 摘要

对应 Microsoft Learn 的 "AI Summary" 按钮。配置了 `site.aiSummary` 之后，
每个文档页都会在标题下方出现一颗小药丸按钮，点击后会以 SSE 流式
方式生成一段 2–4 段的摘要并展开到卡片里。

```json
"site": {
  "aiSummary": {
    "turnstileSiteKey": "0x4AAA...",
    "cacheTtlSeconds": 604800
  }
}
```

| 字段               | 必填 | 说明                                                                                                       |
| ------------------ | :--: | ---------------------------------------------------------------------------------------------------------- |
| `model`            |      | 可选的模型覆盖，作用于池中每个 provider。                                                                  |
| `providers`        |      | 可选白名单，按声明顺序使用 `site.aiProviders` 中匹配的 id（也就是故障转移顺序）。                          |
| `turnstileSiteKey` |      | Cloudflare Turnstile 的 site key。配置后，按钮会在调用模型前向访客发起人机验证。                            |
| `cacheTtlSeconds`  |      | 生成的摘要在 KV 中的存活时间，默认 7 天。                                                                  |

## 问问 AI

由 NavBar 上的按钮触发的对话抽屉。访客提出问题，AI 通过文档工具进行
agent 循环并把答案流式回传。通过 `site.aiChat` 配置：

```json
"site": {
  "aiChat": {
    "turnstileSiteKey": "0x4AAA...",
    "maxIterations": 6
  }
}
```

| 字段               | 必填 | 说明                                                                              |
| ------------------ | :--: | --------------------------------------------------------------------------------- |
| `model`            |      | 可选模型覆盖。对话答案通常值得用一把更贵的推理模型。                              |
| `providers`        |      | 可选白名单。agent 循环会锁定到一种 API 形态（Anthropic vs OpenAI 兼容），由解析后的第一个 provider 决定——池里两种形态混用时，请显式在这里列出匹配形态的 provider。 |
| `turnstileSiteKey` |      | Cloudflare Turnstile 的 site key。每个对话只验证一次，服务端会发放 60 分钟有效的签名 token。 |
| `maxIterations`    |      | 每条用户消息允许的最大 agent 工具调用轮数。默认 6。                                |

AI 可自行调用以下工具：

- `search_docs(query, repo?, locale?)` —— 全文搜索，最多返回 10 条结果。
- `fetch_page(repo, page, locale?)` —— 读取指定页面的纯文本内容。
- `list_repos()` —— 列出站点上的所有仓库。
- `list_pages(repo, locale?)` —— 列出仓库内的所有页面。

凭据沿用 [AI 提供商](#ai-提供商全局池) 一节声明的 env 变量。聊天功能
多一个独有 secret：

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

## 机器翻译

`site.translate` 开启对页面 markdown、侧边栏、仓库导航、frontmatter、
UI 字典和 `vellum.config.json` 文案的机器翻译。结果缓存在一个 D1
数据库里，webhook 推送时按仓库失效，每小时一次的 cron 触发器会清
理超过 `refreshDays` 的过期行。

```json
"site": {
  "translate": {
    "targets": ["zh-CN", "zh-TW", "ja", "ko", "es", "pt-BR"],
    "refreshDays": 5
  }
}
```

| 字段          | 必填 | 说明                                                                                                          |
| ------------- | :--: | ------------------------------------------------------------------------------------------------------------- |
| `model`       |      | 可选模型覆盖。翻译适合用便宜快的模型，不需要推理能力。                                                        |
| `providers`   |      | 可选白名单，从 `site.aiProviders` 里挑 id。                                                                  |
| `targets`     |  ✓   | BCP-47 代码数组（例如 `["zh-CN", "pt-BR"]`），或字面量 `"all"`（展开为 IANA ISO 639-1 注册表中的所有代码）。 |
| `refreshDays` |      | 缓存翻译行的新鲜期。默认 5 天。每小时 cron 删除更老的行以触发懒重译。                                        |
| `batchSize`   |      | 每次 cron tick 删除行数上限。默认 50。                                                                        |

凭据沿用 [AI 提供商](#ai-提供商全局池) 一节声明的 env 变量。新增加的
是承载缓存的 D1 数据库：

- `VELLUM_TRANSLATION_DB`——在 `wrangler.jsonc` 中声明的 D1 绑定。
  用 `wrangler d1 create vellum-translations` 创建，把返回的 UUID
  填入绑定，再执行
  `wrangler d1 migrations apply vellum-translations --remote`。

该绑定在运行时是可选的——缺失时翻译层会变成 no-op，仅在 `targets`
中列出的语言会回退到默认语言的源文件。

详细介绍——翻译范围、提示词如何保留 markdown 语法、刷新行为以及
成本特征——见 [国际化 → 机器翻译](./i18n#机器翻译)。

## 故障转移行为

所有 AI 功能共用同一套故障转移循环。worker 沿 `site.aiProviders`
（或功能过滤出的子集）从左到右遍历，直到有一个端点成功。常见组合：

- **同一 provider，多把 key。** 用同样的 `provider` + `baseUrl` 多
  写一遍，给每条不同的 `apiKeyEnv`——同一个 OpenRouter 账号下多把
  独立配额的 key 就这么挂上去。
- **降级到不同 provider。** 第一条免费的 OpenRouter，第二条
  Anthropic，第三条 Workers AI——上游全网宕机时读者依然能拿到东西。

### 什么情况下触发故障转移

worker 将下列上游状态归类为「用完」，并尝试下一个端点：

| 触发条件                                              | 含义                                            |
| ----------------------------------------------------- | ----------------------------------------------- |
| **HTTP 401**                                          | API key 无效或已撤销。                          |
| **HTTP 402**                                          | 账户余额不足（OpenRouter、Together 等）。       |
| **HTTP 403**                                          | key 有效但被禁止访问此请求。                    |
| **HTTP 429**                                          | 单 key 或整个账号触发限流。                     |
| **HTTP 5xx**                                          | provider 服务端 / 网关错误。                    |
| 网络错误（超时、fetch 失败、ECONNRESET 等）           | TCP / TLS 握手未完成。                          |
| `AI binding not available`（仅 workers-ai）           | 允许后备端点切换到不依赖 binding 的 provider。  |

其他 4xx 错误（400 请求格式有误、404 模型不存在）直接抛错，不再尝试
其他端点——这些是内容 / 配置问题，重发同一个 payload 只会换汤不换药。

### 流式安全语义

`aiSummary` 和 `aiChat` 的 SSE 流是在上游返回 2xx 之后才开始的。故障
转移只在「还没向客户端写过任何字节」时触发——一旦 worker 发出过
`token` 事件就锁定到当前端点。流过程中再出错会直接以 `error` 事件
传递给客户端；不会重复发送 token。

`translate` 是一次性调用（不向客户端流式输出），每次重试都是一次
干净的 POST。

### 与 `aiChat` 的兼容性

`aiChat` 跑的是带工具调用的 agent 循环，请求 / 响应形状是 provider
特定的。循环会锁定到一种 API 形状，由本功能即将使用的池里**第一个
provider** 决定：

- **OpenAI 兼容 / Workers AI**：使用 OpenAI chat-completions 形状。
  故障转移会跳过所有 `anthropic` 条目。
- **Anthropic**：使用 Messages API 形状。故障转移会跳过所有
  `openai-compatible` 和 `workers-ai` 条目。

如果想强制把聊天锁定到某种形状（不依赖池子的顺序），把
`aiChat.providers` 设成你想用的 id 列表就行。

### 环境变量与日志

每个端点的 `apiKeyEnv` 指向 worker 读取 key 的 env 变量名。用
`wrangler secret put` 把它们写进去：

```bash
wrangler secret put VELLUM_AI_API_KEY               # 主
wrangler secret put VELLUM_AI_API_KEY_BACKUP        # 备 #1
wrangler secret put VELLUM_AI_API_KEY_ANTHROPIC     # 备 #2
```

每次故障转移都会以 per-feature tag 写到 `wrangler tail` / `wrangler
dev` 的日志里：

```
[vellum][summarize] endpoint #1 (openai-compatible, key=VELLUM_AI_API_KEY) failed (Upstream 429: rate limit exceeded); trying #2
[vellum][summarize] failover ok: succeeded on endpoint #2 (openai-compatible)
```

如果出现「all N endpoints exhausted」的日志，说明链条里每个端点都
返回了可重试错误——通常意味着 provider 全网宕机，建议加入更多类型
的备用端点。

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

## 绑定

除了环境变量，worker 还需要这些 Cloudflare 绑定：

| 绑定                     |                资源                | 必填用途                                                                       |
| ------------------------ | :--------------------------------: | ------------------------------------------------------------------------------ |
| `ASSETS`                 | `[assets]`                         | 静态客户端 JS / CSS。始终必填。                                                |
| `VELLUM_CACHE`           | `[[kv_namespaces]]`                | 跨区域持久缓存。可选——没有时退回到仅 PoP 级别的 Cache API。                  |
| `VELLUM_TRANSLATION_DB`  | `[[d1_databases]]`                 | 机器翻译缓存。可选——没有时 MT 不生效。                                       |
| `AI`                     | `[ai]`                             | Workers AI 绑定。仅当任一 AI 功能 `provider: "workers-ai"` 时需要。            |

cron 触发器在 `wrangler.jsonc#triggers.crons` 中声明。默认是
`"0 * * * *"`（每小时整点）——翻译刷新器用来清理过期行。

## 重新生成 schema

修改 `src/shared/types.ts` 之后：

```bash
bun run gen:schema
```

这会基于 TypeScript 类型重新生成 `src/shared/site-schema.json`，
同时保留 `scripts/gen-site-schema.ts` 里定义的描述、正则模式、
以及条件性必填规则。
