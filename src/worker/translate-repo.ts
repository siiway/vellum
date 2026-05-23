// Bulk translate every page in a repo into a target locale. Streams progress
// via Server-Sent Events so the client can show a real-time progress bar.
//
// Strategy: enumerate the repo's source tree, filter to .md files under the
// docs root, prioritize index + sidebar files, then translate each page
// sequentially. Each completed page emits an SSE event with the current count
// and total.

import type { Env } from "./env";
import type { RepoConfig, VellumConfig, LocaleConfig } from "../shared/types";
import { fetchSourceTree, fetchSourceFile, repoRef, docsRootPrefix } from "./sources";
import { translate, isMtTarget } from "./translate";
import { loadSidebar } from "./sidebar";

interface TranslateRepoRequest {
  repoSlug: string;
  locale: string;
}

function parseRequest(url: URL): TranslateRepoRequest | null {
  const repoSlug = url.searchParams.get("repo");
  const locale = url.searchParams.get("locale");
  if (!repoSlug || !locale) return null;
  return { repoSlug, locale };
}

export async function handleTranslateRepo(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const params = parseRequest(url);
  if (!params) {
    return Response.json({ error: "Missing repo or locale parameter" }, { status: 400 });
  }

  const repo = site.repos.find((r) => r.slug === params.repoSlug);
  if (!repo) {
    return Response.json({ error: `Unknown repo: ${params.repoSlug}` }, { status: 404 });
  }

  if (!isMtTarget(site, params.locale)) {
    return Response.json(
      { error: `Locale ${params.locale} is not a machine-translation target` },
      { status: 400 },
    );
  }

  const branch = repoRef(repo);
  const docsPrefix = docsRootPrefix(repo.docsRoot);

  const tree = await fetchSourceTree(env, repo, branch, { ctx });
  const mdFiles = tree
    .filter((e) => e.type === "blob" && e.path.endsWith(".md"))
    .filter((e) => e.path.startsWith(docsPrefix) || !docsPrefix)
    .map((e) => {
      const rel =
        docsPrefix && e.path.startsWith(docsPrefix) ? e.path.slice(docsPrefix.length) : e.path;
      return (
        rel
          .replace(/\.md$/, "")
          .replace(/\/index$/, "/")
          .replace(/\/$/, "") || "index"
      );
    });

  // Deduplicate (index.md and README.md may both resolve to "index")
  const pageSet = new Set<string>();
  const pages: string[] = [];
  for (const p of mdFiles) {
    const normalized = p === "" ? "index" : p;
    if (!pageSet.has(normalized)) {
      pageSet.add(normalized);
      pages.push(normalized);
    }
  }

  // Priority sort: index and sidebar-related files first
  const priorityPages = sortByPriority(pages);
  const total = priorityPages.length;

  if (total === 0) {
    return Response.json({ error: "No translatable pages found" }, { status: 404 });
  }

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
        await sendEvent("start", { total, repo: params.repoSlug, locale: params.locale });

        // Translate sidebar labels first (single bundled call)
        await sendEvent("progress", {
          done: 0,
          total,
          current: "_sidebar",
          phase: "sidebar",
        });

        try {
          await translateSidebarForRepo(env, ctx, site, repo, branch, params.locale);
        } catch (err) {
          console.warn(
            `[vellum][translate-repo] sidebar translation failed: ${(err as Error).message}`,
          );
        }

        // Translate each page
        let done = 0;
        for (const pagePath of priorityPages) {
          await sendEvent("progress", {
            done,
            total,
            current: pagePath,
            phase: "page",
          });

          try {
            const source = await fetchPageSource(env, repo, branch, docsPrefix, pagePath, ctx);
            if (source) {
              await translate({
                env,
                ctx,
                site,
                kind: "page",
                key: `${params.repoSlug}@${branch}:${pagePath}`,
                locale: params.locale,
                source,
              });
            }
          } catch (err) {
            console.warn(
              `[vellum][translate-repo] page ${pagePath} failed: ${(err as Error).message}`,
            );
          }

          done++;
          await sendEvent("progress", {
            done,
            total,
            current: pagePath,
            phase: "page",
          });
        }

        await sendEvent("complete", { done, total });
      } catch (err) {
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

  // Within priority pages, put root index first
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
