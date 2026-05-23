// Wrapper around html-react-parser that always uses the server-side parser
// (htmlparser2-based) instead of html-dom-parser's browser entry. The browser
// variant calls `document.implementation.createHTMLDocument`, which doesn't
// exist inside the Cloudflare Workers SSR runtime — so the default
// `import "html-react-parser"` path crashes there. Using the htmlparser2 path
// also works fine on the actual browser side, so there's no need for two
// parsers between SSR and hydration.

// Deep import bypasses html-dom-parser's package.json `exports` conditions
// (which pick the DOM-based "browser" variant on Workers).
import htmlToDOMServer from "html-dom-parser/lib/server/html-to-dom";
import { domToReact, type HTMLReactParserOptions, type DOMNode } from "html-react-parser";

export function parseHtml(
  html: string,
  options: HTMLReactParserOptions,
): ReturnType<typeof domToReact> {
  const dom = (htmlToDOMServer as (html: string, opts?: unknown) => DOMNode[])(
    html,
    (options as unknown as { htmlparser2: unknown }).htmlparser2,
  );
  return domToReact(dom, options);
}

export { domToReact };
export type { HTMLReactParserOptions, DOMNode };
export { Element } from "html-react-parser";
