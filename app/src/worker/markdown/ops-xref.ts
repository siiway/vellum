// OPS xref inline syntax. Two forms:
//
//   <xref:System.Console.WriteLine>             -- displays the resolved name
//   [Console](xref:System.Console)              -- displays the link text
//
// Resolution is done by the host (worker) via a per-repo xrefmap (typically
// xrefmap.yml at the docs root, format documented at
// https://dotnet.github.io/docfx/docs/links-and-cross-references.html).
// When the host hasn't loaded a map or the uid is unresolved, the renderer
// falls back to monospace text so the document still reads.

import type MarkdownIt from "markdown-it";

const XREF_AUTO_RE = /^xref:([^\s<>"]+)>/i;

export function applyOpsXref(md: MarkdownIt): void {
  // Inline rule: detect `<xref:...>` autolinks. markdown-it's autolink rule
  // would reject these (no scheme like http: or mailto:), so we run before it.
  md.inline.ruler.before("autolink", "ops-xref-auto", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const rest = state.src.slice(state.pos + 1);
    const m = rest.match(XREF_AUTO_RE);
    if (!m) return false;
    if (silent) return true;
    const token = state.push("ops_xref", "", 0);
    token.meta = { target: m[1]!, display: undefined };
    // +2 for the surrounding `<` and `>`.
    state.pos += m[0].length + 1;
    return true;
  });

  // Normalize already-parsed `link_open` tokens whose href is `xref:...` into
  // ops_xref tokens carrying the link text as display.
  md.core.ruler.after("inline", "ops-xref-link", (state) => {
    for (const blockTok of state.tokens) {
      if (blockTok.type !== "inline" || !blockTok.children) continue;
      const children = blockTok.children;
      const out: typeof children = [];
      for (let i = 0; i < children.length; i++) {
        const tok = children[i]!;
        if (tok.type === "link_open") {
          const href = tok.attrGet("href") ?? "";
          if (href.toLowerCase().startsWith("xref:")) {
            // Collect text up to matching link_close.
            const target = href.slice("xref:".length);
            let display = "";
            let j = i + 1;
            for (; j < children.length; j++) {
              if (children[j]!.type === "link_close") break;
              if (children[j]!.type === "text") display += children[j]!.content;
            }
            const xref = new state.Token("ops_xref", "", 0);
            xref.meta = { target, display: display || undefined };
            out.push(xref);
            i = j; // jump past link_close
            continue;
          }
        }
        out.push(tok);
      }
      blockTok.children = out;
    }
    return true;
  });
}
