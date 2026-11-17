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
//
// Returns whether the page held all of it. When it didn't, the client can't
// hydrate from `ast`: a block would render without its content, and a
// diagram as one the client draws, which doesn't match the page.
export function fillFromPage(ast: MarkdownAst): boolean {
  const root = document.querySelector(`.${MARKDOWN_ROOT}`);
  // Only the root's own: a block's raw HTML may use the class too.
  const runs = root?.querySelectorAll(`:scope > .${STATIC_RUN}`) ?? [];
  let run = 0;
  const keyed = new Map<string, Element>();
  root?.querySelectorAll(`[${CONTENT_KEY_ATTR}]`).forEach((el) => {
    const key = el.getAttribute(CONTENT_KEY_ATTR)!;
    if (!keyed.has(key)) keyed.set(key, el);
  });
  let complete = true;
  walkBlocks(ast.blocks, (block) => {
    if (block.type === "prerendered") {
      const el = runs[run++];
      if (el) block.html = el.innerHTML;
      else complete = false;
    } else if (block.type === "code" && block.key) {
      const el = keyed.get(block.key);
      if (el) block.html = el.innerHTML;
      else complete = false;
    } else if (block.type === "mermaid" && block.key) {
      const diagram = keyed.get(block.key);
      block.svgLight = diagram?.querySelector(`.${DIAGRAM_LIGHT}`)?.innerHTML;
      block.svgDark = diagram?.querySelector(`.${DIAGRAM_DARK}`)?.innerHTML;
      if (!block.svgLight || !block.svgDark) complete = false;
    }
  });
  return complete;
}
