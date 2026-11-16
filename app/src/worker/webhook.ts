// GitHub webhook handler. Validates the HMAC signature and invalidates cache entries
// for the files and pages a push changed.

import type { Env } from "./env";
import { invalidate } from "./cache";
import { docsRootPrefix } from "./sources";
import { pageCacheKey } from "./page-key";
import config from "../../vellum.config.json";
import { sourceLocale } from "../shared/types";
import type { RepoConfig, VellumConfig } from "../shared/types";

const SITE: VellumConfig = config as VellumConfig;

interface PushPayload {
  ref: string;
  repository: {
    full_name: string;
    owner: { name?: string; login?: string };
    name: string;
  };
  commits?: Array<{
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
}

export async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const sig = request.headers.get("x-hub-signature-256");
  const event = request.headers.get("x-github-event");
  const body = await request.text();

  if (env.VELLUM_WEBHOOK_SECRET) {
    if (!sig || !(await verifySignature(env.VELLUM_WEBHOOK_SECRET, body, sig))) {
      return new Response("bad signature", { status: 401 });
    }
  }

  if (event === "ping") return Response.json({ pong: true });
  if (event !== "push") return new Response("ignored", { status: 200 });

  const payload = JSON.parse(body) as PushPayload;
  const fullName = payload.repository.full_name.toLowerCase();
  const branch = payload.ref.replace(/^refs\/heads\//, "");
  const repo = SITE.repos.find(
    (r) =>
      r.source !== "local" &&
      r.owner &&
      r.repo &&
      `${r.owner}/${r.repo}`.toLowerCase() === fullName,
  );
  if (!repo) return new Response("repo not configured", { status: 200 });
  if (!(repo.versions ?? [{ branch: repo.branch }]).some((v) => v.branch === branch)) {
    return new Response("branch not published", { status: 200 });
  }

  const touched = new Set<string>();
  for (const c of payload.commits ?? []) {
    [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])].forEach((p) =>
      touched.add(p),
    );
  }

  const rootPrefix = docsRootPrefix(repo.docsRoot);
  const keys: string[] = [];
  const pagePaths = new Set<string>();
  for (const p of touched) {
    if (rootPrefix && !p.startsWith(rootPrefix)) continue;
    // Every file under the docs root: pages, includes, vellum.json, the
    // VitePress config and theme.
    keys.push(`raw:${repo.owner}/${repo.repo}@${branch}:${p}`);
    if (!p.endsWith(".md")) continue;
    keys.push(`commit:${repo.owner}/${repo.repo}@${branch}:${p}`);
    for (const pagePath of pagePathsForFile(p.slice(rootPrefix.length), repo)) {
      pagePaths.add(pagePath);
    }
  }
  // Cached page payloads, for every locale.
  for (const pagePath of pagePaths) {
    for (const locale of SITE.site.locales) {
      keys.push(
        pageCacheKey({
          repoSlug: repo.slug,
          version: { branch },
          localeCode: locale.code,
          pagePath,
        }),
      );
    }
  }
  // Navigation and per-repo config can change with any push.
  for (const locale of SITE.site.locales) {
    keys.push(`sidebar:${repo.slug}@${branch}:${locale.code}`);
    keys.push(`nav:${repo.slug}@${branch}:${locale.code}`);
  }
  keys.push(`social:${repo.slug}@${branch}`);
  keys.push(`vue:${repo.slug}@${branch}`);
  keys.push(`xrefmap:${repo.slug}@${branch}`);
  keys.push(`tree:${repo.owner}/${repo.repo}@${branch}`);

  ctx.waitUntil(invalidate(env, keys));
  return Response.json({ invalidated: keys.length });
}

// The page paths (the URL part after the repo slug) that can be served from
// a markdown file, given relative to the docs root: the inverse of the page
// builder's candidate list. Every file serves its own path; `guide/index.md`
// also serves `guide`, and a root `README.md` also serves `index`.
function pagePathsForFile(rel: string, repo: RepoConfig): string[] {
  const owner = sourceLocale(
    rel.replace(/\.md$/, ""),
    SITE.site.locales,
    SITE.site.defaultLocale,
    repo,
  );
  if (!owner) return [];
  const path = owner.path;
  const paths = [path];
  if (path.endsWith("/index")) paths.push(path.slice(0, -"/index".length));
  if (path === "README") paths.push("index");
  return paths;
}

async function verifySignature(secret: string, body: string, header: string): Promise<boolean> {
  const expected = header.replace(/^sha256=/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
