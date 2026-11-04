// Records which npm packages end up in the client build, for NOTICE.md.
//
// A package counts when any of its modules is in an output chunk, so packages
// that are only build tools, or that tree-shaking drops entirely, are left
// out. Writes dist/packages/client.json: a sorted list of package directories,
// relative to the app. scripts/notice.ts reads it, together with the Worker's
// esbuild metafile (dist/worker/meta.json).

import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");

/** The package directory a module id belongs to, relative to the app, or
 *  null for app code and virtual modules. */
export function packageDir(id: string, root = ROOT): string | null {
  if (id.startsWith("\0")) return null;
  const file = path.resolve(root, id.split("?")[0]!).replaceAll("\\", "/");
  const at = file.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const parts = file.slice(at + "/node_modules/".length).split("/");
  const name = parts[0]!.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
  const dir = file.slice(0, at) + "/node_modules/" + name.join("/");
  return path.relative(root, dir).replaceAll("\\", "/");
}

export function bundledPackagesPlugin(): Plugin {
  const dirs = new Set<string>();
  return {
    name: "vellum:bundled-packages",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const id of output.moduleIds) {
          const dir = packageDir(id);
          if (dir) dirs.add(dir);
        }
      }
    },
    writeBundle() {
      const out = path.join(ROOT, "dist", "packages");
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, "client.json"),
        JSON.stringify([...dirs].sort(), null, 2) + "\n",
      );
    },
  };
}
