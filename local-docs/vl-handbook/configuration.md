---
title: Configuration reference
description: "Every field in vellum.config.json explained, with examples."
---

# Configuration reference

Vellum reads one file at startup: `vellum.config.json` at the project root.
Its shape is fully described by a JSON Schema at
`src/shared/site-schema.json` — modern editors will autocomplete and validate
the config when you keep the `"$schema": "./src/shared/site-schema.json"` line
at the top.

The schema is generated from
[`src/shared/types.ts`](https://github.com/siiway/vellum/blob/main/src/shared/types.ts)
by `bun run gen:schema`; edit the types if you add new fields.

## Top-level shape

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

`site` and `repos` are required; `nav` is optional and is the **site-level**
top navigation (each repo can override it with `vellum.json#nav`).

## SiteConfig

| Field           | Required | Notes                                                                              |
| --------------- | :------: | ---------------------------------------------------------------------------------- |
| `title`         |    ✓     | Brand name in the NavBar and `<title>` suffix.                                     |
| `homepageRepo`  |    ✓     | Slug of the repo whose root is the landing page. `/` redirects here.               |
| `defaultLocale` |    ✓     | Locale code used when the URL has no locale prefix.                                |
| `locales`       |    ✓     | `[ { code, label, prefix } ]`. Empty `prefix` means the locale lives at repo root. |
| `tagline`       |          | Shown on landing pages with the `home` layout.                                     |
| `logo`          |          | URL of the site logo.                                                              |
| `favicon`       |          | URL of the favicon.                                                                |
| `themeColor`    |          | `<meta name="theme-color">` hex value, e.g. `#0078d4`.                             |
| `footer`        |          | Footer text rendered below every page.                                             |
| `aiProviders`   |          | Global AI provider pool. See [AI providers](#ai-providers-global-pool).            |
| `aiSummary`     |          | Microsoft Learn-style summary button per page. See [AI Summary](#ai-summary).      |
| `aiChat`        |          | Ask-AI chat drawer. See [Ask AI](#ask-ai).                                         |
| `translate`     |          | Machine translation. See [Machine translation](#machine-translation).              |

::: tip One homepage, many sources
Set `homepageRepo` to a local-source repo with `layout: ms-learn` if you want
a Microsoft Learn-style landing page (see [Layouts](./layouts)). The bundled
config does exactly this — the landing page lives in `local-docs/homepage/`.
:::

## AI providers (global pool)

All three AI features (AI Summary, Ask AI, Machine translation) draw from
a single pool of upstream providers declared at `site.aiProviders`. Each
entry is a fully-specified endpoint with its own provider kind, model,
base URL, and API key env var. Features either consume the whole pool or
narrow it via their own `providers` whitelist.

Order matters: the worker tries entries left-to-right and falls over to
the next on a retryable error (HTTP 401/402/403/429/5xx or network
failure). See [Failover behaviour](#failover-behaviour) below.

```jsonc
"site": {
  "aiProviders": [
    {
      "id": "openrouter",
      "provider": "openai-compatible",
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "openai/gpt-4o-mini",
      "apiKeyEnv": "VELLUM_AI_API_KEY"     // optional; this is the default
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

| Field        | Required | Notes                                                                                                                              |
| ------------ | :------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`         |    ✓     | Short identifier (lowercase kebab). Referenced by feature-level `providers` filters.                                              |
| `provider`   |    ✓     | `"workers-ai"`, `"openai-compatible"`, or `"anthropic"`.                                                                          |
| `model`      |          | Default model id for this entry. Defaults: Llama 3.3 70B Fast / gpt-4o-mini / Haiku 4.5. Features may override per-call.          |
| `baseUrl`    |          | OpenAI-compatible base URL (OpenRouter, Together, a self-hosted gateway). Ignored for `workers-ai` / `anthropic`.                |
| `apiKeyEnv`  |          | Env var name — or **array** of names — that hold the API keys. Defaults to `VELLUM_AI_API_KEY`. See [Multiple keys per provider](#multiple-keys-per-provider).  |
| `extraBody`  |          | JSON merged into the provider request body for provider-specific features (DeepSeek thinking mode, Anthropic extended thinking, extra sampling params). See [Provider body extensions](#provider-body-extensions). |

Credentials live in worker env vars, not the config file:

- `VELLUM_AI_API_KEY` — bearer / x-api-key for `openai-compatible` and
  `anthropic` providers. `workers-ai` doesn't need one. Override per
  entry with `apiKeyEnv` to stage multiple keys.
- `VELLUM_AI_BASE_URL` — legacy global override. Wins over every
  provider entry's `baseUrl` when set; useful when one config ships to
  multiple environments that all share a single gateway.
- `VELLUM_TURNSTILE_SECRET` — paired with feature-level `turnstileSiteKey`.
  Set both or neither; half-configured Turnstile fails closed.

For `workers-ai`, the AI binding is declared in `wrangler.jsonc` (`"ai": { "binding": "AI" }`).

### Multiple keys per provider

When a provider has multiple keys that each carry independent quotas
(common for OpenRouter / Together / Groq free tiers), Vellum supports
two ways to stage them. Both expand into separate failover attempts.

**Option A — array of env var names.** Each name expands into its own
attempt, sharing everything else.

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

**Option B — one env var, one key per line.** Easier to operate when
you don't want to juggle N secrets. The env var's value is split on
newlines (LF / CRLF / CR all work); each non-empty line becomes a
separate attempt labelled `${envName}#1`, `#2`, … in log lines.

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
# paste at the prompt:
# sk-or-v1-abc...
# sk-or-v1-def...
# sk-or-v1-ghi...
```

The two options stack: `apiKeyEnv: ["FOO", "BAR"]` with `FOO`
holding two newline-separated keys and `BAR` holding one runs four
attempts in order (FOO#1, FOO#2, BAR). At resolve time the worker
walks the resulting list left-to-right, falling over to the next key
on any retryable error.

### Provider body extensions

Some provider features aren't exposed by Vellum's first-class fields:
DeepSeek's thinking mode, Anthropic's extended thinking, extra sampling
params, custom headers via OpenRouter routing, etc. The `extraBody`
field on an AiProvider entry is merged verbatim into the provider's
request body before the worker's required fields:

```jsonc
[
  // DeepSeek thinking mode via vLLM-flavoured kwargs.
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
  // Anthropic extended thinking — passed through verbatim to /v1/messages.
  {
    "id": "claude-thinking",
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "apiKeyEnv": "VELLUM_AI_API_KEY_ANTHROPIC",
    "extraBody": {
      "thinking": { "type": "enabled", "budget_tokens": 4000 }
    }
  },
  // Extra sampling tuning that the worker doesn't expose directly.
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

`extraBody` merges with **lower precedence** than the worker's
structural fields. That means `model`, `messages`, `stream`, `system`,
and `tools` always win — so a stray `extraBody.model` can't accidentally
break the streaming setup. Tunable params (`temperature`, `max_tokens`,
`top_p`, …) live at higher precedence than the runner's defaults, so
`extraBody.temperature` does override the worker's translate-time
temperature of `0`.

For `workers-ai` entries the same object is merged into the
`env.AI.run` input — same precedence rules apply.

## AI Summary

Mirrors Microsoft Learn's "AI Summary" button. When `site.aiSummary` is set,
every doc page shows a small pill button below the title; clicking it streams
a 2–4 paragraph summary into an expandable card.

```json
"site": {
  "aiSummary": {
    "turnstileSiteKey": "0x4AAA...",
    "cacheTtlSeconds": 604800
  }
}
```

| Field              | Required | Notes                                                                                                                       |
| ------------------ | :------: | --------------------------------------------------------------------------------------------------------------------------- |
| `model`            |          | Optional model override applied to every provider in the pool when this feature runs.                                       |
| `providers`        |          | Optional whitelist of provider ids from `site.aiProviders` (preserves the order you list them in — the failover order).    |
| `turnstileSiteKey` |          | Cloudflare Turnstile site key. When set, the button challenges the visitor before calling the model.                       |
| `cacheTtlSeconds`  |          | Time a generated summary lives in KV. Defaults to 7 days.                                                                   |

## Ask AI

A chat drawer triggered from the NavBar. The visitor types a question; the
AI runs an agent loop with docs tools and streams the answer back. Configure
with `site.aiChat`:

```json
"site": {
  "aiChat": {
    "turnstileSiteKey": "0x4AAA...",
    "maxIterations": 6
  }
}
```

| Field              | Required | Notes                                                                                                                       |
| ------------------ | :------: | --------------------------------------------------------------------------------------------------------------------------- |
| `model`            |          | Optional model override. A stronger reasoning model is often worth the extra cost for chat answers.                         |
| `providers`        |          | Optional whitelist. The agent loop locks to a single API shape (Anthropic vs OpenAI-compatible) based on the first provider — list providers of the matching shape here when the pool mixes both. |
| `turnstileSiteKey` |          | Cloudflare Turnstile site key. One invisible challenge per chat session; the worker mints a 60-minute signed token.        |
| `maxIterations`    |          | Maximum agent tool-call rounds per user message. Defaults to 6.                                                             |

The AI has these tools and uses them on its own:

- `search_docs(query, repo?, locale?)` — full-text search; up to 10 hits.
- `fetch_page(repo, page, locale?)` — read a specific page as plain text.
- `list_repos()` — enumerate the repos on this site.
- `list_pages(repo, locale?)` — list every page in a repo.

Credentials reuse the env vars declared in [AI providers](#ai-providers-global-pool).
One extra secret unique to chat:

- `VELLUM_SESSION_SECRET` — HMAC key (32+ bytes) used to sign the chat
  session tokens issued by `/api/ai/session`. Set with `wrangler secret put`
  in production; rotate to invalidate every active session.

### MCP server

The same docs tools are exposed at **`/api/mcp`** as a JSON-RPC 2.0
endpoint speaking the [Model Context Protocol](https://modelcontextprotocol.io).
External MCP clients (Claude Desktop, ChatGPT Connectors, mcp-inspector,
custom agents) can connect to this URL and call the tools directly — no
API key required, since a docs site is already public.

To wire it into Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vellum-docs": {
      "url": "https://docs.example.com/api/mcp"
    }
  }
}
```

The endpoint is read-only: it implements `initialize`, `tools/list`,
`tools/call`, and `ping`. There are no resources, prompts, or sampling
calls.

## Machine translation

`site.translate` enables machine translation of page bodies, sidebars,
repo nav, frontmatter, the UI dictionary, and `vellum.config.json`
strings. Translations are cached in a D1 database, refreshed on webhook
push, and pruned on an hourly cron tick when older than `refreshDays`.

```json
"site": {
  "translate": {
    "targets": ["zh-CN", "zh-TW", "ja", "ko", "es", "pt-BR"],
    "refreshDays": 5
  }
}
```

| Field         | Required | Notes                                                                                                                  |
| ------------- | :------: | ---------------------------------------------------------------------------------------------------------------------- |
| `model`       |          | Optional model override. Translation rewards a cheap fast model — no reasoning needed.                                |
| `providers`   |          | Optional whitelist of provider ids from `site.aiProviders`.                                                            |
| `targets`     |    ✓     | Array of BCP-47 codes (e.g. `["zh-CN", "pt-BR"]`), or the sentinel `"all"` to expand to every IANA ISO 639-1 code.    |
| `refreshDays` |          | How long a cached translation row is fresh. Defaults to 5. The hourly cron prunes older rows for lazy re-translation. |
| `batchSize`   |          | Max rows pruned per cron tick. Defaults to 50.                                                                         |

Credentials reuse the env vars declared in
[AI providers](#ai-providers-global-pool). The new piece is the D1
database that backs the cache:

- `VELLUM_TRANSLATION_DB` — D1 binding declared in `wrangler.jsonc`.
  Create with `wrangler d1 create vellum-translations`, paste the
  returned UUID into the binding, then
  `wrangler d1 migrations apply vellum-translations --remote`.

The binding is optional at runtime — without it the translation layer
no-ops and MT-target locales fall back to the default-locale source.

See [Internationalisation → Machine translation](./i18n#machine-translation)
for the full story: what's translated, how the prompt preserves markdown
syntax, refresh behaviour, and cost shape.

## Failover behaviour

Every AI feature shares the same failover loop. The worker walks
`site.aiProviders` (or the feature's filtered subset) left-to-right,
trying each provider until one succeeds. Common setups:

- **Same provider, multiple keys.** Add the same `provider` + `baseUrl`
  twice with different `apiKeyEnv` values to stage two OpenRouter keys
  with independent quotas.
- **Mixed providers as last resort.** Put a free-tier OpenRouter entry
  first, an Anthropic entry second, and Workers AI last — readers
  always get *something*, even when the upstream goes down.

### What triggers a failover

The worker classifies these upstream conditions as "used up" and tries
the next endpoint:

| Trigger                                              | Why                                              |
| ---------------------------------------------------- | ------------------------------------------------ |
| **HTTP 401**                                         | API key invalid or revoked.                      |
| **HTTP 402**                                         | Account out of credit (OpenRouter, Together, …). |
| **HTTP 403**                                         | Key valid but blocked for this request.          |
| **HTTP 429**                                         | Per-key or per-account rate limit hit.           |
| **HTTP 5xx**                                         | Provider server / gateway error.                 |
| Network errors (timeout, fetch failed, ECONNRESET)   | TCP / TLS handshake didn't complete.             |
| `AI binding not available` (workers-ai only)         | Allows a fallback that doesn't need the binding. |

Other 4xx codes (400 bad request, 404 model missing) propagate without
retry — they're content / config problems and re-issuing the same payload
elsewhere just burns the fallback budget for the same outcome.

### Streaming-safe semantics

For `aiSummary` and `aiChat`, the SSE stream begins after the upstream
returns 2xx. Failover only fires before any bytes are written to the
client — once the worker has emitted a `token` event, it's committed to
the current endpoint. Mid-stream errors propagate to the client as a
single `error` event; no duplicate tokens.

For `translate`, the call is single-shot (no streaming to client), so
every retry is a clean POST.

### Compatibility with `aiChat`

`aiChat` runs a tool-calling agent loop with provider-specific request /
response shapes. The loop locks to a single API shape based on the
first provider in the pool that the feature would use:

- **OpenAI-compatible / Workers AI**: the OpenAI chat-completions shape.
  Failover skips past any `anthropic` entries.
- **Anthropic**: the Messages-API shape. Failover skips past
  `openai-compatible` and `workers-ai` entries.

To explicitly pin chat to one shape regardless of pool order, set
`aiChat.providers` to just the ids you want.

### Env vars and logging

Each endpoint's `apiKeyEnv` names the env var the worker reads its key
from. Stage them with `wrangler secret put`:

```bash
wrangler secret put VELLUM_AI_API_KEY               # primary
wrangler secret put VELLUM_AI_API_KEY_BACKUP        # fallback #1
wrangler secret put VELLUM_AI_API_KEY_ANTHROPIC     # fallback #2
```

Every failover decision logs to `wrangler tail` / `wrangler dev` under
the per-feature tag:

```
[vellum][summarize] endpoint #1 (openai-compatible, key=VELLUM_AI_API_KEY) failed (Upstream 429: rate limit exceeded); trying #2
[vellum][summarize] failover ok: succeeded on endpoint #2 (openai-compatible)
```

A line that mentions "all N endpoints exhausted" means every entry in
the chain returned a retryable error — usually a sign that a provider-
wide outage is in progress and you should add more diverse fallbacks.

## RepoConfig

A repo is a slice of documentation — one section in the URL space
(`/<slug>/...`), one sidebar, one search index. You'll typically have one
RepoConfig per actual GitHub repo you're documenting, plus optional local
sources for your handbook and landing page.

| Field             | Required | Notes                                                                                  |
| ----------------- | :------: | -------------------------------------------------------------------------------------- |
| `slug`            |    ✓     | URL segment. Must match `^[a-z0-9][a-z0-9-]*$`.                                        |
| `displayName`     |    ✓     | Shown in the brand crumb and 404 suggestions.                                          |
| `docsRoot`        |    ✓     | Path inside the source to the docs tree. Empty string means the source root.           |
| `source`          |          | `"github"` (default) or `"local"`. See [Sources](./sources).                           |
| `owner`           |    ✓¹    | GitHub owner. Required when `source: "github"`.                                        |
| `repo`            |    ✓¹    | GitHub repo. Required when `source: "github"`.                                         |
| `branch`          |    ✓¹    | Default branch. Required when `source: "github"`. Used as the cache-key suffix.        |
| `localPath`       |          | Override for `local-docs/{slug}`. Local sources only.                                  |
| `description`     |          | Tagline shown on the repo home page and SSR meta description fallback.                 |
| `logo`            |          | Per-repo logo URL.                                                                     |
| `editLinkPattern` |          | Template for "Edit this page" — `:path` is replaced with the docs-root-relative path.  |
| `versions`        |          | Optional version picker. `[ { label, branch, default? } ]`.                            |
| `hideInBrand`     |          | Hides the repo's displayName crumb after the site title. Useful for the homepage repo. |

¹ Conditionally required: the JSON schema enforces `owner` / `repo` / `branch`
when `source` is `"github"` (or omitted).

::: details Full example

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

The site-level top nav. Per-repo navs (from `vellum.json#nav` or VitePress
`themeConfig.nav`) take precedence when a reader is inside that repo.

| Field         | Required | Notes                                                                               |
| ------------- | :------: | ----------------------------------------------------------------------------------- |
| `text`        |    ✓     | Label shown in the NavBar.                                                          |
| `link`        |    ✓²    | Destination URL or site-relative path. Either `link` or `items` is required.        |
| `items`       |    ✓²    | Sub-items, turning the entry into a dropdown.                                       |
| `activeMatch` |          | Regex against the repo-relative path that keeps the entry highlighted in a section. |

² Exactly one of `link` / `items` must be set (enforced by the JSON schema's `oneOf`).

## Environment variables

Set these in `wrangler.jsonc#vars` (or `wrangler secret put` for secrets):

| Var                        |      Default       | Purpose                                                                                                                                |
| -------------------------- | :----------------: | -------------------------------------------------------------------------------------------------------------------------------------- |
| `VELLUM_GITHUB_TOKEN`      |       empty        | Bearer token for `raw.githubusercontent.com` and the GitHub API. Required for private repos and helps with rate limits on public ones. |
| `VELLUM_WEBHOOK_SECRET`    |       empty        | Shared secret for `/api/webhook` HMAC signing. Required for webhook cache busting.                                                     |
| `VELLUM_CACHE_TTL_SECONDS` |       `300`        | TTL for raw markdown / tree / sidebar entries.                                                                                         |
| `VELLUM_HTML_TTL_SECONDS`  |        `60`        | TTL for rendered HTML.                                                                                                                 |
| `VELLUM_KROKI_URL`         | `https://kroki.io` | Override the Kroki endpoint for mermaid SSR. Self-hosters can point at their own instance.                                             |

KV is bound separately in `wrangler.jsonc#kv_namespaces`. Without it, the
worker falls back to the per-edge Cache API alone.

## Bindings

Beyond env vars, the worker has these Cloudflare bindings:

| Binding                  |                Resource                 | Required for                                                                            |
| ------------------------ | :-------------------------------------: | --------------------------------------------------------------------------------------- |
| `ASSETS`                 | `[assets]`                              | Static client JS / CSS. Always required.                                                |
| `VELLUM_CACHE`           | `[[kv_namespaces]]`                     | Cross-region durable cache. Optional — fallback to per-edge Cache API alone.            |
| `VELLUM_TRANSLATION_DB`  | `[[d1_databases]]`                      | Machine-translation cache. Optional — MT no-ops without it.                             |
| `AI`                     | `[ai]`                                  | Workers AI binding. Only when `provider: "workers-ai"` is set on any AI feature.        |

Cron triggers are declared under `wrangler.jsonc#triggers.crons`. The
default is `"0 * * * *"` (top of every hour) — used by the translation
refresher to prune stale rows.

## Regenerating the schema

When you edit `src/shared/types.ts`:

```bash
bun run gen:schema
```

This re-derives `src/shared/site-schema.json` from the TypeScript types,
preserving the curated descriptions, regex patterns, and conditional
requireds defined in `scripts/gen-site-schema.ts`.
