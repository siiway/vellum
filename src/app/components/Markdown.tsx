import { useEffect, useRef } from "react";
import { tokens } from "@fluentui/react-components";
import { makeStyles } from "../css";

// Renders the SSR'd markdown HTML and wires up interactivity:
//   - copy-to-clipboard for code blocks
//   - tab switching for ::: code-group
//   - lazy mermaid render on first sight

const useStyles = makeStyles({
  prose: {
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    maxWidth: "780px",
    "& h1": {
      fontSize: tokens.fontSizeHero700,
      fontWeight: tokens.fontWeightBold,
      marginTop: tokens.spacingVerticalXXL,
      marginBottom: tokens.spacingVerticalL,
    },
    "& h2": {
      fontSize: tokens.fontSizeHero800,
      fontWeight: tokens.fontWeightSemibold,
      marginTop: tokens.spacingVerticalXXL,
      marginBottom: tokens.spacingVerticalM,
      paddingTop: tokens.spacingVerticalL,
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    "& h3": {
      fontSize: tokens.fontSizeBase600,
      fontWeight: tokens.fontWeightSemibold,
      marginTop: tokens.spacingVerticalXL,
      marginBottom: tokens.spacingVerticalS,
    },
    "& h4": {
      fontSize: tokens.fontSizeBase500,
      fontWeight: tokens.fontWeightSemibold,
      marginTop: tokens.spacingVerticalL,
    },
    "& p": { marginBlock: tokens.spacingVerticalM },
    "& a": {
      color: tokens.colorBrandForegroundLink,
      textDecoration: "none",
      "&:hover": { textDecoration: "underline" },
    },
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      backgroundColor: tokens.colorNeutralBackground3,
      paddingInline: "6px",
      paddingBlock: "2px",
      borderRadius: tokens.borderRadiusSmall,
      fontSize: "0.92em",
    },
    "& pre code": {
      backgroundColor: "transparent",
      padding: 0,
      borderRadius: 0,
      fontSize: tokens.fontSizeBase300,
    },
    "& ul, & ol": {
      paddingLeft: tokens.spacingHorizontalXXL,
      marginBlock: tokens.spacingVerticalM,
    },
    "& li": { marginBlock: tokens.spacingVerticalXS },
    "& blockquote": {
      margin: `${tokens.spacingVerticalM} 0`,
      paddingInlineStart: tokens.spacingHorizontalL,
      borderInlineStart: `4px solid ${tokens.colorNeutralStroke2}`,
      color: tokens.colorNeutralForeground2,
    },
    "& table": {
      borderCollapse: "collapse",
      width: "100%",
      marginBlock: tokens.spacingVerticalL,
      fontSize: tokens.fontSizeBase300,
    },
    "& th, & td": {
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
      textAlign: "left",
    },
    "& th": {
      backgroundColor: tokens.colorNeutralBackground2,
      fontWeight: tokens.fontWeightSemibold,
    },
    "& img.vellum-img": {
      maxWidth: "100%",
      borderRadius: tokens.borderRadiusMedium,
      marginBlock: tokens.spacingVerticalM,
    },
    "& hr": {
      border: 0,
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
      marginBlock: tokens.spacingVerticalXL,
    },

    // Callouts (containers + GFM alerts).
    "& .vellum-callout": {
      marginBlock: tokens.spacingVerticalL,
      padding: tokens.spacingHorizontalM,
      borderRadius: tokens.borderRadiusMedium,
      borderInlineStart: "4px solid",
      backgroundColor: tokens.colorNeutralBackground2,
    },
    "& .vellum-callout-title": {
      fontSize: tokens.fontSizeBase200,
      fontWeight: tokens.fontWeightBold,
      textTransform: "uppercase",
      marginBlockEnd: tokens.spacingVerticalXS,
      letterSpacing: "0.5px",
    },
    "& .vellum-callout-tip, & .vellum-callout-note": {
      borderInlineStartColor: tokens.colorBrandStroke1,
    },
    "& .vellum-callout-info": {
      borderInlineStartColor: tokens.colorPaletteBlueBorderActive,
    },
    "& .vellum-callout-warning, & .vellum-callout-caution": {
      borderInlineStartColor: tokens.colorPaletteMarigoldBorderActive,
      backgroundColor: tokens.colorPaletteMarigoldBackground1,
    },
    "& .vellum-callout-danger, & .vellum-callout-important": {
      borderInlineStartColor: tokens.colorPaletteRedBorderActive,
      backgroundColor: tokens.colorPaletteRedBackground1,
    },
    "& .vellum-callout-details": {
      borderInlineStartColor: tokens.colorNeutralStroke1,
      padding: tokens.spacingHorizontalM,
    },

    // Code blocks.
    "& .vellum-code-block": {
      position: "relative",
      borderRadius: tokens.borderRadiusMedium,
      backgroundColor: tokens.colorNeutralBackground3,
      marginBlock: tokens.spacingVerticalM,
      overflow: "hidden",
      border: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    "& .vellum-code-header": {
      display: "flex",
      alignItems: "center",
      gap: tokens.spacingHorizontalS,
      paddingInline: tokens.spacingHorizontalM,
      paddingBlock: tokens.spacingVerticalXS,
      backgroundColor: tokens.colorNeutralBackground4,
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
      fontSize: tokens.fontSizeBase200,
      color: tokens.colorNeutralForeground2,
    },
    "& .vellum-code-filename": {
      flex: 1,
      fontFamily: tokens.fontFamilyMonospace,
    },
    "& .vellum-code-lang": {
      color: tokens.colorNeutralForeground3,
      fontFamily: tokens.fontFamilyMonospace,
    },
    "& .vellum-code-copy": {
      background: "transparent",
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      color: tokens.colorNeutralForeground2,
      padding: "2px 8px",
      borderRadius: tokens.borderRadiusSmall,
      cursor: "pointer",
      fontSize: tokens.fontSizeBase200,
      "&:hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    },
    "& .vellum-code-copy.floating": {
      position: "absolute",
      top: tokens.spacingVerticalS,
      right: tokens.spacingHorizontalS,
      opacity: 0,
      transition: "opacity 100ms",
    },
    "& .vellum-code-block:hover .vellum-code-copy.floating": { opacity: 1 },
    "& .vellum-code pre, & pre.vellum-code": {
      margin: 0,
      padding: tokens.spacingHorizontalM,
      overflowX: "auto",
      fontSize: tokens.fontSizeBase300,
      lineHeight: tokens.lineHeightBase400,
    },
    "& .vellum-line-highlight": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      display: "block",
      marginInline: `-${tokens.spacingHorizontalM}`,
      paddingInline: tokens.spacingHorizontalM,
    },

    // Code groups.
    "& .vellum-codegroup": {
      marginBlock: tokens.spacingVerticalM,
      borderRadius: tokens.borderRadiusMedium,
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      overflow: "hidden",
    },
    "& .vellum-codegroup-tabs": {
      display: "flex",
      backgroundColor: tokens.colorNeutralBackground4,
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    "& .vellum-codegroup-tab": {
      background: "transparent",
      border: "none",
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
      cursor: "pointer",
      color: tokens.colorNeutralForeground2,
      fontSize: tokens.fontSizeBase200,
      borderBottom: "2px solid transparent",
    },
    "& .vellum-codegroup-tab.active": {
      color: tokens.colorBrandForeground1,
      borderBottomColor: tokens.colorBrandStroke1,
    },
    "& .vellum-codegroup-pane": { display: "none" },
    "& .vellum-codegroup-pane.active": { display: "block" },

    "& .vellum-anchor": {
      opacity: 0,
      color: tokens.colorNeutralForeground3,
      textDecoration: "none",
      marginLeft: tokens.spacingHorizontalXS,
      "&:hover": { color: tokens.colorBrandForeground1 },
    },
    "& h2:hover .vellum-anchor, & h3:hover .vellum-anchor, & h4:hover .vellum-anchor": {
      opacity: 1,
    },

    "& .vellum-mermaid": {
      fontFamily: tokens.fontFamilyMonospace,
      padding: tokens.spacingHorizontalM,
      backgroundColor: tokens.colorNeutralBackground3,
      borderRadius: tokens.borderRadiusMedium,
      marginBlock: tokens.spacingVerticalM,
      whiteSpace: "pre-wrap",
    },
  },
});

export function Markdown({ html }: { html: string }) {
  const styles = useStyles();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const root = ref.current;

    // Copy buttons.
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const btn = target.closest("[data-copy]") as HTMLElement | null;
      if (btn) {
        const block = btn.closest(".vellum-code-block");
        const code = block?.querySelector("pre code")?.textContent ?? "";
        navigator.clipboard?.writeText(code).then(() => {
          const original = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = original;
          }, 1200);
        });
        return;
      }
      const tab = target.closest("[data-codegroup-tab]") as HTMLElement | null;
      if (tab) {
        const group = tab.closest("[data-codegroup]");
        if (!group) return;
        const idx = tab.getAttribute("data-codegroup-tab");
        group
          .querySelectorAll<HTMLElement>("[data-codegroup-tab]")
          .forEach((b) => b.classList.remove("active"));
        group
          .querySelectorAll<HTMLElement>("[data-codegroup-pane]")
          .forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        group.querySelector(`[data-codegroup-pane="${idx}"]`)?.classList.add("active");
      }
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [html]);

  return <div ref={ref} className={styles.prose} dangerouslySetInnerHTML={{ __html: html }} />;
}
