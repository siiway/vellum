// VitePress-style custom containers: ::: tip / ::: warning / ::: danger /
// ::: info / ::: note / ::: caution / ::: important / ::: details / ::: code-group.
//
// Unlike markdown-it-container (which just forward-scans for the next `:::`
// regardless of nesting), this parser counts depth across all known container
// names so different-type nesting works without the more-colons workaround:
//
//   ::: details Show nested example
//   ::: warning
//     content
//   :::
//   :::
//
// renders as a details containing a warning, not as a details with a stray `:::`
// floating after it. Same-type nesting also works; arbitrary marker counts
// (`::::` etc.) work too as long as opens and closes use the same count.
//
// We emit the same `container_<name>_open` / `container_<name>_close` token
// types that markdown-it-container does, so the AST builder didn't need to
// change. The render functions also match the old shape so tests / cached
// HTML keep their structure.

import type MarkdownIt from "markdown-it";

type ContainerKind =
  | "tip"
  | "info"
  | "note"
  | "warning"
  | "danger"
  | "caution"
  | "important"
  | "details"
  | "code-group";

const NAMES: readonly ContainerKind[] = [
  "tip",
  "info",
  "note",
  "warning",
  "danger",
  "caution",
  "important",
  "details",
  "code-group",
];
const NAME_SET = new Set<string>(NAMES);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function defaultTitle(type: ContainerKind): string {
  switch (type) {
    case "tip":
      return "TIP";
    case "info":
      return "INFO";
    case "note":
      return "NOTE";
    case "warning":
      return "WARNING";
    case "danger":
      return "DANGER";
    case "caution":
      return "CAUTION";
    case "important":
      return "IMPORTANT";
    case "details":
      return "Details";
    case "code-group":
      return "";
  }
}

interface OpenHead {
  name: string;
  title: string;
  markerCount: number;
}

// Returns the parsed head of an open marker (`:::name [title]`), or null when
// the line isn't an open. The line is the trimmed source between the line's
// start and its end-of-line.
function parseOpen(line: string): OpenHead | null {
  let i = 0;
  while (i < line.length && line.charCodeAt(i) === 0x3a /* : */) i++;
  if (i < 3) return null;
  const markerCount = i;
  const rest = line.slice(i).trim();
  if (!rest) return null;
  const m = rest.match(/^([a-z][a-z0-9-]*)\s*(.*)$/);
  if (!m) return null;
  const name = m[1]!;
  if (!NAME_SET.has(name)) return null;
  return { name, title: m[2] ?? "", markerCount };
}

// Returns the close marker count when the line is a pure `:::` (or `::::`),
// or null when it isn't a close. Trailing whitespace is allowed; trailing
// non-space content disqualifies the line as a closer.
function parseClose(line: string): number | null {
  let i = 0;
  while (i < line.length && line.charCodeAt(i) === 0x3a) i++;
  if (i < 3) return null;
  const tail = line.slice(i).trim();
  if (tail.length > 0) return null;
  return i;
}

export function applyContainers(md: MarkdownIt): void {
  md.block.ruler.before("paragraph", "vellum-containers", containerRule, {
    alt: ["paragraph", "blockquote", "list"],
  });

  // Renderers preserve the legacy HTML so anything downstream that scrapes
  // the output (the markdown-as-html test helpers, the AST builder's html_block
  // GFM-alert detector) sees the same shape.
  for (const name of NAMES) {
    if (name === "code-group") continue;
    md.renderer.rules[`container_${name}_open`] = (tokens, idx) => {
      const tok = tokens[idx]!;
      const title = (tok.info || "").trim() || defaultTitle(name as ContainerKind);
      if (name === "details") {
        return `<details class="vellum-callout vellum-callout-details"><summary>${escapeHtml(title)}</summary>\n`;
      }
      return `<div class="vellum-callout vellum-callout-${name}" data-callout="${name}"><p class="vellum-callout-title">${escapeHtml(title)}</p>\n`;
    };
    md.renderer.rules[`container_${name}_close`] = () =>
      name === "details" ? "</details>\n" : "</div>\n";
  }

  // code-group needs special inner-fence handling. The AST builder iterates
  // the inner fence tokens to build tabs, so the render output here is only
  // used by hypothetical HTML consumers — keep it for symmetry. Bracket
  // notation because the token type has a hyphen.
  md.renderer.rules["container_code-group_open"] = () =>
    `<div class="vellum-codegroup" data-codegroup>\n`;
  md.renderer.rules["container_code-group_close"] = () => `</div>\n`;
}

function containerRule(state: any, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  // Fast reject: first char must be ':' (0x3a).
  if (state.src.charCodeAt(start) !== 0x3a) return false;

  const line = state.src.slice(start, max);
  const head = parseOpen(line);
  if (!head) return false;

  if (silent) return true;

  // Find matching close at the same marker count. Depth tracking lets nested
  // same-marker-count containers (even of different types) close cleanly.
  // Containers using a different marker count nest inside or outside this one
  // without interfering — they're handled by their own invocation of this rule.
  let depth = 1;
  let closeLine = startLine + 1;
  for (; closeLine < endLine; closeLine++) {
    const cStart = state.bMarks[closeLine] + state.tShift[closeLine];
    const cMax = state.eMarks[closeLine];
    if (state.src.charCodeAt(cStart) !== 0x3a) continue;
    const cLine = state.src.slice(cStart, cMax);

    const close = parseClose(cLine);
    if (close !== null) {
      if (close === head.markerCount) {
        depth--;
        if (depth === 0) break;
      }
      continue;
    }

    const open = parseOpen(cLine);
    if (open && open.markerCount === head.markerCount) {
      depth++;
    }
  }

  // Unclosed container: fall through so the author sees their broken syntax
  // rendered verbatim rather than swallowed.
  if (depth !== 0 || closeLine >= endLine) return false;

  const openTokenType = `container_${head.name}_open`;
  const closeTokenType = `container_${head.name}_close`;
  const openToken = state.push(openTokenType, "div", 1);
  openToken.markup = ":".repeat(head.markerCount);
  openToken.block = true;
  openToken.info = head.title;
  openToken.map = [startLine, closeLine];

  // Pre-parse the title as inline markdown and attach the resulting token list
  // via meta so the AST builder can lift it into Inline[]. Lets authors write
  // `::: tip Heads `up`` and have the backticks become an inline code span
  // instead of leaking as literal characters in the rendered summary / title.
  if (head.title) {
    const parsed = state.md.parseInline(head.title, state.env)[0]?.children ?? [];
    (openToken as any).meta = { titleTokens: parsed };
  }

  // Recursively tokenize the inner range. Nested containers will hit this same
  // rule and be handled identically.
  state.md.block.tokenize(state, startLine + 1, closeLine);

  const closeToken = state.push(closeTokenType, "div", -1);
  closeToken.markup = ":".repeat(head.markerCount);
  closeToken.block = true;

  state.line = closeLine + 1;
  return true;
}
