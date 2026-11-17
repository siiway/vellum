// Build-time diagram rendering via Kroki (https://kroki.io). The build has no
// DOM to run mermaid in, so we POST the diagram source to Kroki's HTTP
// service and embed the returned SVG in the AST. The client renderer skips
// its own ~600KB mermaid bundle when the SVG is already there.
//
// SVGs are memoized by content hash for the build, so a diagram that several
// pages share (or a page with both palettes of the same source) is rendered
// once. Failures fall through to null — the client component then
// lazy-renders mermaid itself, so a Kroki outage degrades instead of failing
// the build.

import { createHash } from "node:crypto";
import { memo } from "../memo";

// Public Kroki endpoint. Self-hosters can override by setting VELLUM_KROKI_URL.
const DEFAULT_KROKI = "https://kroki.io";

// Hard ceiling on the SVG we'll embed. Mermaid SVGs are typically a few KB to
// a few hundred KB; anything bigger smells like a runaway diagram and would
// bloat the page and its payload. Capped to half a megabyte.
const MAX_SVG_BYTES = 512 * 1024;

export type DiagramTheme = "light" | "dark";

export function renderMermaidSvg(
  code: string,
  theme: DiagramTheme = "light",
): Promise<string | null> {
  const trimmed = code.trim();
  if (!trimmed) return Promise.resolve(null);

  // Mermaid's `%%{init: {'theme': 'dark'}}%%` directive at the head of the
  // source picks the palette. Kroki passes the source through to mermaid
  // verbatim, so prepending the directive is enough — no Kroki options to set.
  const source = theme === "dark" ? `%%{init: {'theme':'dark'}}%%\n${trimmed}` : trimmed;
  const hash = createHash("sha256").update(source).digest("hex");
  return memo(`diagram:mermaid:${hash}`, () => fetchSvg(source));
}

async function fetchSvg(source: string): Promise<string | null> {
  const krokiBase = process.env.VELLUM_KROKI_URL || DEFAULT_KROKI;
  const url = `${krokiBase.replace(/\/$/, "")}/mermaid/svg`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: source,
      // Cap Kroki's wait time so one slow diagram doesn't stall the build.
      signal: AbortSignal.timeout(20_000),
    });
    // 400 = syntactically invalid diagram; anything else is Kroki's problem.
    // Either way the client renders it (and shows mermaid's error).
    if (!res.ok) return null;
    const svg = await res.text();
    if (svg.length > MAX_SVG_BYTES) return null;
    if (!svg.startsWith("<svg") && !svg.startsWith("<?xml")) return null;
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
//
// The page holds both palettes at once, and Kroki gives every SVG the same
// ids: its root is `container`, and the ids its styles and references use
// start with that. Each palette gets a prefix of its own instead.
export async function renderMermaidThemed(
  code: string,
): Promise<{ light: string | null; dark: string | null }> {
  const [light, dark] = await Promise.all([
    renderMermaidSvg(code, "light"),
    renderMermaidSvg(code, "dark"),
  ]);
  const id = `mermaid-${createHash("sha256").update(code.trim()).digest("hex").slice(0, 12)}`;
  return {
    light: light && scopeIds(light, `${id}-light`),
    dark: dark && scopeIds(dark, `${id}-dark`),
  };
}

function scopeIds(svg: string, prefix: string): string {
  return svg.replace(/(id="|#)container/g, `$1${prefix}`);
}
