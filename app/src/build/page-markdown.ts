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

// On one line: a code span (kept as is: it ends at a backtick run as long as
// the one it starts with), an inline link's destination after `](`, or a link
// reference definition's (`[label]: dest`, not a footnote's `[^1]:`). A
// destination is `<...>`, or has no spaces and balanced parentheses one
// level deep.
const LINK =
  /(`+)[^\n]*?(?<!`)\1(?!`)|((?<!\\)\]\(\s*)(<[^<>\n]*>|[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)|^( {0,3}\[(?!\^)[^\]]+\]:[ \t]*)(<[^<>\n]*>|\S+)/g;

// `render` is the page's render of `source`.
export function pageMarkdown(
  source: string,
  { body, blocks }: Pick<RenderOutput, "body" | "blocks">,
  ctx: LinkContext,
): string {
  // gray-matter's body is the end of the source, after the frontmatter.
  if (!source.endsWith(body)) return source;
  const front = source.slice(0, source.length - body.length);
  const code = new Set<number>();
  for (const { type, map } of blocks) {
    if (VERBATIM.has(type)) for (let i = map[0]; i < map[1]; i++) code.add(i);
  }
  return (
    front +
    body
      .split("\n")
      .map((line, i) =>
        code.has(i)
          ? line
          : line.replace(
              LINK,
              (match, _ticks, inline?: string, dest?: string, ref?: string, refDest?: string) => {
                if (inline !== undefined) return inline + destination(dest!, ctx);
                if (ref !== undefined) return ref + destination(refDest!, ctx);
                return match;
              },
            ),
      )
      .join("\n")
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
