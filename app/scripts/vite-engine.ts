// The engine: the modules a repo's React components get from the page rather
// than bundling their own (src/build/react.ts). React, Griffel and every
// Fluent UI v9 package, each an ES module of the client build with all its
// exports. Each holds only the code the page's own bundle doesn't, and
// imports the rest from there, so no module is in the site twice, and a
// component shares the page's React, theme and styles.
//
// Writes dist/client/.vite/engine.json: for each module's import path (its
// specifier), the files that load it, its own first, and likewise for the
// loaders (enginePlugin). Nothing loads them but a page with a repo's
// component.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
const TABLE = "virtual:vellum-engine";
// An engine module's specifier in the table, and the start of its resolved
// id, which its chunk is named after.
const PUBLIC = "vellum-engine:";
const PREFIX = "\0vellum-engine/";

// Fluent's packages are those @fluentui/react-components depends on. Not its
// icons: they're thousands, and a component bundles the few it uses.
const FLUENT = "@fluentui/react-components";
const EXCLUDED = new Set([FLUENT, "@fluentui/react-icons"]);

// CommonJS, so their named exports are spelled out.
const COMMONJS = ["react", "react/jsx-runtime", "react-dom"];

// What `import { usePage } from "vellum"` gives a component.
const VELLUM = path.join(ROOT, "src/web/vellum.ts");

export interface EngineManifest {
  // By specifier: the module's file, then the files it imports, directly or
  // not, all under the client build's directory.
  modules: Record<string, string[]>;
  // The loaders' file and the files it imports.
  loaders: string[];
}

// The specifiers of the engine's modules.
export function engineModules(root = ROOT): string[] {
  const require = createRequire(path.join(root, "package.json"));
  const manifest = (pkg: string) =>
    JSON.parse(fs.readFileSync(path.join(root, "node_modules", pkg, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      exports?: unknown;
    };

  const packages = new Set<string>();
  const queue = [FLUENT];
  while (queue.length) {
    for (const dep of Object.keys(manifest(queue.pop()!).dependencies ?? {})) {
      if (!/^@(fluentui|griffel)\//.test(dep) || EXCLUDED.has(dep) || packages.has(dep)) continue;
      packages.add(dep);
      queue.push(dep);
    }
  }

  const specs = new Set([...COMMONJS, "vellum"]);
  for (const pkg of [...packages].sort()) {
    const exports = manifest(pkg).exports;
    const paths =
      exports && typeof exports === "object" && Object.keys(exports)[0]?.startsWith(".")
        ? Object.keys(exports).filter((p) => p !== "./package.json" && !p.includes("*"))
        : ["."];
    for (const p of paths) {
      const spec = p === "." ? pkg : `${pkg}${p.slice(1)}`;
      // Types only (@griffel/style-types).
      try {
        require.resolve(spec);
      } catch {
        continue;
      }
      specs.add(spec);
    }
  }
  return [...specs].sort();
}

// The virtual module `virtual:vellum-engine`: an `engine` object with a
// loader for each module, by specifier. The client loads a component's
// modules with it (src/web/repoComponents.ts). Being imported with
// `import()`, from a chunk that loads after the page's own, each holds only
// what the page's bundle lacks.
export function enginePlugin(): Plugin {
  // By resolved id.
  const specs = new Map<string, string>();
  return {
    name: "vellum:engine",
    apply: "build",
    // Vite gives each import() the files it loads, to preload them. A page
    // has them for the engine's already, so the loaders don't carry them.
    config: () => ({
      build: {
        modulePreload: {
          resolveDependencies: (file, deps) =>
            path.basename(file).startsWith("engine-") ? [] : deps,
        },
      },
    }),
    resolveId(id) {
      if (id === TABLE) return `\0${TABLE}`;
      if (!id.startsWith(PUBLIC)) return null;
      const spec = id.slice(PUBLIC.length);
      const resolved = `${PREFIX}engine-${spec.replace(/^@/, "").replace(/[^\w-]+/g, "-")}`;
      specs.set(resolved, spec);
      return resolved;
    },
    load(id) {
      if (id === `\0${TABLE}`) {
        const loaders = engineModules().map(
          (spec) => `  ${JSON.stringify(spec)}: () => import(${JSON.stringify(PUBLIC + spec)}),`,
        );
        return `export const engine = {\n${loaders.join("\n")}\n};\n`;
      }
      const spec = specs.get(id);
      if (spec === undefined) return null;
      // Code of its own, so that it's a file of its own: Rollup would make
      // one whose code is all in other chunks a namespace object in one of
      // them, which a component can't import by URL.
      const own = `export const __vellumEngine = ${JSON.stringify(spec)};`;
      if (spec === "vellum") return `${own}\nexport { usePage } from ${JSON.stringify(VELLUM)};`;
      // Named one by one: Rollup can't render some packages' `export *` (it
      // throws in getReexportSpecifiers). Their CommonJS builds have the same
      // names.
      const names = Object.keys(createRequire(path.join(ROOT, "package.json"))(spec) as object)
        .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name) && name !== "default")
        .sort();
      const from = JSON.stringify(spec);
      if (COMMONJS.includes(spec)) {
        return `${own}\nimport m from ${from};\nexport default m;\nexport const { ${names.join(", ")} } = m;`;
      }
      return `${own}\nexport { ${names.join(", ")} } from ${from};`;
    },
    generateBundle(_options, bundle) {
      const loading = (file: string) => {
        const files = [file];
        for (let i = 0; i < files.length; i++) {
          const imported = bundle[files[i]!];
          if (imported?.type !== "chunk") continue;
          for (const f of imported.imports) if (!files.includes(f)) files.push(f);
        }
        return files;
      };
      const modules: Record<string, string[]> = {};
      let loaders: string[] = [];
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.facadeModuleId) continue;
        if (chunk.facadeModuleId === `\0${TABLE}`) loaders = loading(chunk.fileName);
        const spec = specs.get(chunk.facadeModuleId);
        if (spec) modules[spec] = loading(chunk.fileName);
      }
      const manifest: EngineManifest = {
        modules: Object.fromEntries(Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : 1))),
        loaders,
      };
      this.emitFile({
        type: "asset",
        fileName: ".vite/engine.json",
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}
