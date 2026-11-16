// Source access for the build. Every repo is a directory on disk:
//
// - github: a partial clone (`--filter=blob:none`) under `.sources/{slug}`,
//   made or updated by `syncRepo`. Partial, so the history needed for "last
//   updated" comes along without every old blob.
// - local:  `local-docs/{slug}` (or the repo's `localPath`), part of this
//   repository.
//
// The rest of the build reads files through here and never branches on the
// source kind itself.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { RepoConfig, RepoVersion } from "../shared/types";
import { memo } from "./memo";

// The `app/` directory.
export const APP_ROOT = resolve(import.meta.dirname, "../..");
const SOURCES_DIR = join(APP_ROOT, ".sources");

// Used as the ref of a repo that doesn't declare a branch (typical for local).
export const LOCAL_REF = "local";

export function repoRef(repo: RepoConfig, version?: { branch?: string } | null): string {
  if (version?.branch) return version.branch;
  if (repo.branch) return repo.branch;
  return LOCAL_REF;
}

// The version a repo's pages are built from: the one marked default, else
// the first, else its branch.
export function defaultVersion(repo: RepoConfig): RepoVersion {
  const ref = repoRef(repo);
  const versions = repo.versions ?? [{ label: ref, branch: ref, default: true }];
  return versions.find((v) => v.default) ?? versions[0]!;
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

export function isGitHub(repo: RepoConfig): boolean {
  return repo.source !== "local";
}

// The directory holding the repo's files.
export function repoDir(repo: RepoConfig): string {
  if (!isGitHub(repo)) return resolve(APP_ROOT, repo.localPath ?? `local-docs/${repo.slug}`);
  return join(SOURCES_DIR, repo.slug);
}

// --- Files --------------------------------------------------------------------

// The file's text, or null when it doesn't exist. Paths are relative to the
// repo directory. One that leaves it reads as missing, symlinks included:
// what a docs repo can make the build read ends up on the site, so a link to
// a file of the machine (`/proc/self/environ`, with the CI secrets) must not
// be followed.
export async function readSourceFile(repo: RepoConfig, path: string): Promise<string | null> {
  try {
    const root = await realpath(repoDir(repo));
    const full = await realpath(resolve(root, path));
    if (!isInside(root, full)) return null;
    return await readFile(full, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return null;
    throw e;
  }
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

// The first of `paths`, in order, that exists and isn't empty.
export async function fetchFirstSourceFile(
  repo: RepoConfig,
  paths: string[],
): Promise<{ path: string; text: string } | null> {
  for (const path of paths) {
    const text = await readSourceFile(repo, path);
    if (text) return { path, text };
  }
  return null;
}

// Every file in the repo, as sorted `/`-separated paths relative to its
// directory. Skips `.git` and `node_modules`.
export function listSourceFiles(repo: RepoConfig): Promise<string[]> {
  return memo(`files:${repo.slug}`, async () => {
    const root = repoDir(repo);
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile()) out.push(relative(root, full).split(sep).join("/"));
      }
    };
    if (existsSync(root)) await walk(root);
    return out.sort();
  });
}

// --- Git ----------------------------------------------------------------------

export interface CommitInfo {
  sha: string;
  iso: string;
  author?: string;
}

function remoteUrl(repo: RepoConfig): string {
  if (!repo.owner || !repo.repo) {
    throw new Error(`Repo "${repo.slug}" is configured as github but is missing owner/repo`);
  }
  return `https://github.com/${repo.owner}/${repo.repo}.git`;
}

// `VELLUM_GITHUB_TOKEN` goes in a header, never the URL, so it can't end up
// in the clone's config or in an error message.
function authArgs(): string[] {
  const token = process.env.VELLUM_GITHUB_TOKEN;
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

function git(args: string[], cwd?: string): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      "git",
      [...authArgs(), ...args],
      { cwd, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout, stderr) => {
        if (err) fail(new Error(`git ${args[0]} failed: ${stderr.trim() || err.message}`));
        else done(stdout);
      },
    );
  });
}

// Clones the repo, or brings an existing clone up to the tip of its ref.
export async function syncRepo(repo: RepoConfig): Promise<void> {
  if (!isGitHub(repo)) return;
  const dir = repoDir(repo);
  const ref = repoRef(repo, defaultVersion(repo));
  if (existsSync(join(dir, ".git"))) {
    await git(["fetch", "--quiet", "--filter=blob:none", "origin", ref], dir);
    await git(["reset", "--quiet", "--hard", "FETCH_HEAD"], dir);
  } else {
    await git([
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--single-branch",
      "--branch",
      ref,
      remoteUrl(repo),
      dir,
    ]);
  }
}

// The commit the clone is at.
export async function headSha(repo: RepoConfig): Promise<string> {
  if (!isGitHub(repo)) return LOCAL_REF;
  return (await git(["rev-parse", "HEAD"], repoDir(repo))).trim();
}

// The commit the ref points at on GitHub, without cloning.
export async function remoteSha(repo: RepoConfig): Promise<string> {
  const ref = repoRef(repo, defaultVersion(repo));
  const out = await git(["ls-remote", remoteUrl(repo), `refs/heads/${ref}`, `refs/tags/${ref}`]);
  const sha = out.split(/\s+/)[0];
  if (!sha) throw new Error(`${repo.owner}/${repo.repo} has no branch or tag "${ref}"`);
  return sha;
}

// Most recent commit touching a path, for "last updated". Null for local
// repos, which have no history of their own here.
export async function lastCommit(repo: RepoConfig, path: string): Promise<CommitInfo | null> {
  if (!isGitHub(repo)) return null;
  const commits = await memo(`commits:${repo.slug}`, () => loadCommits(repo));
  return commits.get(path) ?? null;
}

// One pass over the history: the newest commit for every path. No rename
// detection, which would need the blobs a partial clone doesn't have.
async function loadCommits(repo: RepoConfig): Promise<Map<string, CommitInfo>> {
  const out = await git(
    ["log", "--no-renames", "--name-only", "--format=%x1e%H%x1f%aI%x1f%an"],
    repoDir(repo),
  );
  const map = new Map<string, CommitInfo>();
  for (const record of out.split("\x1e")) {
    const [head, ...files] = record.split("\n");
    const [sha, iso, author] = (head ?? "").split("\x1f");
    if (!sha || !iso) continue;
    for (const file of files) {
      if (file && !map.has(file)) map.set(file, { sha, iso, author: author || undefined });
    }
  }
  return map;
}

// The commit of this repository (the app).
export async function appSha(): Promise<string> {
  return (await git(["rev-parse", "HEAD"], APP_ROOT)).trim();
}
