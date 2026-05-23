// GitHub webhook handler. Validates the HMAC signature and invalidates cache entries
// for any markdown files that changed.

import type { Env } from "./env";
import { invalidate } from "./cache";
import { invalidateForRepo } from "./translate";
import config from "../../vellum.config.json";
import { expandLocalesFromTranslate } from "../shared/types";
import type { VellumConfig } from "../shared/types";

const SITE: VellumConfig = expandLocalesFromTranslate(config as VellumConfig);

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

  const keys: string[] = [];
  for (const p of touched) {
    if (!p.startsWith(`${repo.docsRoot}/`) || !p.endsWith(".md")) continue;
    keys.push(`raw:${repo.owner}/${repo.repo}@${branch}:${p}`);
    keys.push(`commit:${repo.owner}/${repo.repo}@${branch}:${p}`);
    const pagePath = pageKeyFromFile(p, repo.docsRoot);
    if (pagePath) {
      for (const locale of SITE.site.locales) {
        keys.push(`html:${repo.slug}@${branch}:${locale.code}:${pagePath.path}`);
      }
    }
  }
  // Always bust sidebar + tree on any push so changes to navigation show up.
  for (const locale of SITE.site.locales) {
    keys.push(`sidebar:${repo.slug}@${branch}:${locale.code}`);
  }
  keys.push(`tree:${repo.owner}/${repo.repo}@${branch}`);

  ctx.waitUntil(invalidate(env, keys));
  // Bust translation rows for this repo + branch so the next read for any
  // MT-target locale re-translates against the fresh source. Top-level
  // kinds (ui, config) aren't repo-scoped — they re-translate themselves
  // when their source hash changes, which happens on the next deploy.
  ctx.waitUntil(invalidateForRepo(env, repo.slug, branch));
  return Response.json({ invalidated: keys.length });
}

function pageKeyFromFile(
  absPath: string,
  docsRoot: string,
): { locale: string; path: string } | null {
  const rel = absPath.slice(`${docsRoot}/`.length).replace(/\.md$/, "");
  // Locale prefix detection by config
  for (const l of SITE.site.locales) {
    if (l.prefix && rel.startsWith(`${l.prefix}/`)) {
      return {
        locale: l.code,
        path: rel.slice(l.prefix.length + 1) || "index",
      };
    }
  }
  return { locale: SITE.site.defaultLocale, path: rel || "index" };
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
