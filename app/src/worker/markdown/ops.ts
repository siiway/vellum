// Microsoft OPS / Learn triple-colon block extensions.
//
// Syntax overview:
//   :::image source="img.png" alt-text="..." type="content":::         (self-closing)
//   :::video source="https://youtu.be/...":::                          (self-closing)
//   :::row:::
//     :::column span="2":::
//       inner markdown
//     :::column-end:::
//   :::row-end:::
//   :::zone pivot="csharp,fsharp":::    ... :::zone-end:::
//   :::moniker range=">=v2.0":::         ... :::moniker-end:::
//
// Unlike markdown-it-container (which uses bare `:::` for close), OPS uses
// `:::name-end:::` so the close marker is unambiguous when blocks nest.
// We emit our own token types (`ops_image`, `ops_row_open`/`ops_row_close`,
// etc.) that the AST builder consumes.

import type MarkdownIt from "markdown-it";

const SELF_CLOSING = new Set(["image", "video"]);
const PAIRED = new Set(["row", "column", "zone", "moniker"]);
const PAIRED_ENDS = new Set([...PAIRED].map((n) => `${n}-end`));
const ALL_NAMES = new Set([...SELF_CLOSING, ...PAIRED, ...PAIRED_ENDS]);

interface ParsedHead {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
}

// Parse `:::name key="value" ...:::?` from a single line. Returns null if the
// line is not a recognized OPS triple-colon opener.
function parseHead(line: string): ParsedHead | null {
  if (!line.startsWith(":::")) return null;
  const body = line.slice(3).trim();
  if (!body) return null;

  // `:::row-end:::` is a closer, not an opener — but we still parse it so the
  // outer rule can decide what to do (we only emit close tokens for these).
  const nameMatch = body.match(/^([a-z][a-z0-9-]*)/);
  if (!nameMatch) return null;
  const name = nameMatch[1]!;
  if (!ALL_NAMES.has(name)) return null;

  let rest = body.slice(name.length);
  // Strip the optional trailing `:::` for self-closing forms.
  let selfClosing = false;
  if (rest.trimEnd().endsWith(":::")) {
    rest = rest.trimEnd().slice(0, -3);
    selfClosing = true;
  }

  const attrs: Record<string, string> = {};
  // Match key="value" and key='value' attribute pairs.
  const re = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    attrs[m[1]!] = m[2] ?? m[3] ?? "";
  }

  return { name, attrs, selfClosing };
}

export function applyOpsTripleColon(md: MarkdownIt): void {
  md.block.ruler.before(
    "paragraph",
    "ops-triple-colon",
    (state, startLine, endLine, silent) => {
      const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
      const max = state.eMarks[startLine]!;
      // Fast reject: must start with ':' (0x3a).
      if (state.src.charCodeAt(pos) !== 0x3a) return false;

      const line = state.src.slice(pos, max);
      const head = parseHead(line);
      if (!head) return false;

      // A bare closer (e.g. `:::row-end:::`) at top level is malformed — the
      // matching open should have already swallowed it. Bail so the line is
      // rendered as a paragraph, which signals the error to the author.
      if (PAIRED_ENDS.has(head.name)) return false;

      if (silent) return true;

      // Self-closing leaf nodes (image, video). Emit a single token carrying
      // the parsed attrs in `meta`; the AST builder turns it into the right
      // block type.
      if (SELF_CLOSING.has(head.name)) {
        if (!head.selfClosing) {
          // image/video without trailing `:::` — treat as malformed.
          return false;
        }
        const token = state.push(`ops_${head.name}`, "", 0);
        token.meta = head.attrs;
        token.map = [startLine, startLine + 1];
        token.block = true;
        state.line = startLine + 1;
        return true;
      }

      // Paired block (row/column/zone/moniker). Find the matching :::name-end:::
      // line, accounting for nested same-name blocks.
      const openMarker = `:::${head.name}`;
      const closeMarker = `:::${head.name}-end:::`;
      let depth = 1;
      let closeLine = startLine + 1;
      for (; closeLine < endLine; closeLine++) {
        const cPos = state.bMarks[closeLine]! + state.tShift[closeLine]!;
        const cMax = state.eMarks[closeLine]!;
        const cLine = state.src.slice(cPos, cMax).trim();
        if (cLine === closeMarker) {
          depth--;
          if (depth === 0) break;
        } else if (
          cLine.startsWith(openMarker) &&
          (cLine[openMarker.length] === " " || cLine === openMarker || cLine === `${openMarker}:::`)
        ) {
          // Only treat as a nested open if it's not the `-end` line (we already
          // checked closeMarker above) and the next char is whitespace or end —
          // i.e. don't treat `:::row-end:::` as nested when looking for `:::row`.
          depth++;
        }
      }
      // Unclosed block — fall back to rendering as paragraph so the author sees
      // their broken syntax verbatim rather than a silent disappearance.
      if (closeLine >= endLine || depth !== 0) return false;

      const openToken = state.push(`ops_${head.name}_open`, "", 1);
      openToken.meta = head.attrs;
      openToken.map = [startLine, closeLine + 1];
      openToken.block = true;

      // Recursively tokenize the inner range. markdown-it's tokenizer will run
      // the same rule for nested `:::` blocks; they were already counted into
      // `depth` above so the boundaries line up.
      state.md.block.tokenize(state, startLine + 1, closeLine);

      const closeToken = state.push(`ops_${head.name}_close`, "", -1);
      closeToken.block = true;
      closeToken.map = [closeLine, closeLine + 1];

      state.line = closeLine + 1;
      return true;
    },
    { alt: ["paragraph", "blockquote", "list"] },
  );
}
