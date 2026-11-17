// A page's content is in its HTML only: the payload the client hydrates the
// page from leaves it out (leanAst). These mark it in the page, and take it
// back from there.

import type { Block, MarkdownAst } from "../shared/markdown";

// The class of the wrapper of a run of static blocks. It has no box of its
// own (ssr.tsx).
export const STATIC_RUN = "vellum-static";

// The attribute that marks a code block's code with the `contentKey` of its
// HTML.
export const CODE_KEY_ATTR = "data-vellum-code";

// Fills what `ast` leaves out back in from the page, before the client
// hydrates it. React keeps the page's markup when it hydrates, but renders
// from the payload whenever it mounts the page again: a theme switch does,
// and so does a hydration that fails.
export function fillFromPage(ast: MarkdownAst): void {
  const runs = document.querySelectorAll(`.${STATIC_RUN}`);
  let run = 0;
  const visit = (block: Block) => {
    if (block.type === "prerendered") {
      block.html = runs[run++]?.innerHTML ?? "";
    } else if (block.type === "code" && block.key) {
      const code = document.querySelector(`[${CODE_KEY_ATTR}="${block.key}"]`);
      block.html = code?.innerHTML ?? "";
    }
    for (const child of children(block)) visit(child);
  };
  ast.blocks.forEach(visit);
}

function children(block: Block): Block[] {
  switch (block.type) {
    case "list":
      return block.items.flatMap((item) => item.children);
    case "blockquote":
    case "callout":
    case "opsRow":
    case "opsColumn":
    case "opsMoniker":
    case "opsZone":
      return block.children;
    case "opsTabs":
      return block.tabs.flatMap((tab) => tab.children);
    default:
      return [];
  }
}
