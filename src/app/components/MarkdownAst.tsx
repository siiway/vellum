// FluentUI renderer for our markdown AST.
// Every block maps to a FluentUI primitive: Title/Subtitle for headings, Body1 for prose,
// Link for anchors, Image for images, MessageBar for callouts, Table/TableRow/TableCell
// for tables, Card for code blocks. Inline code, strong, em, del use Text wrappers so they
// share the Fluent typography stack.

import {
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Card,
  Divider,
  Image,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Subtitle1,
  Subtitle2,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title1,
  Title2,
  Title3,
  Tooltip,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircle24Filled,
  Circle24Regular,
  Copy24Regular,
  Info24Regular,
  Warning24Regular,
  Lightbulb24Regular,
  ErrorCircle24Filled,
  ChevronDown24Regular,
  Open24Regular,
} from "@fluentui/react-icons";
import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { makeStyles } from "../css";
import type { Block, Inline, MarkdownAst } from "../../shared/markdown";
import { MermaidBlock } from "./MermaidBlock";
import { rewriteVueTags } from "./VueIslands";
import { useVellum } from "../context";
import {
  parseHtml,
  domToReact,
  type DOMNode,
  type HTMLReactParserOptions,
  Element as DomElement,
} from "../htmlParser";
import { REACT_COMPONENTS, isRegisteredReactComponent } from "../reactComponents";
import { createElement } from "react";

const useStyles = makeStyles({
  root: {
    maxWidth: "780px",
    marginInline: "auto",
    color: tokens.colorNeutralForeground1,
    "& :first-child": { marginTop: 0 },
  },
  paragraph: {
    display: "block",
    marginBlock: tokens.spacingVerticalM,
    lineHeight: tokens.lineHeightBase400,
  },
  h1: {
    display: "block",
    marginBlock: tokens.spacingVerticalXXL,
    letterSpacing: "-0.02em",
  },
  h2: {
    display: "block",
    marginTop: tokens.spacingVerticalXXXL,
    marginBottom: tokens.spacingVerticalL,
    paddingTop: tokens.spacingVerticalL,
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    letterSpacing: "-0.01em",
  },
  h3: {
    display: "block",
    marginTop: tokens.spacingVerticalXXL,
    marginBottom: tokens.spacingVerticalM,
  },
  h4: {
    display: "block",
    marginTop: tokens.spacingVerticalXL,
    marginBottom: tokens.spacingVerticalS,
  },
  h5: {
    display: "block",
    marginTop: tokens.spacingVerticalL,
    marginBottom: tokens.spacingVerticalS,
  },
  h6: {
    display: "block",
    marginTop: tokens.spacingVerticalL,
    marginBottom: tokens.spacingVerticalS,
  },
  anchorMark: {
    opacity: 0,
    marginLeft: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground3,
    textDecoration: "none",
    "&:hover": { color: tokens.colorBrandForeground1 },
  },
  heading: {
    position: "relative",
    "&:hover .vellum-anchor-mark": { opacity: 1 },
    scrollMarginTop: "72px",
  },
  inlineCode: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "0.92em",
    backgroundColor: tokens.colorNeutralBackground3,
    paddingInline: "5px",
    paddingBlock: "2px",
    borderRadius: tokens.borderRadiusSmall,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  list: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalXXL,
    marginBlock: tokens.spacingVerticalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    lineHeight: tokens.lineHeightBase400,
  },
  taskItem: {
    listStyle: "none",
    marginLeft: `-${tokens.spacingHorizontalXXL}`,
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalS,
  },
  blockquote: {
    margin: `${tokens.spacingVerticalL} 0`,
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalS,
    borderInlineStart: `4px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  callout: { marginBlock: tokens.spacingVerticalL },
  codeCard: {
    marginBlock: tokens.spacingVerticalL,
    overflow: "hidden",
    padding: 0,
    borderRadius: tokens.borderRadiusLarge,
    borderColor: "var(--vellum-code-border)",
    boxShadow: "none",
    backgroundColor: "var(--vellum-code-bg)",
    position: "relative",
  },
  codeHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: "6px",
    backgroundColor: "var(--vellum-code-bg)",
    borderBottom: `1px solid var(--vellum-code-border)`,
    fontFamily: `'Cascadia Code', 'JetBrains Mono', ${tokens.fontFamilyMonospace}`,
    fontSize: "12px",
    color: "var(--vellum-code-fg-muted)",
    minHeight: "32px",
  },
  codeFilename: {
    flex: 1,
    color: "var(--vellum-code-fg-muted)",
    fontFamily: "inherit",
  },
  codeLang: {
    color: "var(--vellum-code-fg-muted)",
    paddingInline: "8px",
    paddingBlock: "1px",
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground1Hover,
    textTransform: "lowercase",
    fontFamily: "inherit",
    fontSize: "11px",
    letterSpacing: "0.04em",
  },
  copyBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    border: "none",
    background: "transparent",
    color: "var(--vellum-code-fg-muted)",
    fontSize: "12px",
    padding: "3px 8px",
    borderRadius: tokens.borderRadiusSmall,
    cursor: "pointer",
    "&:hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
  },
  copyFloating: {
    position: "absolute",
    top: "8px",
    right: "8px",
    opacity: 0,
    transition: "opacity 100ms ease-out",
    zIndex: 1,
  },
  codeCardHover: {
    "&:hover .vellum-copy-floating": { opacity: 1 },
  },
  codeBody: {
    backgroundColor: "var(--vellum-code-bg)",
    overflowX: "auto",
    fontSize: "13.5px",
    lineHeight: "1.55",
    "& pre": {
      margin: 0,
      // Tight vertical padding so the code surface hugs the text. spacingVerticalM
      // (12px) gave a noticeable empty band above/below the first/last line.
      paddingBlock: tokens.spacingVerticalS,
      paddingInline: tokens.spacingHorizontalL,
      backgroundColor: "transparent !important" as any,
    },
    "& code": {
      fontFamily: `'Cascadia Code', 'JetBrains Mono', 'Fira Code', ${tokens.fontFamilyMonospace}`,
      backgroundColor: "transparent !important" as any,
      fontVariantLigatures: "common-ligatures contextual",
    },
  },
  link: {
    color: tokens.colorBrandForegroundLink,
    textDecoration: "none",
    "&:hover": { textDecoration: "underline" },
  },
  externalIcon: {
    display: "inline-flex",
    verticalAlign: "middle",
    marginLeft: "2px",
    width: "0.85em",
    height: "0.85em",
    opacity: 0.6,
  },
  image: {
    display: "block",
    maxWidth: "100%",
    height: "auto",
    borderRadius: tokens.borderRadiusMedium,
    marginBlock: tokens.spacingVerticalM,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  tableWrap: {
    // Article column is bounded by maxWidth:780px; wide tables would otherwise
    // push past it and break the grid. Confine overflow to the wrapper.
    marginBlock: tokens.spacingVerticalL,
    maxWidth: "100%",
    overflowX: "auto",
  },
  table: {
    // Size columns to their content (auto layout), and let the table grow past
    // the article column when needed — the wrapper's overflow-x handles the scroll.
    // `min-width: 100%` keeps narrow tables visually anchored to the column edge
    // instead of floating as a tiny island.
    width: "max-content",
    minWidth: "100%",
    tableLayout: "auto",
    marginBlock: 0,
  },
  hr: { marginBlock: tokens.spacingVerticalXXL },
  codeGroup: {
    marginBlock: tokens.spacingVerticalL,
    overflow: "hidden",
    padding: 0,
    borderRadius: tokens.borderRadiusLarge,
  },
  codeGroupTabs: {
    display: "flex",
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  codeGroupTab: {
    background: "transparent",
    border: "none",
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
    cursor: "pointer",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    borderBottom: "2px solid transparent",
    fontFamily: tokens.fontFamilyMonospace,
  },
  codeGroupTabActive: {
    color: tokens.colorBrandForeground1,
    borderBottomColor: tokens.colorBrandStroke1,
    fontWeight: tokens.fontWeightSemibold,
  },
  taskCheckbox: { marginTop: "2px", flexShrink: 0 },

  // OPS / Learn extension styles. Authored to mirror the Microsoft Learn look
  // (12-column grid, plain image with optional caption, tab strip, pivot/zone
  // panes) without literally re-implementing their stylesheet.
  opsImage: {
    display: "block",
    marginBlock: tokens.spacingVerticalM,
    "& img": {
      maxWidth: "100%",
      height: "auto",
      borderRadius: tokens.borderRadiusMedium,
    },
  },
  opsImageBorder: {
    "& img": { border: `1px solid ${tokens.colorNeutralStroke2}` },
  },
  opsImageCaption: {
    display: "block",
    marginTop: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    textAlign: "center",
  },
  opsVideoWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 9",
    marginBlock: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    overflow: "hidden",
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground3,
    "& iframe, & video": {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      border: "none",
    },
  },
  opsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    marginBlock: tokens.spacingVerticalL,
    "@media (max-width: 720px)": { gridTemplateColumns: "1fr" },
  },
  opsZonePane: {
    marginBlock: tokens.spacingVerticalL,
  },
  opsMonikerNotice: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    paddingInline: tokens.spacingHorizontalS,
    borderInlineStart: `2px solid ${tokens.colorNeutralStroke3}`,
    marginBottom: tokens.spacingVerticalS,
  },
  opsTabs: {
    marginBlock: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    overflow: "hidden",
  },
  opsTabsStrip: {
    display: "flex",
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowX: "auto",
  },
  opsTabBtn: {
    background: "transparent",
    border: "none",
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalS,
    cursor: "pointer",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightRegular,
    borderBottom: "2px solid transparent",
    whiteSpace: "nowrap",
    "&:hover": {
      color: tokens.colorNeutralForeground1,
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
  },
  opsTabBtnActive: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
    borderBottomColor: tokens.colorBrandStroke1,
  },
  opsTabPane: {
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalM,
    "& > :first-child": { marginTop: 0 },
    "& > :last-child": { marginBottom: 0 },
  },
  xref: {
    color: tokens.colorBrandForegroundLink,
    textDecoration: "none",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "0.95em",
    "&:hover": { textDecoration: "underline" },
  },
  xrefUnresolved: {
    fontFamily: tokens.fontFamilyMonospace,
    backgroundColor: tokens.colorNeutralBackground3,
    paddingInline: "4px",
    borderRadius: tokens.borderRadiusSmall,
    border: `1px dashed ${tokens.colorNeutralStroke3}`,
    color: tokens.colorNeutralForeground3,
    fontSize: "0.92em",
  },
});

export function MarkdownAst({ ast }: { ast: MarkdownAst }) {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      {ast.blocks.map((b, i) => (
        <BlockNode key={i} block={b} styles={styles} />
      ))}
    </div>
  );
}

function BlockNode({ block, styles }: { block: Block; styles: ReturnType<typeof useStyles> }) {
  switch (block.type) {
    case "paragraph":
      return (
        <Body1 as="p" className={styles.paragraph}>
          {block.children.map((c, i) => (
            <InlineNode key={i} node={c} styles={styles} />
          ))}
        </Body1>
      );
    case "heading": {
      const HeadingComp =
        block.level === 1
          ? Title1
          : block.level === 2
            ? Title2
            : block.level === 3
              ? Title3
              : block.level === 4
                ? Subtitle1
                : Subtitle2;
      const cls =
        block.level === 1
          ? styles.h1
          : block.level === 2
            ? styles.h2
            : block.level === 3
              ? styles.h3
              : block.level === 4
                ? styles.h4
                : block.level === 5
                  ? styles.h5
                  : styles.h6;
      const Tag = `h${block.level}` as unknown as "h2";
      return (
        <HeadingComp as={Tag} id={block.id} className={mergeClasses(cls, styles.heading)}>
          {block.children.map((c, i) => (
            <InlineNode key={i} node={c} styles={styles} />
          ))}
          {block.id && (
            <Link
              href={`#${block.id}`}
              className={mergeClasses(styles.anchorMark, "vellum-anchor-mark")}
              aria-label="Permalink to this heading"
              data-no-router="true"
            >
              #
            </Link>
          )}
        </HeadingComp>
      );
    }
    case "list":
      return <ListNode block={block} styles={styles} />;
    case "blockquote":
      // FluentUI Body1's `as` doesn't accept "blockquote"; wrap a semantic blockquote
      // with the Fluent-tokenized styles instead.
      return (
        <blockquote className={styles.blockquote}>
          {block.children.map((b, i) => (
            <BlockNode key={i} block={b} styles={styles} />
          ))}
        </blockquote>
      );
    case "callout":
      return <CalloutNode block={block} styles={styles} />;
    case "code":
      return <CodeNode block={block} styles={styles} />;
    case "codeGroup":
      return <CodeGroupNode block={block} styles={styles} />;
    case "thematicBreak":
      return <Divider className={styles.hr} />;
    case "table":
      return <TableNode block={block} styles={styles} />;
    case "mermaid":
      return <MermaidBlock code={block.code} svgLight={block.svgLight} svgDark={block.svgDark} />;
    case "html":
      return <HtmlBlock value={block.value} />;
    case "opsImage":
      return <OpsImageNode block={block} styles={styles} />;
    case "opsVideo":
      return <OpsVideoNode block={block} />;
    case "opsRow":
      return <OpsRowNode block={block} styles={styles} />;
    case "opsColumn":
      // Columns only render inside opsRow, but if one slips through (author
      // mistake) we still want to draw its children so the page doesn't blank.
      return (
        <div>
          {block.children.map((b, i) => (
            <BlockNode key={i} block={b} styles={styles} />
          ))}
        </div>
      );
    case "opsZone":
      return <OpsZoneNode block={block} styles={styles} />;
    case "opsMoniker":
      return <OpsMonikerNode block={block} styles={styles} />;
    case "opsTabs":
      return <OpsTabsNode block={block} styles={styles} />;
  }
}

// Renders inline HTML from markdown, with two extensions on top of plain
// dangerouslySetInnerHTML:
//   1. Author-written Vue tags (registered via the repo's VitePress theme) are
//      swapped for placeholder divs that VueIslands hydrates after mount.
//   2. Registered React components used in markdown — e.g. `<Button>` — are
//      mounted as actual React elements (FluentUI primitives, etc.).
// The HTML parser is configured to preserve tag casing so `<Button>` (React
// component) is distinguishable from `<button>` (plain HTML element).
function HtmlBlock({ value }: { value: string }) {
  const { data } = useVellum();
  const rewritten = rewriteVueTags(value, data.repoComponents ?? []);
  // Suspense boundary so the lazy FluentUI components in the registry resolve
  // without taking down the rest of the page while loading.
  return (
    <Suspense fallback={<div dangerouslySetInnerHTML={{ __html: rewritten }} />}>
      <div>{parseHtmlToReact(rewritten)}</div>
    </Suspense>
  );
}

const parserOptions: HTMLReactParserOptions = {
  // htmlparser2 lowercases tags by default; we need the original casing to
  // tell `<Button>` (React) from `<button>` (HTML).
  htmlparser2: { lowerCaseTags: false, lowerCaseAttributeNames: false } as any,
  replace(node) {
    if (!(node instanceof DomElement)) return undefined;
    const name = node.name;
    if (!isRegisteredReactComponent(name)) return undefined;
    const Comp = REACT_COMPONENTS[name]!;
    const props = mapAttribsToProps(node.attribs);
    const children = domToReact(node.children as DOMNode[], parserOptions);
    return createElement(Comp, props, children);
  },
};

function parseHtmlToReact(html: string) {
  return parseHtml(html, parserOptions);
}

// Maps raw HTML attributes onto React prop names + coerces obvious value types.
// Keeps unknown attributes as-is so authors can pass through `aria-*`, `data-*`,
// and FluentUI's domain-specific props (`appearance`, `size`, etc.).
function mapAttribsToProps(attribs: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(attribs)) {
    let outKey = key;
    if (key === "class") outKey = "className";
    else if (key === "for") outKey = "htmlFor";
    // style="color: red; padding: 4px" -> object
    if (outKey === "style") {
      out.style = parseStyle(raw);
      continue;
    }
    out[outKey] = coerceValue(raw);
  }
  return out;
}

function coerceValue(v: string): unknown {
  if (v === "") return true; // bare attribute (e.g. `disabled`)
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  return v;
}

function parseStyle(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of raw.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (!prop) continue;
    // kebab-case -> camelCase for React's style object.
    const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = value;
  }
  return out;
}

function InlineNode({
  node,
  styles,
}: {
  node: Inline;
  styles: ReturnType<typeof useStyles>;
}): ReactNode {
  switch (node.type) {
    case "text":
      return node.value;
    case "br":
      return <br />;
    case "code":
      return (
        <Text className={styles.inlineCode} font="monospace">
          {node.value}
        </Text>
      );
    case "strong":
      return (
        <Body1Strong as="strong">
          {node.children.map((c, i) => (
            <Fragment key={i}>
              <InlineNode node={c} styles={styles} />
            </Fragment>
          ))}
        </Body1Strong>
      );
    case "em":
      return (
        <Text as="em" italic>
          {node.children.map((c, i) => (
            <Fragment key={i}>
              <InlineNode node={c} styles={styles} />
            </Fragment>
          ))}
        </Text>
      );
    case "del":
      return (
        <Text as="span" strikethrough>
          {node.children.map((c, i) => (
            <Fragment key={i}>
              <InlineNode node={c} styles={styles} />
            </Fragment>
          ))}
        </Text>
      );
    case "link":
      return (
        <Link
          href={node.href}
          className={styles.link}
          inline
          {...(node.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {node.children.map((c, i) => (
            <Fragment key={i}>
              <InlineNode node={c} styles={styles} />
            </Fragment>
          ))}
          {node.external && <Open24Regular className={styles.externalIcon} />}
        </Link>
      );
    case "image":
      return (
        <Image
          className={styles.image}
          src={node.src}
          alt={node.alt}
          title={node.title}
          block
          fit="contain"
        />
      );
    case "html": {
      // Raw inline HTML the worker didn't fold into a structured node — plain
      // tags like `<br>`, `<sub>`, `<kbd>` etc. PascalCase React components
      // are pre-merged into the `reactComponent` case below.
      return <span dangerouslySetInnerHTML={{ __html: node.value }} />;
    }
    case "reactComponent": {
      // Worker already merged the open/close pair (or self-closing) into a
      // single inline node. If the name is registered, mount the component;
      // otherwise render the children as plain text so authors see their
      // content even when they typoed the tag name.
      const kids = node.children.map((c, i) => (
        <Fragment key={i}>
          <InlineNode node={c} styles={styles} />
        </Fragment>
      ));
      if (isRegisteredReactComponent(node.name)) {
        const Comp = REACT_COMPONENTS[node.name]!;
        const element = createElement(Comp, node.props, kids.length ? kids : undefined);
        // Wrap in Suspense so lazy-loaded primitives (Spinner, Tag, Switch …
        // see reactComponents.ts) don't bubble a suspend up to renderToString
        // — which would crash the page. Fallback is the children themselves
        // so the text stays visible during the lazy chunk load.
        return <Suspense fallback={<>{kids}</>}>{element}</Suspense>;
      }
      return <>{kids}</>;
    }
    case "xref":
      if (node.href) {
        return (
          <Link
            href={node.href}
            className={styles.xref}
            inline
            target="_blank"
            rel="noopener noreferrer"
          >
            {node.display ?? node.target}
          </Link>
        );
      }
      // Unresolved: render as monospace fallback. The dashed border makes it
      // obvious to the author that the uid didn't land in any xrefmap.
      return (
        <Text className={styles.xrefUnresolved} as="span" title="Unresolved xref">
          {node.display ?? node.target}
        </Text>
      );
  }
}

function ListNode({
  block,
  styles,
}: {
  block: Extract<Block, { type: "list" }>;
  styles: ReturnType<typeof useStyles>;
}) {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag className={styles.list} start={block.start}>
      {block.items.map((it, idx) => {
        if (it.checked !== null) {
          return (
            <li key={idx} className={styles.taskItem}>
              <span className={styles.taskCheckbox} aria-hidden="true">
                {it.checked ? (
                  <CheckmarkCircle24Filled primaryFill={tokens.colorBrandForeground1} />
                ) : (
                  <Circle24Regular />
                )}
              </span>
              <div>
                {it.children.map((b, i) => (
                  <BlockNode key={i} block={b} styles={styles} />
                ))}
              </div>
            </li>
          );
        }
        return (
          <li key={idx}>
            {it.children.map((b, i) => (
              <BlockNode key={i} block={b} styles={styles} />
            ))}
          </li>
        );
      })}
    </Tag>
  );
}

function CalloutNode({
  block,
  styles,
}: {
  block: Extract<Block, { type: "callout" }>;
  styles: ReturnType<typeof useStyles>;
}) {
  // Titles are Inline[] so `code`, **bold**, links inside the title render
  // through the same InlineNode renderer as paragraph content. `Details`
  // (capital-D) is the fallback when a `::: details` block didn't carry a
  // custom summary.
  const titleNodes = block.title?.length
    ? block.title.map((c, i) => (
        <Fragment key={i}>
          <InlineNode node={c} styles={styles} />
        </Fragment>
      ))
    : null;

  if (block.kind === "details") {
    return (
      <details
        className={styles.callout}
        style={{
          border: `1px solid ${tokens.colorNeutralStroke2}`,
          borderRadius: tokens.borderRadiusMedium,
          padding: `8px 12px`,
          backgroundColor: tokens.colorNeutralBackground2,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ChevronDown24Regular /> <Body1Strong>{titleNodes ?? "Details"}</Body1Strong>
        </summary>
        <div style={{ marginTop: 8 }}>
          {block.children.map((b, i) => (
            <BlockNode key={i} block={b} styles={styles} />
          ))}
        </div>
      </details>
    );
  }

  const intent = mapIntent(block.kind);
  const icon = mapIcon(block.kind);

  return (
    <MessageBar intent={intent} layout="multiline" className={styles.callout} icon={icon}>
      <MessageBarBody>
        {titleNodes && <MessageBarTitle>{titleNodes}</MessageBarTitle>}
        {block.children.map((b, i) => (
          <BlockNode key={i} block={b} styles={styles} />
        ))}
      </MessageBarBody>
    </MessageBar>
  );
}

function mapIntent(kind: string): "info" | "success" | "warning" | "error" {
  switch (kind) {
    case "tip":
      return "success";
    case "warning":
    case "caution":
      return "warning";
    case "danger":
      return "error";
    case "important":
      return "error";
    default:
      return "info";
  }
}

function mapIcon(kind: string) {
  switch (kind) {
    case "tip":
      return <Lightbulb24Regular />;
    case "warning":
    case "caution":
      return <Warning24Regular />;
    case "danger":
    case "important":
      return <ErrorCircle24Filled />;
    default:
      return <Info24Regular />;
  }
}

function CodeNode({
  block,
  styles,
}: {
  block: Extract<Block, { type: "code" }>;
  styles: ReturnType<typeof useStyles>;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    navigator.clipboard?.writeText(block.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [block.code]);

  // Only show the header bar when there's something to put in it; otherwise the
  // code sits in a clean card with a floating copy button that fades in on hover.
  const hasHeader = !!block.filename || !!block.lang;

  const copyIcon = copied ? (
    <CheckmarkCircle24Filled primaryFill={tokens.colorPaletteGreenForeground1} />
  ) : (
    <Copy24Regular />
  );

  if (!hasHeader) {
    return (
      <Card className={mergeClasses(styles.codeCard, styles.codeCardHover)} appearance="outline">
        <Tooltip content={copied ? "Copied" : "Copy code"} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={copyIcon}
            onClick={onCopy}
            className={mergeClasses(styles.copyFloating, "vellum-copy-floating")}
            aria-label={copied ? "Copied" : "Copy code"}
          />
        </Tooltip>
        <div className={styles.codeBody} dangerouslySetInnerHTML={{ __html: block.html }} />
      </Card>
    );
  }

  return (
    <Card className={styles.codeCard} appearance="outline">
      <div className={styles.codeHeader}>
        {block.filename ? (
          <Caption1 className={styles.codeFilename}>{block.filename}</Caption1>
        ) : (
          <div className={styles.codeFilename} />
        )}
        {block.lang && <Caption1 className={styles.codeLang}>{block.lang}</Caption1>}
        <Tooltip content={copied ? "Copied" : "Copy code"} relationship="label">
          <Button appearance="subtle" size="small" icon={copyIcon} onClick={onCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </Tooltip>
      </div>
      <div className={styles.codeBody} dangerouslySetInnerHTML={{ __html: block.html }} />
    </Card>
  );
}

function CodeGroupNode({
  block,
  styles,
}: {
  block: Extract<Block, { type: "codeGroup" }>;
  styles: ReturnType<typeof useStyles>;
}) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    const tab = block.tabs[active];
    if (!tab) return;
    navigator.clipboard?.writeText(tab.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [block.tabs, active]);

  const tab = block.tabs[active];
  const copyIcon = copied ? (
    <CheckmarkCircle24Filled primaryFill={tokens.colorPaletteGreenForeground1} />
  ) : (
    <Copy24Regular />
  );
  return (
    <Card className={styles.codeGroup} appearance="outline">
      <div className={styles.codeGroupTabs}>
        <TabList
          selectedValue={active}
          onTabSelect={(_, d) => setActive(d.value as number)}
          size="small"
          appearance="transparent"
        >
          {block.tabs.map((t, i) => (
            <Tab key={i} value={i}>
              {t.label}
            </Tab>
          ))}
        </TabList>
        <div style={{ flex: 1 }} />
        <Tooltip content={copied ? "Copied" : "Copy code"} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={copyIcon}
            onClick={onCopy}
            style={{ marginRight: 8 }}
            aria-label={copied ? "Copied" : "Copy code"}
          />
        </Tooltip>
      </div>
      {tab && <div className={styles.codeBody} dangerouslySetInnerHTML={{ __html: tab.html }} />}
    </Card>
  );
}

// OPS / Microsoft Learn block renderers. Layered onto the existing FluentUI
// vocabulary rather than introducing a new design language.

function OpsImageNode({
  block,
  styles,
}: {
  block: Extract<Block, { type: "opsImage" }>;
  styles: ReturnType<typeof useStyles>;
}) {
  const wrapClass = mergeClasses(styles.opsImage, block.border && styles.opsImageBorder);
  const inner = (
    <>
      <Image src={block.src} alt={block.alt} fit="contain" />
      {block.caption && (
        <Caption1 className={styles.opsImageCaption} as="span">
          {block.caption}
        </Caption1>
      )}
    </>
  );
  if (block.lightbox) {
    return (
      <figure className={wrapClass}>
        <Link href={block.lightbox} target="_blank" rel="noopener noreferrer">
          {inner}
        </Link>
      </figure>
    );
  }
  return <figure className={wrapClass}>{inner}</figure>;
}

function OpsVideoNode({ block }: { block: Extract<Block, { type: "opsVideo" }> }) {
  const styles = useStyles();
  const src = block.src;
  // Heuristic: YouTube embed URLs and channel9 URLs render in an iframe;
  // raw video file URLs (mp4/webm/ogg) render via <video>. Anything we can't
  // confidently classify falls back to iframe, matching the OPS behaviour.
  const isMediaFile = /\.(mp4|webm|ogg|m4v)(\?|$)/i.test(src);
  return (
    <div className={styles.opsVideoWrap}>
      {isMediaFile ? (
        <video controls preload="metadata" src={src} title={block.title} />
      ) : (
        <iframe src={src} title={block.title ?? "Video"} allowFullScreen loading="lazy" />
      )}
    </div>
  );
}

function OpsRowNode({
  block,
  styles,
}: {
  block: Extract<Block, { type: "opsRow" }>;
  styles: ReturnType<typeof useStyles>;
}) {
  return (
    <div className={styles.opsRow}>
      {block.children.map((c, i) => {
        if (c.type === "opsColumn") {
          const span = Math.min(12, Math.max(1, c.span ?? 6));
          return (
            <div key={i} style={{ gridColumn: `span ${span} / span ${span}` }}>
              {c.children.map((b, j) => (
                <BlockNode key={j} block={b} styles={styles} />
              ))}
            </div>
          );
        }
        // Stray non-column child inside :::row::: — render full-width so the
        // author can still see their content.
        return <BlockNode key={i} block={c} styles={styles} />;
      })}
    </div>
  );
}

// Pivots are picked from ?pivot=… (which the URL editor can change) and stored
// in localStorage. A zone whose pivot list doesn't contain the active pivot is
// hidden. Components-of-zones with a `target` attr (used for platform-only
// content like docs vs chromeless) are shown when their target matches.
function readActivePivot(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("pivot");
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem("vellum.ops.pivot");
  } catch {
    return null;
  }
}

function OpsZoneNode({
  block,
  styles,
}: {
  block: Extract<Block, { type: "opsZone" }>;
  styles: ReturnType<typeof useStyles>;
}) {
  const [pivot, setPivot] = useState<string | null>(null);
  useEffect(() => {
    setPivot(readActivePivot());
  }, []);

  // Server render + initial hydrate: show every zone so the SSR HTML is
  // consistent across pivot choices. Once we know the active pivot on the
  // client, hide non-matching zones in the next render. This also means the
  // page reads top-to-bottom for users without JS.
  if (pivot && block.pivot) {
    const allowed = block.pivot
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowed.includes(pivot)) return null;
  }

  return (
    <div className={styles.opsZonePane} data-pivot={block.pivot} data-target={block.target}>
      {block.children.map((b, i) => (
        <BlockNode key={i} block={b} styles={styles} />
      ))}
    </div>
  );
}

function OpsMonikerNode({
  block,
  styles,
}: {
  block: Extract<Block, { type: "opsMoniker" }>;
  styles: ReturnType<typeof useStyles>;
}) {
  // Without a known active version we have no way to filter, so we render the
  // moniker pane prefixed with a small notice so the reader knows the content
  // is version-scoped. A future pass can wire up a version selector and hide
  // panes that don't match.
  return (
    <div className={styles.opsZonePane} data-moniker={block.range}>
      <div className={styles.opsMonikerNotice}>Applies to: {block.range}</div>
      {block.children.map((b, i) => (
        <BlockNode key={i} block={b} styles={styles} />
      ))}
    </div>
  );
}

function OpsTabsNode({
  block,
  styles,
}: {
  block: Extract<Block, { type: "opsTabs" }>;
  styles: ReturnType<typeof useStyles>;
}) {
  const [active, setActive] = useState(0);
  // Restore the user's last choice for this tab group from localStorage. We
  // key the persisted value by the sorted list of tab ids so unrelated tab
  // groups don't share state.
  const groupKey = useMemo(
    () => `vellum.tabs:${block.tabs.map((t) => t.id).join("|")}`,
    [block.tabs],
  );
  useEffect(() => {
    try {
      const saved = localStorage.getItem(groupKey);
      if (saved) {
        const idx = block.tabs.findIndex((t) => t.id === saved);
        if (idx >= 0) setActive(idx);
      }
    } catch {}
  }, [groupKey, block.tabs]);
  const onSelect = (idx: number) => {
    setActive(idx);
    try {
      localStorage.setItem(groupKey, block.tabs[idx]!.id);
    } catch {}
  };
  const current = block.tabs[active];
  return (
    <div className={styles.opsTabs}>
      <TabList
        selectedValue={active}
        onTabSelect={(_, d) => onSelect(d.value as number)}
        size="small"
        appearance="transparent"
        className={styles.opsTabsStrip}
      >
        {block.tabs.map((t, i) => (
          <Tab key={t.id} value={i}>
            {t.title}
          </Tab>
        ))}
      </TabList>
      <div role="tabpanel" className={styles.opsTabPane}>
        {current?.children.map((b, i) => (
          <BlockNode key={i} block={b} styles={styles} />
        ))}
      </div>
    </div>
  );
}

function TableNode({
  block,
  styles,
}: {
  block: Extract<Block, { type: "table" }>;
  styles: ReturnType<typeof useStyles>;
}) {
  return (
    <div className={styles.tableWrap}>
      <Table className={styles.table} aria-label="Markdown table" size="small">
        {block.head.length > 0 && (
          <TableHeader>
            <TableRow>
              {block.head.map((c, i) => (
                <TableHeaderCell key={i} style={{ textAlign: c.align ?? "left" }}>
                  {c.children.map((cc, j) => (
                    <InlineNode key={j} node={cc} styles={styles} />
                  ))}
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
        )}
        <TableBody>
          {block.rows.map((row, r) => (
            <TableRow key={r}>
              {row.map((cell, c) => (
                <TableCell key={c} style={{ textAlign: cell.align ?? "left" }}>
                  {cell.children.map((cc, j) => (
                    <InlineNode key={j} node={cc} styles={styles} />
                  ))}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
