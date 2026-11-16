// Reads the Vite manifest of the client build to find the hashed bundle
// filenames every page links.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
}

// `clientDir` is the Vite output directory (dist/client).
export async function readClientAssets(clientDir: string): Promise<ClientAssets> {
  const path = join(clientDir, ".vite", "manifest.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`No client build at ${clientDir}. Run \`bun run build:client\` first.`);
  }
  return parseManifest(JSON.parse(text) as ViteManifest);
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

  return { js, preload: [...preload], css };
}
