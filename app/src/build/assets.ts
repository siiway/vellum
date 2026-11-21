// Reads the Vite manifest of the client build to find the hashed bundle
// filenames every page links, and the engine's (scripts/vite-engine.ts).

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EngineManifest } from "../../scripts/vite-engine";

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
  // The engine, for the pages with a repo's React component: the files each
  // of its modules loads, by specifier, and those its loaders do, without
  // the files every page loads.
  engine: EngineManifest;
  // Identifies the client build: pages rendered against another one link
  // bundles that aren't there.
  id: string;
}

// `clientDir` is the Vite output directory (dist/client).
export async function readClientAssets(clientDir: string): Promise<ClientAssets> {
  let text: string;
  let engine: EngineManifest;
  try {
    text = await readFile(join(clientDir, ".vite", "manifest.json"), "utf8");
    engine = JSON.parse(
      await readFile(join(clientDir, ".vite", "engine.json"), "utf8"),
    ) as EngineManifest;
  } catch {
    throw new Error(`No client build at ${clientDir}. Run \`bun run build:client\` first.`);
  }
  const id = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const assets = parseManifest(JSON.parse(text) as ViteManifest);
  const loaded = new Set([...assets.js, ...assets.preload]);
  const own = (files: string[]) => files.map((f) => `/${f}`).filter((f) => !loaded.has(f));
  return {
    ...assets,
    engine: {
      modules: Object.fromEntries(
        Object.entries(engine.modules).map(([spec, files]) => [spec, own(files)]),
      ),
      loaders: own(engine.loaders),
      defaults: engine.defaults,
    },
    id,
  };
}

function parseManifest(manifest: ViteManifest): Omit<ClientAssets, "id" | "engine"> {
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
