# AGENTS

- The app is in `app/`. It uses Bun: run `bun` commands there, never npm or
  pnpm. `bun run check` must pass before you finish.
- Code is in `app/src/`: `worker/` (Cloudflare Worker: routing, markdown
  pipeline, SSR), `web/` (React client) and `shared/` (types, i18n).
- Commit messages are ASCII, conventional style only.

## Docs

- A change in behavior updates the handbook in `app/local-docs/vl-handbook/`
  and its `zh/` copy in the same change, and the two stay in sync.

## Worker

- Build source paths with `docsRootPrefix(repo.docsRoot)` and refs with
  `repoRef(repo)`, never `repo.docsRoot` or `repo.branch` directly.
- Cache keys carry a version prefix (`htmlN:`, `indexN:`, `sitemapN:`). Bump the
  version when the cached shape changes.
- Writes that outlive the response go through `ctx.waitUntil()`; pass `ctx`
  to `writeCache`.
- Bindings are optional in `env.ts` and mirror `wrangler.jsonc`; the Worker
  must degrade when one is missing.

## Config

- A new `vellum.config.json` field goes in `app/src/shared/types.ts`, then
  `bun run gen:schema`. Descriptions and patterns go in `OVERRIDES` in
  `app/scripts/gen-site-schema.ts`.

## UI text

- All UI text goes through `t()` with keys in `app/src/shared/i18n.ts`, in
  both `en` and `zh`, including placeholders and `aria-label`s.
