---
title: 缓存与部署
description: "边缘缓存层级、KV 配置、webhook 以及部署到 Cloudflare。"
---

# 缓存与部署

## 缓存层级

Vellum 采用分层的边缘缓存，全部通过
[`src/worker/cache.ts`](https://github.com/siiway/vellum/blob/main/app/src/worker/cache.ts)
统一走线：

1. **L0 —— isolate 内存。** 每个 Worker isolate 各自一份，最多保留 30 秒。
   热 isolate 里的重复读取连 Cache API 都不用走。
2. **L1 —— Cache API。** 单 PoP，自动，免费。命中时是亚毫秒级。
3. **L2 —— KV 命名空间**（可选）。全局、持久，按 key 可手动失效。
   L1 未命中时回退到它。

读取按上面的顺序逐层查找，命中后会把结果复制到更快的层。未命中也会被缓存：
GitHub 返回 404 的文件会被记住 60 秒，没有 `xrefmap.yml` 的仓库会被记住
5 分钟，这样渲染页面时不必每次都重新探测那些可选文件。

不绑定 KV 时 worker 仍可正常工作——只是缓存仅按 PoP 存在，
eu-west 上的一次命中并不会让随后 us-east 的请求更快。

### 页面缓存

页面从其 bootstrap payload 的缓存中返回：渲染好的 markdown、侧边栏、导航，
以及页面上展示的其它内容。一个条目在 `VELLUM_HTML_TTL_SECONDS` 内是新鲜的。
此后最多再过 `VELLUM_STALE_TTL_SECONDS`，它仍会被立即返回，同时 worker
在后台重建它，下一位读者拿到的就是新版本。只有页面的第一次请求，或者两个
时间窗都过去之后的请求，才需要等待渲染。

- 客户端导航（`?_data=1`）与 HTML 读取同一个条目。
- 渲染好的 HTML 按主机和主题缓存，只要仍与 payload 对应就会被复用。
- HTML 和 JSON 响应都带 `ETag`。浏览器重新验证一个没有变化的页面时，
  会得到一个没有正文的 `304`。
- 更换了客户端 bundle 的部署永远不会返回仍链接旧 bundle 的 HTML：
  bundle 的哈希是 HTML 缓存 key 的一部分。

把 `VELLUM_STALE_TTL_SECONDS` 设为 `0`，条目一旦过了新鲜期就在请求时重建。

### 缓存的内容

| Key 前缀                            | 内容                                                     | TTL                                                                          |
| ----------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `raw:`                              | 来自 GitHub 的 markdown / 主题 / 配置文件，以及 404      | `VELLUM_CACHE_TTL_SECONDS`（默认 300s）；404 为 60s                            |
| `commit:`                           | 最近一次提交的元数据                                       | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `tree:`                             | 仓库完整文件树（用于侧边栏回退 + 搜索语料）                 | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `sidebar:`                          | 按仓库 + 语言解析好的侧边栏                                | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `nav:` / `social:`                  | 按仓库 + 语言的导航，以及按仓库的社交链接                  | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `index:`                            | 按仓库 + 语言的搜索索引                                    | `VELLUM_CACHE_TTL_SECONDS × 4`（约 20 分钟）                                 |
| `xrefmap:`                          | 按仓库的 uid → href 映射                                   | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `diagram:mermaid:{theme}:{sha256}`  | 预渲染的 mermaid SVG                                       | 7 天（长；key 已编码源内容，失效是自动的）                                  |
| `vue:`                              | 按仓库的 Vue 组件注册表                                    | `VELLUM_CACHE_TTL_SECONDS`                                                   |
| `page1:`                            | 按仓库 + 语言 + 页面的页面 payload（见[页面缓存](#页面缓存)） | 新鲜期 `VELLUM_HTML_TTL_SECONDS`（默认 60s），之后最多再以陈旧状态返回 `VELLUM_STALE_TTL_SECONDS`（默认 1 天） |
| `html5:`                            | 按主机 + 主题渲染好的 HTML，与 `page1:` 对应时复用          | 同 `page1:`                                                                  |

::: tip TTL 是可调旋钮
默认值在较短的传播延迟与极高的缓存命中率之间权衡：发布之后，页面会继续
显示旧版本，直到它的新鲜期过去、并有读者触发了重建。如果你发布得少
就把 TTL 调大；如果发布得很频繁就调小。
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
