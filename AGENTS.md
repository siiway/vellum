# AGENTS.md

## Project Overview

Vellum is a multi-repo docs platform on Cloudflare Workers. One Worker serves markdown from GitHub repos and local files, parses it server-side (containers, OPS extensions, Shiki, Kroki mermaid, MathJax), and renders a React 18 FluentUI v9 shell with SSR + hydration.

**Architecture:**

```
src/
  worker/    — Cloudflare Worker (routing, source fetching, markdown pipeline, SSR, search, sitemap, webhook, AI endpoints)
  app/       — React client (Layout, NavBar, Sidebar, Outline, SearchDialog, SearchPage, MarkdownAst renderer)
  shared/    — Types + i18n dictionary shared between worker and client
local-docs/  — Bundled local-source docs (vellum handbook, homepage)
scripts/     — gen-site-schema, drop-kv-cache, vite-local-docs plugin, hooks (prek installer)
migrations/  — D1 migrations for the translations database
.github/     — PR checks, deploy and triage workflows
```

**Data flow:** `Request → Worker → Source (GitHub raw or local ASSETS) → Markdown → AST → SSR HTML + JSON payload → Cache (per-edge + optional KV)`

## Tech Stack

- TypeScript (strict, `noUncheckedIndexedAccess`)
- React 18 (SSR server-side, `renderToString`, then hydrate client-side)
- FluentUI v9 + Griffel CSS-in-JS
- markdown-it (with containers, emoji, footnotes, task-lists, mathjax3, attrs, and custom OPS plugins)
- Shiki (syntax highlighting with ~100 grammars + transformers)
- Kroki (mermaid server-side rendering for light/dark themes)
- Cloudflare Workers (KV, D1, Cache API, Workers AI, Queues/Cron)
- Vite 6 (client build, React plugin, custom local-docs plugin)
- Bun (package manager, script runner)

## Commands

| Command                | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `bun run dev`          | Vite build (client + local-docs) → `wrangler dev` on `:8787` |
| `bun run build`        | Client build + worker dry-run                                |
| `bun run deploy`       | Client build + `wrangler deploy`                             |
| `bun run typecheck`    | `tsc --noEmit`                                               |
| `bun run lint`         | ESLint over `src/` + `scripts/`                              |
| `bun run lint:fix`     | ESLint auto-fix                                              |
| `bun run format`       | Prettier write                                               |
| `bun run format:check` | Prettier check                                               |
| `bun run gen:schema`   | Regenerate `site-schema.json` from `src/shared/types.ts`     |
| `bun run drop:cache`   | Bulk-delete all keys from the configured KV namespace        |
| `bun run clean`        | Remove `dist/` and `.wrangler/tmp`                           |

**Always run `bun run typecheck` and `bun run format:check` after functional changes.**

Git hooks come from `prek.toml` and are installed by `bun install`: pre-commit runs prettier
(and restages), eslint and file checks; pre-push runs typecheck and build. CI runs the same
hooks over every file (`.github/workflows/pr.yml`, and `deploy.yml` before deploying `main`).

## Code Conventions

### File Organisation

- Worker code lives in `src/worker/`; client code lives in `src/app/`; shared types/i18n in `src/shared/`.
- Worker entrypoint: `src/worker/index.ts` (`satisfies ExportedHandler<Env>`).
- React entrypoint: `src/app/hydrate.tsx` (Vite input).
- Markdown pipeline: `src/worker/markdown/index.ts` (rendering) + `ast.ts` (token→AST conversion) + per-feature modules (links, containers, ops-\*, anchors, diagrams, highlight, github-alerts).
- Each Worker route handler is its own module (`webhook.ts`, `search.ts`, `summarize.ts`, `ask.ts`, `mcp.ts`, `vue.ts`, `sitemap.ts`, `session.ts`). The `dispatch` function in `router.ts` gates them by URL path.

### Worker Patterns

- **Cache layer:** All network reads go through `cache.ts` — `readCache`/`writeCache` (L1 = Cache API, L2 = optional KV). Cache keys are stable, version-prefixed (e.g., `html3:`, `index9:`, `sitemap2:`). Bump the version number when the cached shape changes.
- **Environment bindings:** Defined in `env.ts`, mirrors `wrangler.jsonc`. All env vars are optional (`?:`) so the worker degrades when bindings aren't configured.
- **Async context:** Writes that outlive the response use `ctx.waitUntil()`. Always pass `ctx` through to `writeCache` and other fire-and-forget operations.
- **Sources abstraction:** `sources.ts` dispatches between `github` and `local` source types. Everything else calls `fetchSourceFile`/`fetchSourceTree`/`fetchSourceLastCommit` without branching on source kind. Always use `docsRootPrefix(repo.docsRoot)` for path construction — never use the raw `repo.docsRoot` directly, because it normalises `""`, `"/"`, `"docs"`, `"docs/"`, `"/docs/"` to a consistent `"docs/"` or `""`.
- **`repoRef(repo)`:** Returns the canonical git ref for a repo (branch or `"local"` for local-source repos). Always use this for cache keys and fetch operations — never read `repo.branch` directly.
- **`localeSourcePrefix(locale, defaultCode)`:** Source files live at repo root for the default locale and under a `{code}` subdir for others. URL prefixes (BCP47 like `"zh-CN"`) are decoupled from source prefixes (short code like `"zh"`).

### Markdown Pipeline

- Tokens are parsed by markdown-it, then converted to a JSON AST via `ast.ts` → `tokensToAst()`. The AST is shipped in the bootstrap payload and rendered by `MarkdownAst.tsx` on the client.
- OPS extensions (triple-colon, xref, INCLUDE, code-include): implemented as markdown-it block/inline rules in `src/worker/markdown/ops*.ts` and `containers.ts`.
- INCLUDE resolution: `resolveInclude` in `router.ts` fetches the referenced file and re-renders it through `renderMarkdown` (no recursive includes — depth is 1).
- Link rewriting: `normalizeInternal()` in `markdown/index.ts` transforms relative/absolute/xref links. `LinkContext` is built in `renderRoute` and threaded through.

### SSR/Hydration

- HTML page: `ssr.tsx` → `renderToString` with FluentUI `RendererProvider`/`SSRProvider`, embeds Griffel CSS, SEO head, Turnstile loader, and `__VELLUM_DATA__` script tag with JSON payload.
- SPA navigation: client fetches `?_data=1` to get only the JSON payload (no HTML envelope). Cache keys for JSON vs HTML are cleanly separated by the `_data` query parameter.

### i18n

- UI strings live in `src/shared/i18n.ts` (`en` baseline + `zh` hand-curated). Machine-translated locales get their dictionary from D1 via the translate service.
- The `t(locale, key)` function resolves: hand-curated dictionary → runtime dictionary → English baseline → fallback → key.
- `registerUiStrings(locale, dict)` is called in `ssr.tsx` before `renderToString` so server-side `t()` uses the right strings.

### Important Packages

- `gray-matter`: frontmatter parsing
- `markdown-it` + plugins: markdown parsing
- `shiki` + `@shikijs/transformers`: syntax highlighting
- `html-react-parser`: client-side HTML → React conversion for inline HTML blocks
- `mermaid`: client-side fallback for mermaid rendering (server-side uses Kroki via `diagrams.ts`)
- `vue` + `vue3-sfc-loader`: runtime Vue SFC loading for Vue "islands" inside markdown

## Configuration

The whole site is one file: `vellum.config.json` at the project root. Its shape is validated by `src/shared/site-schema.json` (generated from `src/shared/types.ts` by `bun run gen:schema`). The config is imported directly in `src/worker/index.ts` and `src/worker/router.ts` as a static module import — it's bundled into the worker at deploy time.

When adding a new config field:

1. Add the field in `src/shared/types.ts` in the appropriate interface.
2. Run `bun run gen:schema` to regenerate the JSON schema.
3. If the field needs a description, pattern, or other JSON Schema-specific metadata, add it to the `OVERRIDES` table in `scripts/gen-site-schema.ts`.

## After Making Changes

- Update relevant documentation: `README.md`, handbook pages under `local-docs/`, and the configuration reference in `src/shared/site-schema.json` (via `bun run gen:schema`).
- Run `bun run typecheck` to verify no type errors.
- Run `bun run format:check` to verify formatting.
- Bump cache key version numbers in `cache.ts`, `search.ts`, `sitemap.ts`, `sidebar.ts` when changing the cached data shape so stale entries don't cause runtime errors.
- Update `wrangler.jsonc` bindings if new env vars or D1/KV bindings are added.
