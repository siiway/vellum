// OPS INCLUDE and code-include directives.
//
//   [!INCLUDE [label](path/to/file.md)]
//   [!code-csharp[label](path/to/file.cs)]
//   [!code-csharp[label](path/to/file.cs?range=10-20&highlight=2)]
//   [!code-csharp[label](path/to/file.cs#regionname)]
//   [!code-csharp[label](path/to/file.cs?start=10&end=20)]
//
// We detect both as block-level lines (the most common form in OPS docs is one
// directive per line). Each emits a placeholder token; the AST builder fetches
// the referenced file via the host-provided `fetchInclude` callback and splices
// the result into the tree.

import type MarkdownIt from "markdown-it";

// `[!INCLUDE [label](path)]` — label is informational, only the path matters.
const INCLUDE_RE = /^\[!INCLUDE\s+\[[^\]]*\]\(([^)]+)\)\]\s*$/i;

// `[!code-<lang>[label](path)]` — lang ends up on the fence info string.
const CODE_INCLUDE_RE = /^\[!code-([a-zA-Z0-9_+-]+)\[[^\]]*\]\(([^)]+)\)\]\s*$/;

export interface CodeIncludeMeta {
  path: string;
  lang: string;
  range?: string; // "10-20" or "10-20,30-40"
  highlight?: string; // "2" or "2-3,5"
  region?: string; // "#regionname" or ?region=name
  start?: string;
  end?: string;
  filename?: string;
}

function parseCodeIncludeUrl(rawUrl: string): {
  path: string;
  opts: Omit<CodeIncludeMeta, "path" | "lang">;
} {
  let path = rawUrl;
  let region: string | undefined;
  const opts: Omit<CodeIncludeMeta, "path" | "lang"> = {};

  // Extract `#regionname` first.
  const hashIdx = path.indexOf("#");
  if (hashIdx >= 0) {
    region = path.slice(hashIdx + 1) || undefined;
    path = path.slice(0, hashIdx);
  }

  // Extract `?key=value&...`.
  const qIdx = path.indexOf("?");
  if (qIdx >= 0) {
    const q = path.slice(qIdx + 1);
    path = path.slice(0, qIdx);
    for (const pair of q.split("&")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const k = decodeURIComponent(pair.slice(0, eq));
      const v = decodeURIComponent(pair.slice(eq + 1));
      switch (k) {
        case "range":
          opts.range = v;
          break;
        case "highlight":
          opts.highlight = v;
          break;
        case "region":
          opts.region = v;
          break;
        case "start":
          opts.start = v;
          break;
        case "end":
          opts.end = v;
          break;
        case "filename":
          opts.filename = v;
          break;
      }
    }
  }

  if (region && !opts.region) opts.region = region;
  return { path, opts };
}

export function applyOpsIncludes(md: MarkdownIt): void {
  md.block.ruler.before("paragraph", "ops-includes", (state, startLine, _endLine, silent) => {
    const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
    const max = state.eMarks[startLine]!;
    // Fast reject: must start with `[`.
    if (state.src.charCodeAt(pos) !== 0x5b) return false;

    const line = state.src.slice(pos, max).trim();

    const incl = line.match(INCLUDE_RE);
    if (incl) {
      if (silent) return true;
      const token = state.push("ops_include", "", 0);
      token.meta = { path: incl[1]!.trim() };
      token.map = [startLine, startLine + 1];
      token.block = true;
      state.line = startLine + 1;
      return true;
    }

    const code = line.match(CODE_INCLUDE_RE);
    if (code) {
      if (silent) return true;
      const lang = code[1]!;
      const { path, opts } = parseCodeIncludeUrl(code[2]!.trim());
      const token = state.push("ops_code_include", "", 0);
      const meta: CodeIncludeMeta = { path, lang, ...opts };
      token.meta = meta;
      token.map = [startLine, startLine + 1];
      token.block = true;
      state.line = startLine + 1;
      return true;
    }

    return false;
  });
}

// Slice a fetched source file according to range / region / start / end specs.
// Returns the lines that should appear in the rendered snippet, plus an
// optional starting-line-number offset so highlight indices align with the
// original file.
export function extractCodeSlice(
  source: string,
  opts: {
    range?: string;
    highlight?: string;
    region?: string;
    start?: string;
    end?: string;
  },
): { code: string; offset: number; highlightLines: number[] } {
  const lines = source.split(/\r?\n/);
  let selected: number[] = []; // 1-indexed line numbers we keep
  let offset = 1;

  if (opts.region) {
    // Three region marker styles are honoured (matching what DocFX accepts):
    //   #region NAME ... #endregion           (C# preprocessor, also used in F#/VB)
    //   // <NAME> ... // </NAME>              (DocFX "snippet" markers, generic)
    //   // <region name="NAME"> ... </region> (DocFX explicit-attribute form)
    // We try each pattern in order; the first that yields a non-empty range
    // wins. The markers themselves are stripped from the output.
    const region = findRegion(lines, opts.region);
    if (region) {
      selected = region.lines;
      offset = region.startLine;
    }
  } else if (opts.range) {
    selected = expandRanges(opts.range, lines.length);
    if (selected.length > 0) offset = selected[0]!;
  } else if (opts.start || opts.end) {
    const s = opts.start ? Math.max(1, parseInt(opts.start, 10)) : 1;
    const e = opts.end ? Math.min(lines.length, parseInt(opts.end, 10)) : lines.length;
    for (let i = s; i <= e; i++) selected.push(i);
    offset = s;
  } else {
    for (let i = 1; i <= lines.length; i++) selected.push(i);
  }

  const out = selected.map((n) => lines[n - 1] ?? "").join("\n");
  const dedented = dedent(out);
  const highlightLines = opts.highlight ? expandRanges(opts.highlight, selected.length) : [];
  return { code: dedented, offset, highlightLines };
}

// Returns the 1-indexed line numbers inside a named region, plus the offset
// (1-indexed line number of the first line of the region in the original
// file). Tries C# `#region`, then DocFX `// <NAME>`, then DocFX
// `// <region name="NAME">` styles. Returns null when no marker pair was
// found.
function findRegion(
  lines: string[],
  regionName: string,
): { lines: number[]; startLine: number } | null {
  const name = escapeRe(regionName);
  const patterns: Array<{ start: RegExp; end: RegExp }> = [
    { start: new RegExp(`#\\s*region\\s+${name}\\b`), end: /#\s*endregion\b/ },
    { start: new RegExp(`<${name}>`), end: new RegExp(`</${name}>`) },
    {
      start: new RegExp(`<region\\s+name=["']${name}["']\\s*/?>`),
      end: /<\/region>/,
    },
  ];
  for (const p of patterns) {
    let regionStart = -1;
    const collected: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (regionStart < 0 && p.start.test(line)) {
        regionStart = i;
        continue;
      }
      if (regionStart >= 0 && p.end.test(line)) {
        // Found a complete pair. Return immediately so a later (unrelated)
        // pair with the same name doesn't clobber this match.
        return { lines: collected, startLine: regionStart + 2 };
      }
      if (regionStart >= 0) collected.push(i + 1);
    }
  }
  return null;
}

function expandRanges(spec: string, max: number): number[] {
  const out: number[] = [];
  for (const part of spec.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = parseInt(m[1]!, 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    for (let i = a; i <= Math.min(b, max); i++) out.push(i);
  }
  return out;
}

function dedent(s: string): string {
  const lines = s.split("\n");
  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^[ \t]*/);
    minIndent = Math.min(minIndent, m ? m[0].length : 0);
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) return s;
  return lines.map((l) => l.slice(minIndent)).join("\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
