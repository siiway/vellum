// Shared types used by both the Worker (SSR) and the browser (hydration).

export interface LocaleConfig {
  code: string;
  label: string;
  prefix: string; // empty string means root locale
}

export interface RepoVersion {
  label: string;
  branch: string;
  default?: boolean;
}

export interface RepoConfig {
  slug: string;
  // "github" (default) fetches content from raw.githubusercontent.com via the
  // GitHub source. "local" reads from a directory bundled into the worker's
  // ASSETS at build time — useful for docs that live next to the worker, for
  // air-gapped previews, or for content owned by the same repo as Vellum
  // itself. owner/repo/branch become optional when source === "local".
  source?: "github" | "local";
  // GitHub-source fields. Optional when source === "local".
  owner?: string;
  repo?: string;
  branch?: string;
  docsRoot: string;
  displayName: string;
  description?: string;
  logo?: string;
  editLinkPattern?: string;
  versions?: RepoVersion[];
  // Local-source field: directory under the project root that holds the
  // markdown tree. Optional — defaults to `local-docs/{slug}`. Path is
  // relative to the project root and is resolved at build time by the Vite
  // local-docs plugin, which copies the tree into the worker's ASSETS bundle
  // alongside a manifest.json the worker uses to enumerate pages.
  localPath?: string;
  // When true, the NavBar omits this repo's displayName crumb after the site
  // title. Useful for the homepageRepo where the second crumb is redundant
  // (the site title already represents the landing page).
  hideInBrand?: boolean;
  // When true, the repo is omitted from search results — both from the
  // per-repo dialog's scope picker and from the cross-repo full-page search.
  // Use for landing-page repos (the homepage) and other "system" content the
  // reader shouldn't be sent to by a query.
  excludeFromSearch?: boolean;
  // Per-repo override for site.socialLinks. Shown in the NavBar when the
  // reader is inside this repo. Same shape as the site-level field. Higher-
  // priority overrides come from the repo's own vellum.json#socialLinks or
  // VitePress themeConfig.socialLinks.
  socialLinks?: SocialLink[];
}

export interface NavItem {
  text: string;
  link?: string;
  items?: NavItem[];
  activeMatch?: string;
}

export interface VueComponentRef {
  name: string;
  // Repo-rooted path to the .vue source file, used as the `path` parameter to
  // the `/api/vue` endpoint.
  path: string;
}

// Icon names with a built-in SVG. Authors can also pass `{ svg: "<svg...>" }`
// for anything not in the table.
export type SocialIconName =
  | "github"
  | "gitlab"
  | "x"
  | "twitter"
  | "discord"
  | "slack"
  | "mastodon"
  | "bluesky"
  | "youtube"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "npm"
  | "rss"
  | "stackoverflow"
  | "reddit"
  | "twitch"
  | "telegram";

export interface SocialLink {
  // Either a known name (rendered from the built-in SVG table) or a `{ svg }`
  // wrapper carrying raw SVG markup. Matches the VitePress themeConfig.
  icon: SocialIconName | { svg: string };
  link: string;
  // Optional accessible label. Defaults to the capitalised icon name.
  ariaLabel?: string;
}

export interface SiteConfig {
  title: string;
  tagline?: string;
  logo?: string;
  favicon?: string;
  themeColor?: string;
  footer?: string;
  // Which repo's root acts as the site's landing page. The `/` route redirects
  // here, and the NavBar brand link points here (locale-preserved).
  homepageRepo: string;
  defaultLocale: string;
  locales: LocaleConfig[];
  // Icon-only links rendered in the NavBar after the locale picker and before
  // the theme toggle. Matches VitePress's themeConfig.socialLinks.
  socialLinks?: SocialLink[];
  // Microsoft Learn-style AI Summary button rendered below the page title on
  // doc pages. The worker proxies to the configured provider, streams tokens
  // back over SSE, and caches the final summary in KV per (repo, branch,
  // locale, page). Omit the whole block to disable the feature site-wide.
  aiSummary?: AiSummaryConfig;
  // "Ask AI about this docs" chat. Floating button + drawer that lets
  // visitors chat with an LLM that has tools to search and fetch the docs.
  // Same provider plumbing as aiSummary; configured independently so a
  // deployment can enable one without the other (e.g. summaries on, chat
  // off until you've reviewed bills).
  aiChat?: AiChatConfig;
}

export interface AiSummaryConfig {
  // Which provider the worker should route through. Provider-specific secrets
  // (API keys) come from worker env vars, not this file.
  //   - "workers-ai": Cloudflare Workers AI binding (env.AI). No API key needed.
  //   - "openai-compatible": Anything that speaks OpenAI's /v1/chat/completions
  //     — OpenAI itself, OpenRouter, Together, Groq, a local llama.cpp, etc.
  //     Uses VELLUM_AI_API_KEY and VELLUM_AI_BASE_URL.
  //   - "anthropic": Anthropic's Messages API. Uses VELLUM_AI_API_KEY.
  provider: "workers-ai" | "openai-compatible" | "anthropic";
  // Model identifier passed to the provider. For workers-ai this is the
  // model id (e.g. "@cf/meta/llama-3.3-70b-instruct-fp8-fast"). For
  // openai-compatible / anthropic it's whatever the provider's API expects
  // (e.g. "openai/gpt-4o-mini" via OpenRouter, "claude-haiku-4-5").
  model?: string;
  // Base URL override for openai-compatible providers — lets you point at
  // OpenRouter ("https://openrouter.ai/api/v1"), a self-hosted gateway, etc.
  // When omitted the worker uses VELLUM_AI_BASE_URL, then OpenAI's URL.
  baseUrl?: string;
  // Cloudflare Turnstile site key. When set, the AI Summary button mounts an
  // invisible Turnstile widget, the client passes the token to /api/summarize,
  // and the worker verifies it against siteverify before calling the model.
  // Pairs with the VELLUM_TURNSTILE_SECRET env secret. Omit to disable
  // captcha (useful for local dev and trusted-network deploys).
  turnstileSiteKey?: string;
  // KV TTL for the cached summary in seconds. Defaults to 7 days. The webhook
  // doesn't currently bust these — a docs edit invalidates the rendered HTML
  // but the old summary survives until the TTL expires.
  cacheTtlSeconds?: number;
}

export interface AiChatConfig {
  // Same set as AiSummaryConfig.provider — see there for the matrix. Note
  // that tool calling is only reliably supported by openai-compatible and
  // anthropic providers; "workers-ai" works but with a smaller tool-use
  // model menu (Llama 3.3 70B Fast is the default).
  provider: "workers-ai" | "openai-compatible" | "anthropic";
  // Model id. Defaults: "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  // (workers-ai), "openai/gpt-4o-mini" (openai-compatible),
  // "claude-haiku-4-5" (anthropic). Use a stronger model than for summaries
  // if you can afford it — chat answers benefit from more reasoning.
  model?: string;
  baseUrl?: string;
  // Cloudflare Turnstile site key. When set, the visitor solves one
  // (invisible) challenge per chat session; the worker issues a short-lived
  // signed session token that subsequent messages present in the
  // Authorization header. Pairs with VELLUM_TURNSTILE_SECRET.
  turnstileSiteKey?: string;
  // Maximum agentic loop iterations per user message before the worker
  // returns the partial response. Defaults to 6 — enough for "search →
  // fetch one or two pages → answer" while bounding cost.
  maxIterations?: number;
}

export interface VellumConfig {
  site: SiteConfig;
  repos: RepoConfig[];
  nav?: NavItem[];
}

// Per-repo TOC node, either explicit (from vellum.json / VitePress config) or derived from directory listing.
export interface SidebarItem {
  text: string;
  link?: string;
  items?: SidebarItem[];
  collapsed?: boolean;
}

export interface SidebarGroup {
  text: string;
  items: SidebarItem[];
  collapsed?: boolean;
}

// Outline / right-hand TOC built from headings.
// `text` is the plain heading content; `html` preserves inline formatting
// (code spans, emphasis, links) so the sidebar matches the page heading.
export interface OutlineNode {
  depth: number;
  text: string;
  html?: string;
  slug: string;
  children?: OutlineNode[];
}

export interface PageMeta {
  title: string;
  description?: string;
  frontmatter: Record<string, unknown>;
  outline: OutlineNode[];
  editUrl?: string;
  lastUpdated?: { iso: string; author?: string; sha: string } | null;
  prev?: { text: string; link: string } | null;
  next?: { text: string; link: string } | null;
}

// Forward declaration so types.ts doesn't have to import the markdown module.
export type { MarkdownAst } from "./markdown";

export interface RouteContext {
  repoSlug: string;
  repo: RepoConfig;
  version: RepoVersion;
  localeCode: string;
  // path relative to docsRoot (without locale prefix), no leading slash, no trailing .md
  pagePath: string;
  // canonical URL path inside the site, with leading slash and no trailing slash
  canonicalUrl: string;
}

export interface ErrorState {
  status: number;
  title: string;
  message: string;
  hint?: string;
  // Optional list of suggestions ("did you mean ...?") with site-relative URLs.
  suggestions?: Array<{ text: string; link: string }>;
}

// Bootstrap payload serialized into the SSR HTML and read by the hydration entry.
export interface BootstrapPayload {
  config: VellumConfig;
  route: RouteContext;
  page: {
    // AST shipped to the FluentUI renderer. Replaces the legacy html string.
    ast: import("./markdown").MarkdownAst;
    meta: PageMeta;
  };
  sidebar: SidebarGroup[];
  // Per-repo navigation pulled from the repo's VitePress themeConfig.nav (or
  // vellum.json `nav`). When null, the NavBar falls back to the site-level
  // `config.nav`. Localized so links land in the right repo+locale.
  repoNav?: NavItem[] | null;
  // Per-repo social links. Resolution order at render time:
  //   1. repo's vellum.json#socialLinks
  //   2. repo's VitePress themeConfig.socialLinks
  //   3. RepoConfig.socialLinks in vellum.config.json
  //   4. site.socialLinks  (site-wide fallback)
  // The router resolves 1–3 and stuffs the result here; null means the NavBar
  // should fall back to site-level.
  repoSocialLinks?: SocialLink[] | null;
  // Vue components registered in the repo's `.vitepress/theme/index.ts`. The
  // client uses this to (a) rewrite `<Name />` tags inside markdown HTML blocks
  // to mountable placeholders, and (b) lazy-load + mount the SFC at runtime.
  repoComponents?: VueComponentRef[];
  // The initial theme picked by the server based on cookies / prefers-color-scheme hint.
  initialTheme: "light" | "dark";
  // When set, the shell renders an ErrorPage instead of the doc body.
  error?: ErrorState;
}

declare global {
  interface Window {
    __VELLUM__?: BootstrapPayload;
  }
}
