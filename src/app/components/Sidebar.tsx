import { Link, mergeClasses, tokens, Text } from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useEffect, useRef } from "react";
import type { SidebarGroup, SidebarItem } from "../../shared/types";
import { useVellum } from "../context";

const useStyles = makeStyles({
  root: {
    paddingBlock: tokens.spacingVerticalL,
    paddingInline: tokens.spacingHorizontalM,
    overflowY: "auto",
    height: "calc(100vh - 56px)",
    position: "sticky",
    top: "56px",
    "@media (max-width: 960px)": { display: "none" },
    // Subtle right divider via box-shadow so it doesn't add to grid metrics.
    boxShadow: `inset -1px 0 0 ${tokens.colorNeutralStroke3}`,
  },
  // `mobile` variant: rendered inside a Drawer instead of as a sticky aside.
  // Drops the height clamp, sticky positioning, divider, and the "hide on
  // narrow viewports" media query so the same item tree works in both layouts.
  rootMobile: {
    paddingBlock: tokens.spacingVerticalL,
    paddingInline: tokens.spacingHorizontalM,
    overflowY: "auto",
  },
  group: {
    marginBottom: tokens.spacingVerticalL,
  },
  groupHeader: {
    display: "block",
    paddingInline: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalM,
    marginBottom: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    letterSpacing: "0.02em",
  },
  link: {
    display: "block",
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: "5px",
    color: tokens.colorNeutralForeground2,
    textDecoration: "none",
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    transition: "background-color 80ms ease-out, color 80ms ease-out",
    "&:hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
  },
  // && bumps specificity so we win against FluentUI Link's own Griffel color rules.
  active: {
    "&&": {
      backgroundColor: tokens.colorBrandBackground2,
      color: tokens.colorBrandForeground1,
      fontWeight: tokens.fontWeightSemibold,
    },
    "&&:hover": {
      backgroundColor: tokens.colorBrandBackground2Hover,
      color: tokens.colorBrandForeground1,
    },
  },
  nested: {
    marginLeft: tokens.spacingHorizontalM,
    borderLeft: `1px solid ${tokens.colorNeutralStroke3}`,
    paddingLeft: tokens.spacingHorizontalS,
    display: "flex",
    flexDirection: "column",
    gap: "1px",
  },
  branch: {
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: "5px",
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    marginTop: tokens.spacingVerticalXS,
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
      {groups.map((group) => (
        <section key={group.text} className={styles.group}>
          {group.text && (
            <Text className={styles.groupHeader} as="h2">
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
