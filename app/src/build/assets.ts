// Reads the Vite manifest of the client build to find the hashed bundle
// filenames every page links.

import { createHash } from "node:crypto";
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
  // Identifies the client build: pages rendered against another one link
  // bundles that aren't there.
  id: string;
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
  const id = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return { ...parseManifest(JSON.parse(text) as ViteManifest), id };
}

function parseManifest(manifest: ViteManifest): Omit<ClientAssets, "id"> {
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
