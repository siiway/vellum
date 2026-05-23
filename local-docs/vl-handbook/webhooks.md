---
title: GitHub webhooks
description: "Set up cache invalidation on push, with HMAC verification."
---

# GitHub webhooks

Vellum's edge cache holds rendered HTML for ~60 seconds and raw markdown for
~5 minutes by default (see [Caching & deployment](./caching-and-deployment#cache-layers)).
For repos that publish often, a GitHub `push` webhook lets you invalidate
exactly the touched cache entries within milliseconds of a commit — readers
see new content immediately instead of waiting on TTL.

::: tip Local repos
Webhooks only apply to GitHub-source repos. Local repos cache-bust via
redeploy (their content is bundled into the worker's assets).
:::

## Endpoint

`POST /api/webhook` — accepts standard GitHub push webhook payloads.

It always:

1. Reads the raw body once (signature verification needs the byte-exact
   payload before any JSON parsing).
2. Verifies `X-Hub-Signature-256` against `VELLUM_WEBHOOK_SECRET` using
   constant-time comparison.
3. For `ping` events, returns `{ pong: true }` — what GitHub uses to confirm
   the URL is reachable.
4. For `push` events, walks `commits[]` for `added` / `modified` / `removed`
   paths and bulk-invalidates the matching cache keys.
5. Returns `{ invalidated: <count> }` for `push`, or a short non-error
   string for ignored events (so GitHub's webhook UI shows green for
   "delivered" even when the event isn't actionable).

## Configuring on GitHub

In each GitHub-backed repo:

1. **Settings → Webhooks → Add webhook**.
2. **Payload URL** = `https://your-worker.example/api/webhook`.
3. **Content type** = `application/json`.
4. **Secret** = a random string (e.g. `openssl rand -hex 32`).
5. **SSL verification** = enabled.
6. **Which events** = "Just the `push` event".
7. **Active** = checked.

Save. GitHub immediately sends a `ping` — you should see `200 OK` with body
`{"pong":true}` in the webhook's recent deliveries.

::: warning Use the same secret as the worker
Set `VELLUM_WEBHOOK_SECRET` to the same value you put in step 4:

```bash
wrangler secret put VELLUM_WEBHOOK_SECRET
# paste the secret when prompted
```

When the worker has `VELLUM_WEBHOOK_SECRET` set but a request arrives
without (or with a mismatched) `X-Hub-Signature-256`, it returns `401
bad signature`. When the env var is **empty**, the worker accepts
unsigned requests — useful for local testing, **never** appropriate for
production.
:::

## Signature verification

The worker mirrors GitHub's
[HMAC-SHA256 scheme](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries):

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
// Compare `sha256=<hex>` against the X-Hub-Signature-256 header.
```

Two implementation details worth noting:

- **Verification uses the raw request body**, byte-for-byte. JSON.parsing
  it first would lose insignificant whitespace and the signature would
  fail. The worker reads `request.text()` exactly once, verifies, then
  parses.
- **Comparison is constant-time** (`timingSafeEqual`) so an attacker can't
  brute-force the signature one byte at a time via timing oracles. Don't
  replace it with `===`.

## What gets invalidated

For each touched markdown file under `{docsRoot}/`, the worker drops:

| Cache key                                            | Purpose                             |
| ---------------------------------------------------- | ----------------------------------- |
| `raw:{owner}/{repo}@{branch}:{path}`                 | The raw markdown body.              |
| `commit:{owner}/{repo}@{branch}:{path}`              | The "last updated" metadata.        |
| `html:{slug}@{branch}:{locale}:{pagePath}` × locales | The rendered HTML for every locale. |

Plus, on every push regardless of which files changed:

| Cache key                                    | Purpose                                    |
| -------------------------------------------- | ------------------------------------------ |
| `sidebar:{slug}@{branch}:{locale}` × locales | Cached sidebar (in case it moved).         |
| `tree:{owner}/{repo}@{branch}`               | Full repo tree (in case files were added). |

If `site.translate` is configured, the worker also deletes every D1
translation row whose key matches `{slug}@{branch}:*` — that covers
`page`, `frontmatter`, `sidebar`, and `repo-nav` rows for the pushed
repo. Top-level rows (`ui:v1`, `site:v1`) aren't repo-scoped; the
hourly cron handles those on its own staleness schedule. See
[Internationalisation → Machine translation → Refresh](./i18n#refresh).

::: note Cache API caveat
KV invalidation is global; the per-edge Cache API is local to each PoP. The
worker drops the matching entries from both, but other PoPs that haven't
seen the new request yet still hold the old Cache API entry until it
TTLs out. In practice this means a reader in another region sees the old
page for up to `VELLUM_HTML_TTL_SECONDS` seconds after a publish.

For an immediate global flush, run `bun run drop:cache` (this clears KV)
and rotate the cache key prefix in `src/worker/cache.ts` (this orphans
the per-edge entries so they're written-anew).
:::

## Things that aren't invalidated

- **Search indexes** (`index:{slug}:{locale}`) — they live for ~20 minutes
  by default. Cheaper than re-walking the corpus on every push.
- **Mermaid SVGs** (`diagram:mermaid:{theme}:{sha256}`) — the cache key
  encodes the source so a diagram edit is its own new key; old keys roll
  out at their 7-day TTL.
- **xref maps** (`xrefmap:{slug}@{branch}`) — bust on the next push since
  a `xrefmap.yml` change touches the file directly.

## Troubleshooting

::: details GitHub shows `401 bad signature`
The secret on GitHub and `VELLUM_WEBHOOK_SECRET` in the worker don't
match. Double-check both — leading/trailing whitespace is the usual
culprit. Rotate the secret with `wrangler secret put VELLUM_WEBHOOK_SECRET`
if you're not sure what the worker is using.
:::

::: details GitHub shows `200 OK { "invalidated": 0 }`
The push touched files but none of them matched `{docsRoot}/*.md`. Verify
the repo's `docsRoot` in `vellum.config.json` is what you think it is —
typo or trailing slash will silently skip every key.
:::

::: details GitHub shows `200 OK "repo not configured"`
The push payload's `repository.full_name` (lowercase) doesn't match any
of the configured repos' `{owner}/{repo}`. Often: the repo was renamed
on GitHub but not in `vellum.config.json`, or you set up the webhook on
a fork rather than the source.
:::

::: details Page still serves old content after the webhook fires
The per-edge Cache API entry hasn't expired yet — see the note above.
Wait for `VELLUM_HTML_TTL_SECONDS`, or hit the URL from a different
geographic location (e.g. via a different VPN exit) to see whether the
local PoP is stale or it's actually still cached in KV.
:::

::: details I want to test webhook locally
`wrangler dev` exposes `/api/webhook` on `127.0.0.1`. You can hit it with
`curl` and a hand-computed signature:

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

Or use [smee.io](https://smee.io) / `gh webhook forward` to tunnel real
GitHub deliveries to your local worker.
:::

## Security considerations

- **Don't disable signature verification.** Leaving `VELLUM_WEBHOOK_SECRET`
  empty lets anyone on the internet trigger cache busts (and trigger the
  worker to fetch the named files from GitHub). It's harmless for content,
  but burns your GitHub rate limit and your Cloudflare invocations.
- **Rotate the secret periodically.** `wrangler secret put VELLUM_WEBHOOK_SECRET`
  - update the webhook config on GitHub. There's no in-flight grace
    period — point both at the new secret at the same time.
- **Use a single secret per worker, not per repo.** GitHub lets you
  configure one secret per webhook, but the worker has only one
  `VELLUM_WEBHOOK_SECRET` env var. Use the same secret across every
  webhook pointing at this worker.
- **The endpoint is unauthenticated outside the signature check.**
  Don't expose worker internals (KV contents, cache state) via response
  bodies; the current implementation only returns the count, which is fine.
