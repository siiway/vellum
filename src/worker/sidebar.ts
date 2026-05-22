// Sidebar resolution for a repo. Looks for, in order:
//   1. `vellum.json` at the docs root (our native format)
//   2. `docs/.vitepress/config.ts` (text-extracted - we just take the JSON-ish sidebar object)
//   3. Directory listing fallback - flat list of markdown files
//
// Returned sidebar groups are localized: links are prefixed with the repo slug + locale.

import type { Env } from "./env";
import type {
  NavItem,
  RepoConfig,
  SidebarGroup,
  SidebarItem,
  RouteContext,
  SocialLink,
} from "../shared/types";
import { fetchSourceFile, fetchSourceTree, docsRootPrefix } from "./sources";
import { readCache, writeCache } from "./cache";
import { ttlSeconds } from "./env";

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
  localeCode: string,
  ctx?: ExecutionContext,
  defaultLocale?: string,
): Promise<SidebarGroup[]> {
  const key = `sidebar:${repo.slug}@${branch}:${localeCode}`;
  const cached = await readCache<SidebarGroup[]>(env, key);
  if (cached) return cached;

  const native = await tryLoadNative(env, repo, branch, ctx);
  if (native) {
    const groups = pickNativeLocale(native, localeCode, defaultLocale);
    if (groups) {
      const localized = localize(groups, repo.slug, localeCode);
      await writeCache(env, key, localized, ttlSeconds(env, "raw"), ctx);
      return localized;
    }
  }

  const vp = await tryLoadVitePress(env, repo, branch, localeCode, ctx);
  if (vp) {
    const localized = localize(vp, repo.slug, localeCode);
    await writeCache(env, key, localized, ttlSeconds(env, "raw"), ctx);
    return localized;
  }

  const fallback = await buildFromTree(env, repo, branch, localeCode, ctx);
  await writeCache(env, key, fallback, ttlSeconds(env, "raw"), ctx);
  return fallback;
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

// Lightweight VitePress config extractor: we look for `sidebar: [...]` (or the
// route-prefixed object form `sidebar: { "/foo/": [...], ... }`) inside the
// config and JSON.parse the JS5-style array. Good enough for the common case
// and avoids running TS in the worker. Before extracting, we inline `const X = [...]`
// declarations and simple `const X = (params) => [...]` arrow-function calls so
// configs that build their sidebars out of helper functions/variables work too.
async function tryLoadVitePress(
  env: Env,
  repo: RepoConfig,
  branch: string,
  localeCode: string,
  ctx?: ExecutionContext,
): Promise<SidebarGroup[] | null> {
  // VitePress configs ship under several extensions depending on the project
  // (ESM-only repos use .mts/.mjs; plain TS uses .ts; the dev's preferred
  // setup uses .js). Try each in order; first hit wins.
  const base = `${docsRootPrefix(repo.docsRoot)}.vitepress/config`;
  let text: string | null = null;
  for (const ext of [".mts", ".ts", ".mjs", ".js"]) {
    text = await fetchSourceFile(env, repo, branch, `${base}${ext}`, { ctx });
    if (text) break;
  }
  if (!text) return null;

  // First, inline `const NAME = [...]` and arrow-function helpers so identifier
  // and call expressions resolve to their literal array bodies.
  const inlined = inlineConfigConsts(text);

  // If the file uses locales, scope to the right one.
  let scoped = inlined;
  const localeMatch = inlined.match(
    new RegExp(
      `(?:^|[^a-zA-Z])${localeCode === "" || localeCode === "en" ? "root" : localeCode}\\s*:\\s*\\{([\\s\\S]*?)\\n\\s{4}\\}`,
    ),
  );
  if (localeMatch) scoped = localeMatch[1]!;

  const sidebarBlocks = collectSidebarValues(scoped, /(?:^|[^a-zA-Z_$])sidebar\s*:\s*/g);
  if (!sidebarBlocks.length) return null;

  const parsed: SidebarGroup[] = [];
  for (const block of sidebarBlocks) {
    const groups = safeParseArray(block);
    if (Array.isArray(groups)) {
      for (const g of groups) {
        if (g && typeof g === "object" && Array.isArray((g as any).items)) {
          parsed.push({
            text: (g as any).text ?? "",
            items: (g as any).items as SidebarItem[],
          });
        }
      }
    }
  }
  return parsed.length ? parsed : null;
}

// Inlines `const NAME = [...]` and `const NAME = (params) => [...]` declarations
// into the source. After this, `helperFn()` and `someConstArray` references in
// the rest of the file are replaced by their literal array bodies. Lets us
// statically resolve sidebar configs built from helper functions without
// running JS in the worker. Best-effort — silently no-ops on anything it
// doesn't recognize.
function inlineConfigConsts(source: string): string {
  const arrayConsts = new Map<string, string>();
  const fnConsts = new Map<
    string,
    { params: string[]; defaults: Record<string, string>; body: string }
  >();

  // Arrow functions returning an array literal. Match params (single-line) then `=> [`.
  const fnRe = /const\s+([a-zA-Z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>\s*\[/g;
  let fm: RegExpExecArray | null;
  while ((fm = fnRe.exec(source)) !== null) {
    const bracketIdx = source.indexOf("[", fm.index + fm[0].length - 1);
    if (bracketIdx < 0) continue;
    const end = findBalancedEnd(source, bracketIdx, "[", "]");
    if (end < 0) continue;
    const params: string[] = [];
    const defaults: Record<string, string> = {};
    for (const p of fm[2]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const eq = p.indexOf("=");
      if (eq >= 0) {
        const pname = p.slice(0, eq).trim();
        defaults[pname] = p.slice(eq + 1).trim();
        params.push(pname);
      } else {
        params.push(p);
      }
    }
    fnConsts.set(fm[1]!, {
      params,
      defaults,
      body: source.slice(bracketIdx, end + 1),
    });
  }

  // Const-bound array literals (not arrow functions).
  const arrRe = /const\s+([a-zA-Z_$][\w$]*)\s*=\s*\[/g;
  let am: RegExpExecArray | null;
  while ((am = arrRe.exec(source)) !== null) {
    if (fnConsts.has(am[1]!)) continue; // already captured as a function
    const bracketIdx = source.indexOf("[", am.index + am[0].length - 1);
    if (bracketIdx < 0) continue;
    const end = findBalancedEnd(source, bracketIdx, "[", "]");
    if (end < 0) continue;
    arrayConsts.set(am[1]!, source.slice(bracketIdx, end + 1));
  }

  let result = source;

  // Expand function calls. We scan for `NAME(` and replace through to the matching ).
  for (const [name, fn] of fnConsts) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`, "g");
    let out = "";
    let i = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(result)) !== null) {
      const openParen = m.index + m[0].length - 1;
      const closeParen = findBalancedEnd(result, openParen, "(", ")");
      if (closeParen < 0) continue;
      // Carry over text before the match.
      out += result.slice(i, m.index);
      const argsSrc = result.slice(openParen + 1, closeParen);
      const args = splitTopLevel(argsSrc, ",");
      let expanded = fn.body;
      for (let p = 0; p < fn.params.length; p++) {
        const pname = fn.params[p]!;
        const argVal = args[p]?.trim() || fn.defaults[pname] || '""';
        const unquoted = argVal.match(/^["'`]([\s\S]*)["'`]$/)?.[1] ?? argVal;
        // Replace `${pname}` inside template literals and bare `pname` refs.
        expanded = expanded.replace(
          new RegExp("\\$\\{" + escapeRegExp(pname) + "\\}", "g"),
          unquoted,
        );
        expanded = expanded.replace(new RegExp("\\b" + escapeRegExp(pname) + "\\b", "g"), argVal);
      }
      // Convert leftover backtick string literals (no remaining ${}) to plain JSON strings.
      expanded = expanded.replace(/`([^`]*)`/g, (_, content) => JSON.stringify(content));
      out += expanded;
      i = closeParen + 1;
      re.lastIndex = i;
    }
    out += result.slice(i);
    result = out;
  }

  // Replace bare identifier references with the const's array body. Skip the
  // declaration site itself and avoid matching a substring of a longer
  // identifier.
  for (const [name, body] of arrayConsts) {
    const re = new RegExp(`(^|[^\\w$])${escapeRegExp(name)}(?=[^\\w$]|$)`, "g");
    result = result.replace(re, (_match, prev) => {
      // Don't expand at declaration site: `const NAME =`. We rely on the
      // const being declared once: its RHS won't reference itself, so the
      // declaration line is naturally skipped.
      return prev + body;
    });
  }

  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Returns the index of the matching closer for the opener at `start`, respecting
// strings (single/double/backtick) and nested brackets.
function findBalancedEnd(src: string, start: number, open: string, close: string): number {
  let depth = 0;
  let str = "";
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!;
    if (str) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === str) str = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      str = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Splits a comma-separated list at the top level, respecting brackets and strings.
function splitTopLevel(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let str = "";
  let cur = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (str) {
      cur += ch;
      if (ch === "\\") {
        cur += src[++i] ?? "";
        continue;
      }
      if (ch === str) str = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      str = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      cur += ch;
      continue;
    }
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.length) out.push(cur);
  return out;
}

// Collect array literals from VitePress sidebar values. Handles both forms:
//   sidebar: [ {text, items}, ... ]
//   sidebar: { "/guide/": [...], "/api/": [...] }
function collectSidebarValues(source: string, marker: RegExp): string[] {
  const results: string[] = [];
  let m: RegExpExecArray | null;
  marker.lastIndex = 0;
  while ((m = marker.exec(source)) !== null) {
    // The marker may capture a leading non-word char as part of `(?:^|[^a-zA-Z_$])`.
    // Use the actual end of the match.
    let start = m.index + m[0].length;
    // Skip whitespace.
    while (start < source.length && /\s/.test(source[start]!)) start++;
    const ch = source[start];
    if (ch === "[") {
      const end = findBalancedEnd(source, start, "[", "]");
      if (end > start) results.push(source.slice(start, end + 1));
    } else if (ch === "{") {
      const objEnd = findBalancedEnd(source, start, "{", "}");
      if (objEnd <= start) continue;
      const body = source.slice(start + 1, objEnd);
      // Walk body, find each `key: [` value and capture the array.
      let i = 0;
      while (i < body.length) {
        // Skip until we see `:` at depth 0 (handles string keys and identifier keys).
        // Easier: look for `: [` patterns at depth 0.
        const ch2 = body[i]!;
        if (ch2 === '"' || ch2 === "'" || ch2 === "`") {
          // Skip string.
          const close = body.indexOf(ch2, i + 1);
          i = close < 0 ? body.length : close + 1;
          continue;
        }
        if (ch2 === ":") {
          // Skip whitespace; check next non-ws char.
          let j = i + 1;
          while (j < body.length && /\s/.test(body[j]!)) j++;
          if (body[j] === "[") {
            const end = findBalancedEnd(body, j, "[", "]");
            if (end > j) {
              results.push(body.slice(j, end + 1));
              i = end + 1;
              continue;
            }
          }
        }
        i++;
      }
    }
  }
  return results;
}

// Backwards-compat shim — kept because loadRepoNav still uses it for `nav: [...]`.
function collectArrays(source: string, marker: RegExp): string[] {
  return collectSidebarValues(source, marker);
}

// Try JSON.parse, then attempt a light fix (single quotes -> double, trailing commas).
function safeParseArray(src: string): unknown {
  try {
    return JSON.parse(src);
  } catch {}
  const fixed = src
    .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
    .replace(/,\s*([\]}])/g, "$1");
  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

async function buildFromTree(
  env: Env,
  repo: RepoConfig,
  branch: string,
  localeCode: string,
  ctx?: ExecutionContext,
): Promise<SidebarGroup[]> {
  const tree = await fetchSourceTree(env, repo, branch, { ctx });
  const prefix = docsRootPrefix(repo.docsRoot);
  // The locale prefix as it appears in URL paths (e.g. "zh"). Empty for the
  // root locale - those files live directly under docsRoot, not under a locale
  // directory. The site config's locale prefix is authoritative.
  const locale = localeCode === "en" || localeCode === "" ? "" : localeCode;
  const localePath = locale ? `${locale}/` : "";

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

  function urlFor(name: string): string {
    // Strip a trailing `/index` so directory landing pages get clean URLs.
    const cleaned =
      name === "index" ? "" : name.endsWith("/index") ? name.slice(0, -"/index".length) : name;
    return (
      `/${repo.slug}/${localePath}${cleaned}`.replace(/\/+/g, "/").replace(/\/$/, "") ||
      `/${repo.slug}`
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

function localize(groups: SidebarGroup[], repoSlug: string, localeCode: string): SidebarGroup[] {
  const localePrefix = localeCode === "en" || localeCode === "" ? "" : localeCode;
  // Locale-first base: `/{localePrefix}/{repoSlug}`. Each rewrite prepends
  // this to the authored sidebar links.
  const base = `${localePrefix ? `/${localePrefix}` : ""}/${repoSlug}`;

  function rewrite(href: string): string {
    // Pass external URLs through untouched.
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("#"))
      return href;

    let path = href;
    // VitePress configs sometimes write locale-prefixed links (e.g. "/zh/getting-started")
    // inside the locale's own sidebar. Strip that duplicate locale segment so we don't
    // end up with /zh/zh/repo/...
    if (localePrefix && path.startsWith(`/${localePrefix}/`)) {
      path = path.slice(`/${localePrefix}`.length);
    } else if (localePrefix && path === `/${localePrefix}`) {
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
  localeCode: string,
  ctx?: ExecutionContext,
): Promise<NavItem[] | null> {
  const key = `nav:${repo.slug}@${branch}:${localeCode}`;
  const cached = await readCache<NavItem[] | { empty: true }>(env, key);
  if (cached) return Array.isArray(cached) ? cached : null;

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
        const localized = localizeNav(data.nav, repo.slug, localeCode);
        await writeCache(env, key, localized, ttlSeconds(env, "raw"), ctx);
        return localized;
      }
    } catch {
      // Fall through to VitePress.
    }
  }

  // 2. VitePress themeConfig.nav. Try every common config extension.
  const base = `${docsRootPrefix(repo.docsRoot)}.vitepress/config`;
  let text: string | null = null;
  for (const ext of [".mts", ".ts", ".mjs", ".js"]) {
    text = await fetchSourceFile(env, repo, branch, `${base}${ext}`, { ctx });
    if (text) break;
  }
  if (!text) {
    await writeCache(env, key, { empty: true }, ttlSeconds(env, "raw"), ctx);
    return null;
  }

  const inlined = inlineConfigConsts(text);
  let scoped = inlined;
  const localeMatch = inlined.match(
    new RegExp(
      `(?:^|[^a-zA-Z])${localeCode === "" || localeCode === "en" ? "root" : localeCode}\\s*:\\s*\\{([\\s\\S]*?)\\n\\s{4}\\}`,
    ),
  );
  if (localeMatch) scoped = localeMatch[1]!;

  const navBlocks = collectArrays(scoped, /(?:^|[^a-zA-Z_$])nav\s*:\s*/g);
  for (const block of navBlocks) {
    const parsed = safeParseArray(block);
    if (Array.isArray(parsed) && parsed.length) {
      const localized = localizeNav(parsed as NavItem[], repo.slug, localeCode);
      await writeCache(env, key, localized, ttlSeconds(env, "raw"), ctx);
      return localized;
    }
  }

  await writeCache(env, key, { empty: true }, ttlSeconds(env, "raw"), ctx);
  return null;
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

  // 2. VitePress themeConfig.socialLinks. socialLinks lives at the top-level
  //    themeConfig (not per-locale in VitePress), so we don't bother scoping
  //    to the current locale — any array we find wins.
  const base = `${docsRootPrefix(repo.docsRoot)}.vitepress/config`;
  let text: string | null = null;
  for (const ext of [".mts", ".ts", ".mjs", ".js"]) {
    text = await fetchSourceFile(env, repo, branch, `${base}${ext}`, { ctx });
    if (text) break;
  }
  if (text) {
    const inlined = inlineConfigConsts(text);
    const blocks = collectArrays(inlined, /(?:^|[^a-zA-Z_$])socialLinks\s*:\s*/g);
    for (const block of blocks) {
      const parsed = safeParseArray(block);
      if (Array.isArray(parsed) && parsed.length) {
        const cleaned = parsed.filter(
          (x): x is SocialLink =>
            !!x &&
            typeof x === "object" &&
            "icon" in x &&
            "link" in x &&
            typeof (x as any).link === "string",
        );
        if (cleaned.length) {
          await writeCache(env, key, cleaned, ttlSeconds(env, "raw"), ctx);
          return cleaned;
        }
      }
    }
  }

  // 3. RepoConfig.socialLinks from vellum.config.json. Returning null here lets
  //    the router fall back to repo.socialLinks (which it owns directly — no
  //    need to round-trip through the cache).
  await writeCache(env, key, { empty: true }, ttlSeconds(env, "raw"), ctx);
  return null;
}

function localizeNav(items: NavItem[], repoSlug: string, localeCode: string): NavItem[] {
  const localePrefix = localeCode === "en" || localeCode === "" ? "" : localeCode;
  // Locale-first base: matches the same shape as `localize()`.
  const base = `${localePrefix ? `/${localePrefix}` : ""}/${repoSlug}`;

  function rewrite(href: string): string {
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("#"))
      return href;
    let path = href;
    // VitePress nav often writes locale-prefixed paths inside the locale's own
    // themeConfig (e.g. "/zh/getting-started"). Strip that duplicate locale
    // segment so we don't end up with /repo/zh/zh/...
    if (localePrefix && path.startsWith(`/${localePrefix}/`)) {
      path = path.slice(`/${localePrefix}`.length);
    } else if (localePrefix && path === `/${localePrefix}`) {
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
