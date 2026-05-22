// GitHub Flavored Markdown alerts: > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
// Transforms the leading paragraph of a blockquote into a callout matching ::: containers.

import type MarkdownIt from "markdown-it";

const ALERT_TYPES = new Set(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]);

export function applyGithubAlerts(md: MarkdownIt): void {
  md.core.ruler.after("block", "github-alerts", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i]!.type !== "blockquote_open") continue;
      // Find the first inline token.
      const inlineIdx = tokens.slice(i).findIndex((t) => t.type === "inline");
      if (inlineIdx < 0) continue;
      const inline = tokens[i + inlineIdx];
      if (!inline || !inline.content) continue;
      const m = inline.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?([\s\S]*)$/);
      if (!m || !ALERT_TYPES.has(m[1]!)) continue;
      const kind = m[1]!.toLowerCase();
      const rest = m[2] ?? "";
      // Rewrite this blockquote into a callout div.
      tokens[i]!.type = "html_block";
      (tokens[i] as any).content =
        `<div class="vellum-callout vellum-callout-${kind}" data-callout="${kind}"><p class="vellum-callout-title">${m[1]}</p>\n`;
      (tokens[i] as any).block = true;
      (tokens[i] as any).tag = "";
      // Replace the leading inline content with the remainder.
      inline.content = rest;
      if (inline.children && inline.children.length) {
        // Strip the bracketed marker token from children if it's there.
        const firstText = inline.children[0];
        if (firstText && firstText.type === "text") {
          firstText.content = firstText.content.replace(
            /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i,
            "",
          );
        }
      }
      // Find the matching blockquote_close.
      let depth = 1;
      let j = i + 1;
      for (; j < tokens.length; j++) {
        if (tokens[j]!.type === "blockquote_open") depth++;
        else if (tokens[j]!.type === "blockquote_close") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j < tokens.length) {
        tokens[j]!.type = "html_block";
        (tokens[j] as any).content = "</div>\n";
        (tokens[j] as any).block = true;
        (tokens[j] as any).tag = "";
      }
    }
    return false;
  });
}
