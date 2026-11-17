// A page's content is in its HTML only: the payload the client hydrates the
// page from leaves it out (leanAst). These mark it in the page, and take it
// back from there.

import { walkBlocks, type MarkdownAst } from "../shared/markdown";

// The class of the element the page's Markdown renders in.
export const MARKDOWN_ROOT = "vellum-markdown";

// The class of the wrapper of a run of static blocks, a child of the
// Markdown's root. It has no box of its own (ssr.tsx).
export const STATIC_RUN = "vellum-static";

// The attribute that marks a code block's code with its block's key
// (leanAst).
export const CODE_KEY_ATTR = "data-vellum-code";

// The attribute that marks each palette of a diagram with the `paletteKey`
// of its block's key (leanAst).
export const DIAGRAM_KEY_ATTR = "data-vellum-diagram";

// The classes of a diagram's two palettes (MermaidBlock.tsx), which CSS
// picks from (ssr.tsx).
export const DIAGRAM_LIGHT = "vellum-diagram-light";
export const DIAGRAM_DARK = "vellum-diagram-dark";

export function paletteKey(key: string, palette: "light" | "dark"): string {
  return `${key}:${palette}`;
}

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
  const codes = marked(root, CODE_KEY_ATTR);
  const palettes = marked(root, DIAGRAM_KEY_ATTR);
  let complete = true;
  // The markup in `el`, which the page lacks when it's undefined.
  const take = (el: Element | undefined): string => {
    if (!el) complete = false;
    return el?.innerHTML ?? "";
  };
  walkBlocks(ast.blocks, (block) => {
    if (block.type === "prerendered") {
      block.html = take(runs[run++]);
    } else if (block.type === "code" && block.key) {
      block.html = take(codes.get(block.key));
    } else if (block.type === "mermaid" && block.key) {
      block.svgLight = take(palettes.get(paletteKey(block.key, "light")));
      block.svgDark = take(palettes.get(paletteKey(block.key, "dark")));
    }
  });
  return complete;
}

// The elements in `root` marked with `attr`, by the mark: the first of
// each, since equal marks stand for equal content.
function marked(root: Element | null, attr: string): Map<string, Element> {
  const out = new Map<string, Element>();
  root?.querySelectorAll(`[${attr}]`).forEach((el) => {
    const mark = el.getAttribute(attr)!;
    if (!out.has(mark)) out.set(mark, el);
  });
  return out;
}
