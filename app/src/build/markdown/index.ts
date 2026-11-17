// Markdown rendering pipeline. Parses to markdown-it tokens, runs custom passes for
// anchors/containers/alerts, then converts to the shared AST that the FluentUI renderer
// consumes on the client.

import MarkdownIt from "markdown-it";
import matter from "gray-matter";
import attrs from "markdown-it-attrs";
import { full as emoji } from "markdown-it-emoji";
import footnote from "markdown-it-footnote";
// @ts-expect-error - no published types
import taskLists from "markdown-it-task-lists";
import mathjax3 from "markdown-it-mathjax3";

type MdPlugin = (md: MarkdownIt) => void;
type MdPluginWithOptions = (md: MarkdownIt, options?: unknown) => void;

import { applyContainers } from "./containers";
import { applyGithubAlerts } from "./github-alerts";
import { applyAnchorsAndOutline, nestOutline } from "./anchors";
import { applyOpsTripleColon } from "./ops";
import { applyOpsTabs } from "./ops-tabs";
import { applyOpsIncludes } from "./ops-includes";
import { applyOpsXref } from "./ops-xref";
import type { LinkContext } from "./links";
import {
  tokensToAst,
  type IncludeRenderer,
  type CodeIncludeRenderer,
  type XrefResolver,
} from "./ast";
import type { OutlineNode } from "../../shared/types";
import type { MarkdownAst } from "../../shared/markdown";

export interface RenderInput {
  source: string;
  linkContext: LinkContext;
  // Optional hook for rendering diagram code blocks to themed SVGs (e.g.
  // mermaid via Kroki). When provided, the AST builder calls it in parallel
  // with the code fence batch. Either palette may come back null — the client
  // falls back to its own mermaid bundle for whichever palette is missing.
  renderDiagram?: (code: string) => Promise<{ light: string | null; dark: string | null }>;
  // OPS [!INCLUDE]: fetch the referenced markdown file. The AST builder parses
  // it through this same pipeline and splices the resulting blocks in-place.
  resolveInclude?: IncludeRenderer;
  // OPS [!code-lang]: fetch the referenced source file. The builder slices it
  // according to range/region/start-end and turns it into a code block.
  resolveCodeInclude?: CodeIncludeRenderer;
  // OPS xref:uid resolution. Returns an href + display name when the uid is
  // present in the repo's xrefmap; null when unresolved (renderer falls back
  // to monospace text).
  resolveXref?: XrefResolver;
}

export interface RenderOutput {
  ast: MarkdownAst;
  frontmatter: Record<string, unknown>;
  outline: OutlineNode[];
  flatOutline: OutlineNode[];
  title: string;
  description?: string;
  // The source without its frontmatter, and the lines of its blocks as
  // parsed, for editing the source by line (page-markdown.ts).
  body: string;
  blocks: SourceBlock[];
}

// A block token: its type (`paragraph_open`, `fence`, ...) and the lines it
// spans in the body, end exclusive.
export interface SourceBlock {
  type: string;
  map: [number, number];
}

// Walk the token stream and convert math_block / math_inline into html_block /
// html_inline tokens whose content is the renderer's SVG output. After this
// runs, the AST builder treats math the same as any other inlined HTML — no
// new AST node type, no client-side math library.
function preRenderMath(tokens: Array<Token>, md: MarkdownIt): void {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.type === "math_block") {
      const rule = md.renderer.rules.math_block;
      if (rule) {
        const html = rule(tokens, i, md.options, {}, md.renderer);
        tok.type = "html_block";
        tok.content = html;
        tok.block = true;
      }
      continue;
    }
    if (tok.children) {
      for (let j = 0; j < tok.children.length; j++) {
        const child = tok.children[j]!;
        if (child.type !== "math_inline") continue;
        const rule = md.renderer.rules.math_inline;
        if (rule) {
          const html = rule(tok.children, j, md.options, {}, md.renderer);
          child.type = "html_inline";
          child.content = html;
        }
      }
    }
  }
}

type Token = ReturnType<MarkdownIt["parse"]>[number];

function buildMd(outlineSink: { outline: OutlineNode[] }): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
  });

  md.use(attrs as MdPluginWithOptions, { allowedAttributes: ["id", "class", /^data-.*/] });
  md.use(emoji as MdPlugin);
  md.use(footnote as MdPlugin);
  md.use(taskLists as MdPluginWithOptions, { enabled: true, label: false, lineNumber: false });
  // MathJax: renders $inline$ and $$display$$ to inline SVG at parse time so
  // the client doesn't need a math library. Output is HTML, which the AST
  // builder lifts into html_inline / html_block tokens and the renderer drops
  // into the page via dangerouslySetInnerHTML.
  md.use(mathjax3 as MdPluginWithOptions);

  applyContainers(md);
  applyGithubAlerts(md);
  // OPS extensions. Order matters:
  //   - triple-colon BEFORE paragraph so :::image::: doesn't get eaten as text
  //   - tabs run AFTER block tokenization (core ruler) to inspect headings
  //   - includes BEFORE paragraph so `[!INCLUDE ...]` lines are claimed
  //   - xref runs at inline + post-inline to convert link tokens
  applyOpsTripleColon(md);
  applyOpsTabs(md);
  applyOpsIncludes(md);
  applyOpsXref(md);
  applyAnchorsAndOutline(md, outlineSink);

  return md;
}

// Resolves an internal href so it lands inside this repo's URL space.
// VitePress / Markdown convention: an absolute path like "/getting-started" is
// treated as docs-root-relative — for us that means the current repo's root.
// We also handle locale-prefixed absolute paths (e.g. "/zh/getting-started" from a
// localized hero) by collapsing them into the repo's locale prefix.
export function normalizeInternal(href: string, c: LinkContext): string {
  if (/^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("#")) return href;
  // Cross-repo xref: `@other-repo/page`.
  if (href.startsWith("@")) {
    const m = href.match(/^@([a-z0-9-]+)\/(.*)$/i);
    if (m) {
      const resolved = c.resolveXref(m[1]!, m[2]!);
      if (resolved) return resolved;
    }
  }
  const hashIdx = href.indexOf("#");
  const queryIdx = href.indexOf("?");
  let path = href;
  let suffix = "";
  if (hashIdx >= 0 || queryIdx >= 0) {
    const cut = [hashIdx, queryIdx]
      .filter((n) => n >= 0)
      .reduce((a, b) => Math.min(a, b), Infinity);
    path = href.slice(0, cut);
    suffix = href.slice(cut);
  }
  // `index.md` (bare, or after a slash) is its directory's page.
  path = path.replace(/\.md$/i, "").replace(/(^|\/)index$/i, "$1");

  const repoBase = c.repoUrlBase.replace(/\/$/, "");
  const localePrefix = c.localePrefix ?? "";
  // The URL the page is served at: no trailing slash, and a locale root's
  // README is its index page.
  const served = (p: string) => {
    let out = p.replace(/\/+/g, "/");
    if (out === `${repoBase}/README`) out = repoBase;
    if (out.length > 1) out = out.replace(/\/$/, "");
    return `${out}${suffix}`;
  };

  if (path.startsWith("/")) {
    // Already includes the full repo+locale base? Leave alone.
    if (path === repoBase || path.startsWith(`${repoBase}/`)) {
      return served(path);
    }
    // Locale-prefixed absolute path on a page whose repoBase already encodes
    // the same locale (e.g. /zh/getting-started written in docs/zh/index.md).
    // Strip the leading /<locale> so we don't end up with /zh/zh/repo/...
    // With the locale-first URL shape, repoBase STARTS with `/{localePrefix}/`,
    // so author-written `/zh/foo` should resolve under the same repo by
    // dropping the leading `/zh` and prepending repoBase.
    // Check both the URL prefix (e.g. "zh-CN") and the locale code (e.g.
    // "zh") — authors in source files use the code in docs-root-relative
    // links because source directories are named by code, not by URL prefix.
    // The page's source directory goes first: with `localeDirs` it can be
    // deeper than the code (`en/v0.4`), and the longer match must win.
    const localeCandidates = [c.localeSrcDir ?? "", localePrefix, c.localeCode ?? ""];
    for (const lp of localeCandidates) {
      if (
        lp &&
        repoBase.startsWith(`/${localePrefix}/`) &&
        (path === `/${lp}` || path.startsWith(`/${lp}/`))
      ) {
        const stripped = path.slice(`/${lp}`.length) || "/";
        return served(`${repoBase}${stripped}`);
      }
    }
    // Absolute path inside the current repo's URL space - prepend the repo base.
    return served(`${repoBase}${path}`);
  }

  // Relative path — resolve against the current page's directory.
  // Canonical URLs have no trailing slash, so we have to
  // figure out ourselves whether the URL points at a file or a directory:
  //   - Index page (URL like `/vl-handbook`)  → URL IS the directory.
  //   - Sub-page  (URL like `/vl-handbook/x`) → directory is the URL up
  //     to and including the last slash.
  // Without the pageIsIndex branch, `./foo` from `/vl-handbook` would
  // resolve to `/foo` (treating the slug as a file at the site root)
  // instead of the intended `/vl-handbook/foo`.
  let base: string;
  if (c.pageIsIndex) {
    base = c.currentUrl.endsWith("/") ? c.currentUrl : `${c.currentUrl}/`;
  } else if (c.currentUrl.endsWith("/")) {
    base = c.currentUrl;
  } else {
    base = c.currentUrl.slice(0, c.currentUrl.lastIndexOf("/") + 1);
  }
  const url = new URL(path, `https://x${base}`);
  return served(url.pathname);
}

// Inline-only MD instance for frontmatter fields like hero.text, hero.tagline, and
// feature.details. We don't want block parsing (headings, lists) inside a card title,
// just basic inline formatting — code spans, emphasis, links, emoji.
function buildInlineMd(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: false,
  });
  md.use(emoji as MdPlugin);
  return md;
}

function renderInline(
  md: MarkdownIt,
  value: unknown,
  linkContext: LinkContext,
): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const html = md.renderInline(value);
  // Rewrite internal hrefs the same way the body renderer does, so a frontmatter
  // link like /getting-started lands inside the right repo.
  return html.replace(
    /href="([^"]+)"/g,
    (_, h) => `href="${escapeAttr(normalizeInternal(h, linkContext))}"`,
  );
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Pre-renders inline markdown in known home-layout frontmatter fields so the
// client can drop them in via dangerouslySetInnerHTML. Covers both the
// VitePress `home` layout (hero + features) and the Microsoft Learn-style
// `ms-learn` layout (hero + getStarted/products/roles/resources sections).
// Fields not present are left alone; non-string values are ignored.
function processHomeFrontmatter(front: Record<string, unknown>, linkContext: LinkContext): void {
  const md = buildInlineMd();
  const inline = (v: unknown) => renderInline(md, v, linkContext);
  const applyKeys = (obj: Record<string, unknown> | undefined, keys: readonly string[]) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of keys) {
      const out = inline(obj[key]);
      if (out !== undefined) obj[key] = out;
    }
  };

  // VitePress `home` hero — `name` is the gradient headline, `text` is the
  // sub-headline, `tagline` is the paragraph below.
  applyKeys(front.hero as Record<string, unknown> | undefined, ["name", "text", "tagline"]);

  // VitePress `home` features.
  if (Array.isArray(front.features)) {
    for (const f of front.features as Array<Record<string, unknown>>) {
      applyKeys(f, ["title", "details", "linkText"]);
    }
  }

  // ms-learn hero — `title` is the gradient headline, `tagline` the prose.
  // `searchPlaceholder` is an <input> placeholder, NOT user-visible content,
  // so we leave it un-rendered.
  applyKeys(front.hero as Record<string, unknown> | undefined, ["title"]);

  // ms-learn section grids. Each section has a title + description, and items
  // each have title / description / linkText. The same shape (Section { title,
  // description, items: [{ title, description, linkText }] }) is used for
  // getStarted, products, roles, and resources.
  for (const sectionKey of ["getStarted", "products", "roles", "resources"] as const) {
    const section = front[sectionKey] as Record<string, unknown> | undefined;
    if (!section || typeof section !== "object") continue;
    applyKeys(section, ["title", "description"]);
    const items = section.items;
    if (Array.isArray(items)) {
      for (const item of items as Array<Record<string, unknown>>) {
        applyKeys(item, ["title", "description", "linkText"]);
      }
    }
  }
}

export async function renderMarkdown(input: RenderInput): Promise<RenderOutput> {
  const { source, linkContext, renderDiagram, resolveInclude, resolveCodeInclude, resolveXref } =
    input;
  // The options object turns off gray-matter's cache, which hands every
  // parse of the same text one shared `data` object: processHomeFrontmatter
  // mutates it, so a second render would escape its output again.
  const parsed = matter(source, {});
  const front = parsed.data as Record<string, unknown>;
  const body = parsed.content;

  processHomeFrontmatter(front, linkContext);

  const outlineSink = { outline: [] as OutlineNode[] };
  const md = buildMd(outlineSink);
  const tokens = md.parse(body, {});
  // Before preRenderMath turns math blocks into HTML.
  const blocks = tokens.flatMap((t) => (t.map ? [{ type: t.type, map: t.map }] : []));
  // markdown-it-mathjax3 emits math_inline / math_block tokens, not HTML, and
  // expects md.renderer to be invoked at the end. We bypass that pipeline (we
  // build our own AST from the token stream), so the math tokens would slip
  // through as raw text. Replace them with html_inline / html_block tokens
  // carrying the renderer's SVG output.
  preRenderMath(tokens, md);

  const ast = await tokensToAst(tokens, {
    rewriteLink: (href) => normalizeInternal(href, linkContext),
    rewriteImage: (src) => src,
    renderDiagram,
    resolveInclude,
    resolveCodeInclude,
    resolveXref,
  });

  // Title: explicit frontmatter > first h1 > derived from path.
  let title: string = typeof front.title === "string" ? (front.title as string) : "";
  if (!title) {
    const h1 = outlineSink.outline.find((n) => n.depth === 1);
    title = h1?.text ?? "";
  }
  const description =
    typeof front.description === "string" ? (front.description as string) : undefined;
  const nested = nestOutline(outlineSink.outline);

  return {
    ast,
    frontmatter: front,
    outline: nested,
    flatOutline: outlineSink.outline,
    body,
    blocks,
    title,
    description,
  };
}
