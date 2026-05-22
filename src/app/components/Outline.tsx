import { mergeClasses, tokens, Text } from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OutlineNode } from "../../shared/types";
// Outline navigation is local to the page (hash changes only) so it doesn't go
// through the SPA router — that would race against scrollIntoView.

const useStyles = makeStyles({
  root: {
    paddingBlock: tokens.spacingVerticalL,
    paddingInline: tokens.spacingHorizontalL,
    position: "sticky",
    top: "56px",
    height: "calc(100vh - 56px)",
    overflowY: "auto",
    fontSize: tokens.fontSizeBase200,
    "@media (max-width: 1200px)": { display: "none" },
  },
  header: {
    display: "block",
    marginBottom: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: tokens.colorNeutralForeground3,
  },
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  link: {
    display: "block",
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground3,
    textDecoration: "none",
    borderLeft: "2px solid transparent",
    marginLeft: "-1px",
    cursor: "pointer",
    "&:hover": { color: tokens.colorNeutralForeground1 },
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.92em",
      backgroundColor: tokens.colorNeutralBackground3,
      padding: "1px 5px",
      borderRadius: tokens.borderRadiusSmall,
    },
    "& a": { color: "inherit", textDecoration: "none" },
  },
  active: {
    borderLeftColor: tokens.colorBrandStroke1,
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
});

export function Outline({ nodes, label }: { nodes: OutlineNode[]; label: string }) {
  const styles = useStyles();
  const containerRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  const flat = useMemo(() => flatten(nodes), [nodes]);
  const slugs = useMemo(() => flat.map((n) => n.slug), [flat]);
  const [active, setActive] = useActiveHeading(slugs);

  // When the active link changes (whether from scroll or click), keep it
  // visible inside the outline pane so the user always sees their position.
  useEffect(() => {
    if (!active) return;
    const el = itemRefs.current.get(active);
    const container = containerRef.current;
    if (!el || !container) return;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    if (elRect.top < cRect.top + 24 || elRect.bottom > cRect.bottom - 24) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [active]);

  const onLinkClick = useCallback(
    (slug: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      // Snap the active highlight immediately so it doesn't lag the click.
      setActive(slug);
      const target = document.getElementById(slug);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      // Update the URL hash without triggering a refetch.
      const url = new URL(window.location.href);
      url.hash = slug;
      window.history.replaceState(null, "", url.toString());
    },
    [setActive],
  );

  if (!nodes.length) return <aside ref={containerRef} className={styles.root} aria-label={label} />;

  return (
    <aside ref={containerRef} className={styles.root} aria-label={label}>
      <Text className={styles.header} as="h2">
        {label}
      </Text>
      <ul className={styles.list}>
        {flat.map((n) => {
          const isActive = active === n.slug;
          return (
            <li key={n.slug} style={{ paddingLeft: `${(n.depth - 2) * 12}px` }}>
              <a
                href={`#${n.slug}`}
                ref={(el) => {
                  if (el) itemRefs.current.set(n.slug, el);
                  else itemRefs.current.delete(n.slug);
                }}
                className={mergeClasses(styles.link, isActive && styles.active)}
                onClick={onLinkClick(n.slug)}
                data-no-router="true"
                {...(n.html
                  ? { dangerouslySetInnerHTML: { __html: n.html } }
                  : { children: n.text })}
              />
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function flatten(nodes: OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  function walk(list: OutlineNode[]) {
    for (const n of list) {
      out.push(n);
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return out;
}

// Tracks the currently visible heading. Exposes a setter so click handlers can
// snap the highlight before the scroll animation finishes — otherwise the
// IntersectionObserver lags behind the click.
function useActiveHeading(slugs: string[]): [string | null, (slug: string) => void] {
  const [active, setActive] = useState<string | null>(slugs[0] ?? null);
  const manualUntil = useRef<number>(0);

  // Reset to the first slug when the page changes (slugs list will swap).
  const slugKey = slugs.join("|");
  useEffect(() => {
    setActive(slugs[0] ?? null);
  }, [slugKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const headings = slugs
      .map((s) => document.getElementById(s))
      .filter((el): el is HTMLElement => !!el);
    if (!headings.length) return;

    // Track visible headings so we can always pick the right one even when
    // the user scrolls past the rootMargin sweet spot.
    const visible = new Map<string, IntersectionObserverEntry>();
    const observer = new IntersectionObserver(
      (entries) => {
        // Ignore observer updates while a click-driven snap is settling.
        if (Date.now() < manualUntil.current) return;
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e);
          else visible.delete(e.target.id);
        }
        if (visible.size) {
          // Pick the topmost visible heading.
          const sorted = [...visible.values()].sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
          setActive(sorted[0]!.target.id);
        } else {
          // Nothing intersecting (between headings) — pick the last one above the viewport.
          let lastAbove: HTMLElement | null = null;
          for (const h of headings) {
            if (h.getBoundingClientRect().top < 100) lastAbove = h;
          }
          if (lastAbove) setActive(lastAbove.id);
        }
      },
      // Generous top margin so the heading the user just clicked to stays in range.
      { rootMargin: "-64px 0px -55% 0px", threshold: [0, 1] },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [slugKey]);

  const snap = useCallback((slug: string) => {
    setActive(slug);
    // Suppress the observer for ~700ms so the smooth scroll doesn't override us.
    manualUntil.current = Date.now() + 700;
  }, []);

  return [active, snap];
}
