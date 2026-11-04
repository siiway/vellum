import { Link, mergeClasses, tokens, Text } from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useEffect, useRef } from "react";
import type { SidebarGroup, SidebarItem } from "../../shared/types";
import { useVellum } from "../context";

// Prism-style navigation column: flat on the page canvas, a hairline on its
// inner edge, 13px items with a grey (not brand) highlight for the current
// page, and quiet 12px section labels.
const useStyles = makeStyles({
  root: {
    padding: "10px",
    overflowY: "auto",
    height: "calc(100vh - 52px)",
    position: "sticky",
    top: "52px",
    boxSizing: "border-box",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    background: "var(--vellum-canvas)",
    "@media (max-width: 960px)": { display: "none" },
  },
  // `mobile` variant: rendered inside a Drawer instead of as a sticky aside.
  // Drops the height clamp, sticky positioning, divider, and the "hide on
  // narrow viewports" media query so the same item tree works in both layouts.
  rootMobile: {
    padding: "0 2px",
    overflowY: "auto",
  },
  group: {
    marginBottom: "6px",
  },
  groupHeader: {
    display: "block",
    padding: "16px 10px 6px",
    margin: 0,
    fontSize: "12px",
    fontWeight: tokens.fontWeightRegular,
    lineHeight: "16px",
    color: tokens.colorNeutralForeground3,
  },
  groupFirst: {
    paddingTop: "6px",
  },
  link: {
    display: "flex",
    alignItems: "center",
    minHeight: "32px",
    paddingInline: "10px",
    paddingBlock: "6px",
    boxSizing: "border-box",
    color: tokens.colorNeutralForeground2,
    textDecoration: "none",
    borderRadius: tokens.borderRadiusMedium,
    fontSize: "13px",
    lineHeight: "18px",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
      textDecoration: "none",
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  // && bumps specificity so we win against FluentUI Link's own Griffel color rules.
  active: {
    "&&": {
      backgroundColor: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
      fontWeight: tokens.fontWeightMedium,
    },
  },
  nested: {
    marginLeft: "14px",
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingLeft: "6px",
    display: "flex",
    flexDirection: "column",
    gap: "1px",
  },
  branch: {
    display: "flex",
    alignItems: "center",
    minHeight: "32px",
    paddingInline: "10px",
    paddingBlock: "6px",
    boxSizing: "border-box",
    fontSize: "13px",
    lineHeight: "18px",
    fontWeight: tokens.fontWeightMedium,
    color: tokens.colorNeutralForeground1,
  },
  list: { display: "flex", flexDirection: "column", gap: "1px" },
});

export function Sidebar({
  groups,
  variant = "desktop",
}: {
  groups: SidebarGroup[];
  // `mobile` lifts the desktop-only constraints (sticky position, height
  // clamp, hide-at-narrow media query) so the same component renders inside
  // a Drawer on small viewports.
  variant?: "desktop" | "mobile";
}) {
  const styles = useStyles();
  const { data, t } = useVellum();
  const currentUrl = data.route.canonicalUrl;
  const containerRef = useRef<HTMLElement>(null);

  // After every navigation, scroll the active item into view so the user can see
  // where they are in the tree. `nearest` prevents jumpiness when it's already visible.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>("[data-vellum-active='true']");
    if (!active) return;
    const aRect = active.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    if (aRect.top < cRect.top + 24 || aRect.bottom > cRect.bottom - 24) {
      active.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }, [currentUrl]);

  const rootClass = variant === "mobile" ? styles.rootMobile : styles.root;
  return (
    <aside ref={containerRef} className={rootClass} aria-label={t("ui.nav.sidebar")}>
      {groups.map((group, gi) => (
        <section key={group.text} className={styles.group}>
          {group.text && (
            <Text
              className={mergeClasses(styles.groupHeader, gi === 0 && styles.groupFirst)}
              as="h2"
            >
              {group.text}
            </Text>
          )}
          <div className={styles.list}>
            {group.items.map((item) => (
              <Item
                key={item.link ?? item.text}
                item={item}
                currentUrl={currentUrl}
                styles={styles}
              />
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
}

function Item({
  item,
  currentUrl,
  styles,
}: {
  item: SidebarItem;
  currentUrl: string;
  styles: ReturnType<typeof useStyles>;
}) {
  if (item.items?.length) {
    return (
      <div>
        {item.link ? (
          <Link
            href={item.link}
            appearance="subtle"
            className={mergeClasses(styles.link, styles.branch)}
          >
            {item.text}
          </Link>
        ) : (
          <div className={styles.branch}>{item.text}</div>
        )}
        <div className={styles.nested}>
          {item.items.map((sub) => (
            <Item key={sub.link ?? sub.text} item={sub} currentUrl={currentUrl} styles={styles} />
          ))}
        </div>
      </div>
    );
  }
  if (!item.link) return null;
  const isActive = pathEq(item.link, currentUrl);
  return (
    <Link
      href={item.link}
      appearance="subtle"
      data-vellum-active={isActive || undefined}
      className={mergeClasses(styles.link, isActive && styles.active)}
    >
      {item.text}
    </Link>
  );
}

function pathEq(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\/$/, "").replace(/\.html$/, "");
  return norm(a) === norm(b);
}
