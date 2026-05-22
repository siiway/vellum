// Header anchors + outline extraction.
// We don't reuse markdown-it-anchor because we want to deterministically derive slugs
// and capture them in a sidecar list during render for the right-hand outline.

import type MarkdownIt from "markdown-it";
import type { OutlineNode } from "../../shared/types";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9一-龥\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function applyAnchorsAndOutline(md: MarkdownIt, sink: { outline: OutlineNode[] }) {
  const slugCounts = new Map<string, number>();

  md.core.ruler.after("inline", "vellum-anchors", (state) => {
    sink.outline.length = 0;
    slugCounts.clear();
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i]!;
      if (token.type !== "heading_open") continue;
      const inline = state.tokens[i + 1];
      if (!inline || inline.type !== "inline") continue;
      const text = inline.content;
      // Render the inline children to HTML so the outline preserves `<code>`,
      // emphasis, links etc. — matches what the heading actually looks like.
      const html = md.renderer.renderInline(inline.children ?? [], md.options, {});
      const base = slugify(text);
      const count = slugCounts.get(base) ?? 0;
      const slug = count === 0 ? base : `${base}-${count}`;
      slugCounts.set(base, count + 1);
      token.attrSet("id", slug);
      const depth = parseInt(token.tag.slice(1), 10);
      sink.outline.push({ depth, text, html, slug });
      // We don't inject a # anchor here - the React heading renderer adds a Fluent <Link>
      // so it can take part in the SPA's click interception and theme tokens.
    }
    return false;
  });
}

// Group flat outline into a nested tree by depth (h2 -> h3 -> ...).
export function nestOutline(flat: OutlineNode[]): OutlineNode[] {
  const root: OutlineNode = { depth: 0, text: "", slug: "", children: [] };
  const stack: OutlineNode[] = [root];
  for (const node of flat) {
    if (node.depth === 1) continue; // page title is rendered separately
    while (stack.length > 1 && stack[stack.length - 1]!.depth >= node.depth) stack.pop();
    const parent = stack[stack.length - 1]!;
    parent.children = parent.children ?? [];
    const fresh: OutlineNode = { ...node, children: [] };
    parent.children.push(fresh);
    stack.push(fresh);
  }
  return root.children ?? [];
}
