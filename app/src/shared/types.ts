// Shared types used by both the Worker (SSR) and the browser (hydration).

import { countries, continents } from "countries-list";

export interface LocaleConfig {
  code: string;
  label: string;
  // URL prefix segment for this locale (e.g. "en", "zh"). Used when matching
  // and building canonical URLs. Decoupled from the source-file layout —
  // see `localeSourcePrefix` below.
  prefix: string;
}

// Canonicalize a locale code into its BCP47 region-coded form. Uses CLDR's
// likely-subtags data via `Intl.Locale.maximize()` (`zh` → `zh-CN`,
// `pt` → `pt-BR`, `en` → `en-US`). Codes that are already region-coded
// pass through unchanged. Codes the runtime can't parse fall through too.
export function canonicalLocaleCode(code: string): string {
  if (!code) return code;
  if (code.includes("-")) return code;
  try {
    const max = new Intl.Locale(code).maximize();
    return max.region ? `${max.language}-${max.region}` : max.language;
  } catch {
    return code;
  }
}

// Preferred display form for a locale's identifier. Returns the prefix
// (which is already BCP47 for author-declared locales like
// `{ code: "zh", prefix: "zh-CN" }`) or the canonical of the code.
// Used in card subtitles / picker tooltips so readers see `zh-CN`, not
// the internal bare `zh`.
export function displayLocaleCode(locale: LocaleConfig): string {
  if (locale.prefix && locale.prefix.includes("-")) return locale.prefix;
  return canonicalLocaleCode(locale.code);
}

// Map a locale to a continent code (one of "AS", "EU", "AF", "NA", "SA",
// "OC", "AN") using its CLDR-likely region. Returns null when neither the
// runtime nor the country data can produce a region. Continent data comes
// from the `countries-list` npm package — externally maintained, not
// hardcoded in this codebase.
type ContinentCode = "AF" | "AN" | "AS" | "EU" | "NA" | "OC" | "SA";

export function localeContinent(code: string): ContinentCode | null {
  let region: string | undefined;
  try {
    region = new Intl.Locale(code).maximize().region ?? undefined;
  } catch {
    return null;
  }
  if (!region) return null;
  const country = (countries as Record<string, { continent?: string }>)[region];
  return (country?.continent as ContinentCode | undefined) ?? null;
}

// Continent display name in English ("Asia", "Europe", …). Sourced from
// `countries-list`'s exported map; we keep the package as the source of
// truth rather than maintaining our own list.
export function continentName(code: ContinentCode | "OTHER"): string {
  if (code === "OTHER") return "Other";
  return (continents as Record<string, string>)[code] ?? code;
}

// Where this locale's source markdown lives, relative to the repo's docsRoot.
// The repo's `localeDirs` wins when it names the locale. Otherwise the
// default locale's content sits at the docs root with no subdirectory, and
// every other locale lives under a subdir named after its short `code`
// (e.g. `docs/zh/`, `docs/ja/`) — the long-standing repo convention,
// preserved even when URLs use a richer BCP47 prefix like `zh-CN`.
export function localeSourcePrefix(
  locale: Pick<LocaleConfig, "code">,
  defaultLocaleCode: string,
  repo: Pick<RepoConfig, "localeDirs">,
): string {
  const dir = repo.localeDirs?.[locale.code];
  if (dir !== undefined) return dir.replace(/^\/+|\/+$/g, "");
  return locale.code === defaultLocaleCode ? "" : locale.code;
}

// The locale a source file belongs to, and its page path inside that
// locale's directory. `rel` is relative to the docs root, without `.md`.
// A file under a locale's directory belongs to that locale (the deepest
// directory wins). Any other file belongs to the default locale when its
// pages sit at the docs root, and to no locale when they have a directory
// of their own.
export function sourceLocale(
  rel: string,
  locales: Pick<LocaleConfig, "code">[],
  defaultLocaleCode: string,
  repo: Pick<RepoConfig, "localeDirs">,
): { code: string; path: string } | null {
  let best: { code: string; dir: string } | null = null;
  for (const l of locales) {
    const dir = localeSourcePrefix(l, defaultLocaleCode, repo);
    if (dir && rel.startsWith(`${dir}/`) && (!best || dir.length > best.dir.length)) {
      best = { code: l.code, dir };
    }
  }
  if (best) return { code: best.code, path: rel.slice(best.dir.length + 1) };
  if (localeSourcePrefix({ code: defaultLocaleCode }, defaultLocaleCode, repo)) return null;
  return { code: defaultLocaleCode, path: rel };
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
  // Source directory of each locale's pages, relative to docsRoot, keyed by
  // locale code. Locales left out keep the default layout: the default
  // locale at the docs root, others in a directory named after their code.
  // Set it when the default locale has its own directory, like `en/`.
  localeDirs?: Record<string, string>;
  // Path the repo's root URL redirects to, relative to the repo (e.g.
  // "v0.4" sends /{locale}/{slug} to /{locale}/{slug}/v0.4). Use it when
  // the docs root holds no real home page, such as docs versioned by
  // directory.
  landingPage?: string;
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
  // Per-repo search synonyms. Merged on top of site.searchAliases (and the
  // built-in baseline) when searching within this repo. Use it for
  // vocabulary that only makes sense for this product — e.g. mapping a
  // product code-name to its public-facing terminology.
  searchAliases?: Record<string, string[]>;
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
  // Search synonyms. Each key is a canonical or shorthand term; values are
  // the words the docs author is likely to have used for the same concept.
  // A reader searching for any of these terms will also match pages that
  // contain the others (alias hits score below primary hits so canonical
  // matches still win). Merged on top of a built-in baseline (latex/math,
  // auth/oauth, ws/websocket, …) so config only needs to spell out the
  // product-specific vocabulary.
  searchAliases?: Record<string, string[]>;
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
