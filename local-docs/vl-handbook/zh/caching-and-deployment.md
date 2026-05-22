---
title: 缓存与部署
description: "边缘缓存层级、KV 配置、webhook 以及部署到 Cloudflare。"
---

# 缓存与部署

## 缓存层级

Vellum 采用分层的边缘缓存，全部通过
[`src/worker/cache.ts`](https://github.com/siiway/vellum/blob/main/src/worker/cache.ts)
统一走线：

1. **L1 —— Cache API。** 单 PoP，自动，免费。每次可缓存的读取首先经过它，
   命中时是亚毫秒级。
2. **L2 —— KV 命名空间**（可选）。全局、持久，按 key 可手动失效。
   L1 未命中时回退到它。

不绑定 KV 时 worker 仍可正常工作——只是缓存仅按 PoP 存在，
eu-west 上的一次命中并不会让随后 us-east 的请求更快。

### 缓存的内容

| Key 前缀                            | 内容                                                     | TTL                                                                          |
| ----------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `raw:`                              | 来自 GitHub 的 markdown / 主题 / 配置文件                 | `VELLUM_CACHE_TTL_SECONDS`（默认 300s）                                       |
| `commit:`                           | 最近一次提交的元数据                                       | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `tree:`                             | 仓库完整文件树（用于侧边栏回退 + 搜索语料）                 | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `sidebar:`                          | 按仓库 + 语言解析好的侧边栏                                | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `index:`                            | 按仓库 + 语言的搜索索引                                    | `VELLUM_CACHE_TTL_SECONDS × 4`（约 20 分钟）                                 |
| `xrefmap:`                          | 按仓库的 uid → href 映射                                   | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `diagram:mermaid:{theme}:{sha256}`  | 预渲染的 mermaid SVG                                       | 7 天（长；key 已编码源内容，失效是自动的）                                  |
| `vue:`                              | 按仓库的 Vue 组件注册表                                    | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `html:`                             | 一个页面完整渲染好的 HTML                                  | `VELLUM_HTML_TTL_SECONDS`（默认 60s）                                         |

::: tip TTL 是可调旋钮
默认值在 60 秒传播延迟与极高的缓存命中率之间权衡。如果你发布得少
就把它们调大；如果发布得很频繁就调小。
:::

## 绑定 KV

开箱即用只有 Cache API。要启用 KV：

```bash
wrangler kv namespace create VELLUM_CACHE
```

把返回的 id 粘进 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  { "binding": "VELLUM_CACHE", "id": "<paste-id-here>" }
],
```

重新部署。缓存层会检测到 `env.VELLUM_CACHE`，并在未命中时把它作为
真相来源。

## 清空缓存

需要全清（迁移之后、调试陈旧条目等）时：

```bash
bun run drop:cache              # 生产 / 远端 KV
bun run drop:cache --local      # wrangler dev 模拟器
bun run drop:cache --preview    # preview 命名空间
```

脚本（`scripts/drop-kv-cache.ts`）会从 `wrangler.jsonc` 读取命名空间 id，
列出每个 key，并批量删除。

::: warning Cache API 是按 PoP 的
Cloudflare 没有 API 能全局清掉 PoP 级 Cache API。旧条目要等到各自的
TTL 才会下线。如果想强制全清，可以在 `src/worker/cache.ts` 里轮换
缓存 key 前缀然后重新部署。
:::

## Webhook

完整的配置流程见 **[GitHub webhook](./webhooks)**
（GitHub UI 配置、HMAC 校验、被失效的 key、排障、本地测试）。

简短版：`/api/webhook` 端点接收 GitHub `push` 事件。给每个 GitHub
源仓库配置一个 webhook：

| 字段            | 取值                                              |
| --------------- | ------------------------------------------------- |
| Payload URL     | `https://your-worker.example/api/webhook`         |
| Content type    | `application/json`                                |
| Secret          | 任意字符串；把 `VELLUM_WEBHOOK_SECRET` 设为同样的 |
| Events          | 仅 `push` 事件                                    |

push 来到时，worker 会：

1. 校验 `X-Hub-Signature-256` HMAC。
2. 在 `vellum.config.json` 中找出匹配的仓库。
3. 遍历 payload 的 `commits[]`，收集 `added` / `modified` / `removed` 路径。
4. 失效那些路径触及的 `raw:`、`commit:`、`html:`（按语言）、`sidebar:`、
   `tree:` 缓存条目。

本地源仓库会被跳过（它们没有可推送的 GitHub 远端）。

## 外部服务

| 服务   | 用途                                          | 可配置                                       |
| ------ | --------------------------------------------- | -------------------------------------------- |
| GitHub | 拉取原始 markdown + 最近一次提交信息          | `VELLUM_GITHUB_TOKEN` 环境变量              |
| Kroki  | mermaid SSR（同时浅色 + 深色）                | `VELLUM_KROKI_URL` 环境变量（可自部署）     |

Kroki 是唯一一个 Cloudflare 之外的运行时依赖。它不可达时，
mermaid 图会回退到客户端渲染（worker SSR 返回空 SVG；客户端
按需懒加载 mermaid 运行时并在本地渲染）。

## 部署

```bash
bun run deploy
```

这条命令会先跑 `vite build`（确保客户端 bundle 和 local-docs 资源在磁盘
上），然后 `wrangler deploy`。部署会上传：

- Worker bundle 本身。
- `dist/client/` 下的每个文件作为静态资源（包括 `local-docs/...`、
  以及 FluentUI / mermaid / katex 等 chunk）。

包含完整栈（Shiki、MathJax、Vue3 SFC loader、OPS 解析器）时 worker
bundle 大约 25 MB——在 Cloudflare 免费方案的额度内。静态资源由
Cloudflare 边缘直接提供。

## 可观测性

`wrangler.jsonc#observability.enabled` 设为了 `true`，所以 worker 里的
`console.log` / `console.error` 在 Cloudflare dashboard 你 worker 的
"Logs → Tail" 里可见。worker 级别的问题查找 `[vellum]` 和 `[vellum:ssr]`
前缀。

特别针对 SSR 错误：React 会在 Suspense 边界用 `$!` HTML 标记吞掉渲染
错误。如果在浏览器看到 hydration `#419` 错误，去 worker 日志里查找
`[vellum:ssr]` 条目——它们会显示底层原因。
