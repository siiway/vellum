# AGENTS

- The app is in `app/`. It uses Bun: run `bun` commands there, never npm or
  pnpm. `bun run check` must pass before you finish.
- Code is in `app/src/`: `build/` (static site build: sources, markdown
  pipeline, SSR, search index, redirects), `web/` (React client) and `shared/`
  (types, i18n, client search).
- Commit messages are ASCII, conventional style only.

## Docs

- A change in behavior updates the handbook in `app/local-docs/vl-handbook/`
  and its `zh/` copy in the same change, and the two stay in sync.

## Build

- The site is static: Cloudflare serves `app/dist/site` as-is, with no Worker
  code. Nothing in the output may depend on the request; a redirect goes in
  `_redirects` (`src/build/redirects.ts`).
- Build source paths with `docsRootPrefix(repo.docsRoot)` and refs with
  `repoRef(repo)`, never `repo.docsRoot` or `repo.branch` directly.
- A repo's output depends only on that repo and the config: `bun run update`
  re-renders just the repos whose commit changed. Keep it that way.
- Output is deterministic (no timestamps, sorted lists), so an unchanged page
  is an unchanged file.
- Paths the client fetches (`/_vellum/...`) come from `src/shared/paths.ts`.

## Config

- A new `vellum.config.json` field goes in `app/src/shared/types.ts`, then
  `bun run gen:schema`. Descriptions and patterns go in `OVERRIDES` in
  `app/scripts/gen-site-schema.ts`.

## UI text

- All UI text goes through `t()` with keys in `app/src/shared/i18n.ts`, in
  both `en` and `zh`, including placeholders and `aria-label`s.
