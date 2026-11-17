// Renders a fenced ```mermaid block as an SVG diagram. The build draws both
// palettes when it can; the page then holds both and CSS shows the one for the
// theme, with no JavaScript. Otherwise the client draws it: mermaid is heavy
// (~600KB), so we dynamic-import it the first time such a diagram mounts —
// pages without one pay nothing. SSR emits the raw code as a preformatted
// block; once hydrated, the effect swaps in the rendered SVG. Re-renders on
// theme change to keep the diagram's palette in sync.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { tokens } from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { CONTENT_KEY_ATTR, DIAGRAM_DARK, DIAGRAM_LIGHT } from "../prerendered";
import { format } from "../../shared/i18n";
import { contentKey } from "../../shared/markdown";

const useStyles = makeStyles({
  root: {
    marginBlock: tokens.spacingVerticalL,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
    overflowX: "auto",
    display: "flex",
    justifyContent: "center",
    "& svg": {
      maxWidth: "100%",
      height: "auto",
    },
  },
  pending: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    whiteSpace: "pre-wrap",
    margin: 0,
    width: "100%",
    textAlign: "left",
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    margin: 0,
    width: "100%",
    textAlign: "left",
  },
});

interface Props {
  code: string;
  svgLight?: string;
  svgDark?: string;
}

export function MermaidBlock(props: Props) {
  return props.svgLight && props.svgDark ? (
    <DrawnDiagram code={props.code} light={props.svgLight} dark={props.svgDark} />
  ) : (
    <ClientDiagram {...props} />
  );
}

// Both palettes, for the CSS in ssr.tsx to pick from. Marked so the client
// can take them from the page when the payload leaves them out
// (fillFromPage); hydrating them, React keeps the page's.
function DrawnDiagram({ code, light, dark }: { code: string; light: string; dark: string }) {
  const styles = useStyles();
  const { t } = useVellum();
  const key = useMemo(() => contentKey(code), [code]);
  return (
    <div
      className={styles.root}
      role="img"
      aria-label={t("ui.mermaid.label")}
      {...{ [CONTENT_KEY_ATTR]: key }}
    >
      <div
        className={DIAGRAM_LIGHT}
        dangerouslySetInnerHTML={{ __html: light }}
        suppressHydrationWarning
      />
      <div
        className={DIAGRAM_DARK}
        dangerouslySetInnerHTML={{ __html: dark }}
        suppressHydrationWarning
      />
    </div>
  );
}

function ClientDiagram({ code, svgLight, svgDark }: Props) {
  const styles = useStyles();
  const { theme, t } = useVellum();
  const reactId = useId();
  // Mermaid requires IDs valid as CSS selectors — useId() returns ":r0:" etc,
  // which breaks querySelector. Sanitize to alphanumeric.
  const safeId = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;
  // Pre-rendered SVG for the active palette, if Kroki gave us one. Lets us
  // skip the ~600KB mermaid client bundle entirely when both palettes were
  // rendered at build time. Falls back to client mermaid only when the active
  // palette is missing.
  const ssrSvg = theme === "dark" ? svgDark : svgLight;
  const [svg, setSvg] = useState<string | null>(ssrSvg ?? null);
  const [error, setError] = useState<string | null>(null);
  const renderCount = useRef(0);

  useEffect(() => {
    // Server gave us this palette — render it directly, no mermaid bundle.
    if (ssrSvg) {
      setSvg(ssrSvg);
      setError(null);
      return;
    }

    // No SSR SVG for the active theme (Kroki down, or only one palette was
    // populated). Fall back to client mermaid.
    let cancelled = false;
    setError(null);
    const seq = ++renderCount.current;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === "dark" ? "dark" : "default",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        // Each render needs a unique id; suffix with the render seq so React
        // strict-mode double-invokes don't collide on the same DOM id.
        const { svg } = await mermaid.render(`${safeId}-${seq}`, code);
        if (!cancelled && seq === renderCount.current) setSvg(svg);
      } catch (e) {
        if (!cancelled && seq === renderCount.current) {
          setError(e instanceof Error ? e.message : String(e));
          setSvg(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, theme, safeId, ssrSvg]);

  if (error) {
    return (
      <div className={styles.root} role="img" aria-label={t("ui.mermaid.error")}>
        <pre className={styles.error}>
          {format(t("ui.mermaid.errorMessage"), { message: error })}
          {"\n\n"}
          {code}
        </pre>
      </div>
    );
  }

  if (svg) {
    return (
      <div
        className={styles.root}
        role="img"
        aria-label={t("ui.mermaid.label")}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  // SSR / pre-hydration: show the source as a placeholder so the layout reserves
  // roughly the right amount of space and copy-paste still works.
  return (
    <div className={styles.root} role="img" aria-label={t("ui.mermaid.loading")}>
      <pre className={styles.pending}>{code}</pre>
    </div>
  );
}
