// Rollup gives what one chunk exports to another a name of its own,
// `export{e as a}`, beside the one the minifier gave the binding, e. Named
// after the binding instead, `export{e}`, and imported by that name, an
// export takes a third of the bytes. That matters for the files every page
// loads, whose exports are mostly what the engine imports from them
// (scripts/vite-engine.ts).
//
// Only the entry's exports, which nothing imports but other chunks, and
// those of the chunks Rollup splits off. A chunk that `import()` loads keeps
// its names: they're what the code that loads it reads.

import type { Program } from "estree";
import type { Plugin } from "rollup";

type Node = Program["body"][number];

interface Edit {
  start: number;
  end: number;
  text: string;
}

export function bindingExportsPlugin(): Plugin {
  // By chunk: its exports' new names (its bindings), by their old ones.
  let names = new Map<string, Deferred>();
  const deferred = (file: string) => {
    let d = names.get(file);
    if (!d) names.set(file, (d = new Deferred()));
    return d;
  };
  return {
    name: "vellum:binding-exports",
    renderStart() {
      names = new Map();
    },
    renderChunk: {
      // After the minifier, which names the bindings.
      order: "post",
      async handler(code, chunk, _options, { chunks }) {
        const program = this.parse(code) as Program;
        const edits: Edit[] = [];
        const own = new Map<string, string>();
        if (!chunk.isDynamicEntry) {
          for (const node of program.body) {
            if (node.type !== "ExportNamedDeclaration" || node.source || node.declaration) continue;
            const specifiers = new Set<string>();
            for (const s of node.specifiers) {
              const local = name(s.local);
              const exported = name(s.exported);
              if (exported === "default" || !local || !exported) specifiers.add(text(code, s));
              else {
                own.set(exported, local);
                specifiers.add(local);
              }
            }
            edits.push({ ...span(node), text: `export{${[...specifiers].join(",")}};` });
          }
        }
        // Before waiting for the chunks it imports, which may import it.
        deferred(chunk.fileName).resolve(own);

        const dir = chunk.fileName.split("/").slice(0, -1);
        for (const node of program.body) {
          const source = importSource(node);
          if (source === null) continue;
          const file = [...dir, ...source.split("/")].reduce<string[]>((parts, part) => {
            if (part === "..") parts.pop();
            else if (part !== ".") parts.push(part);
            return parts;
          }, []);
          const imported = file.join("/");
          if (!chunk.imports.includes(imported) || !chunks[imported]) continue;
          const renamed = await deferred(imported).promise;
          if (!renamed.size) continue;
          edits.push(...renameImports(node, renamed, code, imported, (m) => this.error(m)));
        }
        if (!edits.length) return null;
        edits.sort((a, b) => b.start - a.start);
        let out = code;
        for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
        return { code: out, map: null };
      },
    },
  };
}

// The new names of what a statement imports from a chunk whose exports were
// renamed.
function renameImports(
  node: Node,
  renamed: Map<string, string>,
  code: string,
  file: string,
  error: (message: string) => never,
): Edit[] {
  const edits: Edit[] = [];
  if (node.type === "ImportDeclaration") {
    for (const s of node.specifiers) {
      if (s.type === "ImportNamespaceSpecifier") {
        error(`A chunk imports all of ${file}, whose exports were renamed.`);
      }
      if (s.type !== "ImportSpecifier") continue;
      const now = renamed.get(name(s.imported) ?? "");
      if (now) edits.push({ ...span(s), text: as(now, s.local.name) });
    }
  } else if (node.type === "ExportNamedDeclaration") {
    for (const s of node.specifiers) {
      const now = renamed.get(name(s.local) ?? "");
      if (now) edits.push({ ...span(s), text: as(now, text(code, s.exported)) });
    }
  } else if (node.type === "ExportAllDeclaration") {
    error(`A chunk re-exports all of ${file}, whose exports were renamed.`);
  }
  return edits;
}

function importSource(node: Node): string | null {
  if (
    (node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration") &&
    typeof node.source?.value === "string" &&
    node.source.value.startsWith(".")
  ) {
    return node.source.value;
  }
  return null;
}

function as(name: string, local: string): string {
  return name === local ? name : `${name} as ${local}`;
}

function name(node: { type: string; name?: string; value?: unknown }): string | null {
  return node.type === "Identifier" ? node.name! : null;
}

function span(node: object): { start: number; end: number } {
  const { start, end } = node as { start: number; end: number };
  return { start, end };
}

function text(code: string, node: object): string {
  const { start, end } = span(node);
  return code.slice(start, end);
}

class Deferred {
  resolve!: (names: Map<string, string>) => void;
  promise = new Promise<Map<string, string>>((resolve) => (this.resolve = resolve));
}
