// Markdown AST shared between the build and the browser.
// Built from markdown-it tokens by the build, rendered by FluentUI components on the client.
// Designed to cover the VitePress-style feature set without losing fidelity:
// containers, code groups, GFM tables/alerts, task lists, footnotes.

export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | {
      type: "link";
      href: string;
      title?: string;
      external: boolean;
      children: Inline[];
    }
  | { type: "image"; src: string; alt: string; title?: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "del"; children: Inline[] }
  | { type: "br" }
  | { type: "html"; value: string }
  // Inline React component, produced when the AST builder spots a PascalCase
  // open/close pair (or self-closing) inside an inline run, e.g.
  // `<Button appearance="primary">Click me</Button>`. The renderer resolves
  // `name` against the repo's own Vue and React components, then the
  // registered React-component table; when it's none of them, it falls back
  // to rendering `children` so the text isn't lost.
  | {
      type: "reactComponent";
      name: string;
      props: Record<string, unknown>;
      children: Inline[];
    }
  // Inline HTML element with content, e.g. `<kbd>Ctrl</kbd>`. markdown-it
  // emits its tags as separate tokens; the AST builder pairs them so the
  // content nests inside. `attrs` are as written, minus event handlers.
  | { type: "element"; tag: string; attrs: Record<string, string>; children: Inline[] }
  // OPS / Microsoft Learn cross-reference. `target` is the uid (e.g. System.Console).
  // `href` is the resolved URL when the build found a matching xrefmap entry;
  // when unresolved, the client renders the uid as monospace fallback text.
  // `display` carries optional link text (from `[text](xref:uid)` form).
  | { type: "xref"; target: string; href?: string; display?: string };

export type Block =
  | {
      type: "heading";
      level: 1 | 2 | 3 | 4 | 5 | 6;
      id: string;
      children: Inline[];
    }
  | { type: "paragraph"; children: Inline[] }
  | {
      type: "list";
      ordered: boolean;
      start?: number;
      // Each item is a list of blocks; tasks have a checkbox state.
      items: Array<{ checked: boolean | null; children: Block[] }>;
    }
  | { type: "blockquote"; children: Block[] }
  | {
      type: "callout";
      kind: "tip" | "info" | "note" | "warning" | "danger" | "caution" | "important" | "details";
      // Inline-parsed title — supports `code`, **bold**, links, etc. Authored
      // as `::: tip Heads `up`` or `> [!NOTE]`; the build runs the inline
      // markdown parser over the raw text so the renderer can use the same
      // InlineNode component as paragraphs.
      title?: Inline[];
      children: Block[];
    }
  | {
      type: "code";
      lang: string | null;
      filename?: string;
      showLineNumbers: boolean;
      highlightLines: number[];
      code: string;
      // Pre-rendered Shiki HTML; the renderer drops it into a FluentUI Card via innerHTML
      // because re-implementing token-by-token highlight rendering in React would 10x the bundle.
      html: string;
      // Only without `code` and `html` (leanAst): the `contentKey` of the
      // HTML, which the page marks the block's code with.
      key?: string;
    }
  | {
      type: "codeGroup";
      tabs: Array<{
        label: string;
        lang: string | null;
        html: string;
        code: string;
      }>;
    }
  | { type: "thematicBreak" }
  | {
      type: "table";
      head: Array<{
        align: "left" | "center" | "right" | null;
        children: Inline[];
      }>;
      rows: Array<Array<{ align: "left" | "center" | "right" | null; children: Inline[] }>>;
    }
  // Mermaid blocks. svgLight/svgDark are populated by the build via Kroki when
  // available; when absent (no env binding, Kroki failure, etc.) the client
  // falls back to its own mermaid render. Both palettes are shipped so theme
  // switching is instant and doesn't need to fetch a fresh SVG.
  | {
      type: "mermaid";
      code: string;
      svgLight?: string;
      svgDark?: string;
      // Only without the SVGs (leanAst): the `contentKey` of `code`, which
      // the page marks its palettes with.
      key?: string;
    }
  // OPS / Microsoft Learn extensions.
  //
  // opsImage replaces the inline image for richer metadata (caption, lightbox,
  // border, content/icon/complex variants).
  | {
      type: "opsImage";
      src: string;
      alt: string;
      kind?: "content" | "icon" | "complex";
      lightbox?: string;
      border?: boolean;
      caption?: string;
    }
  // opsVideo embeds YouTube/Channel9/MP4. The renderer picks an <iframe> for
  // hosted services and an HTML5 <video> for direct media URLs.
  | { type: "opsVideo"; src: string; title?: string }
  // 12-column grid layout. opsRow can only contain opsColumn children.
  | { type: "opsRow"; children: Block[] }
  | { type: "opsColumn"; span?: number; children: Block[] }
  // Zone pivots: a comma-separated list of pivot ids; content shows when the
  // active pivot is in the list. Active pivot is picked client-side from
  // ?pivot= / localStorage / first-match.
  | { type: "opsZone"; pivot?: string; target?: string; children: Block[] }
  // Moniker (version) range: e.g. ">=v2.0", "v1.0-v2.0", "v2.0". The client
  // compares against the current ?view= or repo version.
  | { type: "opsMoniker"; range: string; children: Block[] }
  // DocFX tabs: a set of tab panels grouped under a single tab strip. Each tab
  // has a stable id (slug) used in the URL hash and an authored title.
  | {
      type: "opsTabs";
      tabs: Array<{ id: string; title: string; children: Block[] }>;
    }
  | { type: "html"; value: string }
  // A run of static blocks (isStaticBlock) that only the page's HTML holds.
  // Only in the payload the client hydrates a page from (leanAst), without
  // `html`: the client takes the run's markup from the page.
  | { type: "prerendered"; html?: string };

export interface MarkdownAst {
  blocks: Block[];
}

// Calls `fn` on every block, its children after it, in document order.
export function walkBlocks(blocks: Block[], fn: (b: Block) => void): void {
  for (const b of blocks) {
    fn(b);
    if (b.type === "blockquote" || b.type === "callout") walkBlocks(b.children, fn);
    else if (b.type === "list") b.items.forEach((it) => walkBlocks(it.children, fn));
    else if (
      b.type === "opsRow" ||
      b.type === "opsColumn" ||
      b.type === "opsZone" ||
      b.type === "opsMoniker"
    ) {
      walkBlocks(b.children, fn);
    } else if (b.type === "opsTabs") {
      b.tabs.forEach((t) => walkBlocks(t.children, fn));
    }
  }
}

// The names of the PascalCase tags in an AST, inline or in HTML blocks: the
// components its page may render. Not those commented out.
export function componentNames(ast: MarkdownAst): Set<string> {
  const names = new Set<string>();
  const inline = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === "reactComponent") names.add(node.name);
      if ("children" in node) inline(node.children);
    }
  };
  walkBlocks(ast.blocks, (b) => {
    if (b.type === "html") {
      const html = b.value.replace(/<!--[\s\S]*?-->/g, "");
      for (const m of html.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) names.add(m[1]!);
    } else if (b.type === "paragraph" || b.type === "heading") {
      inline(b.children);
    } else if (b.type === "callout") {
      inline(b.title ?? []);
    } else if (b.type === "table") {
      for (const row of [b.head, ...b.rows]) for (const cell of row) inline(cell.children);
    }
  });
  return names;
}

// Whether a block renders to markup that needs no React once it's on the
// page: no state, effects or handlers. The client can then adopt it from
// the page's HTML. Errs on the side of false: a PascalCase tag may be a
// React component.
//
// This states what the renderers in MarkdownAst.tsx do, and nothing checks
// it: on a page's first load React never renders a static block, so a
// handler or effect given to its renderer would only work after a
// navigation. A renderer that gets one makes its block not static here.
export function isStaticBlock(block: Block): boolean {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return block.children.every(isStaticInline);
    case "list":
      return block.items.every((item) => item.children.every(isStaticBlock));
    case "blockquote":
    case "opsRow":
    case "opsColumn":
    case "opsMoniker":
      return block.children.every(isStaticBlock);
    case "callout":
      return (block.title ?? []).every(isStaticInline) && block.children.every(isStaticBlock);
    case "table":
      return [block.head, ...block.rows].every((row) =>
        row.every((cell) => cell.children.every(isStaticInline)),
      );
    case "html":
      return !/<[A-Z]/.test(block.value);
    case "thematicBreak":
    case "opsImage":
    case "opsVideo":
      return true;
    // The page shows the palette for the theme. Without both, the client
    // draws it.
    case "mermaid":
      return !!(block.svgLight && block.svgDark);
    // A copy button, tabs, pivots.
    case "code":
    case "codeGroup":
    case "opsZone":
    case "opsTabs":
      return false;
    // Already stands for a run of static blocks: never part of another.
    case "prerendered":
      return false;
  }
}

function isStaticInline(node: Inline): boolean {
  switch (node.type) {
    case "reactComponent":
      return false;
    case "link":
    case "strong":
    case "em":
    case "del":
    case "element":
      return node.children.every(isStaticInline);
    default:
      return true;
  }
}

// The page's top-level blocks, with each run of static blocks grouped: the
// unit the page's HTML wraps and the client adopts.
export function groupBlocks(blocks: Block[]): Array<Block | Block[]> {
  const out: Array<Block | Block[]> = [];
  let run: Block[] | null = null;
  for (const block of blocks) {
    if (isStaticBlock(block)) {
      if (!run) out.push((run = []));
      run.push(block);
    } else {
      run = null;
      out.push(block);
    }
  }
  return out;
}

// The AST the client hydrates a page from, without what the page's HTML
// already holds: each run of static blocks becomes a `prerendered` block,
// and code blocks and diagrams drawn by the build, also in other blocks,
// keep no HTML, only the key the page marks it with.
export function leanAst(ast: MarkdownAst): MarkdownAst {
  return {
    blocks: groupBlocks(ast.blocks).map((group) =>
      Array.isArray(group) ? { type: "prerendered" } : leanBlock(group),
    ),
  };
}

// The page holds a pivot's zones all, but only the first tab of a set: tabs
// keep their children whole.
function leanBlock(block: Block): Block {
  switch (block.type) {
    case "code":
      return { ...block, code: "", html: "", key: contentKey(block.html) };
    case "mermaid": {
      if (!block.svgLight || !block.svgDark) return block;
      const { svgLight: _light, svgDark: _dark, ...rest } = block;
      return { ...rest, key: contentKey(block.code) };
    }
    case "list":
      return {
        ...block,
        items: block.items.map((item) => ({ ...item, children: item.children.map(leanBlock) })),
      };
    case "blockquote":
    case "callout":
    case "opsRow":
    case "opsColumn":
    case "opsMoniker":
    case "opsZone":
      return { ...block, children: block.children.map(leanBlock) };
    default:
      return block;
  }
}

// A short key for a string (FNV-1a, and the length). Equal strings get equal
// keys, so two blocks with the same key show the same thing.
export function contentKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${s.length.toString(36)}-${(h >>> 0).toString(36)}`;
}
