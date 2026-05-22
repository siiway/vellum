// Vite plugin that mirrors `local-docs/{slug}/...` into the client output
// (under `dist/client/local-docs/{slug}/`) and emits a manifest.json next to
// it. The worker reads files at runtime via env.ASSETS and uses the manifest
// to enumerate the tree (replacing the GitHub trees API for local repos).
//
// Why a custom plugin instead of `public/`: putting docs in `public/` would
// (a) clobber the conventional asset root, (b) skip per-repo manifest
// generation, and (c) make it impossible to dev-watch the docs tree
// independently of the rest of the public assets.

import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import type { Plugin } from "vite";

interface ManifestEntry {
  path: string;
  size: number;
}

interface RepoManifest {
  slug: string;
  files: ManifestEntry[];
  generatedAt: string;
}

interface PluginOptions {
  // Project-root-relative directory holding `local-docs/<slug>/...` subtrees.
  // Defaults to `local-docs`.
  rootDir?: string;
}

export function localDocsPlugin(opts: PluginOptions = {}): Plugin {
  const rootDir = opts.rootDir ?? "local-docs";
  let projectRoot = "";

  return {
    name: "vellum-local-docs",
    apply: "build",

    configResolved(config) {
      projectRoot = config.root;
    },

    async generateBundle() {
      const absoluteRoot = resolve(projectRoot, rootDir);
      if (!existsSync(absoluteRoot)) return;

      const slugs = await readdir(absoluteRoot, { withFileTypes: true });
      for (const entry of slugs) {
        if (!entry.isDirectory()) continue;
        const slug = entry.name;
        const slugRoot = join(absoluteRoot, slug);

        const files: ManifestEntry[] = [];
        for await (const file of walk(slugRoot)) {
          const rel = posix.normalize(relative(slugRoot, file).split(sep).join("/"));
          const stats = await stat(file);
          files.push({ path: rel, size: stats.size });

          // Vite's emitFile with type "asset" places the file into the output
          // dir at the given fileName. We deliberately bypass Rollup's hashing
          // (the worker fetches by literal path, hashed filenames would defeat
          // the manifest).
          const body = await readFile(file);
          this.emitFile({
            type: "asset",
            fileName: posix.join("local-docs", slug, rel),
            source: body,
          });
        }

        const manifest: RepoManifest = {
          slug,
          files: files.sort((a, b) => a.path.localeCompare(b.path)),
          generatedAt: new Date().toISOString(),
        };
        this.emitFile({
          type: "asset",
          fileName: posix.join("local-docs", slug, "manifest.json"),
          source: JSON.stringify(manifest, null, 2),
        });
      }
    },

    // Watch local-docs in dev/build so an edit triggers a rebuild. Vite's
    // file-watcher honors `addWatchFile` calls during plugin lifecycle.
    async buildStart() {
      const absoluteRoot = resolve(projectRoot, rootDir);
      if (!existsSync(absoluteRoot)) return;
      for await (const file of walk(absoluteRoot)) {
        this.addWatchFile(file);
      }
    },
  };
}

async function* walk(dir: string): AsyncGenerator<string> {
  // Ensure the directory exists; readdir on a missing dir throws ENOENT which
  // we want to bubble up only when the plugin is actively configured.
  await mkdir(dir, { recursive: true }).catch(() => {});
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}
