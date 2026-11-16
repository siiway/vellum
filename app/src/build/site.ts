// The static site build. Renders every page of every repo to HTML (plus the
// JSON payload client-side navigation swaps in) under dist/site, next to a
// copy of the client bundle, ready for `wrangler deploy` as static assets.
//
// The work is per repo: `renderRepo` writes a repo's pages, its search
// indexes and its Vue components, and records its commit and page list in
// dist/state.json. Everything else depends only on the config and those
// page lists, so `updateSite` can re-render just the repos whose commit
// changed and keep the rest of the previous build.

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import siteConfig from "../../vellum.config.json";
import type { BootstrapPayload, LocaleConfig, RepoConfig, VellumConfig } from "../shared/types";
import { payloadPath, searchIndexPath, vueComponentPath } from "../shared/paths";
import { t } from "../shared/i18n";
import { readClientAssets } from "./assets";
import { buildPagePayload } from "./page";
import { renderPage, type RenderOptions } from "./ssr";
import { htmlFile, listRepoPages, localeBase, pageRoute, stubRoute } from "./routes";
import { buildSearchIndex, type IndexPage } from "./search-index";
import { loadVueComponents } from "./vue";
import { buildRedirects } from "./redirects";
import { rootPage } from "./root-page";
import { buildRobots, buildSitemap } from "./sitemap";
import {
  APP_ROOT,
  appSha,
  headSha,
  isGitHub,
  readSourceFile,
  remoteSha,
  repoDir,
  syncRepo,
} from "./sources";

const SITE = siteConfig as VellumConfig;
const DIST = join(APP_ROOT, "dist");
const CLIENT_DIR = join(DIST, "client");
const SITE_DIR = join(DIST, "site");
const STATE_FILE = join(DIST, "state.json");

// Pages rendered at once.
const CONCURRENCY = 8;

interface RepoState {
  // The commit the repo's pages were rendered from ("local" for local repos).
  sha: string;
  // Page paths per locale code.
  pages: Record<string, string[]>;
}

// What the last build rendered. Not deployed.
interface BuildState {
  // The commit of this repository (app, config, local docs) it was built from.
  app: string;
  repos: Record<string, RepoState>;
}

// Clones (or, with `fetch`, updates) every GitHub repo and renders the whole
// site. Needs the client build in dist/client.
export async function buildSite({ fetch }: { fetch: boolean }): Promise<void> {
  const opts = await renderOptions();
  // Emptied rather than removed: `wrangler dev` may be serving it.
  await mkdir(SITE_DIR, { recursive: true });
  for (const entry of await readdir(SITE_DIR)) {
    await rm(join(SITE_DIR, entry), { recursive: true, force: true });
  }
  // The Vite manifest is only for the build.
  await cp(CLIENT_DIR, SITE_DIR, { recursive: true, filter: (src) => basename(src) !== ".vite" });

  await Promise.all(
    SITE.repos.map((repo) =>
      fetch || (isGitHub(repo) && !existsSync(join(repoDir(repo), ".git")))
        ? syncRepo(repo)
        : undefined,
    ),
  );

  const repos: Record<string, RepoState> = {};
  for (const repo of SITE.repos) {
    console.log(`[vellum] rendering ${repo.slug}`);
    repos[repo.slug] = await renderRepo(repo, opts);
  }
  await writeSiteFiles(opts, repos);
  await writeState({ app: await appSha(), repos });
}

// Re-renders the GitHub repos whose commit changed since the last build and
// returns their slugs. Returns null when there's no last build to update,
// or it was built from another commit of this repository; then only a full
// build is correct.
export async function updateSite(): Promise<string[] | null> {
  const state = await readState();
  if (!state || state.app !== (await appSha())) return null;
  if (!existsSync(SITE_DIR) || !existsSync(join(CLIENT_DIR, ".vite", "manifest.json"))) return null;
  if (SITE.repos.some((repo) => !state.repos[repo.slug])) return null;
  const opts = await renderOptions();

  const remote = await Promise.all(
    SITE.repos.map(async (repo) => (isGitHub(repo) ? remoteSha(repo) : null)),
  );
  const changed = SITE.repos.filter(
    (repo, i) => remote[i] !== null && remote[i] !== state.repos[repo.slug]!.sha,
  );

  for (const repo of changed) {
    console.log(`[vellum] ${repo.slug} changed, rendering`);
    await syncRepo(repo);
    await removeRepo(repo, state.repos[repo.slug]!);
    state.repos[repo.slug] = await renderRepo(repo, opts);
  }
  if (changed.length) {
    await writeSitemap(opts, state.repos);
    await writeState(state);
  }
  return changed.map((repo) => repo.slug);
}

async function renderOptions(): Promise<RenderOptions> {
  const origin = SITE.site.url?.replace(/\/+$/, "") || null;
  if (!origin) console.warn("[vellum] site.url is not set: no sitemap, root-relative URLs");
  return { assets: await readClientAssets(CLIENT_DIR), origin };
}

// --- Repos --------------------------------------------------------------------

async function renderRepo(repo: RepoConfig, opts: RenderOptions): Promise<RepoState> {
  const pages = await listRepoPages(SITE, repo);
  const rendered: Record<string, string[]> = {};

  for (const locale of SITE.site.locales) {
    const done: string[] = [];
    const index: IndexPage[] = [];
    await pool(pages[locale.code] ?? [], async (pagePath) => {
      const route = pageRoute(SITE, repo, locale, pagePath);
      let build;
      try {
        build = await buildPagePayload(SITE, route);
      } catch (e) {
        throw new Error(`Rendering ${route.canonicalUrl} failed: ${(e as Error).message}`, {
          cause: e,
        });
      }
      // An empty file.
      if (!build.found) return;
      await writePage(build.payload, opts);
      done.push(pagePath);
      index.push({ url: route.canonicalUrl, path: build.sourcePath, raw: build.source });
    });
    rendered[locale.code] = done.sort();
    await writeJson(
      searchIndexPath(locale.code, repo.slug),
      buildSearchIndex(index, repo.displayName),
    );
  }

  for (const component of await loadVueComponents(repo)) {
    if (!/^[\w-]+$/.test(component.name)) continue;
    const source = await readSourceFile(repo, component.path);
    if (source !== null) await writeOut(vueComponentPath(repo.slug, component.name), source);
  }

  return { sha: await headSha(repo), pages: rendered };
}

// Deletes what `renderRepo` wrote for the repo last time.
async function removeRepo(repo: RepoConfig, last: RepoState): Promise<void> {
  const removals: string[] = [`_vellum/vue/${repo.slug}`];
  for (const locale of SITE.site.locales) {
    removals.push(searchIndexPath(locale.code, repo.slug));
    for (const pagePath of last.pages[locale.code] ?? []) {
      const { canonicalUrl } = pageRoute(SITE, repo, locale, pagePath);
      removals.push(htmlFile(canonicalUrl), payloadPath(canonicalUrl));
    }
  }
  await Promise.all(removals.map((path) => rm(outPath(path), { recursive: true, force: true })));
}

// --- Pages --------------------------------------------------------------------

async function writePage(payload: BootstrapPayload, opts: RenderOptions): Promise<void> {
  const url = payload.route.canonicalUrl;
  await writeOut(htmlFile(url), renderPage(payload, opts));
  await writeJson(payloadPath(url), payload);
}

// Pages that belong to no repo, the redirects and the crawler files.
async function writeSiteFiles(opts: RenderOptions, repos: Record<string, RepoState>) {
  const { locales, defaultLocale } = SITE.site;
  for (const locale of locales) {
    const base = localeBase(locale);
    await writePage(shellPayload(locale, "search", `${base}/search`), opts);
    await writePage(shellPayload(locale, "languages", `${base}/languages`), opts);
    await writeOut(`${base.slice(1)}/404.html`, renderPage(notFoundPayload(locale), opts));
  }

  // The 404 for URLs outside every locale, and `/` unless a locale lives there.
  const fallback = locales.find((l) => l.code === defaultLocale) ?? locales[0]!;
  if (fallback.prefix) await writeOut("404.html", renderPage(notFoundPayload(fallback), opts));
  if (locales.every((l) => l.prefix)) await writeOut("index.html", rootPage(SITE));

  await writeOut("_redirects", buildRedirects(SITE));
  await writeOut("robots.txt", buildRobots(opts.origin));
  await writeSitemap(opts, repos);
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
  const title = t(locale.code, layout === "search" ? "ui.search.allRepos" : "ui.languages.title");
  const description = t(
    locale.code,
    layout === "search" ? "ui.search.start" : "ui.languages.subtitle",
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

function outPath(path: string): string {
  return join(SITE_DIR, path.replace(/^\/+/, ""));
}

async function writeOut(path: string, content: string): Promise<void> {
  const full = outPath(path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

function writeJson(path: string, value: unknown): Promise<void> {
  return writeOut(path, JSON.stringify(value));
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
