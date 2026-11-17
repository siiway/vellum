// A page's content is in its HTML only: the payload the client hydrates the
// page from leaves it out (leanAst). These mark it in the page, and take it
// back from there.

import { walkBlocks, type MarkdownAst } from "../shared/markdown";

// The class of the element the page's Markdown renders in.
export const MARKDOWN_ROOT = "vellum-markdown";

// The class of the wrapper of a run of static blocks, a child of the
// Markdown's root. It has no box of its own (ssr.tsx).
export const STATIC_RUN = "vellum-static";

// The attribute that marks a code block's code with the `contentKey` of its
// HTML.
export const CODE_KEY_ATTR = "data-vellum-code";

// Fills what `ast` leaves out back in from the page, before the client
// hydrates it. React keeps the page's markup when it hydrates, but renders
// from the payload whenever it mounts the page again: a theme switch does,
// and so does a hydration that fails.
export function fillFromPage(ast: MarkdownAst): void {
  const root = document.querySelector(`.${MARKDOWN_ROOT}`);
  if (!root) return;
  // Only the root's own: a block's raw HTML may use the class too.
  const runs = root.querySelectorAll(`:scope > .${STATIC_RUN}`);
  let run = 0;
  const codes = new Map<string, Element>();
  root.querySelectorAll(`[${CODE_KEY_ATTR}]`).forEach((el) => {
    const key = el.getAttribute(CODE_KEY_ATTR)!;
    if (!codes.has(key)) codes.set(key, el);
  });
  walkBlocks(ast.blocks, (block) => {
    if (block.type === "prerendered") {
      block.html = runs[run++]?.innerHTML ?? "";
    } else if (block.type === "code" && block.key) {
      block.html = codes.get(block.key)?.innerHTML ?? "";
    }
  });
}
