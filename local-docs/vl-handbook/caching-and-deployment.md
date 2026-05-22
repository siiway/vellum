---
title: Caching & deployment
description: "Edge cache layers, KV setup, webhooks, and deploying to Cloudflare."
---

# Caching & deployment

## Cache layers

Vellum uses a layered edge cache, all of it routed through
[`src/worker/cache.ts`](https://github.com/siiway/vellum/blob/main/src/worker/cache.ts):

1. **L1 — Cache API.** Per-edge, automatic, free. Every cacheable read goes
   through it first and gets a sub-millisecond hit when warm.
2. **L2 — KV namespace** (optional). Global, durable, manually invalidatable
   by key. Used as a fallback when L1 misses.

Without KV bound, the worker still works fine — just with per-edge caches
only, so a hit in eu-west doesn't speed up subsequent requests in us-east.

### What's cached

| Key prefix                         | What                                                            | TTL                                                                      |
| ---------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `raw:`                             | Markdown / theme / config files from GitHub                     | `VELLUM_CACHE_TTL_SECONDS` (default 300s)                                |
| `commit:`                          | Last-commit metadata                                            | `VELLUM_CACHE_TTL_SECONDS`                                               |
| `tree:`                            | Full repo file tree (used for sidebar fallback + search corpus) | `VELLUM_CACHE_TTL_SECONDS`                                               |
| `sidebar:`                         | Parsed sidebar per repo+locale                                  | `VELLUM_CACHE_TTL_SECONDS`                                               |
| `index:`                           | Search index per repo+locale                                    | `VELLUM_CACHE_TTL_SECONDS × 4` (~20 min)                                 |
| `xrefmap:`                         | Per-repo uid → href map                                         | `VELLUM_CACHE_TTL_SECONDS`                                               |
| `diagram:mermaid:{theme}:{sha256}` | Pre-rendered mermaid SVGs                                       | 7 days (long; cache key encodes the source so invalidation is automatic) |
| `vue:`                             | Per-repo Vue component registry                                 | `VELLUM_CACHE_TTL_SECONDS`                                               |
| `html:`                            | Fully-rendered HTML for a page                                  | `VELLUM_HTML_TTL_SECONDS` (default 60s)                                  |

::: tip TTLs are knobs
The defaults trade a 60-second propagation lag for very high cache hit
rates. Crank both up if you publish rarely; cut them down if you publish
hot.
:::

## Binding KV

Out of the box, the worker uses only the Cache API. To enable KV:

```bash
wrangler kv namespace create VELLUM_CACHE
```

Paste the returned id into `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  { "binding": "VELLUM_CACHE", "id": "<paste-id-here>" }
],
```

Redeploy. The cache layer detects `env.VELLUM_CACHE` and uses it as the
source of truth on misses.

## Dropping the cache

When you need to wipe everything (after a migration, debugging a stale
entry, etc.):

```bash
bun run drop:cache              # production / remote KV
bun run drop:cache --local      # wrangler dev simulator
bun run drop:cache --preview    # preview namespace
```

The script (`scripts/drop-kv-cache.ts`) reads the namespace id from
`wrangler.jsonc`, lists every key, and bulk-deletes them.

::: warning Cache API is per-edge
There's no Cloudflare API to globally purge the per-edge Cache API. Old
entries roll out as they hit their TTL. To force-bust everything, rotate
the cache key prefix in `src/worker/cache.ts` and redeploy.
:::

## Webhooks

See **[GitHub webhooks](./webhooks)** for the full setup walkthrough
(GitHub UI config, HMAC verification, the keys that get invalidated,
troubleshooting, local testing).

Short version: the `/api/webhook` endpoint accepts GitHub `push` events.
Configure a webhook on each GitHub-backed repo:

| Field        | Value                                             |
| ------------ | ------------------------------------------------- |
| Payload URL  | `https://your-worker.example/api/webhook`         |
| Content type | `application/json`                                |
| Secret       | Anything; set `VELLUM_WEBHOOK_SECRET` to the same |
| Events       | Just the `push` event                             |

On a push, the worker:

1. Verifies the `X-Hub-Signature-256` HMAC.
2. Finds the matching repo in `vellum.config.json`.
3. Walks the payload's `commits[]` for `added` / `modified` / `removed` paths.
4. Invalidates the `raw:`, `commit:`, `html:` (per-locale), `sidebar:`, and
   `tree:` cache entries that touch those paths.

Local-source repos are skipped (they don't have a GitHub remote to push from).

## External services

| Service | Used for                                 | Configurable                           |
| ------- | ---------------------------------------- | -------------------------------------- |
| GitHub  | Fetching raw markdown + last-commit info | `VELLUM_GITHUB_TOKEN` env var          |
| Kroki   | Mermaid SSR (both light + dark)          | `VELLUM_KROKI_URL` env var (self-host) |

Kroki is the only non-Cloudflare runtime dependency. If it's unreachable,
mermaid diagrams fall back to client-side rendering (the worker SSR just
returns no SVG; the client lazy-loads the mermaid runtime and renders
locally).

## Deploying

```bash
bun run deploy
```

This runs `vite build` first (so the client bundle and local-docs assets
are on disk), then `wrangler deploy`. The deploy uploads:

- The worker bundle.
- Every file under `dist/client/` as static assets (including
  `local-docs/...` and the FluentUI / mermaid / katex chunks).

Worker bundle size with the full stack (Shiki, MathJax, Vue3 SFC loader,
the OPS parsers) is around 25 MB — within Cloudflare's free-plan limit.
The static assets are served by Cloudflare's edge directly.

## Observability

`wrangler.jsonc#observability.enabled` is set to `true`, so the worker's
`console.log` / `console.error` are visible in the Cloudflare dashboard
under your worker → Logs → Tail. Look for `[vellum]` and `[vellum:ssr]`
prefixes for worker-level issues.

For SSR errors specifically: React swallows render errors inside Suspense
boundaries with a `$!` HTML marker. If you see a hydration `#419` error
in the browser, check the worker logs for `[vellum:ssr]` entries — they'll
show the underlying cause.
