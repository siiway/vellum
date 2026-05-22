// Renders a fenced ```mermaid block as an SVG diagram on the client.
// Mermaid is heavy (~600KB), so we dynamic-import it the first time a diagram
// mounts — pages without diagrams pay nothing. SSR emits the raw code as a
// preformatted block; once hydrated, the effect swaps in the rendered SVG.
// Re-renders on theme change to keep the diagram's palette in sync.

import { useEffect, useId, useRef, useState } from "react";
import { tokens } from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useVellum } from "../context";

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

export function MermaidBlock({
  code,
  svgLight,
  svgDark,
}: {
  code: string;
  svgLight?: string;
  svgDark?: string;
}) {
  const styles = useStyles();
  const { theme } = useVellum();
  const reactId = useId();
  // Mermaid requires IDs valid as CSS selectors — useId() returns ":r0:" etc,
  // which breaks querySelector. Sanitize to alphanumeric.
  const safeId = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;
  // Pre-rendered SVG for the active palette, if Kroki gave us one. Lets us
  // skip the ~600KB mermaid client bundle entirely when both palettes were
  // rendered server-side. Falls back to client mermaid only when the active
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
      <div className={styles.root} role="img" aria-label="Mermaid diagram (error)">
        <pre className={styles.error}>
          Mermaid error: {error}
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
        aria-label="Mermaid diagram"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  // SSR / pre-hydration: show the source as a placeholder so the layout reserves
  // roughly the right amount of space and copy-paste still works.
  return (
    <div className={styles.root} role="img" aria-label="Mermaid diagram (loading)">
      <pre className={styles.pending}>{code}</pre>
    </div>
  );
}
