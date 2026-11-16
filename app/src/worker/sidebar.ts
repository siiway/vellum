// Sidebar resolution for a repo. Looks for, in order:
//   1. `vellum.json` at the docs root (our native format)
//   2. `.vitepress/config.ts` at the docs root, parsed and read statically
//      (see vitepress-config.ts)
//   3. Directory listing fallback - flat list of markdown files
//
// Returned sidebar groups are localized: links are prefixed with the repo slug + locale.

import type { Env } from "./env";
import type {
  LocaleConfig,
  NavItem,
  RepoConfig,
  SidebarGroup,
  SidebarItem,
  RouteContext,
  SocialLink,
  VellumConfig,
} from "../shared/types";
import { localeSourcePrefix, sourceLocale } from "../shared/types";
import { fetchFirstSourceFile, fetchSourceFile, fetchSourceTree, docsRootPrefix } from "./sources";
import { dedupe, readCache, writeCache } from "./cache";
import { ttlSeconds } from "./env";
import { isRecord, readVitePressConfig, themeConfigField } from "./vitepress-config";

// Bundles the URL-side prefix and source-side prefix for a locale into one
// argument, since the per-locale sidebar code needs both: URLs use the
// locale's URL prefix (always for non-root locales, can be set even for the
// default locale), while file-tree filtering uses the source prefix (empty
// for the default locale by convention — see `localeSourcePrefix`).
interface LocaleResolution {
  code: string;
  urlPrefix: string;
  srcPrefix: string;
  isDefault: boolean;
}

function resolveLocale(
  locale: LocaleConfig,
  defaultLocaleCode: string,
  repo: RepoConfig,
): LocaleResolution {
  return {
    code: locale.code,
    urlPrefix: locale.prefix,
    srcPrefix: localeSourcePrefix(locale, defaultLocaleCode, repo),
    isDefault: locale.code === defaultLocaleCode,
  };
}

// Native `vellum.json` supports two shapes:
//
// 1. Flat (single-locale):
//      { "groups": [ ... ] }
//
// 2. Per-locale (VitePress-style — mirrors `locales: { root: { themeConfig:
//    { sidebar: [...] } } }`):
//      { "locales": { "root": { "groups": [...] }, "zh": { "groups": [...] } } }
//
// `root` is the alias for the site's default locale (matching VitePress).
// When the current locale has no entry, we fall back to root.
interface NativeSidebar {
  groups?: SidebarGroup[];
  locales?: Record<string, { groups: SidebarGroup[] }>;
}

export async function loadSidebar(
  env: Env,
  repo: RepoConfig,
  branch: string,
  locale: LocaleConfig,
  defaultLocaleCode: string,
  ctx?: ExecutionContext,
  site?: VellumConfig,
): Promise<SidebarGroup[]> {
  const resolved = resolveLocale(locale, defaultLocaleCode, repo);
  const key = `sidebar:${repo.slug}@${branch}:${resolved.code}`;
  const cached = await readCache<SidebarGroup[]>(env, key);
  if (cached) return cached;

  let groups: SidebarGroup[] | null = null;
  const native = await tryLoadNative(env, repo, branch, ctx);
  if (native) {
    const fromNative = pickNativeLocale(native, resolved.code, defaultLocaleCode);
    if (fromNative) groups = localize(fromNative, repo.slug, resolved);
  }

  if (!groups) {
    const vp = await tryLoadVitePress(env, repo, branch, resolved, ctx);
    if (vp) groups = localize(vp, repo.slug, resolved);
  }

  if (!groups) {
    const locales = site?.site.locales ?? [locale, { code: defaultLocaleCode }];
    groups = await buildFromTree(env, repo, branch, resolved, locales, defaultLocaleCode, ctx);
  }

  await writeCache(env, key, groups, ttlSeconds(env, "raw"), ctx);
  return groups;
}

async function tryLoadNative(
  env: Env,
  repo: RepoConfig,
  branch: string,
  ctx?: ExecutionContext,
): Promise<NativeSidebar | null> {
  const text = await fetchSourceFile(
    env,
    repo,
    branch,
    `${docsRootPrefix(repo.docsRoot)}vellum.json`,
    { ctx },
  );
  if (!text) return null;
  try {
    return JSON.parse(text) as NativeSidebar;
  } catch {
    return null;
  }
}

// The repo's VitePress config, read statically (see vitepress-config.ts).
// The sidebar, nav and social-link loaders all ask for it during one page
// render; `dedupe` has them share one fetch and one parse.
function loadVitePressConfig(
  env: Env,
  repo: RepoConfig,
  branch: string,
  ctx?: ExecutionContext,
): Promise<Record<string, unknown> | null> {
  return dedupe(ctx, `vitepress-config:${repo.slug}@${branch}`, async () => {
    const base = `${docsRootPrefix(repo.docsRoot)}.vitepress/config`;
    const found = await fetchFirstSourceFile(
      env,
      repo,
      branch,
      [".mts", ".ts", ".mjs", ".js"].map((ext) => `${base}${ext}`),
      { ctx },
    );
    return found ? readVitePressConfig(found.text) : null;
  });
}

// VitePress keys `locales` by the locale's top-level source directory (`zh`)
// and the default locale by `root`, so the config and the locale's files
// agree. A default locale with its own directory (`localeDirs`) is still
// `root` unless the config names that directory.
function vitePressLocaleKey(config: Record<string, unknown>, resolved: LocaleResolution): string {
  const dir = resolved.srcPrefix.split("/")[0]!;
  if (!dir) return "root";
  if (!resolved.isDefault) return dir;
  return isRecord(config.locales) && isRecord(config.locales[dir]) ? dir : "root";
}

async function tryLoadVitePress(
  env: Env,
  repo: RepoConfig,
  branch: string,
  resolved: LocaleResolution,
  ctx?: ExecutionContext,
): Promise<SidebarGroup[] | null> {
  const config = await loadVitePressConfig(env, repo, branch, ctx);
  if (!config) return null;
  const groups = toSidebarGroups(
    themeConfigField(config, vitePressLocaleKey(config, resolved), "sidebar"),
  );
  return groups.length ? groups : null;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

function withBase(link: string, base: string | undefined): string {
  if (!base || /^[a-z]+:/i.test(link) || link.startsWith("#")) return link;
  return `${base.replace(/\/+$/, "")}/${link.replace(/^\/+/, "")}`;
}

// `sidebar` is an array of groups, or an object that maps a path to an array
// or to `{ base, items }` (VitePress's multiple sidebars). The object form
// lists every sidebar, one after another.
function toSidebarGroups(value: unknown): SidebarGroup[] {
  const lists: { base?: string; items: unknown[] }[] = [];
  if (Array.isArray(value)) {
    lists.push({ items: value });
  } else if (isRecord(value)) {
    for (const v of Object.values(value)) {
      if (Array.isArray(v)) lists.push({ items: v });
      else if (isRecord(v) && Array.isArray(v.items)) {
        lists.push({ base: str(v.base), items: v.items });
      }
    }
  }
  const groups: SidebarGroup[] = [];
  for (const list of lists) {
    for (const g of list.items) {
      if (!isRecord(g) || !Array.isArray(g.items)) continue;
      groups.push({
        text: str(g.text) ?? "",
        collapsed: bool(g.collapsed),
        items: toSidebarItems(g.items, str(g.base) ?? list.base),
      });
    }
  }
  return groups;
}

// An item's own link uses the base it inherits; its `base` applies to its
// children.
function toSidebarItems(value: unknown[], base: string | undefined): SidebarItem[] {
  const items: SidebarItem[] = [];
  for (const v of value) {
    if (!isRecord(v)) continue;
    const text = str(v.text);
    if (text === undefined) continue;
    const link = str(v.link);
    items.push({
      text,
      link: link === undefined ? undefined : withBase(link, base),
      collapsed: bool(v.collapsed),
      items: Array.isArray(v.items) ? toSidebarItems(v.items, str(v.base) ?? base) : undefined,
    });
  }
  return items;
}

function toNavItems(value: unknown): NavItem[] {
  if (!Array.isArray(value)) return [];
  const items: NavItem[] = [];
  for (const v of value) {
    if (!isRecord(v)) continue;
    const text = str(v.text);
    if (text === undefined) continue;
    items.push({
      text,
      link: str(v.link),
      activeMatch: str(v.activeMatch),
      items: Array.isArray(v.items) ? toNavItems(v.items) : undefined,
    });
  }
  return items;
}

function toSocialLinks(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is SocialLink =>
      isRecord(v) &&
      typeof v.link === "string" &&
      (typeof v.icon === "string" || (isRecord(v.icon) && typeof v.icon.svg === "string")),
  );
}

async function buildFromTree(
  env: Env,
  repo: RepoConfig,
  branch: string,
  resolved: LocaleResolution,
  locales: Pick<LocaleConfig, "code">[],
  defaultLocaleCode: string,
  ctx?: ExecutionContext,
): Promise<SidebarGroup[]> {
  const tree = await fetchSourceTree(env, repo, branch, { ctx });
  const prefix = docsRootPrefix(repo.docsRoot);

  // This locale's pages, as paths inside its source directory, without `.md`.
  const files = tree
    .filter((e) => e.type === "blob" && e.path.startsWith(prefix) && e.path.endsWith(".md"))
    .flatMap((e) => {
      const rel = e.path.slice(prefix.length).replace(/\.md$/, "");
      const owner = sourceLocale(rel, locales, defaultLocaleCode, repo);
      return owner?.code === resolved.code ? [owner.path] : [];
    });

  // Build a directory-aware tree. Files at the docs root land in the "root"
  // group (titled with the repo name); files nested under a subdirectory land
  // in a per-subdir group so a sidebar with many sections doesn't render as a
  // flat slash-joined list ("Api/Auth", "Guide/Configuration", ...).
  const rootItems: SidebarItem[] = [];
  const groups = new Map<string, SidebarItem[]>();

  const urlPrefix = resolved.urlPrefix ? `/${resolved.urlPrefix}` : "";
  function urlFor(name: string): string {
    // Strip a trailing `/index` so directory landing pages get clean URLs.
    const cleaned =
      name === "index" ? "" : name.endsWith("/index") ? name.slice(0, -"/index".length) : name;
    // Locale-first canonical: `/{urlPrefix}/{repoSlug}/{cleaned}`. Source
    // path prefix (`localePath`) only applies to file-tree matching above;
    // URLs use the URL-side prefix.
    return (
      `${urlPrefix}/${repo.slug}/${cleaned}`.replace(/\/+/g, "/").replace(/\/$/, "") ||
      `${urlPrefix}/${repo.slug}`
    );
  }

  for (const name of files) {
    const parts = name.split("/");

    if (parts.length === 1) {
      // Root-level page.
      const leaf = parts[0]!;
      const display = leaf === "index" ? repo.displayName : titleCase(leaf.replace(/[-_]/g, " "));
      rootItems.push({ text: display, link: urlFor(name) });
    } else {
      // Nested page: group by first directory segment.
      const dir = parts[0]!;
      const leaf = parts[parts.length - 1]!;
      const display = leaf === "index" ? "Overview" : titleCase(leaf.replace(/[-_]/g, " "));
      let bucket = groups.get(dir);
      if (!bucket) {
        bucket = [];
        groups.set(dir, bucket);
      }
      bucket.push({ text: display, link: urlFor(name) });
    }
  }

  // Sort items inside each group so the order is deterministic regardless of
  // the GitHub tree response order; put "Overview"/index landing pages first.
  function sortItems(items: SidebarItem[]) {
    items.sort((a, b) => {
      const aIsOverview = a.text === "Overview" || a.link?.endsWith(`/${repo.slug}`);
      const bIsOverview = b.text === "Overview" || b.link?.endsWith(`/${repo.slug}`);
      if (aIsOverview && !bIsOverview) return -1;
      if (bIsOverview && !aIsOverview) return 1;
      return a.text.localeCompare(b.text);
    });
  }
  sortItems(rootItems);

  const result: SidebarGroup[] = [];
  if (rootItems.length) {
    result.push({ text: repo.displayName, items: rootItems });
  }
  // Sort group keys alphabetically; titleCase the dir name for display.
  for (const dir of [...groups.keys()].sort()) {
    const items = groups.get(dir)!;
    sortItems(items);
    result.push({ text: titleCase(dir.replace(/[-_]/g, " ")), items });
  }
  return result;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Picks the right sidebar groups out of a NativeSidebar shape. The new
// shape lives under `locales: { root: ..., zh: ... }`; the flat shape's
// top-level `groups` is still honoured for back-compat with single-locale
// configs.
function pickNativeLocale(
  native: NativeSidebar,
  localeCode: string,
  defaultLocale: string | undefined,
): SidebarGroup[] | null {
  if (native.locales) {
    // Resolution order: exact locale → `root` alias (when current locale is
    // the default) → `root` always (final fallback). VitePress treats `root`
    // as "the default locale's section", so when a non-default locale lacks
    // a translation we'd rather show the default-locale sidebar than
    // nothing.
    const direct = native.locales[localeCode];
    if (direct?.groups) return direct.groups;
    if (defaultLocale && localeCode === defaultLocale && native.locales.root?.groups) {
      return native.locales.root.groups;
    }
    if (native.locales.root?.groups) return native.locales.root.groups;
    const firstKey = Object.keys(native.locales)[0];
    if (firstKey && native.locales[firstKey]?.groups) return native.locales[firstKey].groups;
  }
  return native.groups ?? null;
}

function localize(
  groups: SidebarGroup[],
  repoSlug: string,
  resolved: LocaleResolution,
): SidebarGroup[] {
  // URL-side prefix (always — even for the default locale, now that it
  // carries its own URL prefix). Locale-first canonical: `/{urlPrefix}/{repoSlug}`.
  const urlPrefix = resolved.urlPrefix;
  const base = `${urlPrefix ? `/${urlPrefix}` : ""}/${repoSlug}`;
  // Authored configs sometimes write paths prefixed with the locale's
  // *source* directory (the VitePress convention — `/zh/getting-started`
  // inside the zh sidebar). Strip those before prepending our canonical
  // base so we don't double the segment.
  const srcPrefix = resolved.srcPrefix;

  function rewrite(href: string): string {
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("#"))
      return href;

    let path = href;
    if (srcPrefix && path.startsWith(`/${srcPrefix}/`)) {
      path = path.slice(`/${srcPrefix}`.length);
    } else if (srcPrefix && path === `/${srcPrefix}`) {
      path = "/";
    }

    if (path.startsWith("/")) return `${base}${path}`.replace(/\/+/g, "/");
    return `${base}/${path}`.replace(/\/+/g, "/");
  }

  function mapItem(item: SidebarItem): SidebarItem {
    return {
      text: item.text,
      link: item.link ? rewrite(item.link) : undefined,
      collapsed: item.collapsed,
      items: item.items ? item.items.map(mapItem) : undefined,
    };
  }
  return groups.map((g) => ({
    text: g.text,
    collapsed: g.collapsed,
    items: g.items.map(mapItem),
  }));
}

// Per-repo top navigation. Reads from either our native vellum.json (nav field)
// or VitePress themeConfig.nav. Localized so links land inside this repo + locale.
export async function loadRepoNav(
  env: Env,
  repo: RepoConfig,
  branch: string,
  locale: LocaleConfig,
  defaultLocaleCode: string,
  ctx?: ExecutionContext,
): Promise<NavItem[] | null> {
  const resolved = resolveLocale(locale, defaultLocaleCode, repo);
  const key = `nav:${repo.slug}@${branch}:${resolved.code}`;
  const cached = await readCache<NavItem[] | { empty: true }>(env, key);
  if (cached) return Array.isArray(cached) ? cached : null;

  let nav: NavItem[] | null = null;

  // 1. vellum.json native format.
  const nativeText = await fetchSourceFile(
    env,
    repo,
    branch,
    `${docsRootPrefix(repo.docsRoot)}vellum.json`,
    { ctx },
  );
  if (nativeText) {
    try {
      const data = JSON.parse(nativeText) as { nav?: NavItem[] };
      if (Array.isArray(data.nav) && data.nav.length) {
        nav = localizeNav(data.nav, repo.slug, resolved);
      }
    } catch {
      // Fall through to VitePress.
    }
  }

  if (!nav) {
    // 2. VitePress themeConfig.nav.
    const config = await loadVitePressConfig(env, repo, branch, ctx);
    const items = config
      ? toNavItems(themeConfigField(config, vitePressLocaleKey(config, resolved), "nav"))
      : [];
    if (items.length) nav = localizeNav(items, repo.slug, resolved);
  }

  if (!nav) {
    await writeCache(env, key, { empty: true }, ttlSeconds(env, "raw"), ctx);
    return null;
  }

  await writeCache(env, key, nav, ttlSeconds(env, "raw"), ctx);
  return nav;
}

// Per-repo social links. Resolution order: vellum.json#socialLinks → VitePress
// themeConfig.socialLinks → RepoConfig.socialLinks. Returns null when nothing
// repo-specific is configured; the NavBar then falls back to site-level.
//
// Cached just like loadRepoNav. The cache key intentionally omits the locale
// because socialLinks are universally site/repo-wide — not localised. Sharing
// one cache entry across locales avoids re-parsing the VitePress config per
// language switch.
export async function loadRepoSocialLinks(
  env: Env,
  repo: RepoConfig,
  branch: string,
  ctx?: ExecutionContext,
): Promise<SocialLink[] | null> {
  const key = `social:${repo.slug}@${branch}`;
  const cached = await readCache<SocialLink[] | { empty: true }>(env, key);
  if (cached) return Array.isArray(cached) ? cached : null;

  // 1. vellum.json native.
  const nativeText = await fetchSourceFile(
    env,
    repo,
    branch,
    `${docsRootPrefix(repo.docsRoot)}vellum.json`,
    { ctx },
  );
  if (nativeText) {
    try {
      const data = JSON.parse(nativeText) as { socialLinks?: SocialLink[] };
      if (Array.isArray(data.socialLinks) && data.socialLinks.length) {
        await writeCache(env, key, data.socialLinks, ttlSeconds(env, "raw"), ctx);
        return data.socialLinks;
      }
    } catch {
      // Fall through to VitePress.
    }
  }

  // 2. VitePress themeConfig.socialLinks. Social links are the same in every
  //    locale, so the default locale's (or the shared) value is used.
  const config = await loadVitePressConfig(env, repo, branch, ctx);
  const links = config ? toSocialLinks(themeConfigField(config, "root", "socialLinks")) : [];
  if (links.length) {
    await writeCache(env, key, links, ttlSeconds(env, "raw"), ctx);
    return links;
  }

  // 3. RepoConfig.socialLinks from vellum.config.json. Returning null here lets
  //    the router fall back to repo.socialLinks (which it owns directly — no
  //    need to round-trip through the cache).
  await writeCache(env, key, { empty: true }, ttlSeconds(env, "raw"), ctx);
  return null;
}

function localizeNav(items: NavItem[], repoSlug: string, resolved: LocaleResolution): NavItem[] {
  // URL-side prefix anchors every link to the canonical locale-first path.
  const urlPrefix = resolved.urlPrefix;
  const base = `${urlPrefix ? `/${urlPrefix}` : ""}/${repoSlug}`;
  // Source-side prefix is what authors write inside their locale-keyed
  // config (e.g. `/zh/getting-started`); strip it before reattaching our
  // canonical base.
  const srcPrefix = resolved.srcPrefix;

  function rewrite(href: string): string {
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("#"))
      return href;
    let path = href;
    if (srcPrefix && path.startsWith(`/${srcPrefix}/`)) {
      path = path.slice(`/${srcPrefix}`.length);
    } else if (srcPrefix && path === `/${srcPrefix}`) {
      path = "/";
    }
    if (path.startsWith("/")) return `${base}${path}`.replace(/\/+/g, "/");
    return `${base}/${path}`.replace(/\/+/g, "/");
  }

  function mapItem(item: NavItem): NavItem {
    return {
      text: item.text,
      link: item.link ? rewrite(item.link) : undefined,
      activeMatch: item.activeMatch,
      items: item.items ? item.items.map(mapItem) : undefined,
    };
  }
  return items.map(mapItem);
}

// Compute prev/next from sidebar relative to current URL.
export function neighbors(groups: SidebarGroup[], route: RouteContext) {
  const flat: { text: string; link: string }[] = [];
  function walk(items: SidebarItem[]) {
    for (const i of items) {
      if (i.link) flat.push({ text: i.text, link: i.link });
      if (i.items?.length) walk(i.items);
    }
  }
  groups.forEach((g) => walk(g.items));

  const idx = flat.findIndex((f) => normalize(f.link) === normalize(route.canonicalUrl));
  return {
    prev: idx > 0 ? flat[idx - 1]! : null,
    next: idx >= 0 && idx < flat.length - 1 ? flat[idx + 1]! : null,
  };
}

function normalize(url: string): string {
  return url.replace(/\/+$/, "").replace(/\.html$/, "");
}
