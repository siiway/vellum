// Shiki-based code highlighting that runs in the Worker.
// We use a singleton highlighter so cold starts only initialize it once,
// and only the languages we actually need are bundled.
//
// Engine choice: the default Oniguruma engine ships as a WASM module and instantiates
// it via `WebAssembly.instantiate` — which Cloudflare Workers blocks at runtime
// ("Wasm code generation disallowed by embedder"). Using the pure-JS regex engine
// avoids that path entirely. It's marginally less accurate on a handful of exotic
// TextMate patterns; for the languages we ship it's indistinguishable in output.

import {
  getSingletonHighlighter,
  type HighlighterGeneric,
  type BundledLanguage,
  type BundledTheme,
} from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationFocus,
  transformerNotationErrorLevel,
  transformerNotationWordHighlight,
  transformerMetaHighlight,
} from "@shikijs/transformers";

// Comprehensive bundled-language set. Each grammar adds a few KB to the
// worker bundle, but for a docs platform that has to render *whatever* an
// author writes, narrow lists are the worse trade. Categories rather than
// alphabetical so adding new ones stays straightforward.
const LANGS: BundledLanguage[] = [
  // Web — TS/JS family
  "ts",
  "tsx",
  "js",
  "jsx",
  // Web — markup / templating
  "html",
  "css",
  "scss",
  "sass",
  "less",
  "stylus",
  "postcss",
  "vue",
  "vue-html",
  "svelte",
  "astro",
  "mdx",
  "marko",
  "jinja",
  "liquid",
  "handlebars",
  "twig",
  "pug",
  "haml",
  // Data formats
  "json",
  "json5",
  "jsonc",
  "jsonl",
  "yaml",
  "toml",
  "xml",
  "csv",
  "tsv",
  "graphql",
  "regexp",
  // Shells
  "bash",
  "shell",
  "shellscript",
  "shellsession",
  "powershell",
  "fish",
  "nushell",
  "bat",
  // Systems / native
  "c",
  "cpp",
  "csharp",
  "fsharp",
  "objective-c",
  "objective-cpp",
  "rust",
  "go",
  "zig",
  "nim",
  "crystal",
  "d",
  "v",
  "wasm",
  "wgsl",
  "glsl",
  "hlsl",
  "asm",
  "mipsasm",
  "riscv",
  // JVM
  "java",
  "kotlin",
  "scala",
  "groovy",
  "clojure",
  // Dynamic
  "python",
  "ruby",
  "perl",
  "lua",
  "luau",
  "php",
  "elixir",
  "erlang",
  "haskell",
  "ocaml",
  "scheme",
  "racket",
  "common-lisp",
  // Stats / scientific
  "r",
  "julia",
  "matlab",
  "sas",
  "stata",
  // Mobile
  "swift",
  "dart",
  // Functional / niche
  "elm",
  "purescript",
  "gleam",
  "fortran-free-form",
  // Database
  "sql",
  "plsql",
  "cypher",
  "sparql",
  // Smart contracts
  "solidity",
  "vyper",
  "cairo",
  "move",
  // Build / infra / config
  "docker",
  "terraform",
  "hcl",
  "nginx",
  "apache",
  "ini",
  "dotenv",
  "prisma",
  "bicep",
  "make",
  "cmake",
  "ssh-config",
  "systemd",
  // VCS / patches / logs
  "diff",
  "log",
  "git-commit",
  "git-rebase",
  // Markup / docs
  "md",
  "markdown",
  "asciidoc",
  "latex",
  "tex",
  "rst",
  "bibtex",
  // Misc / scripting
  "proto",
  "applescript",
  "vb",
  "kusto",
];

const THEMES: BundledTheme[] = ["github-light", "github-dark"];

// Author-facing shorthand → canonical Shiki language id. Authors write what
// they're used to from other ecosystems; we normalise on the way in. Anything
// not in this map is passed through verbatim and matched against LANGS.
const LANG_ALIASES: Record<string, BundledLanguage> = {
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
  // Plain text
  text: "txt" as BundledLanguage,
  plain: "txt" as BundledLanguage,
  plaintext: "txt" as BundledLanguage,
};

let highlighterPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = getSingletonHighlighter({
      themes: THEMES,
      langs: LANGS,
      // `forgiving: true` — some bundled grammars (csharp, etc.) use Oniguruma
      // patterns the pure-JS engine can't compile (overlapping recursions).
      // Without forgiving, the whole grammar throws on first use and the doc
      // falls back to plain text. With forgiving, those patterns become
      // no-ops so the rest of the grammar still highlights the file —
      // mostly indistinguishable in output.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return highlighterPromise;
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
// language id we actually loaded. Returns `"text"` when no match — that
// renders as monospace with no highlighting but never throws.
function resolveLang(raw: string | null): BundledLanguage {
  if (!raw) return "text" as BundledLanguage;
  const lower = raw.toLowerCase();
  const aliased = LANG_ALIASES[lower];
  if (aliased && (LANGS as string[]).includes(aliased)) return aliased;
  if ((LANGS as string[]).includes(lower)) return lower as BundledLanguage;
  return "text" as BundledLanguage;
}

export async function highlightCode(code: string, info: string): Promise<string> {
  const meta = parseCodeInfo(info);
  const lang = resolveLang(meta.lang);

  let inner: string;
  try {
    const hl = await getHighlighter();
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
          line(node: any, line: number) {
            if (meta.highlightLines.has(line)) {
              this.addClassToHast(node, "vellum-line-highlight");
            }
            if (meta.showLineNumbers) {
              (node.properties as Record<string, string>)["data-line"] = String(line);
            }
          },
          pre(node: any) {
            const props = node.properties as Record<string, string>;
            const cls = (props.class as string | undefined) ?? "";
            props.class =
              `${cls} vellum-code${meta.showLineNumbers ? " has-line-numbers" : ""}`.trim();
          },
        },
      ] as any,
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

// Preload the highlighter once we know which languages a page uses.
// Currently we eagerly init the singleton; future optimization: per-request narrowing.
export async function warmHighlighter(): Promise<void> {
  await getHighlighter();
}
