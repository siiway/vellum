// DocFX-style tabs. Syntax:
//
//   # [Windows](#tab/windows)
//   instructions for windows
//
//   # [macOS](#tab/macos)
//   instructions for macos
//
//   # [Linux](#tab/linux/optional-condition)
//   instructions for linux
//
//   ---
//
// A tab group is detected when consecutive same-level headings all carry a
// `#tab/<id>` href. The group ends at a `---` thematic break, a heading whose
// link isn't `#tab/...`, or end of document.
//
// We rewrite the consumed heading + paragraph tokens into a single synthetic
// `ops_tabs` token whose `meta` holds the parsed tab list. The AST builder
// turns each tab's inner tokens into its own Block[] tree.

import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

interface Tab {
  id: string;
  title: string;
  // Token range, exclusive end, in the original tokens array.
  innerStart: number;
  innerEnd: number;
}

// Match: # [Title](#tab/id)  or  # [Title](#tab/id/condition)
// We tolerate any heading level (DocFX accepts H1..H3), as long as every tab
// in the group uses the same level.
function readTabHeading(
  tokens: Token[],
  i: number,
): { level: number; id: string; title: string } | null {
  const open = tokens[i];
  if (!open || !open.type.match(/^heading_open$/)) return null;
  const inline = tokens[i + 1];
  const close = tokens[i + 2];
  if (!inline || inline.type !== "inline" || !close || close.type !== "heading_close") return null;

  const children = inline.children ?? [];
  // Expect link_open, text, link_close exactly.
  if (children.length < 3) return null;
  const linkOpen = children[0];
  const text = children[1];
  const linkClose = children[2];
  if (
    !linkOpen ||
    linkOpen.type !== "link_open" ||
    !text ||
    text.type !== "text" ||
    !linkClose ||
    linkClose.type !== "link_close"
  )
    return null;

  const href = linkOpen.attrGet("href") ?? "";
  const m = href.match(/^#tab\/([A-Za-z0-9_-]+)(?:\/.*)?$/);
  if (!m) return null;

  const level = parseInt(open.tag.slice(1), 10);
  return { level, id: m[1]!, title: text.content };
}

export function applyOpsTabs(md: MarkdownIt): void {
  // after("inline"), not after("block"): the inline phase populates each
  // inline token's `children`. readTabHeading inspects those children to find
  // the `[Title](#tab/id)` link, so running before inline runs would mean we
  // see empty children and bail on every page.
  md.core.ruler.after("inline", "ops-tabs", (state) => {
    const tokens = state.tokens;
    const out: Token[] = [];
    let i = 0;
    while (i < tokens.length) {
      const head = readTabHeading(tokens, i);
      if (!head) {
        out.push(tokens[i]!);
        i++;
        continue;
      }

      // Collect a run of tabs at the same heading level.
      const tabs: Tab[] = [];
      let cursor = i;
      let groupEnd = i;

      while (cursor < tokens.length) {
        const h = readTabHeading(tokens, cursor);
        if (!h || h.level !== head.level) break;
        const innerStart = cursor + 3; // skip heading_open, inline, heading_close
        // Inner end = next tab heading at same level OR `---` (hr) OR EOF.
        let innerEnd = innerStart;
        while (innerEnd < tokens.length) {
          const nextTab = readTabHeading(tokens, innerEnd);
          if (nextTab && nextTab.level === head.level) break;
          if (tokens[innerEnd]!.type === "hr") break;
          innerEnd++;
        }
        tabs.push({ id: h.id, title: h.title, innerStart, innerEnd });
        cursor = innerEnd;
        groupEnd = innerEnd;
        // Consume the terminating `---` if present so it doesn't render under
        // the tab group.
        if (cursor < tokens.length && tokens[cursor]!.type === "hr") {
          groupEnd = cursor + 1;
          break;
        }
      }

      if (tabs.length < 2) {
        // Single tab isn't really a tab group — leave the heading as-is.
        out.push(tokens[i]!);
        i++;
        continue;
      }

      // Emit one synthetic `ops_tabs` token carrying the inner token slices.
      const tabToken = new state.Token("ops_tabs", "", 0);
      tabToken.block = true;
      tabToken.map = [tokens[i]!.map?.[0] ?? 0, tokens[groupEnd - 1]!.map?.[1] ?? 0];
      tabToken.meta = {
        tabs: tabs.map((t) => ({
          id: t.id,
          title: t.title,
          // Slice the original token range. The AST builder runs its parser
          // over each slice to produce a Block[] tree per tab.
          innerTokens: tokens.slice(t.innerStart, t.innerEnd),
        })),
      };
      out.push(tabToken);

      i = groupEnd;
    }

    state.tokens = out;
    return true;
  });
}
