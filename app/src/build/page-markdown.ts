// The Markdown published next to each page, at the page's URL plus `.md`:
// the page's source file as written, except for its links.
//
// A relative link in the source is relative to the source file, which isn't
// where the Markdown is published (`guide/index.md` is published as
// `guide.md`, a level up), and an absolute one is relative to the docs root,
// not the site. So each link is resolved the way the HTML page resolves it:
// a link to a page points at that page's Markdown, and one to another file
// at the URL the page links. Images keep their paths, as on the page, which
// is in the same directory as its Markdown. External links, anchors, the
// frontmatter, code and OPS include directives (their files aren't pages)
// are left as they are. What's code is what the page's render parsed as
// code.

import { escapeHtml, unescapeAll } from "markdown-it/lib/common/utils.mjs";
import { normalizeInternal, type RenderOutput } from "./markdown/index";
import type { LinkContext } from "./markdown/links";
import { markdownUrl } from "./routes";

// Blocks whose lines are kept as written.
const VERBATIM = new Set([
  "fence",
  "code_block",
  "math_block",
  "math_block_eqno",
  "ops_include",
  "ops_code_include",
]);

// A link destination: `<...>`, or no spaces and balanced parentheses one
// level deep. Either may hold backslash escapes.
const DEST =
  /<(?:\\.|[^<>\n\\])*>|(?:\\.|[^\s()<>\\])+(?:\((?:\\.|[^\s()\\])*\)(?:\\.|[^\s()<>\\])*)*/.source;

// What the rewriter finds in a block's text.
const LINK = new RegExp(
  [
    // A code span, kept as is. It starts at a whole run of backticks that
    // isn't escaped and ends at the next run as long, on any of the block's
    // lines.
    /(?<![\\`])(?<ticks>`+)(?!`)[\s\S]*?(?<!`)\k<ticks>(?!`)/.source,
    // An inline link's destination, after a `]` not escaped by an odd
    // number of backslashes.
    `(?<inline>${/(?<!(?<!\\)(?:\\\\)*\\)\]\(\s*/.source})(?<dest>${DEST})`,
    // A link reference definition's (`[label]: dest`, not a footnote's
    // `[^1]:`), maybe in a blockquote or a list item. A title or nothing
    // follows its destination.
    `^(?<ref>${/(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?\[(?!\^)[^\]\n]+\]:[ \t]*/.source})` +
      `(?<refDest>${/<(?:\\.|[^<>\n\\])*>|[^\s<>]+/.source})${/(?=[ \t]*(?:\r?$|["'(]))/.source}`,
    // An `<a>` tag's href.
    `(?<a>${/<a\s(?:[^>"']|"[^"]*"|'[^']*')*?(?<=\s)href\s*=\s*/.source})` +
      `(?<href>${/"[^"]*"|'[^']*'|[^\s"'=<>`]+/.source})`,
  ].join("|"),
  "gm",
);

// `body` and `blocks` are from the page's render of `source`.
export function pageMarkdown(
  source: string,
  { body, blocks }: Pick<RenderOutput, "body" | "blocks">,
  ctx: LinkContext,
): string {
  // gray-matter's body is the end of the source, after the frontmatter.
  if (!source.endsWith(body)) return source;
  const front = source.slice(0, source.length - body.length);
  const verbatim = new Set<number>();
  // A line that looks like a reference definition in a paragraph is prose:
  // the render didn't take it for one.
  const prose = new Set<number>();
  // An HTML block is kept as written, as the page keeps it. Lines with
  // inline content aren't one: a GitHub alert's blockquote becomes an
  // `html_block` around its paragraphs.
  const html = new Set<number>();
  const inline = new Set<number>();
  const starts = new Set<number>();
  for (const { type, map } of blocks) {
    starts.add(map[0]);
    const lines =
      (VERBATIM.has(type) && verbatim) ||
      (type === "paragraph_open" && prose) ||
      (type === "html_block" && html) ||
      (type === "inline" && inline);
    if (lines) for (let i = map[0]; i < map[1]; i++) lines.add(i);
  }
  for (const i of html) if (!inline.has(i)) verbatim.add(i);

  // Lines go through in runs a code span can stretch across: inside one
  // block, up to a blank line.
  const out: string[] = [];
  let run: string[] = [];
  let first = 0;
  const flush = () => {
    if (run.length) out.push(rewrite(run.join("\n"), first, prose, ctx));
    run = [];
  };
  body.split("\n").forEach((line, i) => {
    if (verbatim.has(i) || !line.trim()) {
      flush();
      out.push(line);
      return;
    }
    if (starts.has(i)) flush();
    if (!run.length) first = i;
    run.push(line);
  });
  flush();
  return front + out.join("\n");
}

// `text` is lines of the body from line `first`.
function rewrite(text: string, first: number, prose: Set<number>, ctx: LinkContext): string {
  return text.replace(LINK, (match: string, ...args: unknown[]) => {
    const offset = args.at(-3) as number;
    const g = args.at(-1) as Record<string, string | undefined>;
    if (g.inline !== undefined) {
      // The page keeps an image's path as written.
      return isImage(text, offset) ? match : g.inline + destination(g.dest!, ctx);
    }
    if (g.ref !== undefined) {
      const line = first + (text.slice(0, offset).match(/\n/g)?.length ?? 0);
      return prose.has(line) ? match : g.ref + destination(g.refDest!, ctx);
    }
    if (g.a !== undefined) return g.a + attribute(g.href!, ctx);
    return match;
  });
}

// An `<a>` href as written, quoted or not, and as the rewritten URL. Its
// entities are decoded (unescapeAll also drops a backslash before
// punctuation, which an href hardly has).
function attribute(value: string, ctx: LinkContext): string {
  const quoted = /^["']/.test(value);
  const out = linkHref(unescapeAll(quoted ? value.slice(1, -1) : value), ctx);
  return out === null ? value : `"${escapeHtml(out)}"`;
}

// Whether the `](` at `at` ends an image's alt text: its `[` follows a `!`.
function isImage(text: string, at: number): boolean {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (text[i - 1] === "\\") continue;
    if (text[i] === "]") depth++;
    else if (text[i] === "[" && depth-- === 0) return text[i - 1] === "!";
  }
  return false;
}

// A destination as written, with its escapes and entities, and as the
// rewritten URL: in `<...>` when it was, or has spaces or parentheses.
function destination(dest: string, ctx: LinkContext): string {
  const angled = dest.startsWith("<");
  const href = unescapeAll(angled ? dest.slice(1, -1) : dest);
  const out = linkHref(href, ctx)?.replace(/[<>]/g, encodeURIComponent);
  if (out === undefined) return dest;
  return angled || /[\s()]/.test(out) ? `<${out}>` : out;
}

// What a link to `href` leads to from the Markdown: a page's Markdown, or
// the site URL the page links for another file. Null keeps it as written.
function linkHref(href: string, ctx: LinkContext): string | null {
  // External (`https:`, `mailto:`, OPS `xref:`), protocol-relative, or on
  // this page.
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href) || /^(\/\/|#|\?)/.test(href)) return null;
  const url = normalizeInternal(href, ctx);
  const cut = url.search(/[?#]/);
  const path = cut < 0 ? url : url.slice(0, cut);
  // A file: an extension other than `.md`, which normalizeInternal drops.
  // It holds a letter, so `v0.4` is a page.
  if (/\.[a-z\d]*[a-z][a-z\d]*$/i.test(path)) return url;
  return markdownUrl(path) + url.slice(path.length);
}
