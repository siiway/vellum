import { useEffect, useMemo, useState } from "react";
import { Link, Text, tokens } from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { parseHtml, Element, type DOMNode, type HTMLReactParserOptions } from "../htmlParser";

// Lightweight markdown renderer for AI-generated content. We share the
// markdown-it dependency the worker already uses, but lazy-load it on the
// client so the cost is paid only when a visitor opens an AI surface
// (Summary card or Ask AI drawer).
//
// Why not the full src/worker/markdown pipeline? That one runs Shiki +
// Kroki + OPS extensions — designed for authored docs, not chat output.
// AI replies use a tiny vocabulary: paragraphs, bold/italic/code, links,
// headings, lists. markdown-it with html:false handles that cleanly and
// escapes raw HTML the model might emit.

const useStyles = makeStyles({
  root: {
    color: tokens.colorNeutralForeground1,
    "& p": {
      marginBlock: tokens.spacingVerticalS,
    },
    "& p:first-child": { marginTop: 0 },
    "& p:last-child": { marginBottom: 0 },
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      backgroundColor: tokens.colorNeutralBackground3,
      paddingInline: "4px",
      paddingBlock: "1px",
      borderRadius: tokens.borderRadiusSmall,
      fontSize: "0.92em",
    },
    "& pre": {
      backgroundColor: tokens.colorNeutralBackground3,
      borderRadius: tokens.borderRadiusMedium,
      padding: tokens.spacingHorizontalM,
      overflow: "auto",
      marginBlock: tokens.spacingVerticalS,
    },
    "& pre code": {
      backgroundColor: "transparent",
      padding: 0,
    },
    "& ul, & ol": {
      marginBlock: tokens.spacingVerticalS,
      paddingInlineStart: tokens.spacingHorizontalXL,
    },
    "& li": { marginBlock: "2px" },
    "& h1, & h2, & h3, & h4": {
      marginTop: tokens.spacingVerticalM,
      marginBottom: tokens.spacingVerticalXS,
      fontWeight: tokens.fontWeightSemibold,
    },
    "& h1": { fontSize: tokens.fontSizeBase500 },
    "& h2": { fontSize: tokens.fontSizeBase400 },
    "& h3, & h4": { fontSize: tokens.fontSizeBase300 },
    "& blockquote": {
      marginBlock: tokens.spacingVerticalS,
      paddingInlineStart: tokens.spacingHorizontalM,
      borderInlineStart: `3px solid ${tokens.colorNeutralStroke2}`,
      color: tokens.colorNeutralForeground2,
    },
    "& hr": {
      border: "none",
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
      marginBlock: tokens.spacingVerticalM,
    },
    "& strong": { fontWeight: tokens.fontWeightSemibold },
  },
  cursor: {
    display: "inline-block",
    width: "0.5em",
    height: "1em",
    verticalAlign: "text-bottom",
    backgroundColor: tokens.colorBrandForeground1,
    marginLeft: "2px",
    animationName: {
      "0%, 100%": { opacity: 1 },
      "50%": { opacity: 0 },
    },
    animationDuration: "1s",
    animationIterationCount: "infinite",
  },
});

// markdown-it is fetched once per page load and cached. We keep the import
// promise outside the React tree so concurrent components don't trigger
// duplicate fetches.
type MarkdownItRenderer = { render: (s: string) => string };

let mdPromise: Promise<MarkdownItRenderer> | null = null;
function getMarkdownIt(): Promise<MarkdownItRenderer> {
  if (mdPromise) return mdPromise;
  mdPromise = import("markdown-it").then(({ default: MarkdownIt }) => {
    return new MarkdownIt({
      html: false,
      // Tab-style code fences (```), GFM-ish autolinking, hard line breaks
      // — what AI assistants tend to emit and what readers expect.
      linkify: true,
      breaks: true,
      typographer: false,
    });
  });
  return mdPromise;
}

export function AiMarkdown({
  source,
  streaming,
}: {
  source: string;
  // When true, append a blinking caret after the rendered content to signal
  // that more tokens are still arriving. Suppressed automatically when the
  // source is empty.
  streaming?: boolean;
}) {
  const styles = useStyles();
  const { navigate } = useVellum();
  const [md, setMd] = useState<MarkdownItRenderer | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMarkdownIt().then((inst) => {
      if (!cancelled) setMd(inst);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // While markdown-it is loading the first time, render the raw source so
  // streaming text is visible immediately. Subsequent renders swap in the
  // fully-parsed HTML.
  const html = useMemo(() => {
    if (!md || !source) return null;
    return md.render(source);
  }, [md, source]);

  // Convert HTML → React nodes. Internal links route through the SPA
  // navigator so AI-cited "/repo/page" hops don't trigger full reloads.
  const tree = useMemo(() => {
    if (!html) return null;
    const opts: HTMLReactParserOptions = {
      replace: (node: DOMNode) => {
        if (!(node instanceof Element)) return undefined;
        if (node.name === "a") {
          const href = (node.attribs?.href ?? "").trim();
          const isExternal = /^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:");
          // We can't render children here without recursing back into the
          // parser; html-react-parser exposes domToReact via the same
          // module, but for our tiny use case the AI almost always emits
          // [text](url) — a single text child. Walking the children array
          // and pulling text is enough.
          const label = collectText(node);
          if (isExternal) {
            return (
              <Link href={href} target="_blank" rel="noopener noreferrer">
                {label}
              </Link>
            );
          }
          return (
            <Link
              href={href}
              onClick={(e) => {
                e.preventDefault();
                navigate(href);
              }}
            >
              {label}
            </Link>
          );
        }
        return undefined;
      },
    };
    return parseHtml(html, opts);
  }, [html, navigate]);

  if (!source) {
    return streaming ? <span className={styles.cursor} aria-hidden="true" /> : null;
  }

  if (!tree) {
    // Pre-load fallback: render the raw source as plain text so streaming
    // remains visible. We strip the markdown sigils that would otherwise
    // look noisy as literals.
    return (
      <Text className={styles.root}>
        {stripObviousSigils(source)}
        {streaming && <span className={styles.cursor} aria-hidden="true" />}
      </Text>
    );
  }

  return (
    <div className={styles.root}>
      {tree}
      {streaming && <span className={styles.cursor} aria-hidden="true" />}
    </div>
  );
}

// Walk an Element's text descendants. Used to extract link labels without a
// second parser pass.
function collectText(node: Element): string {
  let out = "";
  for (const child of node.children) {
    if ("data" in child && typeof child.data === "string") {
      out += child.data;
    } else if (child instanceof Element) {
      out += collectText(child);
    }
  }
  return out;
}

// Pre-parse fallback: strip the most distracting markdown sigils so the
// loading state doesn't look like the model is broken.
function stripObviousSigils(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "• ");
}
