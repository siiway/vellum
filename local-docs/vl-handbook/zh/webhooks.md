---
title: GitHub webhook
description: "用 push 事件让缓存失效，附带 HMAC 校验。"
---

# GitHub webhook

Vellum 的边缘缓存默认保留渲染好的 HTML 约 60 秒、原始 markdown 约 5 分钟
（见 [缓存与部署](./caching-and-deployment#缓存层级)）。
对发布频繁的仓库，GitHub `push` webhook 可以让你在提交后毫秒内
精准失效相关缓存——读者立刻看到新内容，不必等 TTL。

::: tip 本地仓库
Webhook 只适用于 GitHub 源仓库。本地仓库通过重新部署来失效缓存
（内容打包在 worker 的资源里）。
:::

## 端点

`POST /api/webhook` —— 接收标准的 GitHub push webhook payload。

它总是会：

1. 一次性读完原始请求体（签名校验需要 JSON 解析前那份字节精确的 payload）。
2. 用 `VELLUM_WEBHOOK_SECRET` 通过常量时间比较来校验 `X-Hub-Signature-256`。
3. 对 `ping` 事件，返回 `{ pong: true }`——这是 GitHub 用来确认 URL 可达的。
4. 对 `push` 事件，遍历 `commits[]` 中的 `added` / `modified` / `removed`
   路径，批量失效匹配的缓存 key。
5. 对 `push` 返回 `{ invalidated: <count> }`，对被忽略的事件返回一句简短的
   非错误字符串（这样在事件本身无需处理时 GitHub 的 webhook UI 也会
   显示"已送达"的绿色）。

## 在 GitHub 上配置

对每个 GitHub 源仓库：

1. **Settings → Webhooks → Add webhook**。
2. **Payload URL** = `https://your-worker.example/api/webhook`。
3. **Content type** = `application/json`。
4. **Secret** = 一段随机字符串（例如 `openssl rand -hex 32`）。
5. **SSL verification** = enabled。
6. **Which events** = "Just the `push` event"。
7. **Active** = 勾选。

保存。GitHub 会立即发一个 `ping`——在 webhook 的 recent deliveries
里应该能看到 `200 OK`，响应体是 `{"pong":true}`。

::: warning 让 worker 使用相同的 secret
把 `VELLUM_WEBHOOK_SECRET` 设为你在第 4 步填的值：

```bash
wrangler secret put VELLUM_WEBHOOK_SECRET
# 系统提示时把 secret 粘进去
```

当 worker 设置了 `VELLUM_WEBHOOK_SECRET`，而请求没有（或带了错误的）
`X-Hub-Signature-256` 时，会返回 `401 bad signature`。当该环境变量为
**空** 时，worker 接受未签名的请求——适合本地测试，
**绝不要** 在生产用。
:::

## 签名校验

Worker 与 GitHub 的
[HMAC-SHA256 方案](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
一致：

```ts
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);
const mac = await crypto.subtle.sign(
  "HMAC",
  key,
  new TextEncoder().encode(body),
);
const hex = [...new Uint8Array(mac)]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
// 把 `sha256=<hex>` 与 X-Hub-Signature-256 头部对比。
```

两个值得注意的实现细节：

- **校验使用原始请求体**，逐字节比较。如果先 JSON.parse 会丢掉无关
  空白，签名就会校验失败。Worker 仅调用 `request.text()` 一次，
  先校验，再解析。
- **对比是常量时间的**（`timingSafeEqual`），所以攻击者无法通过时序
  侧信道一字节一字节地暴力破解签名。**不要** 用 `===` 替换它。

## 哪些会被失效

对每个被触及的、位于 `{docsRoot}/` 下的 markdown 文件，worker 会清掉：

| 缓存 key                                             | 用途                                  |
| ---------------------------------------------------- | ------------------------------------- |
| `raw:{owner}/{repo}@{branch}:{path}`                 | 原始 markdown 内容。                  |
| `commit:{owner}/{repo}@{branch}:{path}`              | "最近更新" 元数据。                   |
| `html:{slug}@{branch}:{locale}:{pagePath}` × locales | 每种语言下渲染好的 HTML。             |

此外，无论哪些文件改动，每次 push 都会清掉：

| 缓存 key                                     | 用途                                      |
| -------------------------------------------- | ----------------------------------------- |
| `sidebar:{slug}@{branch}:{locale}` × locales | 缓存的侧边栏（以防有文件移动）。          |
| `tree:{owner}/{repo}@{branch}`               | 完整仓库文件树（以防有新增文件）。        |

::: note Cache API 的注意点
KV 失效是全局的；PoP 级 Cache API 只对单 PoP 生效。Worker 会同时清掉
两边匹配的条目，但其它还没见到新请求的 PoP 仍然持有旧的 Cache API
条目，直到它们各自 TTL 到期。实际上这意味着另一个区域的读者在
发布后最多还会看到 `VELLUM_HTML_TTL_SECONDS` 秒的旧页面。

要立刻全局清空，跑 `bun run drop:cache`（清掉 KV），然后轮换
`src/worker/cache.ts` 里的缓存 key 前缀（让 PoP 级条目失去引用，
下次会重新写入）。
:::

## 不会被失效的东西

- **搜索索引**（`index:{slug}:{locale}`）——默认存活 ~20 分钟。
  比每次 push 都重走语料库便宜得多。
- **Mermaid SVG**（`diagram:mermaid:{theme}:{sha256}`）——缓存 key
  编码了源内容，所以图编辑就是新的 key；旧 key 会在 7 天 TTL 到期后下线。
- **xref 映射**（`xrefmap:{slug}@{branch}`）——会在下一次 push 时被
  失效，因为 `xrefmap.yml` 改动会直接 touch 这个文件。

## 排障

::: details GitHub 显示 `401 bad signature`
GitHub 那边的 secret 与 worker 里的 `VELLUM_WEBHOOK_SECRET` 不一致。
两边都仔细看一遍——首尾空白是最常见的元凶。不放心的话用
`wrangler secret put VELLUM_WEBHOOK_SECRET` 轮换。
:::

::: details GitHub 显示 `200 OK { "invalidated": 0 }`
这次 push 触动了文件，但没有任何文件匹配 `{docsRoot}/*.md`。
确认 `vellum.config.json` 里这个仓库的 `docsRoot` 确实是你想的那个
——拼写错误或多/少了尾斜线都会让每个 key 静默跳过。
:::

::: details GitHub 显示 `200 OK "repo not configured"`
push payload 里的 `repository.full_name`（已转小写）与已配置仓库的
`{owner}/{repo}` 都不匹配。常见情况：仓库在 GitHub 改名了但
`vellum.config.json` 没改，或者 webhook 被装到了 fork 上而不是源仓库。
:::

::: details Webhook 触发后页面仍然返回旧内容
PoP 级 Cache API 条目还没过期——见上面那条 note。等
`VELLUM_HTML_TTL_SECONDS` 秒，或者从另一个地理位置访问 URL
（例如换一个 VPN 出口）来判断是本地 PoP 陈旧，还是 KV 里真的还
缓存着旧内容。
:::

::: details 我想本地测 webhook
`wrangler dev` 在 `127.0.0.1` 上暴露了 `/api/webhook`。可以用
`curl` 和手算的签名打它：

```bash
SECRET="your-secret"
BODY='{"ref":"refs/heads/main","repository":{"full_name":"owner/repo","owner":{"name":"owner"},"name":"repo"},"commits":[{"modified":["docs/index.md"]}]}'
SIG="sha256=$(printf %s "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -X POST http://127.0.0.1:8787/api/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$BODY"
```

或者用 [smee.io](https://smee.io) / `gh webhook forward` 把真实的
GitHub 投递隧道到你的本地 worker。
:::

## 安全考量

- **不要关闭签名校验。** 把 `VELLUM_WEBHOOK_SECRET` 留空意味着
  互联网上任何人都能触发缓存失效（并触发 worker 去 GitHub 拉点名
  的文件）。这不会损坏内容，但会消耗你的 GitHub 限流额度和
  Cloudflare 调用次数。
- **定期轮换 secret。** `wrangler secret put VELLUM_WEBHOOK_SECRET`
  ——再去 GitHub 上更新 webhook 配置。没有"过渡期"机制——
  请同时把两边切到新 secret。
- **每个 worker 一个 secret，而不是每个仓库一个。** GitHub 允许
  按 webhook 配置 secret，但 worker 只有一个 `VELLUM_WEBHOOK_SECRET`
  环境变量。指向同一个 worker 的所有 webhook 都用同一个 secret。
- **端点除签名校验外是无鉴权的。** 不要在响应体里暴露 worker 内部
  状态（KV 内容、缓存状态）；当前实现只返回数量，这是合适的。
