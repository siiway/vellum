// Markdown AST shared between worker and browser.
// Built from markdown-it tokens on the worker, rendered by FluentUI components on the client.
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
  // `name` against the registered React-component table; when unregistered, it
  // falls back to rendering `children` so the text isn't lost.
  | {
      type: "reactComponent";
      name: string;
      props: Record<string, unknown>;
      children: Inline[];
    }
  // OPS / Microsoft Learn cross-reference. `target` is the uid (e.g. System.Console).
  // `href` is the resolved URL when the worker found a matching xrefmap entry;
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
      // as `::: tip Heads `up`` or `> [!NOTE]`; the worker runs the inline
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
  // Mermaid blocks. svgLight/svgDark are populated by the worker via Kroki when
  // available; when absent (no env binding, Kroki failure, etc.) the client
  // falls back to its own mermaid render. Both palettes are shipped so theme
  // switching is instant and doesn't need to fetch a fresh SVG.
  | { type: "mermaid"; code: string; svgLight?: string; svgDark?: string }
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
  | { type: "html"; value: string };

export interface MarkdownAst {
  blocks: Block[];
}
