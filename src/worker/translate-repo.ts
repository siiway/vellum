// Bulk translate every page in a repo into a target locale. Streams progress
// via Server-Sent Events so the client can show a real-time progress bar.
//
// Strategy: enumerate the repo's source tree, filter to .md files under the
// docs root, prioritize index + sidebar files, then translate pages
// concurrently (respecting site.translate.concurrency). Each completed page
// emits an SSE event with the current count and total.
//
// Variant fallback: when the target is a regional variant (e.g. zh-HK) and
// a linguistically closer locale (e.g. zh-CN) already has a cached
// translation for that page, the closer translation is used as the source
// instead of the default locale. This produces much better output for
// closely related variants.
//
// Job state is persisted in D1 (kind = "translate-job") so any browser tab
// can poll progress via GET /api/translate-repo?repo=…&locale=…. Cancel is
// gated on a random token returned in the SSE `start` event and stored by
// the initiator in localStorage.

import type { Env } from "./env";
import type { RepoConfig, VellumConfig, LocaleConfig, RouteContext } from "../shared/types";
import { fetchSourceTree, fetchSourceFile, repoRef, docsRootPrefix } from "./sources";
import { translate, isMtTarget, readCachedTranslation } from "./translate";
import { loadSidebar } from "./sidebar";

// --- D1 job helpers ---------------------------------------------------------

interface TranslateJob {
  cancelToken: string;
  done: number;
  total: number;
  current: string;
  phase: string; // "sidebar" | "page"
  status: string; // "running" | "complete" | "cancelled" | "error"
  repoSlug: string;
  locale: string;
  errorMessage?: string;
  providerModel?: string;
  apiKeyHint?: string;
}

function jobKey(repoSlug: string, locale: string): string {
  return `${repoSlug}:${locale}`;
}

async function readJob(
  db: D1Database,
  repoSlug: string,
  locale: string,
): Promise<TranslateJob | null> {
  try {
    const row = await db
      .prepare(
        "SELECT content FROM translations WHERE kind = 'translate-job' AND key = ?1 AND locale = ?2",
      )
      .bind(jobKey(repoSlug, locale), locale)
      .first<{ content: string }>();
    if (!row) return null;
    return JSON.parse(row.content) as TranslateJob;
  } catch {
    return null;
  }
}

async function writeJob(
  db: D1Database,
  repoSlug: string,
  locale: string,
  job: TranslateJob,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO translations (kind, key, locale, source_hash, content, model, refreshed_at)
       VALUES ('translate-job', ?1, ?2, '', ?3, NULL, ?4)
       ON CONFLICT(kind, key, locale) DO UPDATE SET
         content = excluded.content,
         refreshed_at = excluded.refreshed_at`,
    )
    .bind(jobKey(repoSlug, locale), locale, JSON.stringify(job), Date.now())
    .run();
}

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

// --- Variant source fallback -----------------------------------------------

// Find the linguistically closest locale that already has cached
// translations, so zh-HK translates from zh-CN (not en-US), pt-PT from
// pt-BR, etc. Returns the locale code to use as the translation source,
// or null to fall back to the default locale.
function findClosestLocale(targetCode: string, site: VellumConfig): string | null {
  let targetLang: string;
  try {
    targetLang = new Intl.Locale(targetCode).language;
  } catch {
    return null;
  }

  const defaultCode = site.site.defaultLocale;
  const candidates: string[] = [];

  for (const l of site.site.locales) {
    if (l.code === targetCode || l.code === defaultCode) continue;
    try {
      const lang = new Intl.Locale(l.code).language;
      if (lang === targetLang) candidates.push(l.code);
    } catch {
      continue;
    }
  }

  if (!candidates.length) return null;

  // Prefer hand-curated over machine-translated
  const handCurated = candidates.filter(
    (c) => !site.site.locales.find((l) => l.code === c)?.machineTranslated,
  );
  if (handCurated.length) return handCurated[0]!;
  return candidates[0]!;
}

// Try to get a cached translation from a closer variant locale for a
// specific page. Returns the translated content or null.
async function fetchVariantSource(
  env: Env,
  closestLocale: string,
  repoSlug: string,
  branch: string,
  pagePath: string,
): Promise<string | null> {
  return readCachedTranslation(env, "page", `${repoSlug}@${branch}:${pagePath}`, closestLocale);
}

// --- Concurrency pool ------------------------------------------------------

async function pooled<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  shouldStop?: () => Promise<boolean>,
): Promise<boolean> {
  let idx = 0;
  let stopped = false;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length && !stopped) {
      if (shouldStop) {
        const stop = await shouldStop();
        if (stop) {
          stopped = true;
          return;
        }
      }
      const i = idx++;
      if (i >= items.length) break;
      await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return stopped;
}

async function isJobCancelled(
  db: D1Database | undefined,
  repoSlug: string,
  locale: string,
): Promise<boolean> {
  if (!db) return false;
  const job = await readJob(db, repoSlug, locale);
  return job?.status === "cancelled";
}

// --- Router entry -----------------------------------------------------------

export async function handleTranslateRepo(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET") return handleStatus(url, env);
  if (request.method === "DELETE") return handleCancel(request, url, env);
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  return handleStart(url, env, ctx, site);
}

// --- GET: poll job status ---------------------------------------------------

async function handleStatus(url: URL, env: Env): Promise<Response> {
  const db = env.VELLUM_TRANSLATION_DB;
  if (!db) return Response.json({ status: "no-db" });

  const repoSlug = url.searchParams.get("repo");
  const locale = url.searchParams.get("locale");

  // List all jobs when no repo/locale specified
  if (!repoSlug || !locale) {
    return listAllJobs(db);
  }

  const job = await readJob(db, repoSlug, locale);
  if (!job) return Response.json({ status: "idle" });

  return Response.json({
    status: job.status,
    done: job.done,
    total: job.total,
    current: job.current,
    phase: job.phase,
    repoSlug: job.repoSlug,
    locale: job.locale,
    errorMessage: job.errorMessage,
    providerModel: job.providerModel,
    apiKeyHint: job.apiKeyHint,
  });
}

async function listAllJobs(db: D1Database): Promise<Response> {
  try {
    const { results } = await db
      .prepare(
        "SELECT key, locale, content, refreshed_at FROM translations WHERE kind = 'translate-job' ORDER BY refreshed_at DESC",
      )
      .all<{ key: string; locale: string; content: string; refreshed_at: number }>();

    const jobs = (results ?? []).map((row) => {
      const job = JSON.parse(row.content) as TranslateJob;
      return {
        status: job.status,
        done: job.done,
        total: job.total,
        current: job.current,
        phase: job.phase,
        repoSlug: job.repoSlug,
        locale: job.locale,
        errorMessage: job.errorMessage,
        providerModel: job.providerModel,
        apiKeyHint: job.apiKeyHint,
        updatedAt: row.refreshed_at,
      };
    });

    return Response.json({ jobs });
  } catch {
    return Response.json({ jobs: [] });
  }
}

// --- DELETE: cancel a running job -------------------------------------------

async function handleCancel(request: Request, url: URL, env: Env): Promise<Response> {
  const repoSlug = url.searchParams.get("repo");
  const locale = url.searchParams.get("locale");
  const token = request.headers.get("x-cancel-token");

  if (!repoSlug || !locale || !token) {
    return Response.json({ error: "Missing repo, locale, or cancel token" }, { status: 400 });
  }

  const db = env.VELLUM_TRANSLATION_DB;
  if (!db) return Response.json({ error: "No database" }, { status: 500 });

  const job = await readJob(db, repoSlug, locale);
  if (!job) return Response.json({ error: "No active job" }, { status: 404 });
  if (job.cancelToken !== token) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  job.status = "cancelled";
  await writeJob(db, repoSlug, locale, job);
  return Response.json({ ok: true });
}

// --- POST: start a new translation ------------------------------------------

async function handleStart(
  url: URL,
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
): Promise<Response> {
  const repoSlug = url.searchParams.get("repo");
  const locale = url.searchParams.get("locale");
  if (!repoSlug || !locale) {
    return Response.json({ error: "Missing repo or locale parameter" }, { status: 400 });
  }

  const repo = site.repos.find((r) => r.slug === repoSlug);
  if (!repo) {
    return Response.json({ error: `Unknown repo: ${repoSlug}` }, { status: 404 });
  }

  if (!isMtTarget(site, locale)) {
    return Response.json(
      { error: `Locale ${locale} is not a machine-translation target` },
      { status: 400 },
    );
  }

  // Guard against concurrent jobs for the same (repo, locale).
  const db = env.VELLUM_TRANSLATION_DB;
  if (db) {
    const existing = await readJob(db, repoSlug, locale);
    if (existing?.status === "running") {
      return Response.json(
        {
          error: "A translation job is already running for this repo and locale",
          status: existing.status,
          done: existing.done,
          total: existing.total,
          current: existing.current,
          phase: existing.phase,
        },
        { status: 409 },
      );
    }
  }

  const branch = repoRef(repo);
  const docsPrefix = docsRootPrefix(repo.docsRoot);

  const tree = await fetchSourceTree(env, repo, branch, { ctx });
  const pages = listDefaultLocalePages(tree, docsPrefix, site);
  const priorityPages = sortByPriority(pages);
  const total = priorityPages.length;

  if (total === 0) {
    return Response.json({ error: "No translatable pages found" }, { status: 404 });
  }

  const cancelToken = generateToken();
  const concurrency = site.site.translate?.concurrency ?? 4;
  const closestLocale = findClosestLocale(locale, site);

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const sendEvent = async (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    await writer.write(encoder.encode(payload));
  };

  ctx.waitUntil(
    (async () => {
      try {
        const job: TranslateJob = {
          cancelToken,
          done: 0,
          total,
          current: "_sidebar",
          phase: "sidebar",
          status: "running",
          repoSlug,
          locale,
        };
        if (db) await writeJob(db, repoSlug, locale, job);

        await sendEvent("start", { total, repo: repoSlug, locale, cancelToken });
        await sendEvent("progress", { done: 0, total, current: "_sidebar", phase: "sidebar" });

        try {
          await translateSidebarForRepo(env, ctx, site, repo, branch, locale);
        } catch (err) {
          console.warn(
            `[vellum][translate-repo] sidebar translation failed: ${(err as Error).message}`,
          );
        }

        let done = 0;
        let lastModel: string | undefined;
        let lastKeyHint: string | undefined;
        const checkCancel = () => isJobCancelled(db, repoSlug, locale);

        // Translate pages concurrently with per-page cancellation checks
        const stopped = await pooled(
          priorityPages,
          concurrency,
          async (pagePath) => {
            try {
              let source: string | null = null;
              if (closestLocale) {
                source = await fetchVariantSource(env, closestLocale, repoSlug, branch, pagePath);
                if (source) {
                  console.log(
                    `[vellum][translate-repo] ${pagePath}: using ${closestLocale} as source for ${locale}`,
                  );
                }
              }
              if (!source) {
                source = await fetchPageSource(env, repo, branch, docsPrefix, pagePath, ctx);
              }
              if (source) {
                const result = await translate({
                  env,
                  ctx,
                  site,
                  kind: "page",
                  key: `${repoSlug}@${branch}:${pagePath}`,
                  locale,
                  source,
                  awaitWrite: true,
                });
                if (result.model) lastModel = result.model;
                if (result.apiKeyHint) lastKeyHint = result.apiKeyHint;
              }
            } catch (err) {
              console.warn(
                `[vellum][translate-repo] page ${pagePath} failed: ${(err as Error).message}`,
              );
            }
            done++;

            if (db && done % concurrency === 0) {
              job.done = done;
              job.current = pagePath;
              job.phase = "page";
              job.providerModel = lastModel;
              job.apiKeyHint = lastKeyHint;
              await writeJob(db, repoSlug, locale, job);
            }

            await sendEvent("progress", {
              done,
              total,
              current: pagePath,
              phase: "page",
              providerModel: lastModel,
              apiKeyHint: lastKeyHint,
            });
          },
          checkCancel,
        );

        if (stopped) {
          await sendEvent("cancelled", { done, total });
        }

        // Final D1 update
        if (db) {
          job.done = done;
          job.providerModel = lastModel;
          job.apiKeyHint = lastKeyHint;
          job.status = stopped ? "cancelled" : "complete";
          await writeJob(db, repoSlug, locale, job);
        }

        if (!stopped) {
          await sendEvent("complete", { done, total });
        }
      } catch (err) {
        if (db) {
          try {
            const job = await readJob(db, repoSlug, locale);
            if (job) {
              job.status = "error";
              job.errorMessage = (err as Error).message;
              await writeJob(db, repoSlug, locale, job);
            }
          } catch {
            // ignore
          }
        }
        try {
          await sendEvent("error", { message: (err as Error).message });
        } catch {
          // writer may be closed
        }
      } finally {
        try {
          await writer.close();
        } catch {
          // already closed
        }
      }
    })(),
  );

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
    },
  });
}

// --- Helpers ----------------------------------------------------------------

// Enumerate default-locale pages from a repo tree, excluding locale
// subdirectories (zh/, ja/, etc.) that hold hand-curated translations.
function listDefaultLocalePages(
  tree: Array<{ path: string; type: string }>,
  docsPrefix: string,
  site: VellumConfig,
): string[] {
  // Locale subdirectories can be named by code (zh), prefix (zh-CN), or
  // either — collect all non-default locale identifiers so we skip every
  // hand-curated directory regardless of naming convention.
  const localeDirs = new Set<string>();
  for (const l of site.site.locales) {
    if (l.code === site.site.defaultLocale) continue;
    localeDirs.add(l.code);
    if (l.prefix) localeDirs.add(l.prefix);
  }

  const pageSet = new Set<string>();
  const pages: string[] = [];

  for (const e of tree) {
    if (e.type !== "blob" || !e.path.endsWith(".md")) continue;
    if (docsPrefix && !e.path.startsWith(docsPrefix)) continue;

    const rel =
      docsPrefix && e.path.startsWith(docsPrefix) ? e.path.slice(docsPrefix.length) : e.path;
    const firstSeg = rel.split("/")[0]!;
    if (firstSeg && localeDirs.has(firstSeg)) continue;

    const normalized =
      rel
        .replace(/\.md$/, "")
        .replace(/\/index$/, "/")
        .replace(/\/$/, "") || "index";
    const key = normalized === "" ? "index" : normalized;
    if (!pageSet.has(key)) {
      pageSet.add(key);
      pages.push(key);
    }
  }

  return pages;
}

function sortByPriority(pages: string[]): string[] {
  const priority: string[] = [];
  const rest: string[] = [];

  for (const p of pages) {
    const lower = p.toLowerCase();
    if (
      lower === "index" ||
      lower.endsWith("/index") ||
      lower === "readme" ||
      lower.endsWith("/readme")
    ) {
      priority.unshift(p);
    } else {
      rest.push(p);
    }
  }

  priority.sort((a, b) => {
    if (a === "index") return -1;
    if (b === "index") return 1;
    return a.localeCompare(b);
  });

  return [...priority, ...rest];
}

async function fetchPageSource(
  env: Env,
  repo: RepoConfig,
  branch: string,
  docsPrefix: string,
  pagePath: string,
  ctx: ExecutionContext,
): Promise<string | null> {
  const candidates = [`${docsPrefix}${pagePath}.md`, `${docsPrefix}${pagePath}/index.md`];
  if (pagePath === "index") {
    candidates.push(`${docsPrefix}index.md`);
    candidates.push(`${docsPrefix}README.md`);
  }
  const seen = new Set<string>();
  for (const c of candidates) {
    const normalized = c.replace(/\/+/g, "/");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const source = await fetchSourceFile(env, repo, branch, normalized, { ctx });
    if (source) return source;
  }
  return null;
}

async function translateSidebarForRepo(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  repo: RepoConfig,
  branch: string,
  locale: string,
): Promise<void> {
  const localeConfig = site.site.locales.find((l) => l.code === locale) as LocaleConfig | undefined;
  if (!localeConfig) return;
  await loadSidebar(env, repo, branch, localeConfig, site.site.defaultLocale, ctx, site);
}

// --- Smart background translation ------------------------------------------

// Triggered by the router when a reader visits an MT page that isn't cached
// yet. Translates pages in priority order so the reader's immediate context
// is ready first:
//   1. The current page
//   2. Sidebar labels
//   3. Pages linked from the current page's markdown
//   4. Prev / next pages (adjacent in the sidebar)
//   5. All remaining pages in the repo
export async function triggerSmartTranslation(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  route: RouteContext,
  currentPageSource: string,
): Promise<void> {
  const locale = route.localeCode;
  const branch = route.version.branch;
  const repo = route.repo;
  const docsPrefix = docsRootPrefix(repo.docsRoot);
  const concurrency = site.site.translate?.concurrency ?? 4;
  const closestLocale = findClosestLocale(locale, site);
  const tag = `[vellum][smart-translate] ${repo.slug}/${route.pagePath} → ${locale}`;
  const db = env.VELLUM_TRANSLATION_DB;
  const checkCancel = () => isJobCancelled(db, repo.slug, locale);

  async function translatePage(pagePath: string, source?: string): Promise<void> {
    const cached = await readCachedTranslation(
      env,
      "page",
      `${repo.slug}@${branch}:${pagePath}`,
      locale,
    );
    if (cached) return;

    let src = source ?? null;
    if (!src && closestLocale) {
      src = await fetchVariantSource(env, closestLocale, repo.slug, branch, pagePath);
    }
    if (!src) {
      src = await fetchPageSource(env, repo, branch, docsPrefix, pagePath, ctx);
    }
    if (!src) return;

    await translate({
      env,
      ctx,
      site,
      kind: "page",
      key: `${repo.slug}@${branch}:${pagePath}`,
      locale,
      source: src,
      awaitWrite: true,
    });
  }

  try {
    // 1. Current page (highest priority — the reader is looking at it)
    console.log(`${tag} phase 1: current page`);
    await translatePage(route.pagePath, currentPageSource);

    if (await checkCancel()) return;

    // 2. Sidebar labels
    console.log(`${tag} phase 2: sidebar`);
    try {
      await translateSidebarForRepo(env, ctx, site, repo, branch, locale);
    } catch {
      // sidebar translation failure shouldn't block the rest
    }

    if (await checkCancel()) return;

    // 3. Pages linked from the current page's markdown
    const linkedPages = extractInternalLinks(currentPageSource, repo.slug);
    if (linkedPages.length) {
      console.log(`${tag} phase 3: ${linkedPages.length} linked pages`);
      const stopped = await pooled(
        linkedPages,
        concurrency,
        async (pagePath) => {
          try {
            await translatePage(pagePath);
          } catch {
            // continue on failure
          }
        },
        checkCancel,
      );
      if (stopped) return;
    }

    // 4. All remaining pages in the repo
    console.log(`${tag} phase 4: remaining pages`);
    const tree = await fetchSourceTree(env, repo, branch, { ctx });
    const allPages = listDefaultLocalePages(tree, docsPrefix, site);

    const translated = new Set([route.pagePath, ...linkedPages]);
    const remaining = sortByPriority(allPages).filter((p) => !translated.has(p));

    if (remaining.length) {
      await pooled(
        remaining,
        concurrency,
        async (pagePath) => {
          try {
            await translatePage(pagePath);
          } catch {
            // continue on failure
          }
        },
        checkCancel,
      );
    }

    console.log(`${tag} done`);
  } catch (err) {
    console.warn(`${tag} failed: ${(err as Error).message}`);
  }
}

// Extract internal page links from markdown source. Matches:
//   [text](./path)  [text](/path)  [text](path)
// Skips external URLs, anchors, images, and code blocks.
function extractInternalLinks(markdown: string, _repoSlug: string): string[] {
  const links = new Set<string>();
  const stripped = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
  const re = /\[(?:[^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    let href = m[1]!.split("#")[0]!.split("?")[0]!.trim();
    if (!href || href.startsWith("http") || href.startsWith("mailto:")) continue;
    if (href.startsWith("@")) continue;
    href = href.replace(/^\.\//, "").replace(/\.md$/, "");
    if (href.startsWith("/")) href = href.slice(1);
    if (!href || href === "." || href === "..") continue;
    const parts = href.split("/").filter(Boolean);
    if (parts.some((p) => p === "..")) continue;
    links.add(href);
  }
  return [...links];
}
