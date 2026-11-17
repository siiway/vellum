// A page's content is in its HTML only: the payload the client hydrates the
// page from leaves it out (leanAst). These mark it in the page, and take it
// back from there.

import { walkBlocks, type MarkdownAst } from "../shared/markdown";

// The class of the element the page's Markdown renders in.
export const MARKDOWN_ROOT = "vellum-markdown";

// The class of the wrapper of a run of static blocks, a child of the
// Markdown's root. It has no box of its own (ssr.tsx).
export const STATIC_RUN = "vellum-static";

// The attribute that marks a code block's code, and a diagram, with its
// block's key (leanAst).
export const CONTENT_KEY_ATTR = "data-vellum-key";

// The classes of a diagram's two palettes (MermaidBlock.tsx), which CSS
// picks from (ssr.tsx).
export const DIAGRAM_LIGHT = "vellum-diagram-light";
export const DIAGRAM_DARK = "vellum-diagram-dark";

// Fills what `ast` leaves out back in from the page, before the client
// hydrates it. React keeps the page's markup when it hydrates, but renders
// from the payload whenever it mounts the page again, as it does when a
// hydration fails.
export function fillFromPage(ast: MarkdownAst): void {
  const root = document.querySelector(`.${MARKDOWN_ROOT}`);
  if (!root) return;
  // Only the root's own: a block's raw HTML may use the class too.
  const runs = root.querySelectorAll(`:scope > .${STATIC_RUN}`);
  let run = 0;
  const keyed = new Map<string, Element>();
  root.querySelectorAll(`[${CONTENT_KEY_ATTR}]`).forEach((el) => {
    const key = el.getAttribute(CONTENT_KEY_ATTR)!;
    if (!keyed.has(key)) keyed.set(key, el);
  });
  walkBlocks(ast.blocks, (block) => {
    if (block.type === "prerendered") {
      block.html = runs[run++]?.innerHTML ?? "";
    } else if (block.type === "code" && block.key) {
      block.html = keyed.get(block.key)?.innerHTML ?? "";
    } else if (block.type === "mermaid" && block.key) {
      const diagram = keyed.get(block.key);
      block.svgLight = diagram?.querySelector(`.${DIAGRAM_LIGHT}`)?.innerHTML;
      block.svgDark = diagram?.querySelector(`.${DIAGRAM_DARK}`)?.innerHTML;
    }
  });
}
