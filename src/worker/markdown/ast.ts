// Convert markdown-it's flat token stream into the JSON AST that we ship to the client.
// Code fences are highlighted up-front by Shiki and the resulting HTML is embedded in the
// code block so the browser can render colored output without shipping Shiki client-side.

// markdown-it's published types don't re-export the Token class; pull it from the entrypoint
// via a default import alias.
import type MarkdownItDefault from "markdown-it";
type Token = NonNullable<ReturnType<MarkdownItDefault["parse"]>[number]>;
import type { Block, Inline, MarkdownAst } from "../../shared/markdown";
import { highlightCode } from "./highlight";

type CalloutKind = Extract<Block, { type: "callout" }>["kind"];
const CALLOUT_KINDS = new Set<CalloutKind>([
  "tip",
  "info",
  "note",
  "warning",
  "danger",
  "caution",
  "important",
  "details",
]);

export interface AstBuildOptions {
  // Hook to rewrite a link's href (relative -> site-absolute, .md stripping, xref expansion).
  rewriteLink?: (href: string) => string;
  // Hook for image src.
  rewriteImage?: (src: string) => string;
  // Optional async hook for rendering a mermaid diagram to themed SVGs
  // (server-side via Kroki, etc.). Called once per mermaid block in parallel
  // with code fences. Either palette may be null — the client falls back to
  // its own mermaid bundle for whichever palette is missing.
  renderDiagram?: (code: string) => Promise<{ light: string | null; dark: string | null }>;
  // OPS [!INCLUDE]: resolve a relative markdown path → parsed Block[].
  resolveInclude?: IncludeRenderer;
  // OPS [!code-lang]: resolve a relative source path → rendered code block.
  resolveCodeInclude?: CodeIncludeRenderer;
  // OPS xref:uid → href + display, or null when unresolved.
  resolveXref?: XrefResolver;
}

export type IncludeRenderer = (path: string) => Promise<Block[] | null>;
export type CodeIncludeRenderer = (
  meta: import("./ops-includes").CodeIncludeMeta,
) => Promise<Extract<Block, { type: "code" }> | null>;
export type XrefResolver = (uid: string) => { href: string; name?: string } | null;

interface PendingFence {
  placeholder: string;
  code: string;
  info: string;
  lang: string | null;
}

// Walk the token stream and produce a Block[] tree. Code fences, mermaid
// diagrams, and OPS includes are queued and resolved in parallel afterwards so
// we don't serialize the awaits — a page with N mermaid + M include blocks
// pays for one async round trip, not N+M.
interface PendingInclude {
  placeholder: string;
  path: string;
}
interface PendingCodeInclude {
  placeholder: string;
  meta: import("./ops-includes").CodeIncludeMeta;
}

export async function tokensToAst(
  tokens: Token[],
  opts: AstBuildOptions = {},
): Promise<MarkdownAst> {
  const fences: PendingFence[] = [];
  const mermaidBlocks: Array<Extract<Block, { type: "mermaid" }>> = [];
  const includes: PendingInclude[] = [];
  const codeIncludes: PendingCodeInclude[] = [];
  const blocks = parseBlocks(
    tokens,
    0,
    tokens.length,
    fences,
    mermaidBlocks,
    includes,
    codeIncludes,
    opts,
  ).blocks;

  const work: Array<Promise<void>> = [];

  if (fences.length) {
    work.push(
      (async () => {
        const resolved = await Promise.all(
          fences.map(async (f) => ({ ...f, ...(await renderFence(f)) })),
        );
        const byPlaceholder = new Map(resolved.map((r) => [r.placeholder, r]));
        walkBlocks(blocks, (b) => {
          if (b.type === "code" && b.html.startsWith("__VELLUM_FENCE_")) {
            const r = byPlaceholder.get(b.html);
            if (r) {
              b.html = r.html;
              b.code = r.code;
              b.lang = r.langOut;
              b.filename = r.filename;
              b.showLineNumbers = r.showLineNumbers;
              b.highlightLines = r.highlightLines;
            }
          } else if (b.type === "codeGroup") {
            b.tabs = b.tabs.map((t) => {
              if (t.html.startsWith("__VELLUM_FENCE_")) {
                const r = byPlaceholder.get(t.html);
                if (r)
                  return {
                    label: t.label,
                    lang: r.langOut,
                    code: r.code,
                    html: r.html,
                  };
              }
              return t;
            });
          }
        });
      })(),
    );
  }

  if (mermaidBlocks.length && opts.renderDiagram) {
    const render = opts.renderDiagram;
    work.push(
      (async () => {
        const rendered = await Promise.all(
          mermaidBlocks.map((m) => render(m.code).catch(() => ({ light: null, dark: null }))),
        );
        mermaidBlocks.forEach((m, i) => {
          const r = rendered[i];
          if (r?.light) m.svgLight = r.light;
          if (r?.dark) m.svgDark = r.dark;
        });
      })(),
    );
  }

  // INCLUDE / code-include resolution. Both produce content that should
  // replace a placeholder html block in the tree. We fetch in parallel, then
  // walk the tree (including nested containers / lists / tabs / columns) and
  // splice in the resolved blocks. When a fetch fails we leave a visible
  // "include failed" callout in place so the author sees the broken reference
  // instead of a silently-disappearing block.
  const placeholderEntries = new Map<string, IncludePlaceholderResult>();

  if (includes.length) {
    const resolve = opts.resolveInclude;
    work.push(
      (async () => {
        const resolved = resolve
          ? await Promise.all(includes.map((i) => resolve(i.path).catch(() => null)))
          : includes.map(() => null);
        includes.forEach((i, idx) => {
          placeholderEntries.set(i.placeholder, {
            kind: "include",
            path: i.path,
            blocks: resolved[idx] ?? null,
          });
        });
      })(),
    );
  }

  if (codeIncludes.length) {
    const resolve = opts.resolveCodeInclude;
    work.push(
      (async () => {
        const resolved = resolve
          ? await Promise.all(codeIncludes.map((i) => resolve(i.meta).catch(() => null)))
          : codeIncludes.map(() => null);
        codeIncludes.forEach((i, idx) => {
          placeholderEntries.set(i.placeholder, {
            kind: "codeInclude",
            path: i.meta.path,
            code: resolved[idx] ?? null,
          });
        });
      })(),
    );
  }

  if (work.length) await Promise.all(work);

  if (placeholderEntries.size) {
    spliceIncludes(blocks, placeholderEntries);
  }

  return { blocks };
}

type IncludePlaceholderResult =
  | { kind: "include"; path: string; blocks: Block[] | null }
  | {
      kind: "codeInclude";
      path: string;
      code: Extract<Block, { type: "code" }> | null;
    };

// Walks the tree and rewrites every placeholder html block to its resolved
// content. Successful INCLUDEs flatten into the parent array; successful
// code-includes become a single code block. Failures (resolver returned null,
// no resolver registered, fetch threw) render as a "danger" callout naming the
// missing path so the author can spot the broken reference.
function spliceIncludes(blocks: Block[], entries: Map<string, IncludePlaceholderResult>): void {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (
      b.type === "html" &&
      (b.value.startsWith("__VELLUM_INCLUDE_") || b.value.startsWith("__VELLUM_CODE_INCLUDE_"))
    ) {
      const entry = entries.get(b.value);
      if (!entry) {
        // Placeholder we don't recognise — strip it so the literal __VELLUM_..._
        // marker never reaches the renderer.
        blocks.splice(i, 1);
        i--;
        continue;
      }
      if (entry.kind === "include") {
        if (entry.blocks) {
          blocks.splice(i, 1, ...entry.blocks);
          i += entry.blocks.length - 1;
        } else {
          blocks[i] = makeIncludeErrorBlock("INCLUDE", entry.path);
        }
        continue;
      }
      // code-include
      if (entry.code) {
        blocks[i] = entry.code;
      } else {
        blocks[i] = makeIncludeErrorBlock("code-include", entry.path);
      }
      continue;
    }
    // Recurse into containers.
    if (b.type === "blockquote" || b.type === "callout") spliceIncludes(b.children, entries);
    else if (b.type === "list") b.items.forEach((it) => spliceIncludes(it.children, entries));
    else if (
      b.type === "opsRow" ||
      b.type === "opsColumn" ||
      b.type === "opsZone" ||
      b.type === "opsMoniker"
    ) {
      spliceIncludes(b.children, entries);
    } else if (b.type === "opsTabs") {
      b.tabs.forEach((t) => spliceIncludes(t.children, entries));
    }
  }
}

function makeIncludeErrorBlock(kind: "INCLUDE" | "code-include", path: string): Block {
  // Reuse the existing callout primitive so the failure looks like any other
  // surfaced error in the docs — same MessageBar chrome, same iconography.
  return {
    type: "callout",
    kind: "danger",
    title: [{ type: "text", value: `Failed to resolve ${kind}` }],
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: `Path: ` },
          { type: "code", value: path },
        ],
      },
    ],
  };
}

interface RenderedFence {
  html: string;
  code: string;
  langOut: string | null;
  filename?: string;
  showLineNumbers: boolean;
  highlightLines: number[];
}

async function renderFence(f: PendingFence): Promise<RenderedFence> {
  // highlightCode wraps in its own scaffolding; for the AST we want just the inner Shiki HTML
  // so the React renderer can place the FluentUI Card chrome around it itself.
  const html = await highlightCode(f.code, f.info);
  // highlightCode returns <div class="vellum-code-block"><div class="vellum-code-header">...</div><pre class="shiki">...</pre><button .../></div>
  // Strip the wrapper so the React component owns the layout.
  const inner = stripCodeBlockWrapper(html);
  const meta = parseFenceInfo(f.info);
  return {
    html: inner,
    code: f.code,
    langOut: meta.lang,
    filename: meta.filename,
    showLineNumbers: meta.showLineNumbers,
    highlightLines: meta.highlightLines,
  };
}

function stripCodeBlockWrapper(html: string): string {
  // Extract everything from the first <pre to the matching </pre>.
  const start = html.indexOf("<pre");
  const end = html.lastIndexOf("</pre>");
  if (start < 0 || end < 0) return html;
  return html.slice(start, end + "</pre>".length);
}

function parseFenceInfo(info: string): {
  lang: string | null;
  filename?: string;
  showLineNumbers: boolean;
  highlightLines: number[];
} {
  const tokens = info.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { lang: null, showLineNumbers: false, highlightLines: [] };
  let lang: string | null;
  let showLineNumbers = false;
  const first = tokens.shift()!;
  if (first.includes(":line-numbers")) {
    lang = first.split(":")[0] || null;
    showLineNumbers = true;
  } else {
    lang = first || null;
  }
  let filename: string | undefined;
  let highlightLines: number[] = [];
  for (const t of tokens) {
    const fn = t.match(/^\[(.+)\]$/);
    if (fn) filename = fn[1];
    const ln = t.match(/^\{([\d,\-\s]+)\}$/);
    if (ln) highlightLines = expandRanges(ln[1]!);
    if (t === "line-numbers") showLineNumbers = true;
  }
  return { lang, filename, showLineNumbers, highlightLines };
}

function expandRanges(s: string): number[] {
  const out: number[] = [];
  for (const part of s.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.split("-").map((n) => parseInt(n, 10));
    if (range.length === 1 && Number.isFinite(range[0])) out.push(range[0]!);
    else if (range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
      for (let i = range[0]!; i <= range[1]!; i++) out.push(i);
    }
  }
  return out;
}

interface ParseResult {
  blocks: Block[];
  end: number;
}

// Recursive descent over markdown-it's block tokens. Walks until `end` or until it sees
// a matching close token for `stopType`. Collects fences, mermaid blocks, and pending
// OPS includes into out-parameters so the caller can resolve them in parallel after
// the tree is built.
function parseBlocks(
  tokens: Token[],
  start: number,
  end: number,
  fences: PendingFence[],
  mermaidBlocks: Array<Extract<Block, { type: "mermaid" }>>,
  includes: PendingInclude[],
  codeIncludes: PendingCodeInclude[],
  opts: AstBuildOptions,
  stopType?: string,
): ParseResult {
  const blocks: Block[] = [];
  let i = start;
  while (i < end) {
    const tok = tokens[i]!;
    if (stopType && tok.type === stopType) return { blocks, end: i };

    if (tok.type === "heading_open") {
      const level = parseInt(tok.tag.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6;
      const id = tok.attrGet("id") ?? "";
      const inline = tokens[i + 1]!;
      const children = inline.children ? inlinesFromTokens(inline.children, opts) : [];
      blocks.push({ type: "heading", level, id, children });
      i += 3; // open, inline, close
      continue;
    }

    if (tok.type === "paragraph_open") {
      const inline = tokens[i + 1]!;
      const children = inline.children ? inlinesFromTokens(inline.children, opts) : [];
      blocks.push({ type: "paragraph", children });
      i += 3;
      continue;
    }

    if (tok.type === "bullet_list_open" || tok.type === "ordered_list_open") {
      const ordered = tok.type === "ordered_list_open";
      const close = ordered ? "ordered_list_close" : "bullet_list_close";
      const items: Array<{ checked: boolean | null; children: Block[] }> = [];
      let j = i + 1;
      while (j < end && tokens[j]!.type !== close) {
        if (tokens[j]!.type === "list_item_open") {
          const itemEnd = findMatchingClose(tokens, j, "list_item_open", "list_item_close", end);
          const inner = parseBlocks(
            tokens,
            j + 1,
            itemEnd,
            fences,
            mermaidBlocks,
            includes,
            codeIncludes,
            opts,
          ).blocks;
          // GFM task list checkbox detection: a markdown-it-task-lists plugin annotates
          // the first inline child with a <input type="checkbox"> token.
          let checked: boolean | null = null;
          if (inner[0]?.type === "paragraph") {
            const first = inner[0].children[0];
            if (first?.type === "html" && /<input[^>]*type=["']checkbox["']/.test(first.value)) {
              checked = /checked/.test(first.value);
              inner[0].children = inner[0].children.slice(1);
            }
          }
          items.push({ checked, children: inner });
          j = itemEnd + 1;
        } else {
          j++;
        }
      }
      const start = (tok.attrGet("start") ?? "").length
        ? parseInt(tok.attrGet("start")!, 10)
        : undefined;
      blocks.push({ type: "list", ordered, start, items });
      i = j + 1;
      continue;
    }

    if (tok.type === "blockquote_open") {
      const closeIdx = findMatchingClose(tokens, i, "blockquote_open", "blockquote_close", end);
      const inner = parseBlocks(
        tokens,
        i + 1,
        closeIdx,
        fences,
        mermaidBlocks,
        includes,
        codeIncludes,
        opts,
      ).blocks;
      blocks.push({ type: "blockquote", children: inner });
      i = closeIdx + 1;
      continue;
    }

    if (tok.type === "fence") {
      const placeholder = `__VELLUM_FENCE_${fences.length}__`;
      if (tok.info.trim().startsWith("mermaid")) {
        const mermaid: Extract<Block, { type: "mermaid" }> = {
          type: "mermaid",
          code: tok.content,
        };
        blocks.push(mermaid);
        mermaidBlocks.push(mermaid);
      } else {
        fences.push({
          placeholder,
          code: tok.content,
          info: tok.info,
          lang: tok.info.split(/\s+/)[0] || null,
        });
        blocks.push({
          type: "code",
          lang: tok.info.split(/\s+/)[0] || null,
          showLineNumbers: false,
          highlightLines: [],
          code: tok.content,
          html: placeholder,
        });
      }
      i++;
      continue;
    }

    if (tok.type === "code_block") {
      const placeholder = `__VELLUM_FENCE_${fences.length}__`;
      fences.push({ placeholder, code: tok.content, info: "", lang: null });
      blocks.push({
        type: "code",
        lang: null,
        showLineNumbers: false,
        highlightLines: [],
        code: tok.content,
        html: placeholder,
      });
      i++;
      continue;
    }

    if (tok.type === "hr") {
      blocks.push({ type: "thematicBreak" });
      i++;
      continue;
    }

    if (tok.type === "table_open") {
      const closeIdx = findMatchingClose(tokens, i, "table_open", "table_close", end);
      const table = parseTable(tokens, i, closeIdx, opts);
      blocks.push(table);
      i = closeIdx + 1;
      continue;
    }

    // Custom containers: ::: tip / ::: warning / ::: details ...
    if (tok.type.startsWith("container_") && tok.type.endsWith("_open")) {
      const kindName = tok.type.slice("container_".length, -"_open".length);
      const closeType = `container_${kindName}_close`;
      const closeIdx = findMatchingClose(tokens, i, tok.type, closeType, end);
      const info = tok.info.trim();

      if (kindName === "code-group") {
        const tabs: Array<{
          label: string;
          lang: string | null;
          html: string;
          code: string;
        }> = [];
        for (let k = i + 1; k < closeIdx; k++) {
          const sub = tokens[k]!;
          if (sub.type !== "fence") continue;
          const placeholder = `__VELLUM_FENCE_${fences.length}__`;
          fences.push({
            placeholder,
            code: sub.content,
            info: sub.info,
            lang: sub.info.split(/\s+/)[0] || null,
          });
          const labelMatch = sub.info.match(/\[(.+?)\]/);
          const label = labelMatch ? labelMatch[1]! : sub.info.split(/\s+/)[0] || "code";
          tabs.push({
            label,
            lang: sub.info.split(/\s+/)[0] || null,
            html: placeholder,
            code: sub.content,
          });
        }
        blocks.push({ type: "codeGroup", tabs });
        i = closeIdx + 1;
        continue;
      }

      if (CALLOUT_KINDS.has(kindName as CalloutKind)) {
        // Prefer the pre-parsed inline tokens from containers.ts (which lets
        // backticks/emphasis/links inside the title render properly). Fall
        // back to wrapping the raw info string when there's no meta — covers
        // legacy paths and the AST-pretty-printer's tests.
        const titleMeta = tok.meta as { titleTokens?: Token[] } | null | undefined;
        let title: Inline[] | undefined;
        if (titleMeta?.titleTokens && titleMeta.titleTokens.length > 0) {
          title = inlinesFromTokens(titleMeta.titleTokens, opts);
        } else if (info) {
          title = [{ type: "text", value: info }];
        }
        const inner = parseBlocks(
          tokens,
          i + 1,
          closeIdx,
          fences,
          mermaidBlocks,
          includes,
          codeIncludes,
          opts,
        ).blocks;
        blocks.push({
          type: "callout",
          kind: kindName as CalloutKind,
          title,
          children: inner,
        });
        i = closeIdx + 1;
        continue;
      }

      // Unknown container: treat as blockquote.
      const inner = parseBlocks(
        tokens,
        i + 1,
        closeIdx,
        fences,
        mermaidBlocks,
        includes,
        codeIncludes,
        opts,
      ).blocks;
      blocks.push({ type: "blockquote", children: inner });
      i = closeIdx + 1;
      continue;
    }

    // OPS triple-colon self-closing leaves.
    if (tok.type === "ops_image") {
      const m = (tok.meta ?? {}) as Record<string, string>;
      blocks.push({
        type: "opsImage",
        src: opts.rewriteImage ? opts.rewriteImage(m.source ?? "") : (m.source ?? ""),
        alt: m["alt-text"] ?? m.alt ?? "",
        kind: (m.type as "content" | "icon" | "complex" | undefined) ?? "content",
        lightbox: m.lightbox || undefined,
        border: m.border === "true" ? true : m.border === "false" ? false : undefined,
        caption: undefined,
      });
      i++;
      continue;
    }
    if (tok.type === "ops_video") {
      const m = (tok.meta ?? {}) as Record<string, string>;
      blocks.push({
        type: "opsVideo",
        src: m.source ?? "",
        title: m.title || undefined,
      });
      i++;
      continue;
    }

    // OPS triple-colon paired blocks: row / column / zone / moniker.
    if (tok.type === "ops_row_open") {
      const closeIdx = findMatchingClose(tokens, i, "ops_row_open", "ops_row_close", end);
      const inner = parseBlocks(
        tokens,
        i + 1,
        closeIdx,
        fences,
        mermaidBlocks,
        includes,
        codeIncludes,
        opts,
      ).blocks;
      blocks.push({ type: "opsRow", children: inner });
      i = closeIdx + 1;
      continue;
    }
    if (tok.type === "ops_column_open") {
      const closeIdx = findMatchingClose(tokens, i, "ops_column_open", "ops_column_close", end);
      const inner = parseBlocks(
        tokens,
        i + 1,
        closeIdx,
        fences,
        mermaidBlocks,
        includes,
        codeIncludes,
        opts,
      ).blocks;
      const m = (tok.meta ?? {}) as Record<string, string>;
      const span = m.span ? parseInt(m.span, 10) : undefined;
      blocks.push({
        type: "opsColumn",
        span: Number.isFinite(span) ? (span as number) : undefined,
        children: inner,
      });
      i = closeIdx + 1;
      continue;
    }
    if (tok.type === "ops_zone_open") {
      const closeIdx = findMatchingClose(tokens, i, "ops_zone_open", "ops_zone_close", end);
      const inner = parseBlocks(
        tokens,
        i + 1,
        closeIdx,
        fences,
        mermaidBlocks,
        includes,
        codeIncludes,
        opts,
      ).blocks;
      const m = (tok.meta ?? {}) as Record<string, string>;
      blocks.push({
        type: "opsZone",
        pivot: m.pivot || undefined,
        target: m.target || undefined,
        children: inner,
      });
      i = closeIdx + 1;
      continue;
    }
    if (tok.type === "ops_moniker_open") {
      const closeIdx = findMatchingClose(tokens, i, "ops_moniker_open", "ops_moniker_close", end);
      const inner = parseBlocks(
        tokens,
        i + 1,
        closeIdx,
        fences,
        mermaidBlocks,
        includes,
        codeIncludes,
        opts,
      ).blocks;
      const m = (tok.meta ?? {}) as Record<string, string>;
      blocks.push({
        type: "opsMoniker",
        range: m.range ?? "",
        children: inner,
      });
      i = closeIdx + 1;
      continue;
    }

    // DocFX tabs (already wrapped by the ops-tabs core ruler into a single token
    // carrying per-tab inner token slices).
    if (tok.type === "ops_tabs") {
      const m = tok.meta as {
        tabs: Array<{ id: string; title: string; innerTokens: Token[] }>;
      };
      const tabs = m.tabs.map((t) => ({
        id: t.id,
        title: t.title,
        children: parseBlocks(
          t.innerTokens,
          0,
          t.innerTokens.length,
          fences,
          mermaidBlocks,
          includes,
          codeIncludes,
          opts,
        ).blocks,
      }));
      blocks.push({ type: "opsTabs", tabs });
      i++;
      continue;
    }

    // OPS [!INCLUDE] / [!code-lang]: leave a placeholder html block; the host
    // resolver fetches the file and the post-pass splices in the result.
    if (tok.type === "ops_include") {
      const placeholder = `__VELLUM_INCLUDE_${includes.length}__`;
      const m = (tok.meta ?? {}) as { path: string };
      includes.push({ placeholder, path: m.path });
      blocks.push({ type: "html", value: placeholder });
      i++;
      continue;
    }
    if (tok.type === "ops_code_include") {
      const placeholder = `__VELLUM_CODE_INCLUDE_${codeIncludes.length}__`;
      const meta = tok.meta as import("./ops-includes").CodeIncludeMeta;
      codeIncludes.push({ placeholder, meta });
      blocks.push({ type: "html", value: placeholder });
      i++;
      continue;
    }

    if (tok.type === "html_block") {
      // Detect the GFM-alerts rewrite that emits a callout open div.
      const alertOpen = tok.content.match(
        /^<div class="vellum-callout vellum-callout-(\w+)"[^>]*>\s*<p class="vellum-callout-title">(.*?)<\/p>/,
      );
      if (alertOpen) {
        const kind = alertOpen[1]!.toLowerCase();
        if (CALLOUT_KINDS.has(kind as CalloutKind)) {
          // Find the matching </div> close marker.
          let depth = 1,
            k = i + 1;
          for (; k < end; k++) {
            const tk = tokens[k]!;
            if (tk.type === "html_block" && tk.content.trim() === "</div>") {
              depth--;
              if (depth === 0) break;
            }
          }
          const inner = parseBlocks(
            tokens,
            i + 1,
            k,
            fences,
            mermaidBlocks,
            includes,
            codeIncludes,
            opts,
          ).blocks;
          // GFM alert titles are simple labels (NOTE / TIP / WARNING / …) with
          // no inline syntax — wrap as a single text node so the Block.title
          // type stays uniformly Inline[].
          const alertTitle: Inline[] | undefined = alertOpen[2]
            ? [{ type: "text", value: alertOpen[2] }]
            : undefined;
          blocks.push({
            type: "callout",
            kind: kind as CalloutKind,
            title: alertTitle,
            children: inner,
          });
          i = k + 1;
          continue;
        }
      }
      blocks.push({ type: "html", value: tok.content });
      i++;
      continue;
    }

    // Anything we don't model yet (footnote refs, custom plugins) - emit as HTML.
    if (tok.type === "inline" && tok.children) {
      const children = inlinesFromTokens(tok.children, opts);
      blocks.push({ type: "paragraph", children });
      i++;
      continue;
    }

    i++;
  }
  return { blocks, end: i };
}

function parseTable(
  tokens: Token[],
  openIdx: number,
  closeIdx: number,
  opts: AstBuildOptions,
): Block {
  const head: Array<{
    align: "left" | "center" | "right" | null;
    children: Inline[];
  }> = [];
  const rows: Array<Array<{ align: "left" | "center" | "right" | null; children: Inline[] }>> = [];
  let inHead = false;
  let currentRow: Array<{
    align: "left" | "center" | "right" | null;
    children: Inline[];
  }> | null = null;
  for (let i = openIdx + 1; i < closeIdx; i++) {
    const t = tokens[i]!;
    if (t.type === "thead_open") inHead = true;
    else if (t.type === "thead_close") inHead = false;
    else if (t.type === "tr_open") currentRow = [];
    else if (t.type === "tr_close") {
      if (currentRow) {
        if (inHead) head.push(...currentRow);
        else rows.push(currentRow);
      }
      currentRow = null;
    } else if (t.type === "th_open" || t.type === "td_open") {
      const style = t.attrGet("style") ?? "";
      const align = style.includes("center")
        ? "center"
        : style.includes("right")
          ? "right"
          : style.includes("left")
            ? "left"
            : null;
      const inline = tokens[i + 1]!;
      const children = inline.children ? inlinesFromTokens(inline.children, opts) : [];
      currentRow?.push({ align, children });
      i += 2; // skip inline + close
    }
  }
  return { type: "table", head, rows };
}

// Convert markdown-it inline children into our Inline tree (nested).
function inlinesFromTokens(tokens: Token[], opts: AstBuildOptions): Inline[] {
  const out: Inline[] = [];
  const stack: Inline[][] = [out];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    const top = stack[stack.length - 1]!;
    switch (t.type) {
      case "text":
        top.push({ type: "text", value: t.content });
        break;
      case "softbreak":
        top.push({ type: "text", value: " " });
        break;
      case "hardbreak":
        top.push({ type: "br" });
        break;
      case "code_inline":
        top.push({ type: "code", value: t.content });
        break;
      case "strong_open":
        top.push({ type: "strong", children: [] });
        stack.push((top[top.length - 1] as Extract<Inline, { type: "strong" }>).children);
        break;
      case "em_open":
        top.push({ type: "em", children: [] });
        stack.push((top[top.length - 1] as Extract<Inline, { type: "em" }>).children);
        break;
      case "s_open":
        top.push({ type: "del", children: [] });
        stack.push((top[top.length - 1] as Extract<Inline, { type: "del" }>).children);
        break;
      case "strong_close":
      case "em_close":
      case "s_close":
        stack.pop();
        break;
      case "link_open": {
        const href = t.attrGet("href") ?? "";
        const title = t.attrGet("title") ?? undefined;
        const external = /^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:");
        const rewritten =
          external || href.startsWith("#") || !opts.rewriteLink ? href : opts.rewriteLink(href);
        top.push({
          type: "link",
          href: rewritten,
          title,
          external,
          children: [],
        });
        stack.push((top[top.length - 1] as Extract<Inline, { type: "link" }>).children);
        break;
      }
      case "link_close":
        stack.pop();
        break;
      case "image": {
        const src = t.attrGet("src") ?? "";
        const alt = t.children?.map((c: Token) => c.content).join("") ?? "";
        const title = t.attrGet("title") ?? undefined;
        const finalSrc = opts.rewriteImage ? opts.rewriteImage(src) : src;
        top.push({ type: "image", src: finalSrc, alt, title });
        break;
      }
      case "html_inline": {
        // PascalCase tags get folded into structured `reactComponent` nodes so
        // the client renderer can mount the real component instead of dumping
        // raw HTML (which the browser ignores for unknown custom elements).
        // markdown-it emits `<Button>text</Button>` as three inline tokens
        // (open / text / close); we use the same children-stack the bold/em
        // handlers use to nest the text under the component.
        const content = t.content;
        const selfClose = content.match(/^<([A-Z][A-Za-z0-9]*)\s*([^>]*?)\s*\/>\s*$/);
        if (selfClose) {
          top.push({
            type: "reactComponent",
            name: selfClose[1]!,
            props: parseHtmlAttrs(selfClose[2] ?? ""),
            children: [],
          });
          break;
        }
        const openMatch = content.match(/^<([A-Z][A-Za-z0-9]*)\s*([^>]*)>$/);
        if (openMatch) {
          const node: Inline = {
            type: "reactComponent",
            name: openMatch[1]!,
            props: parseHtmlAttrs(openMatch[2] ?? ""),
            children: [],
          };
          top.push(node);
          stack.push((node as Extract<Inline, { type: "reactComponent" }>).children);
          break;
        }
        const closeMatch = content.match(/^<\/([A-Z][A-Za-z0-9]*)\s*>$/);
        if (closeMatch && stack.length > 1) {
          // Pop the children frame opened by the matching `<Tag>`. If the
          // markup is malformed (close without matching open at the right
          // level) we'd risk popping a different frame — checking the parent
          // node's name guards against that.
          const parent = parentOfTop(stack, out);
          if (parent?.type === "reactComponent" && parent.name === closeMatch[1]) {
            stack.pop();
            break;
          }
        }
        top.push({ type: "html", value: content });
        break;
      }
      case "ops_xref": {
        const m = (t.meta ?? {}) as { target: string; display?: string };
        const resolved = opts.resolveXref ? opts.resolveXref(m.target) : null;
        top.push({
          type: "xref",
          target: m.target,
          href: resolved?.href,
          display: m.display ?? resolved?.name,
        });
        break;
      }
      default:
        // Unknown - try to keep something visible.
        if (t.content) top.push({ type: "text", value: t.content });
        break;
    }
    i++;
  }
  return out;
}

// Locates the Inline node whose children array currently sits on top of the
// children stack. Returns null when top is the root array — that means we
// don't actually have a parent component frame to pop.
function parentOfTop(stack: Inline[][], root: Inline[]): Inline | null {
  const top = stack[stack.length - 1];
  if (top === root) return null;
  // Walk the stack from the bottom and find the entry whose children === top.
  // The stack always nests, so this is O(depth) and depth is tiny in practice.
  for (let depth = stack.length - 2; depth >= 0; depth--) {
    const frame = stack[depth]!;
    for (const node of frame) {
      if ("children" in node && (node as { children: unknown }).children === top) return node;
    }
  }
  return null;
}

// Parse attribute strings from HTML opening tags ("a=\"b\" c='d' bare"). Used
// when folding inline `<Comp ...>` tags into structured reactComponent nodes.
// Values that look numeric / boolean are coerced so authors can write
// `<Comp size={3} />` style JSX-ish props (typed as string by HTML but read
// as numbers by FluentUI when appropriate).
function parseHtmlAttrs(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const key = m[1]!;
    const raw = m[2] ?? m[3] ?? m[4];
    const outKey = key === "class" ? "className" : key === "for" ? "htmlFor" : key;
    if (raw === undefined) out[outKey] = true;
    else if (raw === "true") out[outKey] = true;
    else if (raw === "false") out[outKey] = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) out[outKey] = Number(raw);
    else out[outKey] = raw;
  }
  return out;
}

function findMatchingClose(
  tokens: Token[],
  openIdx: number,
  openType: string,
  closeType: string,
  end: number,
): number {
  let depth = 1;
  for (let i = openIdx + 1; i < end; i++) {
    if (tokens[i]!.type === openType) depth++;
    else if (tokens[i]!.type === closeType) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return end - 1;
}

function walkBlocks(blocks: Block[], fn: (b: Block) => void): void {
  for (const b of blocks) {
    fn(b);
    if (b.type === "blockquote" || b.type === "callout") walkBlocks(b.children, fn);
    else if (b.type === "list") b.items.forEach((it) => walkBlocks(it.children, fn));
    // OPS containers: fences, mermaid, etc. living inside a row/column/zone/
    // moniker/tabs need the same placeholder resolution treatment as anything
    // at the top level. Without this, code blocks inside :::column::: render
    // their __VELLUM_FENCE_N__ literal.
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
