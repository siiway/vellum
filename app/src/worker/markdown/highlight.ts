// Shiki-based code highlighting that runs in the Worker.
// One highlighter per isolate. It starts with just the two themes; each
// grammar loads the first time a code block uses it, so a fresh isolate
// pays for the languages on the page rather than all of LANGS. Built on
// `shiki/core` with per-language imports, so the Worker bundle carries only
// the grammars in LANGS and the two themes, not Shiki's full set.
//
// Engine choice: the default Oniguruma engine ships as a WASM module and instantiates
// it via `WebAssembly.instantiate` — which Cloudflare Workers blocks at runtime
// ("Wasm code generation disallowed by embedder"). Using the pure-JS regex engine
// avoids that path entirely. It's marginally less accurate on a handful of exotic
// TextMate patterns; for the languages we ship it's indistinguishable in output.

import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
  type ShikiTransformer,
} from "shiki/core";
import type { Element } from "hast";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubLight from "shiki/themes/github-light.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationFocus,
  transformerNotationErrorLevel,
  transformerNotationWordHighlight,
  transformerMetaHighlight,
} from "@shikijs/transformers";

type GrammarModule = Promise<{ default: LanguageRegistration[] }>;

// Comprehensive language set: the name an author writes -> Shiki language
// id. Each grammar adds a few KB to the worker bundle, but for a docs
// platform that has to render *whatever* an author writes, narrow lists are
// the worse trade. Categories rather than alphabetical so adding new ones
// stays straightforward.
const LANGS: Record<string, string> = {
  // Web — TS/JS family
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  // Web — markup / templating
  html: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  stylus: "stylus",
  postcss: "postcss",
  vue: "vue",
  "vue-html": "vue-html",
  svelte: "svelte",
  astro: "astro",
  mdx: "mdx",
  marko: "marko",
  jinja: "jinja",
  liquid: "liquid",
  handlebars: "handlebars",
  twig: "twig",
  pug: "pug",
  haml: "haml",
  // Data formats
  json: "json",
  json5: "json5",
  jsonc: "jsonc",
  jsonl: "jsonl",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  csv: "csv",
  tsv: "tsv",
  graphql: "graphql",
  regexp: "regexp",
  // Shells
  bash: "shellscript",
  shell: "shellscript",
  shellscript: "shellscript",
  shellsession: "shellsession",
  powershell: "powershell",
  fish: "fish",
  nushell: "nushell",
  bat: "bat",
  // Systems / native
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  fsharp: "fsharp",
  "objective-c": "objective-c",
  "objective-cpp": "objective-cpp",
  rust: "rust",
  go: "go",
  zig: "zig",
  nim: "nim",
  crystal: "crystal",
  d: "d",
  v: "v",
  wasm: "wasm",
  wgsl: "wgsl",
  glsl: "glsl",
  hlsl: "hlsl",
  asm: "asm",
  mipsasm: "mipsasm",
  riscv: "riscv",
  // JVM
  java: "java",
  kotlin: "kotlin",
  scala: "scala",
  groovy: "groovy",
  clojure: "clojure",
  // Dynamic
  python: "python",
  ruby: "ruby",
  perl: "perl",
  lua: "lua",
  luau: "luau",
  php: "php",
  elixir: "elixir",
  erlang: "erlang",
  haskell: "haskell",
  ocaml: "ocaml",
  scheme: "scheme",
  racket: "racket",
  "common-lisp": "common-lisp",
  // Stats / scientific
  r: "r",
  julia: "julia",
  matlab: "matlab",
  sas: "sas",
  stata: "stata",
  // Mobile
  swift: "swift",
  dart: "dart",
  // Functional / niche
  elm: "elm",
  purescript: "purescript",
  gleam: "gleam",
  "fortran-free-form": "fortran-free-form",
  // Database
  sql: "sql",
  plsql: "plsql",
  cypher: "cypher",
  sparql: "sparql",
  // Smart contracts
  solidity: "solidity",
  vyper: "vyper",
  cairo: "cairo",
  move: "move",
  // Build / infra / config
  docker: "docker",
  terraform: "terraform",
  hcl: "hcl",
  nginx: "nginx",
  apache: "apache",
  ini: "ini",
  dotenv: "dotenv",
  prisma: "prisma",
  bicep: "bicep",
  make: "make",
  cmake: "cmake",
  "ssh-config": "ssh-config",
  systemd: "systemd",
  // VCS / patches / logs
  diff: "diff",
  log: "log",
  "git-commit": "git-commit",
  "git-rebase": "git-rebase",
  // Markup / docs
  md: "markdown",
  markdown: "markdown",
  asciidoc: "asciidoc",
  latex: "latex",
  tex: "tex",
  rst: "rst",
  bibtex: "bibtex",
  // Misc / scripting
  proto: "proto",
  applescript: "applescript",
  vb: "vb",
  kusto: "kusto",
};

// Grammar modules by Shiki language id: the languages in LANGS plus the ones
// their modules import. A module brings the grammars it embeds statically;
// `ensureLanguage` loads the ones it embeds by reference from this table.
// Only these grammars end up in the Worker bundle.
const GRAMMARS: Record<string, () => GrammarModule> = {
  apache: () => import("shiki/langs/apache.mjs"),
  applescript: () => import("shiki/langs/applescript.mjs"),
  asciidoc: () => import("shiki/langs/asciidoc.mjs"),
  asm: () => import("shiki/langs/asm.mjs"),
  astro: () => import("shiki/langs/astro.mjs"),
  bat: () => import("shiki/langs/bat.mjs"),
  bibtex: () => import("shiki/langs/bibtex.mjs"),
  bicep: () => import("shiki/langs/bicep.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cairo: () => import("shiki/langs/cairo.mjs"),
  clojure: () => import("shiki/langs/clojure.mjs"),
  cmake: () => import("shiki/langs/cmake.mjs"),
  "common-lisp": () => import("shiki/langs/common-lisp.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  "cpp-macro": () => import("shiki/langs/cpp-macro.mjs"),
  crystal: () => import("shiki/langs/crystal.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  csv: () => import("shiki/langs/csv.mjs"),
  cypher: () => import("shiki/langs/cypher.mjs"),
  d: () => import("shiki/langs/d.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  docker: () => import("shiki/langs/docker.mjs"),
  dotenv: () => import("shiki/langs/dotenv.mjs"),
  elixir: () => import("shiki/langs/elixir.mjs"),
  elm: () => import("shiki/langs/elm.mjs"),
  erlang: () => import("shiki/langs/erlang.mjs"),
  fish: () => import("shiki/langs/fish.mjs"),
  "fortran-free-form": () => import("shiki/langs/fortran-free-form.mjs"),
  fsharp: () => import("shiki/langs/fsharp.mjs"),
  "git-commit": () => import("shiki/langs/git-commit.mjs"),
  "git-rebase": () => import("shiki/langs/git-rebase.mjs"),
  gleam: () => import("shiki/langs/gleam.mjs"),
  glsl: () => import("shiki/langs/glsl.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  groovy: () => import("shiki/langs/groovy.mjs"),
  haml: () => import("shiki/langs/haml.mjs"),
  handlebars: () => import("shiki/langs/handlebars.mjs"),
  haskell: () => import("shiki/langs/haskell.mjs"),
  hcl: () => import("shiki/langs/hcl.mjs"),
  hlsl: () => import("shiki/langs/hlsl.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  "html-derivative": () => import("shiki/langs/html-derivative.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jinja: () => import("shiki/langs/jinja.mjs"),
  "jinja-html": () => import("shiki/langs/jinja-html.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  json5: () => import("shiki/langs/json5.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  jsonl: () => import("shiki/langs/jsonl.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  julia: () => import("shiki/langs/julia.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  kusto: () => import("shiki/langs/kusto.mjs"),
  latex: () => import("shiki/langs/latex.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  liquid: () => import("shiki/langs/liquid.mjs"),
  log: () => import("shiki/langs/log.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  luau: () => import("shiki/langs/luau.mjs"),
  make: () => import("shiki/langs/make.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  "markdown-vue": () => import("shiki/langs/markdown-vue.mjs"),
  marko: () => import("shiki/langs/marko.mjs"),
  matlab: () => import("shiki/langs/matlab.mjs"),
  mdx: () => import("shiki/langs/mdx.mjs"),
  mipsasm: () => import("shiki/langs/mipsasm.mjs"),
  move: () => import("shiki/langs/move.mjs"),
  nginx: () => import("shiki/langs/nginx.mjs"),
  nim: () => import("shiki/langs/nim.mjs"),
  nushell: () => import("shiki/langs/nushell.mjs"),
  "objective-c": () => import("shiki/langs/objective-c.mjs"),
  "objective-cpp": () => import("shiki/langs/objective-cpp.mjs"),
  ocaml: () => import("shiki/langs/ocaml.mjs"),
  perl: () => import("shiki/langs/perl.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  plsql: () => import("shiki/langs/plsql.mjs"),
  postcss: () => import("shiki/langs/postcss.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  prisma: () => import("shiki/langs/prisma.mjs"),
  proto: () => import("shiki/langs/proto.mjs"),
  pug: () => import("shiki/langs/pug.mjs"),
  purescript: () => import("shiki/langs/purescript.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  racket: () => import("shiki/langs/racket.mjs"),
  regexp: () => import("shiki/langs/regexp.mjs"),
  riscv: () => import("shiki/langs/riscv.mjs"),
  rst: () => import("shiki/langs/rst.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sas: () => import("shiki/langs/sas.mjs"),
  sass: () => import("shiki/langs/sass.mjs"),
  scala: () => import("shiki/langs/scala.mjs"),
  scheme: () => import("shiki/langs/scheme.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  shellsession: () => import("shiki/langs/shellsession.mjs"),
  solidity: () => import("shiki/langs/solidity.mjs"),
  sparql: () => import("shiki/langs/sparql.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  "ssh-config": () => import("shiki/langs/ssh-config.mjs"),
  stata: () => import("shiki/langs/stata.mjs"),
  stylus: () => import("shiki/langs/stylus.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  systemd: () => import("shiki/langs/systemd.mjs"),
  terraform: () => import("shiki/langs/terraform.mjs"),
  tex: () => import("shiki/langs/tex.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsv: () => import("shiki/langs/tsv.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  turtle: () => import("shiki/langs/turtle.mjs"),
  twig: () => import("shiki/langs/twig.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  v: () => import("shiki/langs/v.mjs"),
  vb: () => import("shiki/langs/vb.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  "vue-directives": () => import("shiki/langs/vue-directives.mjs"),
  "vue-html": () => import("shiki/langs/vue-html.mjs"),
  "vue-interpolations": () => import("shiki/langs/vue-interpolations.mjs"),
  "vue-sfc-style-variable-injection": () =>
    import("shiki/langs/vue-sfc-style-variable-injection.mjs"),
  vyper: () => import("shiki/langs/vyper.mjs"),
  wasm: () => import("shiki/langs/wasm.mjs"),
  wgsl: () => import("shiki/langs/wgsl.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  zig: () => import("shiki/langs/zig.mjs"),
};

// Author-facing shorthand → LANGS name. Authors write what they're used to
// from other ecosystems; we normalise on the way in. Anything not in this
// map is passed through verbatim and matched against LANGS.
const LANG_ALIASES: Record<string, string> = {
  // TS / JS family
  typescript: "ts",
  javascript: "js",
  node: "js",
  mjs: "js",
  cjs: "js",
  // C family
  "c#": "csharp",
  cs: "csharp",
  "f#": "fsharp",
  fs: "fsharp",
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  objc: "objective-c",
  objcpp: "objective-cpp",
  // Dynamic
  py: "python",
  rb: "ruby",
  pl: "perl",
  kt: "kotlin",
  // Shell
  sh: "bash",
  zsh: "bash",
  ksh: "bash",
  console: "shellsession",
  ps1: "powershell",
  ps: "powershell",
  cmd: "bat",
  batch: "bat",
  // Data
  yml: "yaml",
  toml: "toml",
  // Web
  htm: "html",
  svg: "xml",
  // Build / config
  dockerfile: "docker",
  hcl: "terraform",
  tf: "terraform",
  conf: "ini",
  env: "dotenv",
  // Docs / markup
  markdown: "md",
  tex: "latex",
  // Patches
  patch: "diff",
  // Misc
  protobuf: "proto",
  proto3: "proto",
  golang: "go",
  rs: "rust",
};

// Shiki's built-in plain-text language, which needs no grammar.
const PLAIN = "text";

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubLight, githubDark],
      langs: [],
      // `forgiving: true` — some bundled grammars (csharp, etc.) use Oniguruma
      // patterns the pure-JS engine can't compile (overlapping recursions).
      // Without forgiving, the whole grammar throws on first use and the doc
      // falls back to plain text. With forgiving, those patterns become
      // no-ops so the rest of the grammar still highlights the file —
      // mostly indistinguishable in output.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
    // A failed init shouldn't disable highlighting for the isolate's life.
    highlighterPromise.catch(() => {
      highlighterPromise = null;
    });
  }
  return highlighterPromise;
}

const hasGrammar = (id: string) => Object.prototype.hasOwnProperty.call(GRAMMARS, id);

// Shiki language id -> the ids its grammars embed by reference, once per
// isolate. Concurrent code blocks share the load.
const moduleLoads = new Map<string, Promise<string[]>>();

function loadModule(hl: HighlighterCore, id: string): Promise<string[]> {
  let load = moduleLoads.get(id);
  if (!load) {
    load = GRAMMARS[id]!().then(async ({ default: grammars }) => {
      await hl.loadLanguage(...grammars);
      return grammars.flatMap((g) => g.embeddedLangsLazy ?? []).filter(hasGrammar);
    });
    load.catch(() => moduleLoads.delete(id));
    moduleLoads.set(id, load);
  }
  return load;
}

// Loads a language's grammar, then every grammar it embeds by reference
// (HTML in Markdown, CSS in Vue) and theirs in turn. Embedded code then
// highlights the same whatever else the isolate has rendered.
async function ensureLanguage(hl: HighlighterCore, id: string): Promise<void> {
  const seen = new Set<string>();
  let pending = [id];
  while (pending.length) {
    pending.forEach((p) => seen.add(p));
    const embedded = await Promise.all(pending.map((p) => loadModule(hl, p)));
    pending = [...new Set(embedded.flat())].filter((p) => !seen.has(p));
  }
}

export interface CodeMeta {
  lang: string | null;
  filename?: string;
  highlightLines: Set<number>;
  focusLines: Set<number>;
  showLineNumbers: boolean;
}

const LINE_NUM_RE = /\{([\d,\-\s]+)\}/;
const FILENAME_RE = /\[([^\]]+)\]/;

function parseLineRanges(input: string): Set<number> {
  const out = new Set<number>();
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.split("-").map((n) => parseInt(n, 10));
    if (range.length === 1 && !Number.isNaN(range[0]!)) out.add(range[0]!);
    else if (range.length === 2 && !Number.isNaN(range[0]!) && !Number.isNaN(range[1]!)) {
      for (let i = range[0]!; i <= range[1]!; i++) out.add(i);
    }
  }
  return out;
}

export function parseCodeInfo(info: string): CodeMeta {
  // Examples:
  //   ts                          -> lang=ts
  //   ts {1,3-5}                  -> highlight lines
  //   ts:line-numbers             -> show line numbers
  //   ts [my-file.ts]             -> filename badge
  //   ts:line-numbers {2} [x.ts]
  let lang: string | null;
  let showLineNumbers = false;
  const tokens = info.split(/\s+/).filter(Boolean);
  if (tokens.length === 0)
    return {
      lang: null,
      highlightLines: new Set(),
      focusLines: new Set(),
      showLineNumbers: false,
    };
  const first = tokens.shift()!;
  // Support `ts:line-numbers` form.
  if (first.includes(":line-numbers")) {
    lang = first.split(":")[0]!;
    showLineNumbers = true;
  } else {
    lang = first;
  }

  let highlightLines = new Set<number>();
  const focusLines = new Set<number>();
  let filename: string | undefined;
  for (const tok of tokens) {
    const ln = tok.match(LINE_NUM_RE);
    if (ln) highlightLines = parseLineRanges(ln[1]!);
    const fn = tok.match(FILENAME_RE);
    if (fn) filename = fn[1]!;
    if (tok === "line-numbers") showLineNumbers = true;
  }
  return { lang, filename, highlightLines, focusLines, showLineNumbers };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Map an author-supplied language tag (`cs`, `c#`, `JSONC`, ...) to a Shiki
// language id from LANGS. Returns `"text"` when no match — that renders as
// monospace with no highlighting but never throws.
function resolveLang(raw: string | null): string {
  if (!raw) return PLAIN;
  const lower = raw.toLowerCase();
  const name = LANG_ALIASES[lower] ?? lower;
  return Object.prototype.hasOwnProperty.call(LANGS, name) ? LANGS[name]! : PLAIN;
}

export async function highlightCode(rawCode: string, info: string): Promise<string> {
  // Fence content always ends with a newline; Shiki turns it into a trailing
  // empty `.line`, which shows up as an extra blank row at the bottom of
  // every code block.
  const code = rawCode.replace(/\r?\n$/, "");
  const meta = parseCodeInfo(info);
  const id = resolveLang(meta.lang);
  let lang = PLAIN;

  let inner: string;
  try {
    const hl = await getHighlighter();
    if (id !== PLAIN) {
      try {
        await ensureLanguage(hl, id);
        lang = id;
      } catch (e) {
        console.error("[vellum] shiki grammar failed to load", { lang: id, err: String(e) });
      }
    }
    inner = hl.codeToHtml(code, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
      // defaultColor: 'light' (implicit) emits direct color styles for light theme and
      // --shiki-dark variables for dark. Using `false` (vars-only) was producing
      // monochrome output in the live page; sticking with the documented Shiki pattern.
      // `as any` because @shikijs/transformers and shiki currently resolve
      // to slightly different copies of @shikijs/types — same runtime shape,
      // structurally incompatible at the TS level. Safe to cast.
      transformers: [
        // Notation transformers turn comment annotations into class names:
        //   // [!code highlight]       — highlight this line
        //   // [!code ++] / [!code --] — diff add/remove
        //   // [!code focus]           — focus mode (dim everything else)
        //   // [!code error] / warning — error/warning markers
        //   // [!code word:foo]        — inline-highlight the word "foo"
        // The styling for the resulting classes lives in src/worker/ssr.tsx's
        // base CSS so the output works without client-side JS.
        transformerNotationDiff({ matchAlgorithm: "v3" }),
        transformerNotationHighlight({ matchAlgorithm: "v3" }),
        transformerNotationFocus({ matchAlgorithm: "v3" }),
        transformerNotationErrorLevel({ matchAlgorithm: "v3" }),
        transformerNotationWordHighlight({ matchAlgorithm: "v3" }),
        // `{1,3-5}` in the fence info — Shiki's own meta-string handler keeps
        // the existing `ts {1,3-5}` syntax working alongside our own.
        transformerMetaHighlight(),
        // Vellum-specific transforms: layer on the highlight-lines we parsed
        // from the fence info AND tag <pre> with our line-numbers class.
        {
          line(node: Element, line: number) {
            if (meta.highlightLines.has(line)) {
              this.addClassToHast(node, "vellum-line-highlight");
            }
            if (meta.showLineNumbers) {
              (node.properties as Record<string, string>)["data-line"] = String(line);
            }
          },
          pre(node: Element) {
            const props = node.properties as Record<string, string>;
            const cls = (props.class as string | undefined) ?? "";
            props.class =
              `${cls} vellum-code${meta.showLineNumbers ? " has-line-numbers" : ""}`.trim();
          },
        },
      ] as ShikiTransformer[],
    });
  } catch (e) {
    console.error("[vellum] shiki failure", {
      lang,
      info,
      err: (e as Error)?.stack ?? String(e),
    });
    inner = `<pre class="vellum-code"><code>${escapeHtml(code)}</code></pre>`;
  }

  const header =
    meta.filename || meta.lang
      ? `<div class="vellum-code-header">${
          meta.filename
            ? `<span class="vellum-code-filename">${escapeHtml(meta.filename)}</span>`
            : ""
        }${meta.lang ? `<span class="vellum-code-lang">${escapeHtml(meta.lang)}</span>` : ""}<button class="vellum-code-copy" data-copy type="button">Copy</button></div>`
      : `<button class="vellum-code-copy floating" data-copy type="button">Copy</button>`;

  return `<div class="vellum-code-block" data-code-block>${header}${inner}</div>`;
}

// Creates the highlighter ahead of the first code block.
export async function warmHighlighter(): Promise<void> {
  await getHighlighter();
}
