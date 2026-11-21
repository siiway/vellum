// The static site build. Renders every page of every repo to HTML (plus the
// JSON payload client-side navigation swaps in, a lean one the client
// hydrates the HTML from, and the page's Markdown)
// under dist/site, next to a copy of the client bundle, ready for
// `wrangler deploy` as static assets.
//
// The work is per repo: `renderRepo` writes a repo's pages, its search
// indexes and its Vue and React components, and records its commit and page
// list in dist/state.json. Everything else depends only on the config and
// those page lists, so `updateSite` can re-render just the repos whose commit
// changed and keep the rest of the previous build.

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import siteConfig from "../../vellum.config.json";
import type { BootstrapPayload, LocaleConfig, RepoConfig, VellumConfig } from "../shared/types";
import { contentKey, leanAst } from "../shared/markdown";
import {
  hydrationPath,
  notFoundPayloadPath,
  payloadPath,
  searchIndexPath,
  reactDir,
  reactFilePath,
  vueComponentPath,
  vueDir,
} from "../shared/paths";
import { t } from "../shared/i18n";
import { readClientAssets } from "./assets";
import { buildPagePayload } from "./page";
import { renderPage, type Hydration, type RenderOptions } from "./ssr";
import {
  fallbackLocale,
  htmlFile,
  listRepoPages,
  localeBase,
  markdownUrl,
  pageRoute,
  stubRoute,
} from "./routes";
import { buildSearchIndex, type IndexPage } from "./search-index";
import { loadVueComponents } from "./vue";
import { bundleReactComponents, importReactComponents } from "./react";
import { buildRedirects } from "./redirects";
import { buildHeaders } from "./headers";
import { buildAgentFiles } from "./agents";
import { rootPage } from "./root-page";
import { buildRobots, buildSitemap } from "./sitemap";
import {
  APP_ROOT,
  appSha,
  hasClone,
  headSha,
  isGitHub,
  readSourceFile,
  remoteSha,
  syncRepo,
} from "./sources";

const SITE = siteConfig as VellumConfig;
const DIST = join(APP_ROOT, "dist");
const CLIENT_DIR = join(DIST, "client");
const SITE_DIR = join(DIST, "site");
const STATE_FILE = join(DIST, "state.json");
// Where an update renders a repo before it replaces the repo's pages.
const STAGE_DIR = join(DIST, "stage");

// Pages rendered at once.
const CONCURRENCY = 8;

interface RepoState {
  // The commit the repo's pages were rendered from ("local" for local repos).
  sha: string;
  // Page paths per locale code.
  pages: Record<string, string[]>;
  // The paths of the pages each locale shows another locale's page at, as it
  // has no translation of them, per locale code.
  fallbacks: Record<string, string[]>;
}

// What the last build rendered. Not deployed.
interface BuildState {
  // The commit of this repository (app, config, local docs) it was built
  // from; null when it wasn't built from a git checkout.
  app: string | null;
  // The client build its pages link (ClientAssets.id).
  client: string;
  repos: Record<string, RepoState>;
}

// Clones (or, with `fetch`, updates) every GitHub repo and renders the whole
// site. Needs the client build in dist/client.
export async function buildSite({ fetch }: { fetch: boolean }): Promise<void> {
  const opts = await renderOptions();
  // Until this build is complete, there's no build to update.
  await rm(STATE_FILE, { force: true });
  // Emptied rather than removed: `wrangler dev` may be serving it.
  await mkdir(SITE_DIR, { recursive: true });
  for (const entry of await readdir(SITE_DIR)) {
    await rm(join(SITE_DIR, entry), { recursive: true, force: true });
  }
  // The Vite manifest is only for the build.
  await cp(CLIENT_DIR, SITE_DIR, { recursive: true, filter: (src) => basename(src) !== ".vite" });

  // Without `fetch`, a repo is still cloned when it has no clone of the
  // repository the config names.
  await Promise.all(
    SITE.repos.map(async (repo) => {
      if (fetch || (isGitHub(repo) && !(await hasClone(repo)))) await syncRepo(repo);
    }),
  );

  const repos: Record<string, RepoState> = {};
  for (const repo of SITE.repos) {
    console.log(`[vellum] rendering ${repo.slug}`);
    repos[repo.slug] = await renderRepo(repo, opts);
  }
  await writeSiteFiles(opts, repos);
  await writeState({ app: await appSha(), client: opts.assets.id, repos });
}

export interface UpdateResult {
  // Repos re-rendered.
  changed: string[];
  // Repos that couldn't be checked or rendered. Each keeps the pages it had.
  failed: string[];
}

// Re-renders the GitHub repos whose commit changed since the last build.
// Returns null when there's no last build to update, or it was built from
// another commit of this repository (or the commit can't be told); then only
// a full build is correct.
//
// One repo failing (its branch is gone, a page throws) doesn't hold up the
// others: it's rendered into a staging directory first, so on a failure its
// last pages stay as they were.
export async function updateSite(): Promise<UpdateResult | null> {
  const state = await readState();
  const app = await appSha();
  if (!state || !app || state.app !== app) return null;
  if (!existsSync(SITE_DIR) || !existsSync(join(CLIENT_DIR, ".vite", "manifest.json"))) return null;
  if (SITE.repos.some((repo) => !state.repos[repo.slug])) return null;
  const opts = await renderOptions();
  // dist/client was rebuilt since (`bun run check` does): dist/site has the
  // old bundles, which new pages wouldn't link.
  if (state.client !== opts.assets.id) return null;

  const failed: string[] = [];
  const fail = (repo: RepoConfig, e: unknown) => {
    failed.push(repo.slug);
    console.error(`[vellum] ${repo.slug} failed, keeping its last pages: ${(e as Error).message}`);
  };

  const remote = await Promise.all(
    SITE.repos.map(async (repo) => {
      if (!isGitHub(repo)) return null;
      try {
        return await remoteSha(repo);
      } catch (e) {
        fail(repo, e);
        return null;
      }
    }),
  );
  const outdated = SITE.repos.filter(
    (repo, i) => remote[i] != null && remote[i] !== state.repos[repo.slug]!.sha,
  );

  const changed: string[] = [];
  for (const repo of outdated) {
    console.log(`[vellum] ${repo.slug} changed, rendering`);
    await rm(STAGE_DIR, { recursive: true, force: true });
    await mkdir(STAGE_DIR, { recursive: true });
    try {
      await syncRepo(repo);
      const next = await renderRepo(repo, opts, STAGE_DIR);
      await removeRepo(repo, state.repos[repo.slug]!);
      await cp(STAGE_DIR, SITE_DIR, { recursive: true });
      state.repos[repo.slug] = next;
      changed.push(repo.slug);
    } catch (e) {
      fail(repo, e);
    } finally {
      await rm(STAGE_DIR, { recursive: true, force: true });
    }
  }
  if (changed.length) {
    await writeSitemap(opts, state.repos);
    await writeState(state);
  }
  return { changed, failed };
}

async function renderOptions(): Promise<RenderOptions> {
  const origin = SITE.site.url?.replace(/\/+$/, "") || null;
  if (!origin) {
    console.warn("[vellum] site.url is not set: no sitemap or agent files, root-relative URLs");
  } else if (!isOrigin(origin)) {
    // Before a build starts deleting anything.
    throw new Error(
      `site.url must be an origin like "https://docs.example.com", not ${JSON.stringify(SITE.site.url)}`,
    );
  }
  return { assets: await readClientAssets(CLIENT_DIR), origin };
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      /^https?:$/.test(url.protocol) &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username
    );
  } catch {
    return false;
  }
}

// --- Repos --------------------------------------------------------------------

// Writes under `root`: dist/site, or the staging directory of an update.
async function renderRepo(
  repo: RepoConfig,
  opts: RenderOptions,
  root = SITE_DIR,
): Promise<RepoState> {
  const pages = await listRepoPages(SITE, repo);
  const rendered: Record<string, string[]> = {};
  const fallbacks: Record<string, string[]> = {};
  // The pages each locale's search index holds, by locale code.
  const indexes = new Map<string, IndexPage[]>(SITE.site.locales.map((l) => [l.code, []]));
  // First: the pages render the components, and the head of a page that
  // uses one links its files. One that doesn't build fails the repo, like a
  // page that doesn't render.
  const react = await bundleReactComponents(repo, opts.assets);
  for (const [file, content] of react.files) {
    await writeOut(reactFilePath(repo.slug, file), content, root);
  }
  importReactComponents(repo, react);

  // Renders a page in `locale`, from `source`'s page when that's another
  // locale. False for an empty file, which has no page.
  const render = async (locale: LocaleConfig, pagePath: string, source?: string) => {
    const route = pageRoute(SITE, repo, locale, pagePath);
    let build;
    try {
      build = await buildPagePayload(SITE, route, react, source);
    } catch (e) {
      throw new Error(`Rendering ${route.canonicalUrl} failed: ${(e as Error).message}`, {
        cause: e,
      });
    }
    if (!build.found) return false;
    await writePage(build.payload, opts, root, build.markdown);
    indexes.get(locale.code)!.push({
      url: route.canonicalUrl,
      path: build.sourcePath,
      raw: build.source,
      fallback: source !== undefined,
    });
    return true;
  };

  for (const locale of SITE.site.locales) {
    const done: string[] = [];
    await pool(pages[locale.code] ?? [], async (pagePath) => {
      if (await render(locale, pagePath)) done.push(pagePath);
    });
    rendered[locale.code] = done.sort();
  }

  // A page a locale has no translation of is still at its URL there, showing
  // another locale's page (fallbackLocale), so a link to it or a switch to
  // that locale doesn't end in a 404.
  const own = new Map(SITE.site.locales.map((l) => [l.code, new Set(rendered[l.code])]));
  const every = [...new Set(Object.values(rendered).flat())].sort();
  for (const locale of SITE.site.locales) {
    const done: string[] = [];
    const missing = every.filter((pagePath) => !own.get(locale.code)!.has(pagePath));
    await pool(missing, async (pagePath) => {
      const source = fallbackLocale(SITE, (code) => own.get(code)!.has(pagePath))!;
      if (await render(locale, pagePath, source.code)) done.push(pagePath);
    });
    fallbacks[locale.code] = done.sort();
    await writeJson(
      searchIndexPath(locale.code, repo.slug),
      buildSearchIndex(indexes.get(locale.code)!, repo.displayName),
      root,
    );
  }

  for (const component of await loadVueComponents(repo)) {
    if (!/^[\w-]+$/.test(component.name)) continue;
    const source = await readSourceFile(repo, component.path);
    if (source !== null) {
      await writeOut(vueComponentPath(repo.slug, component.name), source, root);
    }
  }

  return { sha: await headSha(repo), pages: rendered, fallbacks };
}

// Deletes what `renderRepo` wrote for the repo last time.
async function removeRepo(repo: RepoConfig, last: RepoState): Promise<void> {
  const removals: string[] = [vueDir(repo.slug), reactDir(repo.slug)];
  for (const locale of SITE.site.locales) {
    removals.push(searchIndexPath(locale.code, repo.slug));
    // A state from before fallback pages has none.
    const paths = [...(last.pages[locale.code] ?? []), ...(last.fallbacks?.[locale.code] ?? [])];
    for (const pagePath of paths) {
      const { canonicalUrl } = pageRoute(SITE, repo, locale, pagePath);
      removals.push(
        htmlFile(canonicalUrl),
        markdownUrl(canonicalUrl),
        payloadPath(canonicalUrl),
        hydrationPath(canonicalUrl),
      );
    }
  }
  await Promise.all(removals.map((path) => rm(outPath(path), { recursive: true, force: true })));
}

// --- Pages --------------------------------------------------------------------

// A docs page also gets its Markdown, at its URL plus `.md`.
async function writePage(
  payload: BootstrapPayload,
  opts: RenderOptions,
  root = SITE_DIR,
  markdown?: string,
): Promise<void> {
  payload = { ...payload, client: opts.assets.id };
  const url = payload.route.canonicalUrl;
  const json = JSON.stringify(payload);
  const hydration = { url: hydrationPath(url), build: contentKey(json) };
  await writeOut(htmlFile(url), renderPage(payload, hydration, opts), root);
  await writeJson(hydration.url, leanPayload(payload, hydration), root);
  await writeOut(payloadPath(url), json, root);
  const md = payload.page.meta.markdownUrl;
  if (md && markdown !== undefined) await writeOut(md, markdown, root);
}

// Pages that belong to no repo, the redirects and headers, and the files for
// crawlers and agents.
async function writeSiteFiles(opts: RenderOptions, repos: Record<string, RepoState>) {
  const { locales, defaultLocale } = SITE.site;
  for (const locale of locales) {
    const base = localeBase(locale);
    await writePage(shellPayload(locale, "search", `${base}/search`), opts);
    await writePage(shellPayload(locale, "languages", `${base}/languages`), opts);
    await writeNotFound(locale, `${base.slice(1)}/404.html`, opts);
  }

  // The 404 for URLs outside every locale, and `/` unless a locale lives there.
  const fallback = locales.find((l) => l.code === defaultLocale) ?? locales[0]!;
  if (fallback.prefix) await writeNotFound(fallback, "404.html", opts);
  if (locales.every((l) => l.prefix)) await writeOut("index.html", rootPage(SITE));

  await writeOut("_redirects", buildRedirects(SITE));
  await writeOut("_headers", buildHeaders(opts.origin));
  await writeOut("robots.txt", buildRobots(SITE, opts.origin));
  await writeSitemap(opts, repos);
  if (opts.origin) {
    for (const [path, content] of Object.entries(buildAgentFiles(SITE, opts.origin))) {
      await writeOut(path, content);
    }
  }
}

async function writeSitemap(opts: RenderOptions, repos: Record<string, RepoState>) {
  if (!opts.origin) return;
  const pages = Object.fromEntries(Object.entries(repos).map(([slug, s]) => [slug, s.pages]));
  await writeOut("sitemap.xml", buildSitemap(SITE, opts.origin, pages));
}

// The search and languages pages: empty chrome around a client component
// that reads its state from the URL.
function shellPayload(
  locale: LocaleConfig,
  layout: "search" | "languages",
  canonicalUrl: string,
): BootstrapPayload {
  const title = t(locale.code, layout === "search" ? "ui.search" : "ui.languages.title");
  const description = t(
    locale.code,
    layout === "search" ? "ui.search.fullPageSubtitle" : "ui.languages.subtitle",
  );
  return {
    config: SITE,
    route: stubRoute(SITE, locale, layout, canonicalUrl),
    sidebar: [],
    initialTheme: "light",
    page: {
      ast: { blocks: [] },
      // `layout` is the switch Layout.tsx reads.
      meta: { title, description, frontmatter: { layout }, outline: [] },
    },
  };
}

// Writes the locale's 404 page to `file`, and its payload.
async function writeNotFound(locale: LocaleConfig, file: string, opts: RenderOptions) {
  const payload: BootstrapPayload = { ...notFoundPayload(locale), client: opts.assets.id };
  const hydration = {
    url: notFoundPayloadPath(locale.code),
    build: contentKey(JSON.stringify(payload)),
  };
  await writeOut(file, renderPage(payload, hydration, opts));
  await writeJson(hydration.url, leanPayload(payload, hydration));
}

// The payload the client hydrates a page's HTML from: everything but the
// content the HTML already holds (leanAst), and the build it's from.
function leanPayload(payload: BootstrapPayload, { build }: Hydration): BootstrapPayload {
  return { ...payload, build, page: { ...payload.page, ast: leanAst(payload.page.ast) } };
}

// The localized 404, with links to the repos.
function notFoundPayload(locale: LocaleConfig): BootstrapPayload {
  const title = t(locale.code, "ui.notFound.title");
  const message = t(locale.code, "ui.notFound.message");
  return {
    config: SITE,
    route: stubRoute(SITE, locale, "index", localeBase(locale) || "/"),
    sidebar: [],
    initialTheme: "light",
    error: {
      status: 404,
      title,
      message,
      suggestions: SITE.repos.slice(0, 5).map((repo) => ({
        text: repo.displayName,
        link: pageRoute(SITE, repo, locale, "index").canonicalUrl,
      })),
    },
    page: {
      ast: { blocks: [] },
      meta: { title, description: message, frontmatter: {}, outline: [] },
    },
  };
}

// --- Files --------------------------------------------------------------------

function outPath(path: string, root = SITE_DIR): string {
  return join(root, path.replace(/^\/+/, ""));
}

async function writeOut(
  path: string,
  content: string | Uint8Array,
  root = SITE_DIR,
): Promise<void> {
  const full = outPath(path, root);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

function writeJson(path: string, value: unknown, root = SITE_DIR): Promise<void> {
  return writeOut(path, JSON.stringify(value), root);
}

async function readState(): Promise<BuildState | null> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as BuildState;
  } catch {
    return null;
  }
}

async function writeState(state: BuildState): Promise<void> {
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

// Runs `task` over `items`, CONCURRENCY at a time. The first failure stops
// new tasks and is rethrown.
async function pool<T>(items: T[], task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++]!;
      try {
        await task(item);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}
