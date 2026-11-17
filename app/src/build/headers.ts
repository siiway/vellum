// The `_headers` file: response headers Cloudflare adds by path.
//
//   - The hashed bundles under /assets/ never change, so they're cached for
//     a year.
//   - With the agent files written (`site.url` set), the homepage points
//     agents at them with Link headers (RFC 8288; `ard` is the relation ARD
//     defines for its catalog), and other origins may fetch them (the ARD
//     catalog asks for CORS).
//   - With `site.url` set, a page's Markdown names the page as canonical,
//     so search engines don't index the page twice. `/index.md` (the page
//     at `/`, when a locale lives there) names `/index`, which the assets
//     server answers with `/`. The agent skill under /.well-known/ isn't a
//     page's Markdown, so it drops the header.

import { ARD_PATH, SKILLS_INDEX_PATH } from "./agents";

export function buildHeaders(origin: string | null): string {
  const rules = [["/assets/*", "Cache-Control: public, max-age=31536000, immutable"]];
  if (origin) {
    rules.push(
      [
        "/",
        `Link: <${ARD_PATH}>; rel="ard describedby"; type="application/json"`,
        `Link: <${SKILLS_INDEX_PATH}>; rel="describedby"; type="application/json"`,
      ],
      ["/*.md", `Link: <${origin}/:splat>; rel="canonical"`],
      ["/.well-known/*", "Access-Control-Allow-Origin: *", "! Link"],
    );
  }
  return `${rules.map(([path, ...headers]) => [path, ...headers.map((h) => `  ${h}`)].join("\n")).join("\n\n")}\n`;
}
