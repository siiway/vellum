// The engine: the modules a repo's React components get from the page rather
// than bundling their own (src/build/react.ts). React, Griffel and every
// Fluent UI v9 package, each an ES module of the client build with all its
// exports. Each imports from the page's own bundle the code that's in it, so
// a component shares the page's React, theme and styles, and holds the rest,
// which the page's bundle then needn't (enginePlugin).
//
// Writes dist/client/.vite/engine.json: for each module's import path (its
// specifier), the files that load it, its own first, and likewise for the
// loaders (enginePlugin). Nothing loads them but a page with a repo's
// component.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type {
  CallExpression,
  Declaration,
  Expression,
  MemberExpression,
  Node,
  Program,
  SpreadElement,
} from "estree";
import { build, type Plugin, type ResolvedConfig } from "vite";
import type { PluginContext } from "rollup";

const ROOT = path.resolve(import.meta.dirname, "..");
const TABLE = "virtual:vellum-engine";
// An engine module's specifier in the table, and the start of its resolved
// id, which its chunk is named after.
const PUBLIC = "vellum-engine:";
const PREFIX = "\0vellum-engine/";
// A module the engine has a copy of (resolveId), by the start of its id.
export const COPY = "\0vellum-engine-copy:";
// Set while the plugin builds the client without the engine (pageModules).
const LEAN = "VELLUM_ENGINE_LEAN";

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
  // The specifiers of the modules with a default export: the CommonJS
  // packages', which a CommonJS require() gets (src/build/react.ts).
  defaults: string[];
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
      // For development builds only.
      if (p.endsWith("/jsx-dev-runtime")) continue;
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
//
// The engine shares a module with the page only if the page has code of it
// without the engine (pageModules): of any other it has a copy of its own,
// and so of any of data, and of any without state whose exports the page
// doesn't all use. The page's bundle then holds what it would without the
// engine, but the exports the engine imports. Were the engine to share the
// others too, the page's bundle would also hold whatever Rollup can't tell
// the engine doesn't need of what the page has of them (an object's unused
// methods, say).
export function enginePlugin(): Plugin {
  if (process.env[LEAN]) return leanPlugin();
  // By resolved id.
  const specs = new Map<string, string>();
  let config: ResolvedConfig;
  let page: PageModules = { included: new Set(), partly: new Set() };
  return {
    name: "vellum:engine",
    // Before Vite resolves the imports of the engine's modules (resolveId).
    enforce: "pre",
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
    configResolved(resolved) {
      config = resolved;
    },
    async buildStart() {
      page = await pageModules(config);
    },
    async resolveId(id, importer, options) {
      if (id === TABLE) return `\0${TABLE}`;
      if (id.startsWith(PUBLIC)) {
        const spec = id.slice(PUBLIC.length);
        const resolved = `${PREFIX}engine-${spec.replace(/^@/, "").replace(/[^\w-]+/g, "-")}`;
        specs.set(resolved, spec);
        return resolved;
      }
      // What an engine module, or a copy, imports.
      if (!importer?.startsWith(PREFIX) && !importer?.startsWith(COPY)) return null;
      const from = importer.startsWith(COPY) ? importer.slice(COPY.length) : undefined;
      const resolved = await this.resolve(id, from, { ...options, skipSelf: true });
      if (!resolved || resolved.external || !resolved.id.includes("/node_modules/"))
        return resolved;
      const module = parsed(resolved.id, this.parse);
      const copy =
        module &&
        (dataModule(module) ||
          (page.included.has(resolved.id)
            ? page.partly.has(resolved.id) && statelessModule(module)
            : esModule(module)));
      return copy ? { ...resolved, id: `${COPY}${resolved.id}` } : resolved;
    },
    load(id) {
      if (id.startsWith(COPY)) return parsed(id.slice(COPY.length), this.parse)!.code;
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
      // A module the engine has a copy of and the page has too, which the
      // modules they share import: its state (a context, say) would be in
      // two.
      const ids = new Set(
        Object.values(bundle).flatMap((c) => (c.type === "chunk" ? c.moduleIds : [])),
      );
      for (const id of ids) {
        const real = id.startsWith(COPY) ? id.slice(COPY.length) : null;
        const module = real && ids.has(real) && parsed(real, this.parse);
        if (module && !dataModule(module) && !statelessModule(module)) {
          this.error(
            `The engine has ${real} twice: a copy, and the page's, which the page has no code of without the engine.`,
          );
        }
      }
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
      const defaults: string[] = [];
      let loaders: string[] = [];
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.facadeModuleId) continue;
        if (chunk.facadeModuleId === `\0${TABLE}`) loaders = loading(chunk.fileName);
        const spec = specs.get(chunk.facadeModuleId);
        if (!spec) continue;
        modules[spec] = loading(chunk.fileName);
        if (chunk.exports.includes("default")) defaults.push(spec);
      }
      const manifest: EngineManifest = {
        modules: Object.fromEntries(Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : 1))),
        loaders,
        defaults: defaults.sort(),
      };
      this.emitFile({
        type: "asset",
        fileName: ".vite/engine.json",
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

// The client built without the engine, before the client is (pageModules).
function leanPlugin(): Plugin {
  return {
    name: "vellum:engine-lean",
    apply: "build",
    resolveId: (id) => (id === TABLE ? `\0${TABLE}` : null),
    load: (id) => (id === `\0${TABLE}` ? "export const engine = {};" : null),
  };
}

interface PageModules {
  // The modules in node_modules the client has code of without the engine.
  included: Set<string>;
  // Those of them with exports it doesn't use.
  partly: Set<string>;
}

async function pageModules(config: ResolvedConfig): Promise<PageModules> {
  const page: PageModules = { included: new Set(), partly: new Set() };
  process.env[LEAN] = "1";
  try {
    await build({
      configFile: config.configFile ?? path.join(ROOT, "vite.config.ts"),
      root: config.root,
      mode: config.mode,
      logLevel: "silent",
      build: { write: false, minify: false, manifest: false, reportCompressedSize: false },
      plugins: [
        {
          name: "vellum:engine-page",
          generateBundle(_options, bundle) {
            for (const chunk of Object.values(bundle)) {
              if (chunk.type !== "chunk") continue;
              for (const [id, module] of Object.entries(chunk.modules)) {
                if (!id.includes("/node_modules/")) continue;
                page.included.add(id);
                if (module.removedExports.length) page.partly.add(id);
              }
            }
          },
        },
      ],
    });
  } finally {
    delete process.env[LEAN];
  }
  return page;
}

interface Parsed {
  code: string;
  program: Program | null;
}

// By path; null for what isn't a file.
const files = new Map<string, Parsed | null>();
function parsed(id: string, parse: PluginContext["parse"]): Parsed | null {
  if (!files.has(id)) {
    let file: Parsed | null = null;
    try {
      const code = fs.readFileSync(id, "utf8");
      let program: Program | null = null;
      try {
        program = parse(code) as Program;
      } catch {
        // Not JavaScript (JSON, say).
      }
      file = { code, program };
    } catch {
      // Not a file.
    }
    files.set(id, file);
  }
  return files.get(id)!;
}

// Whether a module holds only data: constants made of literals and of what
// it imports, and re-exports. The engine has a copy of each rather than the
// page's, which keeps only the parts the page uses (a few of the 500
// tokens, say) and would keep all of them for the engine; an object the
// engine re-exported would also keep the page from dropping what it doesn't
// use of it (the functions of Griffel's `shorthands`). Nothing is lost: data
// has no state to share. A module with anything else, a function, a call
// (createContext) or an empty object (a cache), is the page's, if the page
// has code of it.
function dataModule({ program }: Parsed): boolean {
  return !!program?.body.every(dataStatement);
}

// Whether a module is an ES module, which the engine can have a copy of: not
// CommonJS, which Vite makes one of, and a copy wouldn't be.
function esModule({ code, program }: Parsed): boolean {
  return (
    !!program?.body.some((n) => n.type === "ImportDeclaration" || n.type.startsWith("Export")) &&
    !/\brequire\s*\(|\bmodule\.exports\b|\bexports\.\w/.test(code)
  );
}

// Calls that make a value of what they're given, with nothing in it that two
// copies would each have their own of and have to agree on: Griffel's style
// hooks (the rules they add are the page renderer's), Fluent's icons and
// React's component wrappers.
const FACTORIES = new Set([
  "__styles",
  "__resetStyles",
  "__staticStyles",
  "__css",
  "__resetCSS",
  "__staticCSS",
  "makeStyles",
  "makeResetStyles",
  "makeStaticStyles",
  "createFluentIcon",
  "forwardRef",
  "memo",
]);

// Methods that change the object or array they're called on, and those of
// Object and Reflect that change their first argument.
const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill"]);
const MUTATORS_OF = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "set",
]);

// Whether a module has no state: its own bindings are data, functions and
// what FACTORIES make, set up once (`Button.displayName = 'Button'`), and no
// function changes them. A copy of one behaves as the module does.
function statelessModule({ program }: Parsed): boolean {
  if (!program) return false;
  const own = new Set<string>();
  for (const node of program.body) {
    const declaration =
      node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration"
        ? node.declaration
        : node;
    if (declaration?.type === "FunctionDeclaration" && declaration.id) own.add(declaration.id.name);
    if (declaration?.type === "VariableDeclaration") {
      for (const d of declaration.declarations) if (d.id.type === "Identifier") own.add(d.id.name);
    }
  }
  return program.body.every((node) => statelessStatement(node, own)) && !mutates(program, own);
}

function statelessStatement(
  node: Program["body"][number] | Declaration,
  own: Set<string>,
): boolean {
  switch (node.type) {
    case "FunctionDeclaration":
      return true;
    case "ExportNamedDeclaration":
      return !node.declaration || statelessStatement(node.declaration, own);
    case "ExportDefaultDeclaration":
      return (
        node.declaration.type === "FunctionDeclaration" || value(node.declaration as Expression)
      );
    case "VariableDeclaration":
      return node.kind === "const" && node.declarations.every((d) => d.init && value(d.init));
    // 'use client', or setting up a binding of its own.
    case "ExpressionStatement":
      return (
        "directive" in node ||
        (node.expression.type === "AssignmentExpression" &&
          node.expression.operator === "=" &&
          node.expression.left.type === "MemberExpression" &&
          own.has(root(node.expression.left) ?? "") &&
          value(node.expression.right))
      );
    default:
      return dataStatement(node as Program["body"][number]);
  }
}

function value(node: Expression | SpreadElement | null): boolean {
  if (!node) return false;
  switch (node.type) {
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return true;
    case "CallExpression":
      return (
        FACTORIES.has(calleeName(node.callee) ?? "") &&
        node.arguments.every((a) => value(a as Expression | SpreadElement))
      );
    case "SpreadElement":
      return value(node.argument);
    case "ArrayExpression":
      return node.elements.length > 0 && node.elements.every(value);
    case "ObjectExpression":
      return (
        node.properties.length > 0 &&
        node.properties.every((p) =>
          p.type === "SpreadElement"
            ? value(p)
            : (p.kind === "init" || p.method) &&
              (!p.computed || constant(p.key as Expression)) &&
              value(p.value as Expression),
        )
      );
    default:
      return constant(node);
  }
}

// Whether a function changes one of the module's own bindings, or what's in
// one: assigns to it, or calls something that changes it.
function mutates(program: Program, own: Set<string>): boolean {
  let found = false;
  const visit = (node: unknown, inFunction: boolean): void => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, inFunction);
      return;
    }
    const n = node as Node;
    if (typeof n.type !== "string") return;
    if (inFunction) {
      const target =
        n.type === "AssignmentExpression"
          ? (n.left as Node)
          : n.type === "UpdateExpression" ||
              (n.type === "UnaryExpression" && n.operator === "delete")
            ? (n.argument as Node)
            : n.type === "CallExpression" && n.callee.type === "MemberExpression"
              ? mutated(n)
              : null;
      if (target && names(target).some((name) => own.has(name))) {
        found = true;
        return;
      }
    }
    const isFunction =
      n.type === "FunctionDeclaration" ||
      n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression";
    for (const [key, child] of Object.entries(n)) {
      if (key !== "type") visit(child, inFunction || isFunction);
    }
  };
  visit(program.body, false);
  return found;
}

// What a call changes: x of `x.push(...)` or `Object.assign(x, ...)`.
function mutated(call: CallExpression): Node | null {
  const callee = call.callee as MemberExpression;
  const method =
    !callee.computed && callee.property.type === "Identifier" ? callee.property.name : null;
  if (!method) return null;
  if (MUTATORS.has(method)) return callee.object as Node;
  const of = callee.object.type === "Identifier" ? callee.object.name : null;
  if ((of === "Object" || of === "Reflect") && MUTATORS_OF.has(method)) {
    return (call.arguments[0] as Node | undefined) ?? null;
  }
  return null;
}

// The bindings an assignment's target names, or that an expression is a
// member of.
function names(node: Node): string[] {
  switch (node.type) {
    case "Identifier":
      return [node.name];
    case "MemberExpression": {
      const name = root(node);
      return name ? [name] : [];
    }
    case "ObjectPattern":
      return node.properties.flatMap((p) => names(p.type === "RestElement" ? p : p.value));
    case "ArrayPattern":
      return node.elements.flatMap((e) => (e ? names(e) : []));
    case "RestElement":
      return names(node.argument);
    case "AssignmentPattern":
      return names(node.left);
    default:
      return [];
  }
}

function root(node: Node): string | null {
  while (node.type === "MemberExpression") node = node.object;
  return node.type === "Identifier" ? node.name : null;
}

function calleeName(callee: CallExpression["callee"]): string | null {
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
}

function dataStatement(node: Program["body"][number]): boolean {
  switch (node.type) {
    case "ImportDeclaration":
    case "ExportAllDeclaration":
    case "EmptyStatement":
      return true;
    // 'use client'
    case "ExpressionStatement":
      return "directive" in node;
    case "ExportNamedDeclaration":
      return !node.declaration || dataStatement(node.declaration);
    case "ExportDefaultDeclaration":
      return constant(node.declaration as Expression);
    case "VariableDeclaration":
      return node.kind === "const" && node.declarations.every((d) => d.init && constant(d.init));
    default:
      return false;
  }
}

function constant(node: Expression | SpreadElement | null): boolean {
  if (!node) return false;
  switch (node.type) {
    case "Literal":
      // A RegExp has state (lastIndex).
      return !("regex" in node);
    case "Identifier":
      return true;
    case "TemplateLiteral":
      return node.expressions.every(constant);
    case "UnaryExpression":
      return node.operator !== "delete" && constant(node.argument);
    case "BinaryExpression":
      return node.left.type !== "PrivateIdentifier" && constant(node.left) && constant(node.right);
    case "SpreadElement":
      return constant(node.argument);
    case "MemberExpression":
      return (
        node.object.type !== "Super" &&
        constant(node.object) &&
        (!node.computed || constant(node.property as Expression))
      );
    case "ArrayExpression":
      return node.elements.length > 0 && node.elements.every(constant);
    case "ObjectExpression":
      return (
        node.properties.length > 0 &&
        node.properties.every((p) =>
          p.type === "SpreadElement"
            ? constant(p)
            : p.kind === "init" &&
              !p.method &&
              (!p.computed || constant(p.key as Expression)) &&
              constant(p.value as Expression),
        )
      );
    default:
      return false;
  }
}
