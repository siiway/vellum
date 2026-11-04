// Reads the Vite manifest from the assets binding to find the hashed bundle filenames.
// Cached at module scope; refreshed on every cold start.

import type { Env } from "./env";

interface ManifestEntry {
  file: string;
  src?: string;
  isEntry?: boolean;
  css?: string[];
  imports?: string[];
}

type ViteManifest = Record<string, ManifestEntry>;

let cached: { js: string[]; css: string[] } | null = null;

export async function getClientAssets(env: Env): Promise<{ js: string[]; css: string[] }> {
  if (cached) return cached;
  try {
    const url = "https://internal/.vite/manifest.json";
    const res = await env.ASSETS.fetch(new Request(url));
    if (!res.ok) {
      // Fallback location for older Vite versions.
      const alt = await env.ASSETS.fetch(new Request("https://internal/manifest.json"));
      if (!alt.ok) return (cached = { js: [], css: [] });
      cached = parseManifest((await alt.json()) as ViteManifest);
      return cached;
    }
    cached = parseManifest((await res.json()) as ViteManifest);
    return cached;
  } catch {
    cached = { js: [], css: [] };
    return cached;
  }
}

function parseManifest(manifest: ViteManifest): {
  js: string[];
  css: string[];
} {
  const js: string[] = [];
  const css: string[] = [];
  for (const entry of Object.values(manifest)) {
    if (entry.isEntry) {
      js.push(`/${entry.file}`);
      for (const c of entry.css ?? []) css.push(`/${c}`);
    }
  }
  return { js, css };
}
