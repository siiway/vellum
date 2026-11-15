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

export interface ClientAssets {
  // Entry scripts.
  js: string[];
  // Chunks the entry imports statically. Preloaded so the browser fetches
  // them alongside the entry instead of after parsing it.
  preload: string[];
  css: string[];
  // Changes with any of the files above. Cache keys and ETags for HTML that
  // links these files include it, so a deploy never serves HTML pointing at
  // bundles that no longer exist.
  id: string;
}

let cached: ClientAssets | null = null;

export async function getClientAssets(env: Env): Promise<ClientAssets> {
  if (cached) return cached;
  try {
    const url = "https://internal/.vite/manifest.json";
    const res = await env.ASSETS.fetch(new Request(url));
    if (!res.ok) {
      // Fallback location for older Vite versions.
      const alt = await env.ASSETS.fetch(new Request("https://internal/manifest.json"));
      if (!alt.ok) return (cached = parseManifest({}));
      cached = parseManifest((await alt.json()) as ViteManifest);
      return cached;
    }
    cached = parseManifest((await res.json()) as ViteManifest);
    return cached;
  } catch {
    cached = parseManifest({});
    return cached;
  }
}

function parseManifest(manifest: ViteManifest): ClientAssets {
  const js: string[] = [];
  const css: string[] = [];
  const preload = new Set<string>();

  // Every chunk reachable through static imports.
  const visit = (key: string) => {
    const entry = manifest[key];
    if (!entry || preload.has(`/${entry.file}`)) return;
    preload.add(`/${entry.file}`);
    for (const c of entry.css ?? []) if (!css.includes(`/${c}`)) css.push(`/${c}`);
    entry.imports?.forEach(visit);
  };

  for (const entry of Object.values(manifest)) {
    if (!entry.isEntry) continue;
    js.push(`/${entry.file}`);
    for (const c of entry.css ?? []) if (!css.includes(`/${c}`)) css.push(`/${c}`);
    entry.imports?.forEach(visit);
  }
  for (const file of js) preload.delete(file);

  return { js, preload: [...preload], css, id: hashId([...js, ...preload, ...css].join("|")) };
}

// FNV-1a, base 36. Short and stable; not a security boundary.
function hashId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
