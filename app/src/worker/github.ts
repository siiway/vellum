// GitHub content fetcher with edge caching.
// All network reads go through here so callers benefit from the layered cache.

import type { Env } from "./env";
import { cached, dedupe, readCache, writeCache } from "./cache";
import { ttlSeconds } from "./env";

// How long a miss (404, failed commit lookup) is remembered. Short, so a
// file added without a webhook shows up within a minute.
const MISS_TTL_SECONDS = 60;

interface FetchOptions {
  ctx?: ExecutionContext;
  // Force a network fetch and refresh the cache.
  bypassCache?: boolean;
}

function authHeaders(env: Env): HeadersInit {
  const h: Record<string, string> = {
    "user-agent": "vellum-worker",
    accept: "application/vnd.github.v3.raw",
  };
  if (env.VELLUM_GITHUB_TOKEN) h.authorization = `Bearer ${env.VELLUM_GITHUB_TOKEN}`;
  return h;
}

// Fetch a raw file from github.com. Returns null on 404, throws on 5xx.
export async function fetchRaw(
  env: Env,
  owner: string,
  repo: string,
  ref: string,
  path: string,
  opts: FetchOptions = {},
): Promise<string | null> {
  const key = `raw:${owner}/${repo}@${ref}:${path}`;
  const ttl = (body: string | null) => (body === null ? MISS_TTL_SECONDS : ttlSeconds(env, "raw"));
  const load = async (): Promise<string | null> => {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
    const res = await fetch(url, {
      headers: env.VELLUM_GITHUB_TOKEN
        ? {
            authorization: `Bearer ${env.VELLUM_GITHUB_TOKEN}`,
            "user-agent": "vellum-worker",
          }
        : { "user-agent": "vellum-worker" },
      cf: { cacheEverything: true, cacheTtl: 60 },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      // Not cached: a GitHub hiccup shouldn't stick.
      throw new Error(`GitHub raw ${owner}/${repo}/${path}@${ref} failed: ${res.status}`);
    }
    return res.text();
  };

  if (opts.bypassCache) {
    const body = await load();
    await writeCache(env, key, body, ttl(body), opts.ctx);
    return body;
  }
  return cached(env, key, ttl, load, opts.ctx);
}

export interface CommitInfo {
  sha: string;
  iso: string;
  author?: string;
}

// Most recent commit touching a path. Used for "last updated".
export async function fetchLastCommit(
  env: Env,
  owner: string,
  repo: string,
  ref: string,
  path: string,
  opts: FetchOptions = {},
): Promise<CommitInfo | null> {
  const key = `commit:${owner}/${repo}@${ref}:${path}`;
  const ttl = (info: CommitInfo | null) =>
    info === null ? MISS_TTL_SECONDS : ttlSeconds(env, "raw");
  // Any failure, rate limiting included, is remembered as "no commit" for a
  // minute rather than retried on every render.
  const load = async (): Promise<CommitInfo | null> => {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(ref)}&per_page=1`;
    const res = await fetch(url, {
      headers: {
        ...authHeaders(env),
        accept: "application/vnd.github+json",
      },
      cf: { cacheEverything: true, cacheTtl: 300 },
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{
      sha: string;
      commit: { author?: { date?: string; name?: string } };
    }>;
    const first = arr[0];
    if (!first) return null;
    return {
      sha: first.sha,
      iso: first.commit.author?.date ?? new Date().toISOString(),
      author: first.commit.author?.name,
    };
  };

  if (opts.bypassCache) {
    const info = await load();
    await writeCache(env, key, info, ttl(info), opts.ctx);
    return info;
  }
  return cached(env, key, ttl, load, opts.ctx);
}

export interface RepoTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

// Full repo tree at a ref - used for sidebar fallback when no explicit sidebar exists,
// and as a corpus seed for the search index.
export async function fetchRepoTree(
  env: Env,
  owner: string,
  repo: string,
  ref: string,
  opts: FetchOptions = {},
): Promise<RepoTreeEntry[]> {
  const key = `tree:${owner}/${repo}@${ref}`;
  if (!opts.bypassCache) {
    const hit = await readCache<RepoTreeEntry[]>(env, key);
    if (hit) return hit;
  }
  return dedupe(opts.ctx, key, () => loadRepoTree(env, owner, repo, ref, key, opts));
}

// A failed lookup returns [] without caching it, so the next request retries.
async function loadRepoTree(
  env: Env,
  owner: string,
  repo: string,
  ref: string,
  key: string,
  opts: FetchOptions,
): Promise<RepoTreeEntry[]> {
  // Step 1: resolve ref to a tree SHA.
  const branchRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(ref)}`,
    {
      headers: { ...authHeaders(env), accept: "application/vnd.github+json" },
      cf: { cacheEverything: true, cacheTtl: 300 },
    },
  );
  if (!branchRes.ok) {
    return [];
  }
  const branch = (await branchRes.json()) as {
    commit: { commit: { tree: { sha: string } } };
  };
  const treeSha = branch.commit.commit.tree.sha;

  // Step 2: fetch the full recursive tree.
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    {
      headers: { ...authHeaders(env), accept: "application/vnd.github+json" },
      cf: { cacheEverything: true, cacheTtl: 300 },
    },
  );
  if (!treeRes.ok) return [];
  const tree = (await treeRes.json()) as {
    tree: Array<{ path: string; type: "blob" | "tree"; size?: number }>;
  };
  const entries: RepoTreeEntry[] = tree.tree.map((t) => ({
    path: t.path,
    type: t.type,
    size: t.size,
  }));
  await writeCache(env, key, entries, ttlSeconds(env, "raw"), opts.ctx);
  return entries;
}
