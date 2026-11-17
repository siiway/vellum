// The Markdown published next to each page, at the page's URL plus `.md`:
// the page's source file as written, except for its links to other pages.
//
// A relative link in the source is relative to the source file, which isn't
// where the Markdown is published (`guide/index.md` is published as
// `guide.md`, a level up), and an absolute one is relative to the docs root,
// not the site. So each link to a page is resolved the way the HTML page
// resolves it and points at that page's Markdown. Links to other files
// (images, downloads), external links and anchors are left as they are, and
// so are the frontmatter, code and OPS include directives (their files
// aren't pages). What's code is what the page's render parsed as code.

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

// In a block's text: a code span (kept as is), an inline link's destination
// after `](`, or a link reference definition's (`[label]: dest`, not a
// footnote's `[^1]:`). A code span starts at a whole run of backticks that
// isn't escaped and ends at the next run as long, on any of the block's
// lines. A destination is `<...>`, or has no spaces and balanced parentheses
// one level deep. A definition may sit in a blockquote or a list item, and
// its destination is followed by a title or nothing.
const LINK =
  /(?<![\\`])(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)|((?<!\\)\]\(\s*)(<[^<>\n]*>|[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)|^((?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?\[(?!\^)[^\]\n]+\]:[ \t]*)(<[^<>\n]*>|[^\s<>]+)(?=[ \t]*(?:\r?$|["'(]))/gm;

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
  const starts = new Set<number>();
  for (const { type, map } of blocks) {
    starts.add(map[0]);
    const lines = VERBATIM.has(type) ? verbatim : type === "paragraph_open" ? prose : null;
    if (lines) for (let i = map[0]; i < map[1]; i++) lines.add(i);
  }

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
  return text.replace(
    LINK,
    (
      match: string,
      _ticks: string | undefined,
      inline: string | undefined,
      dest: string | undefined,
      ref: string | undefined,
      refDest: string | undefined,
      offset: number,
    ) => {
      if (inline !== undefined) return inline + destination(dest!, ctx);
      if (ref !== undefined) {
        const line = first + (text.slice(0, offset).match(/\n/g)?.length ?? 0);
        return prose.has(line) ? match : ref + destination(refDest!, ctx);
      }
      return match;
    },
  );
}

function destination(dest: string, ctx: LinkContext): string {
  const angled = dest.startsWith("<");
  const href = angled ? dest.slice(1, -1) : dest;
  const out = pageHref(href, ctx);
  if (out === null) return dest;
  return angled ? `<${out}>` : out;
}

// The Markdown URL of the page `href` links to, or null when it doesn't link
// to a page.
function pageHref(href: string, ctx: LinkContext): string | null {
  // External (`https:`, `mailto:`, OPS `xref:`), protocol-relative, or on
  // this page.
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href) || /^(\/\/|#|\?)/.test(href)) return null;
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  // A file other than Markdown. `v0.4` is a directory: an extension starts
  // with a letter.
  const ext = /\.([a-z][a-z\d]*)$/i.exec(path)?.[1];
  if (ext && ext.toLowerCase() !== "md") return null;

  const url = normalizeInternal(href, ctx);
  const at = url.search(/[?#]/);
  return at < 0 ? markdownUrl(url) : markdownUrl(url.slice(0, at)) + url.slice(at);
}
