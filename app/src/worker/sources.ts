// Source dispatcher. Each repo declares `source: "github" | "local"`; this
// module hides that distinction from the rest of the worker so router/sidebar/
// search etc. don't have to branch on source kind themselves.
//
// - github: passes through to github.ts (raw.githubusercontent.com + Cache API).
// - local:  reads from the worker's ASSETS bundle. Files live under
//           `/local-docs/{slug}/...` and a manifest at
//           `/local-docs/{slug}/manifest.json` enumerates the tree. Both are
//           produced by the Vite local-docs plugin at build time.

import type { Env } from "./env";
import type { RepoConfig } from "../shared/types";
import {
  fetchRaw as fetchGitHubRaw,
  fetchRepoTree as fetchGitHubRepoTree,
  fetchLastCommit as fetchGitHubLastCommit,
  type CommitInfo,
  type RepoTreeEntry,
} from "./github";

interface SourceFetchOptions {
  ctx?: ExecutionContext;
  bypassCache?: boolean;
}

// Used in cache keys when a repo doesn't declare a branch (typical for local).
// Picking a stable placeholder keeps cache entries stable across reloads.
export const LOCAL_REF = "local";

export function repoRef(repo: RepoConfig, version?: { branch?: string } | null): string {
  if (version?.branch) return version.branch;
  if (repo.branch) return repo.branch;
  return LOCAL_REF;
}

// Normalises a `docsRoot` value into a path PREFIX suitable for concatenation:
// returns "" when the repo's docs are at the source root, or "<path>/" with
// no leading slash and a single trailing slash otherwise. Tolerates the
// common author shapes — empty / "/" / "docs" / "docs/" / "/docs/" — all
// produce a deterministic prefix without introducing double-slashes.
export function docsRootPrefix(docsRoot: string | undefined): string {
  const trimmed = (docsRoot ?? "").replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/` : "";
}

// Internal hostname for ASSETS requests. Cloudflare's ASSETS binding ignores
// the host; only the pathname matters. Picking a non-routable hostname makes
// the intent obvious in logs / error messages.
const LOCAL_HOST = "https://vellum.local";

export async function fetchSourceFile(
  env: Env,
  repo: RepoConfig,
  ref: string,
  path: string,
  opts: SourceFetchOptions = {},
): Promise<string | null> {
  if (repo.source === "local") return fetchLocalFile(env, repo, path);
  if (!repo.owner || !repo.repo) {
    throw new Error(`Repo "${repo.slug}" is configured as github but is missing owner/repo`);
  }
  return fetchGitHubRaw(env, repo.owner, repo.repo, ref, path, opts);
}

export async function fetchSourceTree(
  env: Env,
  repo: RepoConfig,
  ref: string,
  opts: SourceFetchOptions = {},
): Promise<RepoTreeEntry[]> {
  if (repo.source === "local") return fetchLocalTree(env, repo);
  if (!repo.owner || !repo.repo) {
    throw new Error(`Repo "${repo.slug}" is configured as github but is missing owner/repo`);
  }
  return fetchGitHubRepoTree(env, repo.owner, repo.repo, ref, opts);
}

// Last-commit info is GitHub-only — local sources have no git history available
// to the worker. Callers should handle null gracefully (already do for missing
// data in the GitHub path).
export async function fetchSourceLastCommit(
  env: Env,
  repo: RepoConfig,
  ref: string,
  path: string,
  opts: SourceFetchOptions = {},
): Promise<CommitInfo | null> {
  if (repo.source === "local") return null;
  if (!repo.owner || !repo.repo) return null;
  return fetchGitHubLastCommit(env, repo.owner, repo.repo, ref, path, opts);
}

async function fetchLocalFile(env: Env, repo: RepoConfig, path: string): Promise<string | null> {
  const url = new URL(`/local-docs/${repo.slug}/${path}`.replace(/\/+/g, "/"), LOCAL_HOST);
  const res = await env.ASSETS.fetch(new Request(url.toString()));
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.text();
}

async function fetchLocalTree(env: Env, repo: RepoConfig): Promise<RepoTreeEntry[]> {
  const url = new URL(`/local-docs/${repo.slug}/manifest.json`, LOCAL_HOST);
  const res = await env.ASSETS.fetch(new Request(url.toString()));
  if (!res.ok) return [];
  try {
    const manifest = (await res.json()) as {
      files?: Array<{ path: string; size?: number }>;
    };
    return (manifest.files ?? []).map((f) => ({
      path: f.path,
      type: "blob" as const,
      size: f.size,
    }));
  } catch {
    return [];
  }
}
