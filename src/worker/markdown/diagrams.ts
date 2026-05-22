// Server-side diagram rendering via Kroki (https://kroki.io). Cloudflare Workers
// can't run mermaid (no DOM), so we POST the diagram source to Kroki's public
// HTTP service and embed the returned SVG in the AST. The client renderer skips
// its own ~600KB mermaid bundle when the SVG is already there.
//
// SVGs are cached in KV (and the local Cache API) by content hash, so re-edits
// hit the cache and Kroki only sees novel diagram code. Failures fall through
// to null — the client component will then lazy-render mermaid itself, so a
// Kroki outage degrades to the legacy behaviour rather than blanking the page.

import type { Env } from "../env";
import { readCache, writeCache } from "../cache";

// One week — mermaid syntax is stable, and our cache key includes the full
// source, so invalidation happens naturally when the diagram changes.
const SVG_TTL_SECONDS = 60 * 60 * 24 * 7;

// Public Kroki endpoint. Self-hosters can override by setting VELLUM_KROKI_URL.
const DEFAULT_KROKI = "https://kroki.io";

// Hard ceiling on the SVG we'll cache. Mermaid SVGs are typically a few KB to
// a few hundred KB; anything bigger smells like a runaway diagram and would
// bloat the bootstrap payload and KV value size. Capped to half a megabyte.
const MAX_SVG_BYTES = 512 * 1024;

export type DiagramTheme = "light" | "dark";

export async function renderMermaidSvg(
  code: string,
  env: Env,
  ctx?: ExecutionContext,
  theme: DiagramTheme = "light",
): Promise<string | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  // Mermaid's `%%{init: {'theme': 'dark'}}%%` directive at the head of the
  // source picks the palette. Kroki passes the source through to mermaid
  // verbatim, so prepending the directive is enough — no Kroki options to set.
  // Light uses the default theme (no directive) so existing cached entries
  // from a single-theme world remain valid.
  const source = theme === "dark" ? `%%{init: {'theme':'dark'}}%%\n${trimmed}` : trimmed;

  const key = `diagram:mermaid:${theme}:${await sha256Hex(source)}`;
  const cached = await readCache<string>(env, key);
  if (cached !== null) return cached;

  const krokiBase = (env as { VELLUM_KROKI_URL?: string }).VELLUM_KROKI_URL || DEFAULT_KROKI;
  const url = `${krokiBase.replace(/\/$/, "")}/mermaid/svg`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: source,
      // Cap Kroki's wait time so a slow render doesn't pin the whole page render.
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      // 400 = syntactically invalid diagram — cache the failure briefly so we
      // don't retry on every page load while the author iterates. 5xx and
      // anything else: return null without caching.
      if (res.status === 400) {
        await writeCache(env, key, "", 60, ctx);
      }
      return null;
    }

    const svg = await res.text();
    if (svg.length > MAX_SVG_BYTES) return null;
    if (!svg.startsWith("<svg") && !svg.startsWith("<?xml")) return null;

    await writeCache(env, key, svg, SVG_TTL_SECONDS, ctx);
    return svg;
  } catch {
    // Network/timeout/abort: degrade silently to client-side render.
    return null;
  }
}

// Convenience wrapper: render both palettes in parallel for the same diagram.
// Either side may come back null (Kroki down, invalid diagram, etc.) — the
// client falls back to its own mermaid render when both are missing for the
// current theme.
export async function renderMermaidThemed(
  code: string,
  env: Env,
  ctx?: ExecutionContext,
): Promise<{ light: string | null; dark: string | null }> {
  const [light, dark] = await Promise.all([
    renderMermaidSvg(code, env, ctx, "light"),
    renderMermaidSvg(code, env, ctx, "dark"),
  ]);
  return { light, dark };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}
