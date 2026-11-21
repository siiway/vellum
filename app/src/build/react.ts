// A repo's own React components, which its pages use like the built-in ones
// (`<Counter start="3" />`). The repo lists them in its vellum.json, with
// paths relative to the docs root:
//
//   { "components": { "Counter": "components/Counter.tsx" } }
//
// The build bundles all of a repo's components in one esbuild run, into
// `/_vellum/react/{repo}/`: a module per component (`{Name}.js`), the chunks
// they share (`chunk-{hash}.js`), so code that several components use loads
// once, a file per stylesheet they import (`{name}-{hash}.css`), and the
// images and fonts those point to.
//
// React, Griffel and Fluent UI v9 aren't in those: they come from the engine
// (scripts/vite-engine.ts), the client build's modules of them, which the
// components import by URL. The page and its components then run the same
// copy of each, and none is on the site twice. An import of
// @fluentui/react-components becomes imports of the packages it re-exports.
// Anything else a component imports is bundled: the repo's files by
// relative path, and packages from the docs root's package.json, which the
// build installs from its bun.lock.
//
// The build renders the components into the pages' HTML, with a second
// bundle that requires its own copies of the engine's packages
// (importReactComponents). In the browser, a page that uses one preloads its
// files in its head and loads its module before it hydrates
// (src/web/components/RepoComponent.tsx).
//
// Neither bundling nor installing runs the repo's code: the install runs no
// scripts. The repo's files are read only through readSourceFile, and
// packages only from inside the install. Rendering does run it, in the
// build's process, with its environment and files.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import {
  build,
  type BuildOptions,
  type Loader,
  type Message,
  type Metafile,
  type OnResolveArgs,
  type OnResolveResult,
  type OutputFile,
  type Plugin,
  type PluginBuild,
} from "esbuild";
import type { ComponentType } from "react";
import type { ReactComponentFiles, RepoConfig } from "../shared/types";
import { reactFilePath } from "../shared/paths";
import * as vellumModule from "../web/vellum";
import { provideComponent } from "../web/repoComponents";
import type { ClientAssets } from "./assets";
import { APP_ROOT, docsRootPrefix, readSourceBytes, readSourceFile } from "./sources";
import { memo } from "./memo";

interface ReactComponentRef {
  name: string;
  // Repo-rooted path of the component's module.
  path: string;
}

export interface ReactBundle {
  // The files to publish in the repo's directory of them (reactDir), by
  // name: text, or the bytes of an image or a font.
  files: Map<string, string | Uint8Array>;
  // What each component loads, by name, sorted.
  components: Record<string, ReactComponentFiles>;
  // The components for the build to render with: a CommonJS module whose
  // default export has each, by name.
  server: string;
}

// The tags the markdown parser makes components of (markdown/ast.ts).
const NAME = /^[A-Z][A-Za-z0-9]*$/;

// Fluent's umbrella package, which isn't an engine module: it re-exports
// them.
const FLUENT = "@fluentui/react-components";

// The repo's files a component can import, and how each is read. CSS
// modules aren't supported: their minified class names would clash with
// another repo's, which stay on the page after a client-side navigation.
const LOADERS: Record<string, Loader> = {
  ".tsx": "tsx",
  ".ts": "ts",
  ".jsx": "jsx",
  ".js": "jsx",
  ".mjs": "js",
  ".json": "json",
  ".css": "css",
};

// Tried, in order, after an import without one.
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".json"];

// The files a stylesheet's url() can point to, of the repo or its packages
// (an image, a font): each is published beside the stylesheets.
const ASSETS: Record<string, Loader> = Object.fromEntries(
  [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".avif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
  ].map((ext) => [ext, "file"]),
);

// Where the build installs the packages of repos, a directory per
// package.json and bun.lock. Kept between builds.
const PACKAGES_DIR = join(APP_ROOT, ".cache", "react-packages");

// esbuild's output directory. Nothing is written there (`write: false`):
// output paths are relative to it.
const OUT = "out";

// Marks a resolve the plugin asks esbuild for, which the plugin leaves to it.
const INNER = Symbol("vellum-inner");

// Vellum's own packages: the engine's, for the build to render with.
const appRequire = createRequire(join(APP_ROOT, "package.json"));

function loadReactComponents(repo: RepoConfig): Promise<ReactComponentRef[]> {
  return memo(`react:${repo.slug}`, async () => {
    const root = docsRootPrefix(repo.docsRoot);
    const text = await readSourceFile(repo, `${root}vellum.json`);
    let listed: unknown;
    try {
      listed = text ? (JSON.parse(text) as { components?: unknown }).components : null;
    } catch {
      return [];
    }
    if (!listed || typeof listed !== "object" || Array.isArray(listed)) return [];
    const components: ReactComponentRef[] = [];
    for (const [name, file] of Object.entries(listed)) {
      if (!NAME.test(name) || typeof file !== "string" || !/\.[jt]sx?$/.test(file)) continue;
      const path = posix.join(root, file.replace(/^\/+/, ""));
      if (!outsideRepo(path)) components.push({ name, path });
    }
    return components.sort((a, b) => (a.name < b.name ? -1 : 1));
  });
}

// Bundles the repo's components, against the engine of the client build
// `assets`. A component's module exports it as `default`: the file's default
// export, or its export named like the component.
export function bundleReactComponents(
  repo: RepoConfig,
  assets: ClientAssets,
): Promise<ReactBundle> {
  return memo(`react-bundle:${repo.slug}`, async () => {
    const bundle: ReactBundle = { files: new Map(), components: {}, server: "" };
    const components = await loadReactComponents(repo);
    if (!components.length) return bundle;
    const packages = await installPackages(repo);
    // By specifier, the engine module's URL.
    const engine = new Map(
      Object.entries(assets.engine.modules).map(([spec, files]) => [spec, files[0]!]),
    );
    const specOf = new Map([...engine].map(([spec, url]) => [url, spec]));
    const defaults = new Set(assets.engine.defaults);
    const browser = repoModules(repo, components, packages, engine, defaults, false);

    const js = await run(repo, {
      entryPoints: components.map((c) => ({ in: `component:${c.name}`, out: c.name })),
      entryNames: "[name]",
      chunkNames: "chunk-[hash]",
      splitting: true,
      plugins: [browser],
    });
    // esbuild's stylesheets each hold all a component imports, so one that
    // two components import would load twice. Each is built on its own below.
    for (const file of js.outputFiles) {
      if (file.path.endsWith(".js")) bundle.files.set(outName(file.path), file.text);
    }
    const url = (key: string) => reactFilePath(repo.slug, outName(key));

    // The stylesheets the components' modules import (not those they
    // @import), and those each one's CSS holds, in their order there.
    const roots = new Set<string>();
    for (const [key, input] of Object.entries(js.metafile.inputs)) {
      if (key.endsWith(".css")) continue;
      for (const i of input.imports) if (i.path.endsWith(".css")) roots.add(i.path);
    }
    const outputs = js.metafile.outputs;
    const styles = new Map<string, string[]>();
    for (const c of components) {
      const key = Object.keys(outputs).find(
        (k) => outputs[k]!.entryPoint === `component:${c.name}`,
      )!;
      const css = outputs[key]!.cssBundle;
      styles.set(c.name, css ? Object.keys(outputs[css]!.inputs).filter((i) => roots.has(i)) : []);
      const chunks = staticImports(outputs, key);
      const specs = new Set<string>();
      for (const chunk of chunks) {
        for (const i of outputs[chunk]!.imports) if (i.external) specs.add(specOf.get(i.path)!);
      }
      const engineFiles = [...specs].sort().flatMap((s) => assets.engine.modules[s] ?? []);
      bundle.components[c.name] = {
        js: [...new Set([...chunks.map(url), ...engineFiles])],
        engine: [...specs].sort(),
        css: [],
      };
    }

    const sheets = [...new Set([...styles.values()].flat())];
    if (sheets.length) {
      const names = new Set<string>();
      const css = await run(repo, {
        entryPoints: sheets.map((sheet) => {
          let name = posix.basename(sheet, ".css").replace(/[^\w-]/g, "_") || "style";
          while (names.has(name)) name += "_";
          names.add(name);
          return { in: sheet, out: name };
        }),
        entryNames: "[name]-[hash]",
        plugins: [browser],
      });
      const fileOf = new Map<string, string>();
      for (const [key, output] of Object.entries(css.metafile.outputs)) {
        if (output.entryPoint) fileOf.set(output.entryPoint, url(key));
      }
      // The stylesheets, and the images and fonts their url()s point to.
      for (const file of css.outputFiles) {
        bundle.files.set(
          outName(file.path),
          file.path.endsWith(".css") ? file.text : file.contents,
        );
      }
      for (const c of components) {
        bundle.components[c.name]!.css = styles.get(c.name)!.map((sheet) => fileOf.get(sheet)!);
      }
    }

    // For the build: one CommonJS module, whose requires of the engine's
    // packages get Vellum's.
    const server = await run(repo, {
      entryPoints: [{ in: "server:", out: "server" }],
      format: "cjs",
      plugins: [repoModules(repo, components, packages, engine, defaults, true)],
    });
    bundle.server = server.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
    return bundle;
  });
}

async function run(
  repo: RepoConfig,
  options: BuildOptions,
): Promise<{ outputFiles: OutputFile[]; metafile: Metafile }> {
  let result;
  try {
    result = await build({
      absWorkingDir: APP_ROOT,
      outdir: OUT,
      write: false,
      metafile: true,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      loader: ASSETS,
      assetNames: "[name]-[hash]",
      // Not the app's tsconfig.json: the output depends on the repo alone.
      tsconfigRaw: {},
      logLevel: "silent",
      ...options,
    });
  } catch (e) {
    const errors = (e as { errors?: Message[] }).errors;
    if (!errors?.length) throw e;
    // A package that many files import fails the same way in each: the
    // first says it.
    const seen = new Set<string>();
    const lines = errors.filter((m) => !seen.has(m.text) && seen.add(m.text)).map(formatError);
    const shown = lines.slice(0, 20).join("\n");
    const more = lines.length > 20 ? `\n  … and ${lines.length - 20} more` : "";
    throw new Error(`The React components of ${repo.slug} didn't build:\n${shown}${more}`, {
      cause: e,
    });
  }
  return { outputFiles: result.outputFiles!, metafile: result.metafile! };
}

// The output `key` and every chunk it imports, directly or not, but not
// those it imports with import(): they load when it gets to them.
function staticImports(outputs: Metafile["outputs"], key: string): string[] {
  const out = [key];
  for (let i = 0; i < out.length; i++) {
    for (const imported of outputs[out[i]!]!.imports) {
      if (
        imported.kind === "import-statement" &&
        !imported.external &&
        !out.includes(imported.path)
      ) {
        out.push(imported.path);
      }
    }
  }
  return out;
}

// The name of an output file in the repo's directory, from its path.
function outName(path: string): string {
  return relative(join(APP_ROOT, OUT), resolve(APP_ROOT, path)).split(sep).join("/");
}

// --- Modules ------------------------------------------------------------------

// Resolves and loads every import of a component: the engine's modules, by
// URL from the browser and as Vellum's packages on the `server`, the repo's
// files by relative path, and packages from the install. Anything else is
// an error. Imports in packages resolve as usual, but only to files inside
// the install.
function repoModules(
  repo: RepoConfig,
  components: ReactComponentRef[],
  packages: Packages | null,
  engine: Map<string, string>,
  // The specifiers of the engine modules with a default export: React's.
  engineDefaults: ReadonlySet<string>,
  server: boolean,
): Plugin {
  const paths = new Map(components.map((c) => [c.name, c.path]));
  const enginePackages = new Set([...engine.keys()].map(packageName));
  const engineUrls = new Set(engine.values());
  const files = new Map<string, string | null>();
  const assetFiles = new Map<string, Uint8Array | null>();
  const read = async (path: string): Promise<string | null> => {
    if (!files.has(path)) files.set(path, await readSourceFile(repo, path));
    return files.get(path)!;
  };
  const versions = new Map<string, Promise<string | null>>();

  return {
    name: "vellum-repo-modules",
    setup(b) {
      const repoFile = async (path: string, shown: string): Promise<OnResolveResult> => {
        if (!outsideRepo(path)) {
          for (const candidate of candidates(path)) {
            if (loaderFor(candidate) && (await read(candidate)) !== null) {
              return { path: candidate, namespace: "repo" };
            }
          }
        }
        return { errors: [{ text: `can't find "${shown}" in the repo` }] };
      };
      const repoAsset = async (path: string, shown: string): Promise<OnResolveResult> => {
        if (!outsideRepo(path)) {
          if (!assetFiles.has(path)) assetFiles.set(path, await readSourceBytes(repo, path));
          if (assetFiles.get(path)) return { path, namespace: "repo-asset" };
        }
        return { errors: [{ text: `can't find "${shown}" in the repo` }] };
      };

      // From the install: a package, or a file a package imports.
      const installed = async (args: OnResolveArgs, resolveDir: string) => {
        const notFound = { errors: [{ text: `can't find "${args.path}" in the repo's packages` }] };
        const found = await b.resolve(args.path, {
          kind: args.kind,
          resolveDir,
          importer: args.namespace === "file" ? args.importer : undefined,
          pluginData: INNER,
        });
        if (found.errors.length) return notFound;
        // A module the package's `browser` field leaves out.
        if (found.namespace !== "file") return found;
        if (!packages || !(await inside(packages.real, found.path))) return notFound;
        return { path: found.path, sideEffects: found.sideEffects };
      };

      // An error when the install has a newer `path` than the engine.
      const checkVersion = async (args: OnResolveArgs) => {
        if (!packages) return null;
        const dir = args.namespace === "file" ? args.resolveDir : packages.dir;
        const key = `${dir}\0${args.path}`;
        if (!versions.has(key)) versions.set(key, newerThanPage(b, packages, args.path, dir));
        return versions.get(key)!;
      };

      b.onResolve({ filter: /.*/ }, async (args) => {
        const { path, kind, namespace, importer } = args;
        if (args.pluginData === INNER) return undefined;

        if (kind === "entry-point") {
          if (path.startsWith("component:")) {
            return { path: path.slice("component:".length), namespace: "component" };
          }
          if (path === "server:") return { path: "server", namespace: "server" };
          // The stylesheets of the second run: a repo file, or one in the
          // install, by its key in the first run's metafile.
          if (path.startsWith("repo:")) {
            return { path: path.slice("repo:".length), namespace: "repo" };
          }
          const full = resolve(APP_ROOT, path);
          if (packages && (await inside(packages.real, full))) return { path: full };
          return { errors: [{ text: `can't find "${path}"` }] };
        }
        // A url() in a stylesheet: a file of the repo or of a package, which
        // is published, or anything else (data:, https:, /path, #id), which
        // stays as written.
        if (kind === "url-token") {
          if (/^([a-z][\w+.-]*:|\/|#)/i.test(path)) return { path, external: true };
          const file = path.replace(/[?#].*$/, "");
          if (!ASSETS[posix.extname(file).toLowerCase()]) {
            return {
              errors: [{ text: `can't publish "${path}": url() can point to an image or a font` }],
            };
          }
          if (namespace === "file") return installed({ ...args, path: file }, args.resolveDir);
          if (namespace === "repo")
            return repoAsset(posix.join(posix.dirname(importer), file), path);
          return { path, external: true };
        }
        // The server module's components.
        if (namespace === "server") {
          return { path: path.slice("component:".length), namespace: "component" };
        }
        // The component's module, from its entry: a path in the repo, even
        // one that starts like an engine package's name (`react/Card.tsx`).
        if (namespace === "component") return repoFile(path, path);
        // An engine module's URL, which an engine-require module imports.
        if (engineUrls.has(path)) return { path, external: true, sideEffects: false };

        if (engine.has(path) || packageName(path) === FLUENT) {
          const error = path === "vellum" ? null : await checkVersion(args);
          if (error) return { errors: [{ text: error }] };
          if (server) return { path, external: true };
          // A CommonJS require() of one (use-sync-external-store's of
          // react): esbuild can't require() an ES module it doesn't bundle,
          // and would leave a require() that throws in the browser. It gets
          // a module that imports the engine's, which esbuild can.
          if (engine.has(path) && kind === "require-call") {
            return { path, namespace: "engine-require" };
          }
          // Engine modules have no side effects: an import of one that the
          // component doesn't use, which Fluent's re-exports are, goes.
          if (engine.has(path)) {
            return { path: engine.get(path)!, external: true, sideEffects: false };
          }
          // Fluent's re-exports, from Vellum's copy.
          const found = await b.resolve(path, { kind, resolveDir: APP_ROOT, pluginData: INNER });
          if (found.errors.length) return { errors: [{ text: `can't import "${path}"` }] };
          return { path: found.path, namespace: "fluent", sideEffects: false };
        }
        if (enginePackages.has(packageName(path))) {
          const has = [...engine.keys()].filter((s) => packageName(s) === packageName(path));
          return {
            errors: [{ text: `can't import "${path}": the engine has only ${quoteList(has)}` }],
          };
        }

        if (namespace === "file") return installed(args, args.resolveDir);
        if (/^\.\.?\//.test(path)) return repoFile(posix.join(posix.dirname(importer), path), path);
        if (packages && /^[@\w]/.test(path)) return installed(args, packages.dir);
        if (/^[@\w]/.test(path)) {
          return {
            errors: [
              {
                text: `can't import "${path}": the docs root has no package.json and bun.lock to install it from`,
              },
            ],
          };
        }
        return { errors: [{ text: `can't find "${path}" in the repo` }] };
      });

      b.onLoad({ filter: /.*/, namespace: "component" }, ({ path: name }) => ({
        contents: [
          `import * as m from ${JSON.stringify(paths.get(name))};`,
          `export default m.default ?? m[${JSON.stringify(name)}];`,
        ].join("\n"),
        loader: "js",
      }));
      b.onLoad({ filter: /.*/, namespace: "server" }, () => ({
        contents: [
          ...components.map(
            (c, i) => `import c${i} from ${JSON.stringify(`component:${c.name}`)};`,
          ),
          `export default { ${components.map((c, i) => `${JSON.stringify(c.name)}: c${i}`).join(", ")} };`,
        ].join("\n"),
        loader: "js",
      }));
      b.onLoad({ filter: /.*/, namespace: "repo" }, ({ path }) => ({
        contents: files.get(path)!,
        loader: loaderFor(path),
      }));
      b.onLoad({ filter: /.*/, namespace: "repo-asset" }, ({ path }) => ({
        contents: assetFiles.get(path)!,
        loader: "file",
      }));
      b.onLoad({ filter: /.*/, namespace: "engine-require" }, ({ path }) => {
        const url = JSON.stringify(engine.get(path)!);
        const contents = [`export * from ${url};`];
        if (engineDefaults.has(path)) contents.push(`export { default } from ${url};`);
        return { contents: contents.join("\n"), loader: "js" };
      });
      // A statement for each name it re-exports, where it has one for each
      // package: esbuild keeps every name of a statement it keeps.
      b.onLoad({ filter: /.*/, namespace: "fluent" }, async ({ path }) => {
        const text = await readFile(path, "utf8");
        const statements: string[] = [];
        for (const [, names, from] of text.matchAll(
          /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g,
        )) {
          for (const name of names!.split(",").map((n) => n.trim())) {
            if (name) statements.push(`export { ${name} } from ${JSON.stringify(from)};`);
          }
        }
        return { contents: statements.join("\n"), loader: "js" };
      });
    },
  };
}

function loaderFor(path: string): Loader | undefined {
  return LOADERS[posix.extname(path)];
}

// The files an import of `path` can mean: the path, with an extension, an
// index file in it, and the TypeScript source of a `.js` path.
function candidates(path: string): string[] {
  const out = [path, ...EXTENSIONS.map((e) => `${path}${e}`)];
  out.push(...EXTENSIONS.map((e) => `${path}/index${e}`));
  const source = path.replace(/\.(m?js|jsx)$/, "");
  if (source !== path) out.push(`${source}.ts`, `${source}.tsx`);
  return out;
}

function outsideRepo(path: string): boolean {
  return path === ".." || path.startsWith("../") || posix.isAbsolute(path);
}

// Whether `path` is inside the directory `real` (a real path), links
// followed.
async function inside(real: string, path: string): Promise<boolean> {
  try {
    const full = await realpath(path);
    return full === real || full.startsWith(real + sep);
  } catch {
    return false;
  }
}

// `@scope/name` or `name`, of a module path.
function packageName(path: string): string {
  const parts = path.split("/");
  return parts[0]!.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function quoteList(items: readonly string[]): string {
  return items.map((m) => `"${m}"`).join(", ");
}

function formatError(m: Message): string {
  const at = m.location;
  return at
    ? `  ${at.file.replace(/^repo:/, "")}:${at.line}:${at.column}: ${m.text}`
    : `  ${m.text}`;
}

// --- Packages -----------------------------------------------------------------

interface Packages {
  // The install's directory, which has the node_modules.
  dir: string;
  // Its real path.
  real: string;
}

// Installs the packages of the docs root's package.json, from its bun.lock,
// once per pair of them: two repos with the same ones, or a later build,
// reuse the install. Null when the docs root has no package.json and
// bun.lock.
//
// Only those two files go in the install's directory: a bunfig.toml or
// .npmrc of the repo doesn't apply. `--ignore-scripts` keeps the packages'
// install scripts from running.
async function installPackages(repo: RepoConfig): Promise<Packages | null> {
  const root = docsRootPrefix(repo.docsRoot);
  const manifest = await readSourceFile(repo, `${root}package.json`);
  const lockfile = await readSourceFile(repo, `${root}bun.lock`);
  if (manifest === null || lockfile === null) return null;
  checkManifest(manifest, `${root}package.json`);

  const hash = createHash("sha256").update(manifest).update("\0").update(lockfile).digest("hex");
  const dir = join(PACKAGES_DIR, hash.slice(0, 16));
  const done = join(dir, ".installed");
  if (!existsSync(done)) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), manifest);
    await writeFile(join(dir, "bun.lock"), lockfile);
    try {
      await bunInstall(dir);
    } catch (e) {
      throw new Error(`Installing the packages of ${repo.slug} failed: ${(e as Error).message}`, {
        cause: e,
      });
    }
    await writeFile(done, "");
  }
  return { dir, real: await realpath(dir) };
}

// Packages come from a registry or a URL. A local path (`file:`, `link:`,
// a workspace) would install files of the machine.
function checkManifest(text: string, path: string): void {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${path} isn't valid JSON`);
  }
  if (manifest.workspaces) throw new Error(`${path}: workspaces aren't supported`);
  const specs: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") specs.push(value.trim());
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    collect(manifest[field]);
  }
  collect(manifest.overrides);
  collect(manifest.resolutions);
  const local = specs.find((s) =>
    /^(file|link|workspace|portal):|^\.{0,2}[/\\]|^~[/\\]|^[a-z]:[/\\]/i.test(s),
  );
  if (local) {
    throw new Error(`${path}: "${local}" is a local path; packages come from a registry or a URL`);
  }
}

function bunInstall(dir: string): Promise<void> {
  return new Promise((done, fail) => {
    execFile(
      process.execPath,
      ["install", "--frozen-lockfile", "--production", "--ignore-scripts"],
      { cwd: dir, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (err, stdout, stderr) => {
        if (err) fail(new Error((stderr || stdout).trim() || err.message));
        else done();
      },
    );
  });
}

// The version of package `pkg` in the engine: Vellum's.
function engineVersion(pkg: string): Promise<string> {
  return memo(`engine-version:${pkg}`, async () => {
    const file = join(APP_ROOT, "node_modules", pkg, "package.json");
    return (JSON.parse(await readFile(file, "utf8")) as { version: string }).version;
  });
}

// An error when the engine module `path`, imported from `dir`, resolves in
// the install to a newer version of its package than the engine's. The
// component gets the engine's, so code written against the newer one could
// use what it lacks.
async function newerThanPage(
  b: PluginBuild,
  packages: Packages,
  path: string,
  dir: string,
): Promise<string | null> {
  const found = await b.resolve(path, {
    kind: "import-statement",
    resolveDir: dir,
    pluginData: INNER,
  });
  // Not in the install, but where esbuild looked after it: Vellum's.
  if (found.errors.length || !(await inside(packages.real, found.path))) return null;
  const pkg = packageName(path);
  for (let at = dirname(found.path); at.startsWith(packages.dir); at = dirname(at)) {
    let manifest: { name?: string; version?: string };
    try {
      manifest = JSON.parse(await readFile(join(at, "package.json"), "utf8")) as typeof manifest;
    } catch {
      continue;
    }
    if (manifest.name !== pkg || !manifest.version) continue;
    const page = await engineVersion(pkg);
    if (compareVersions(manifest.version, page) <= 0) return null;
    return (
      `the repo's packages have ${pkg} ${manifest.version}, newer than the engine's ${page}, ` +
      `which components use: pin it to ${page} or older ("overrides" in package.json)`
    );
  }
  return null;
}

// Semver order: numbers first, and a prerelease before its release. Of two
// prereleases, part by part: numbers as numbers (alpha.99 before alpha.112),
// a number before a word, and fewer parts first.
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre] = v.split("+")[0]!.split(/-(.*)/);
    return { nums: core.split(".").map((n) => Number(n) || 0), pre: pre?.split(".") };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Math.sign(Number(p) - Number(q));
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// --- Rendering ----------------------------------------------------------------

// Runs the bundle's server module, so the pages the build renders next have
// the components in their HTML. This runs the repo's code. Its requires of
// the engine's packages get Vellum's: in Bun, Fluent's packages load as
// CommonJS (their "node" export) and require Griffel's CommonJS build, so
// `require` gets the copies the page renders with, where an import of
// Griffel would load its ES module, a second copy with its own renderer.
export function importReactComponents(repo: RepoConfig, bundle: ReactBundle): void {
  if (!bundle.server) return;
  const module = { exports: {} as { default?: Record<string, unknown> } };
  const require = (spec: string) => (spec === "vellum" ? vellumModule : appRequire(spec));
  try {
    // The module the build bundled, as CommonJS runs it.
    new Function("module", "exports", "require", bundle.server)(module, module.exports, require);
  } catch (e) {
    throw new Error(
      `The React components of ${repo.slug} failed to load: ${(e as Error).message}`,
      {
        cause: e,
      },
    );
  }
  for (const [name, files] of Object.entries(bundle.components)) {
    const component = module.exports.default?.[name];
    if (!component)
      throw new Error(`The React component ${name} of ${repo.slug} exports no component`);
    provideComponent(files, component as ComponentType<Record<string, unknown>>);
  }
}
