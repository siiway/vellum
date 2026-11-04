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
import { localeSourcePrefix } from "../shared/types";
import { fetchSourceFile, fetchSourceTree, docsRootPrefix } from "./sources";
import { readCache, writeCache } from "./cache";
import { ttlSeconds } from "./env";
import { translateBundle } from "./translate";
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

function resolveLocale(locale: LocaleConfig, defaultLocaleCode: string): LocaleResolution {
  return {
    code: locale.code,
    urlPrefix: locale.prefix,
    srcPrefix: localeSourcePrefix(locale, defaultLocaleCode),
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
  const resolved = resolveLocale(locale, defaultLocaleCode);
  const key = `sidebar:${repo.slug}@${branch}:${resolved.code}`;
  const cached = await readCache<SidebarGroup[]>(env, key);
  if (cached) return cached;

  // For machine-translated locales, the repo doesn't ship a localized tree
  // for them. Load using the default-locale source layout, then translate
  // the labels in one batch below. (Locales declared in site.locales but
  // also listed in translate.targets are treated as author-curated and use
  // their own srcPrefix — author content wins.)
  const sourceResolved =
    locale.machineTranslated && site
      ? resolveLocale(
          { ...locale, code: defaultLocaleCode, prefix: locale.prefix },
          defaultLocaleCode,
        )
      : resolved;

  let groups: SidebarGroup[] | null = null;
  const native = await tryLoadNative(env, repo, branch, ctx);
  if (native) {
    const fromNative = pickNativeLocale(native, resolved.code, defaultLocaleCode);
    if (fromNative) groups = localize(fromNative, repo.slug, resolved);
  }

  if (!groups) {
    const vp = await tryLoadVitePress(env, repo, branch, sourceResolved.srcPrefix, ctx);
    if (vp) groups = localize(vp, repo.slug, resolved);
  }

  if (!groups) {
    groups = await buildFromTree(env, repo, branch, sourceResolved, ctx, resolved);
  }

  // Machine-translation pass. Only fires when the locale was synthesized
  // from site.translate.targets (machineTranslated:true) — author-declared
  // locales keep their hand-curated labels.
  if (site && locale.machineTranslated && ctx) {
    groups = await translateSidebarGroups(env, ctx, site, repo, branch, locale.code, groups);
  }

  await writeCache(env, key, groups, ttlSeconds(env, "raw"), ctx);
  return groups;
}

// Walk the sidebar tree, collect every `.text` field with a stable structural
// path key, hand them to the translator in one batch, then walk again to
// swap the translated text back in. Stable keys mean adding a single new
// entry to a sidebar doesn't invalidate translations for unchanged items.
async function translateSidebarGroups(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  repo: RepoConfig,
  branch: string,
  localeCode: string,
  groups: SidebarGroup[],
): Promise<SidebarGroup[]> {
  const entries: Record<string, string> = {};
  function collectItem(item: SidebarItem, path: string) {
    if (item.text) entries[`${path}.t`] = item.text;
    item.items?.forEach((child, i) => collectItem(child, `${path}.${i}`));
  }
  groups.forEach((g, gi) => {
    if (g.text) entries[`g${gi}.t`] = g.text;
    g.items?.forEach((item, i) => collectItem(item, `g${gi}.${i}`));
  });
  if (!Object.keys(entries).length) return groups;

  const translated = await translateBundle({
    env,
    ctx,
    site,
    kind: "sidebar",
    key: `${repo.slug}@${branch}`,
    locale: localeCode,
    entries,
  });

  function rewriteItem(item: SidebarItem, path: string): SidebarItem {
    return {
      ...item,
      text: translated[`${path}.t`] ?? item.text,
      items: item.items?.map((child, i) => rewriteItem(child, `${path}.${i}`)),
    };
  }
  return groups.map((g, gi) => ({
    ...g,
    text: translated[`g${gi}.t`] ?? g.text,
    items: g.items?.map((item, i) => rewriteItem(item, `g${gi}.${i}`)) ?? [],
  }));
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
async function loadVitePressConfig(
  env: Env,
  repo: RepoConfig,
  branch: string,
  ctx?: ExecutionContext,
): Promise<Record<string, unknown> | null> {
  const base = `${docsRootPrefix(repo.docsRoot)}.vitepress/config`;
  for (const ext of [".mts", ".ts", ".mjs", ".js"]) {
    const text = await fetchSourceFile(env, repo, branch, `${base}${ext}`, { ctx });
    if (text) return readVitePressConfig(text);
  }
  return null;
}

// VitePress keys `locales` by the locale's source directory (`zh`), and the
// default locale by `root`, so the config and the locale's files agree.
const vitePressLocaleKey = (srcPrefix: string) => srcPrefix || "root";

async function tryLoadVitePress(
  env: Env,
  repo: RepoConfig,
  branch: string,
  srcPrefix: string,
  ctx?: ExecutionContext,
): Promise<SidebarGroup[] | null> {
  const config = await loadVitePressConfig(env, repo, branch, ctx);
  if (!config) return null;
  const groups = toSidebarGroups(
    themeConfigField(config, vitePressLocaleKey(srcPrefix), "sidebar"),
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
  sourceResolved: LocaleResolution,
  ctx?: ExecutionContext,
  urlResolved?: LocaleResolution,
): Promise<SidebarGroup[]> {
  const tree = await fetchSourceTree(env, repo, branch, { ctx });
  const prefix = docsRootPrefix(repo.docsRoot);
  // Source-side prefix — where this locale's files live under docsRoot.
  // Default locale's files sit at the docs root (empty source prefix); other
  // locales live under their prefix directory. For machine-translated
  // locales the source-side resolution points at the default locale so the
  // tree walk finds the actual files; `urlResolved` carries the target
  // locale's URL prefix for link construction.
  const resolved = urlResolved ?? sourceResolved;
  const localePath = sourceResolved.srcPrefix ? `${sourceResolved.srcPrefix}/` : "";

  // Set of *all* locale directories so the root locale's filter can exclude
  // anything that lives under a locale dir (e.g. "zh/").
  const localeDirs = new Set<string>();
  // Heuristic: any top-level directory whose name is 2-5 ASCII chars is a
  // candidate locale. The router-side site config is the source of truth, but
  // we don't have it here, so cover the common 2-char (en/zh/ja) case.
  localeDirs.add("zh");

  const files = tree
    .filter((e) => e.type === "blob" && e.path.startsWith(prefix) && e.path.endsWith(".md"))
    .map((e) => e.path.slice(prefix.length))
    .filter((p) => {
      if (localePath) return p.startsWith(localePath);
      // Root locale: drop anything that sits inside a known locale dir.
      const first = p.split("/")[0]!;
      return !localeDirs.has(first);
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

  for (const p of files) {
    const rel = localePath ? p.slice(localePath.length) : p;
    const name = rel.replace(/\.md$/, "");
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
  site?: VellumConfig,
): Promise<NavItem[] | null> {
  const resolved = resolveLocale(locale, defaultLocaleCode);
  const key = `nav:${repo.slug}@${branch}:${resolved.code}`;
  const cached = await readCache<NavItem[] | { empty: true }>(env, key);
  if (cached) return Array.isArray(cached) ? cached : null;

  // Machine-translated locales pull from the default-locale config (no
  // localized nav exists in the repo) and then translate the labels below.
  const sourceLocaleKey = locale.machineTranslated
    ? "root"
    : vitePressLocaleKey(resolved.srcPrefix);

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
    const items = config ? toNavItems(themeConfigField(config, sourceLocaleKey, "nav")) : [];
    if (items.length) nav = localizeNav(items, repo.slug, resolved);
  }

  if (!nav) {
    await writeCache(env, key, { empty: true }, ttlSeconds(env, "raw"), ctx);
    return null;
  }

  // Translate labels for machine-translated locales. Hand-curated locales
  // keep their author-supplied text even when listed in translate.targets.
  if (site && locale.machineTranslated && ctx) {
    nav = await translateNavItems(env, ctx, site, repo, branch, locale.code, nav);
  }

  await writeCache(env, key, nav, ttlSeconds(env, "raw"), ctx);
  return nav;
}

async function translateNavItems(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  repo: RepoConfig,
  branch: string,
  localeCode: string,
  items: NavItem[],
): Promise<NavItem[]> {
  const entries: Record<string, string> = {};
  function collect(item: NavItem, path: string) {
    if (item.text) entries[`${path}.t`] = item.text;
    item.items?.forEach((child, i) => collect(child, `${path}.${i}`));
  }
  items.forEach((item, i) => collect(item, `n${i}`));
  if (!Object.keys(entries).length) return items;

  const translated = await translateBundle({
    env,
    ctx,
    site,
    kind: "repo-nav",
    key: `${repo.slug}@${branch}`,
    locale: localeCode,
    entries,
  });

  function rewrite(item: NavItem, path: string): NavItem {
    return {
      ...item,
      text: translated[`${path}.t`] ?? item.text,
      items: item.items?.map((child, i) => rewrite(child, `${path}.${i}`)),
    };
  }
  return items.map((item, i) => rewrite(item, `n${i}`));
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
