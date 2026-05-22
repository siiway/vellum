// Discovers Vue components registered in a repo's VitePress theme entry
// (`.vitepress/theme/index.ts`) and serves their .vue source files to the
// client for runtime SFC loading. Used by the markdown renderer to mount Vue
// "islands" inside rendered docs.

import type { Env } from "./env";
import type { RepoConfig, VellumConfig } from "../shared/types";
import { fetchSourceFile, repoRef, docsRootPrefix } from "./sources";
import { readCache, writeCache } from "./cache";
import { ttlSeconds } from "./env";

export interface VueComponentRef {
  // Tag name used in markdown (case-sensitive), e.g. "ScopeBuilder".
  name: string;
  // Path inside the repo (relative to the repo root, not docsRoot), e.g.
  // "docs/.vitepress/theme/ScopeBuilder.vue".
  path: string;
}

// Reads .vitepress/theme/index.ts and pulls out `app.component("Name", X)`
// registrations, resolving the symbol back to its .vue import.
export async function loadVueComponents(
  env: Env,
  repo: RepoConfig,
  branch: string,
  ctx?: ExecutionContext,
): Promise<VueComponentRef[]> {
  const key = `vue:${repo.slug}@${branch}`;
  const cached = await readCache<VueComponentRef[] | { empty: true }>(env, key);
  if (cached) return Array.isArray(cached) ? cached : [];

  const themeIndexPath = `${docsRootPrefix(repo.docsRoot)}.vitepress/theme/index.ts`;
  const text = await fetchSourceFile(env, repo, branch, themeIndexPath, {
    ctx,
  });
  if (!text) {
    await writeCache(env, key, { empty: true }, ttlSeconds(env, "raw"), ctx);
    return [];
  }

  // Map of imported symbol -> .vue file path relative to theme/index.ts.
  const imports = new Map<string, string>();
  const importRe = /import\s+(\w+)\s+from\s+["']([^"']+\.vue)["']/g;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(text)) !== null) {
    imports.set(im[1]!, im[2]!);
  }

  const components: VueComponentRef[] = [];
  const seen = new Set<string>();
  const regRe = /app\.component\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g;
  let rm: RegExpExecArray | null;
  while ((rm = regRe.exec(text)) !== null) {
    const name = rm[1]!;
    const sym = rm[2]!;
    if (seen.has(name)) continue;
    const relPath = imports.get(sym);
    if (!relPath) continue;
    const themeDir = `${docsRootPrefix(repo.docsRoot)}.vitepress/theme/`;
    // Strip leading "./" if present.
    const cleaned = relPath.startsWith("./") ? relPath.slice(2) : relPath;
    components.push({ name, path: `${themeDir}${cleaned}` });
    seen.add(name);
  }

  await writeCache(
    env,
    key,
    components.length ? components : { empty: true },
    ttlSeconds(env, "raw"),
    ctx,
  );
  return components;
}

// `/api/vue?repo=<slug>&path=<encoded-path>` — returns the SFC source. The
// `path` must match one of the registered component paths for the named repo
// so untrusted requests can't fetch arbitrary repo files.
export async function handleVueComponentRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
): Promise<Response> {
  const url = new URL(request.url);
  const repoSlug = url.searchParams.get("repo");
  const path = url.searchParams.get("path");
  if (!repoSlug || !path) return new Response("Bad Request", { status: 400 });

  const repo = site.repos.find((r) => r.slug === repoSlug);
  if (!repo) return new Response("Unknown repo", { status: 404 });

  const branch = repoRef(
    repo,
    repo.versions?.find((v) => v.default),
  );
  const allowed = await loadVueComponents(env, repo, branch, ctx);
  if (!allowed.some((c) => c.path === path)) {
    return new Response("Component not registered", { status: 404 });
  }

  const source = await fetchSourceFile(env, repo, branch, path, { ctx });
  if (!source) return new Response("Not found", { status: 404 });

  return new Response(source, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Cache for a while; the worker-side cache key already includes the
      // branch, so edits invalidate via cache-bust.
      "cache-control": `public, max-age=${ttlSeconds(env, "raw")}`,
    },
  });
}
