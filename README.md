# Vellum

A Microsoft Open Publishing System-style multi-repo docs platform on
Cloudflare Workers, with full VitePress markdown support and a FluentUI v9
shell.

One Worker serves Markdown from any combination of GitHub repositories and
local files, parses it server-side (containers, OPS extensions, Shiki, Kroki
mermaid, MathJax), and renders a React app that hydrates from the same SSR
payload.

```
Request → Worker → Source (GitHub raw or local ASSETS)
                 → Markdown → AST → SSR HTML + JSON payload
                 → Cache (per-edge + optional KV)
```

## Highlights

- **Multiple sources, one site.** Mix GitHub-backed repos and local-bundled
  docs in the same site. Per-repo `source: "github" | "local"`.
- **Full VitePress markdown.** Containers (`::: tip`), code groups, GFM
  alerts, task lists, footnotes, attribute lists.
- **Full Microsoft Learn / OPS extension set.** Triple-colon
  image/video/row/column/zone/moniker, DocFX tabs, `[!INCLUDE]`,
  `[!code-<lang>]` with `#region` markers, `<xref:Uid>` resolution.
- **Server-side highlighting.** Shiki with ~100 grammars; line numbers,
  filename badges, line highlights/focus/diff via `@shikijs/transformers`.
- **Server-side diagrams.** Mermaid rendered through Kroki in both light
  and dark palettes — theme switching is instant, no client mermaid bundle
  needed when both palettes are populated.
- **First-class i18n.** Locale-first URLs (`/zh/repo/page`), translated site
  chrome, hreflang alternates in the SEO head, sitemap with `xhtml:link`
  siblings.
- **Search.** Per-repo Ctrl-K dialog plus a full-page `/search` that fans
  out across every repo. Advanced query syntax (`"phrase"`, `-exclude`,
  `title:`, `repo:`).
- **React in Markdown.** Drop FluentUI primitives directly into `.md`
  files — they mount as real components, not inert HTML.
- **SEO out of the box.** Open Graph + Twitter Card + JSON-LD (WebSite,
  BreadcrumbList, TechArticle), `/robots.txt`, `/sitemap.xml`.
- **Edge cache + KV.** Layered cache through `cache.ts`; GitHub `push`
  webhook invalidates exactly the touched entries.
- **AI Summary.** Microsoft Learn-style pill button below the page title
  streams a model-generated summary over SSE. Pluggable provider — Workers
  AI, any OpenAI-compatible endpoint (OpenAI, OpenRouter, Together…), or
  Anthropic. Optional Cloudflare Turnstile gate. Per-page summaries cached
  in KV for 7 days. See
  [Configuration → AI Summary](./local-docs/vl-handbook/configuration.md#ai-summary).
- **Ask AI about this docs.** Chat drawer launched from the NavBar. The AI
  has docs tools (`search_docs`, `fetch_page`, `list_repos`, `list_pages`)
  so it can walk the site to answer a question instead of relying on the
  current page alone. Visitor picks the scope (current repo / whole site)
  in the drawer header. The same tools are exposed over JSON-RPC at
  **`/api/mcp`** so Claude Desktop / ChatGPT Connectors / any MCP client
  can query the docs directly.

## Quick start

```bash
git clone https://github.com/siiway/vellum.git
cd vellum
bun install
bun run dev          # http://127.0.0.1:8787
```

The default `vellum.config.json` wires up some real SiiWay projects plus this
handbook, so the dev server is useful with zero edits.

To deploy to your own Cloudflare account:

```bash
bun run deploy
```

`bun run deploy` runs the client build and `wrangler deploy`, which uploads
the worker plus every static asset (including bundled `local-docs/`).

## Configuration

The whole site is one file: `vellum.config.json` at the project root. Its
shape is fully described by the JSON Schema at
`src/shared/site-schema.json` (autocomplete and validation in any modern
editor — keep the `"$schema"` line at the top of the file).

Minimum viable repo:

```json
{
  "site": {
    "title": "My Docs",
    "homepageRepo": "main-docs",
    "defaultLocale": "en",
    "locales": [{ "code": "en", "label": "English", "prefix": "" }]
  },
  "repos": [
    {
      "slug": "main-docs",
      "owner": "your-org",
      "repo": "your-repo",
      "branch": "main",
      "docsRoot": "docs",
      "displayName": "Main Docs"
    }
  ]
}
```

See the [Configuration reference](./local-docs/vl-handbook/configuration.md)
for every field.

## Project structure

```
src/
  worker/         # Cloudflare Worker — routing, source fetching, markdown
                  #   pipeline, SSR, search, sitemap, webhook
  app/            # React client — Layout, NavBar, Sidebar, Outline,
                  #   SearchDialog, SearchPage, MarkdownAst renderer
  shared/         # Types + i18n dictionary shared between worker and client
local-docs/
  vl-handbook/    # This handbook (a local-source repo)
  homepage/       # The site landing page (also local-source)
scripts/          # gen-site-schema, drop-kv-cache, vite-local-docs plugin
```

## Scripts

| Command              | What it does                                                 |
| -------------------- | ------------------------------------------------------------ |
| `bun run dev`        | Vite build (client + local-docs) → `wrangler dev` on `:8787` |
| `bun run build`      | Client build + worker dry-run                                |
| `bun run deploy`     | Client build + `wrangler deploy`                             |
| `bun run typecheck`  | `tsc --noEmit`                                               |
| `bun run lint`       | ESLint over `src/` + `scripts/`                              |
| `bun run format`     | Prettier write                                               |
| `bun run gen:schema` | Regenerate `site-schema.json` from `src/shared/types.ts`     |
| `bun run drop:cache` | Bulk-delete every key from the configured KV namespace       |

## Handbook

For everything beyond the quickstart — every config field, every markdown
extension, the search/i18n/caching/webhook details — read the handbook:

- [Getting started](./local-docs/vl-handbook/getting-started.md)
- [Configuration reference](./local-docs/vl-handbook/configuration.md)
- [Sources: GitHub & local](./local-docs/vl-handbook/sources.md)
- [Layouts](./local-docs/vl-handbook/layouts.md)
- [Markdown features](./local-docs/vl-handbook/markdown.md)
- [OPS extensions](./local-docs/vl-handbook/ops-extensions.md)
- [React components in Markdown](./local-docs/vl-handbook/react-in-markdown.md)
- [Search](./local-docs/vl-handbook/search.md)
- [Internationalisation](./local-docs/vl-handbook/i18n.md)
- [Caching & deployment](./local-docs/vl-handbook/caching-and-deployment.md)
- [GitHub webhooks](./local-docs/vl-handbook/webhooks.md)

The handbook is itself served by Vellum from the bundled `vl-handbook`
local-source repo — visit `/vl-handbook/` on a running instance to read it
with the full chrome.

## Requirements

- **Node 22+** and **Bun 1.1+** (Bun is the package manager / script
  runner).
- A **Cloudflare account** with Workers enabled.
- Optional: a **GitHub PAT** (`VELLUM_GITHUB_TOKEN`) for private repos and
  higher rate limits on public ones.

## Tech stack

TypeScript • React 18 (SSR + hydrate) • FluentUI v9 + Griffel CSS-in-JS •
markdown-it • Shiki • Kroki (for mermaid) • MathJax • Cloudflare Workers •
Vite • Bun.

## License

GNU General Public License 3.0. See [LICENSE](./LICENSE).
