import {
  Button,
  Image,
  Link,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
  Tooltip,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { makeStyles } from "../css";
import {
  Search16Regular,
  Search20Regular,
  Globe20Regular,
  Desktop16Regular,
  WeatherSunny16Regular,
  WeatherMoon16Regular,
  WeatherSunny20Regular,
  WeatherMoon20Regular,
  ChevronDown12Regular,
  Navigation20Regular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useVellum, type ThemeMode } from "../context";
import { getSocialIconSvg, defaultSocialLabel } from "./SocialIcons";
import { AskAiButton } from "./AskAI";
import { Segmented } from "./Segmented";

// Shell header in the Prism style: a solid strip of the page canvas with a
// hairline under it, compact 32px controls, and grey (not brand) selection.
export const HEADER_HEIGHT = 52;

const useStyles = makeStyles({
  root: {
    position: "sticky",
    top: 0,
    zIndex: 100,
    background: "var(--vellum-canvas)",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingInline: "16px 12px",
    height: `${HEADER_HEIGHT}px`,
    boxSizing: "border-box",
    "@media (max-width: 720px)": {
      gap: "4px",
      paddingInline: "8px",
    },
  },
  brandGroup: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
    flexShrink: 1,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minWidth: 0,
    color: tokens.colorNeutralForeground1,
    textDecoration: "none",
    "&:hover": { color: tokens.colorNeutralForeground1, textDecoration: "none" },
  },
  brandText: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // Repo crumb: muted, like a path segment after the site name.
  brandRepo: {
    gap: "8px",
    color: tokens.colorNeutralForeground3,
    "&:hover": { color: tokens.colorNeutralForeground1, textDecoration: "none" },
    "@media (max-width: 540px)": { display: "none" },
  },
  brandRepoText: {
    fontSize: tokens.fontSizeBase300,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  brandSep: {
    color: tokens.colorNeutralStroke1,
    fontSize: tokens.fontSizeBase400,
    userSelect: "none",
    "@media (max-width: 540px)": { display: "none" },
  },
  // Hamburger button wrapper: opens the mobile Drawer sidebar. Only shown
  // on narrow viewports; the desktop sticky sidebar handles the same role
  // at >=960px. Wrapped in a span because FluentUI's Button enforces its
  // own `display: inline-flex` at the same specificity our className uses,
  // so a direct `display: none` on the Button doesn't stick.
  menuBtn: {
    display: "none",
    "@media (max-width: 960px)": { display: "inline-flex" },
  },
  logo: {
    width: "24px",
    height: "24px",
    display: "block",
    flexShrink: 0,
    borderRadius: "7px",
  },
  logoSmall: {
    width: "20px",
    height: "20px",
    display: "block",
    flexShrink: 0,
    borderRadius: "6px",
  },
  spacer: { flex: 1 },
  navLinks: {
    display: "flex",
    alignItems: "center",
    gap: "1px",
    marginLeft: "12px",
    "@media (max-width: 720px)": { display: "none" },
  },
  navLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    minHeight: "32px",
    paddingInline: "10px",
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground2,
    textDecoration: "none",
    fontSize: "13px",
    fontWeight: tokens.fontWeightMedium,
    whiteSpace: "nowrap",
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
  // && beats FluentUI Link's own colour rules.
  navLinkActive: {
    "&&": {
      backgroundColor: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
    },
  },
  navMenuTrigger: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  navChevron: {
    color: tokens.colorNeutralForeground3,
  },
  actions: { display: "flex", alignItems: "center", gap: "2px" },
  // Social-link row. Sits between the locale picker and the theme switch in
  // the actions strip. Hidden when no links are configured.
  socials: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    "@media (max-width: 540px)": { display: "none" },
  },
  socialIcon: {
    display: "inline-flex",
    width: "18px",
    height: "18px",
    "& svg": { width: "100%", height: "100%", display: "block" },
  },
  // Looks like a field, acts as a button: opens the search dialog.
  searchBtn: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "240px",
    height: "32px",
    marginRight: "6px",
    padding: "0 8px 0 10px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground3,
    fontFamily: "inherit",
    fontSize: "13px",
    cursor: "pointer",
    "& > svg": { flexShrink: 0 },
    ":hover": {
      borderTopColor: tokens.colorNeutralStroke1,
      borderRightColor: tokens.colorNeutralStroke1,
      borderBottomColor: tokens.colorNeutralStroke1,
      borderLeftColor: tokens.colorNeutralStroke1,
      color: tokens.colorNeutralForeground2,
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "1px",
    },
    "@media (max-width: 900px)": { width: "180px" },
    // Below 540px the field duplicates the weight of the icon actions; the
    // icon-only `searchIconBtn` takes over.
    "@media (max-width: 540px)": { display: "none" },
  },
  searchIconBtn: {
    display: "none",
    "@media (max-width: 540px)": { display: "inline-flex" },
  },
  searchLabel: { flex: 1, textAlign: "left" },
  kbd: {
    padding: "0 5px",
    borderRadius: tokens.borderRadiusSmall,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: "11px",
    lineHeight: "18px",
    fontFamily: "inherit",
    "@media (max-width: 900px)": { display: "none" },
  },
  // Appearance panel. PopoverSurface ships its own drop-shadow filter and a
  // transparent border; replace both so there is one soft shadow and a
  // hairline edge, like Prism's account panel.
  prefPanel: {
    padding: "4px",
    minWidth: "220px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    filter: "none",
    boxShadow: tokens.shadow8,
    background: tokens.colorNeutralBackground1,
    fontSize: "13px",
  },
  prefRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    minHeight: "36px",
    padding: "0 4px 0 8px",
    color: tokens.colorNeutralForeground2,
  },
});

export interface NavBarProps {
  onOpenSearch: () => void;
  onOpenAskAi?: () => void;
  // When set, NavBar renders a hamburger button that calls this — used to
  // open the mobile sidebar Drawer on narrow viewports. Layout passes
  // `undefined` for layouts that don't have a sidebar (home, search).
  onOpenSidebar?: () => void;
}

export function NavBar({ onOpenSearch, onOpenAskAi, onOpenSidebar }: NavBarProps) {
  const styles = useStyles();
  const { data, navigate, t } = useVellum();
  const { site } = data.config;
  // SSR renders "Ctrl K"; the platform is only known in the browser.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  // Site title links to the configured homepage repo's localized home so a
  // zh reader stays in zh after clicking the brand. Repo crumb does the same
  // for the current repo. URL shape is locale-first:
  // `/{localePrefix}/{repoSlug}` — matches MS Learn convention.
  const localePrefix =
    data.config.site.locales.find((l) => l.code === data.route.localeCode)?.prefix ?? "";
  const prefix = localePrefix ? `/${localePrefix}` : "";
  const homepageHref = `${prefix}/${site.homepageRepo}`;
  const repoHref = data.route.repoSlug ? `${prefix}/${data.route.repoSlug}` : homepageHref;
  const repo = data.route.repo;

  return (
    <header className={styles.root}>
      <div className={styles.brandGroup}>
        <Link href={homepageHref} className={styles.brand} appearance="subtle">
          {site.logo && <Image src={site.logo} alt="" className={styles.logo} />}
          <Text className={styles.brandText}>{site.title}</Text>
        </Link>
        {repo && !repo.hideInBrand && (
          <>
            <span className={styles.brandSep} aria-hidden="true">
              /
            </span>
            <Link
              href={repoHref}
              className={mergeClasses(styles.brand, styles.brandRepo)}
              appearance="subtle"
            >
              {repo.logo && <Image src={repo.logo} alt="" className={styles.logoSmall} />}
              <Text className={styles.brandRepoText}>{repo.displayName}</Text>
            </Link>
          </>
        )}
      </div>
      <nav className={styles.navLinks} aria-label={t("ui.nav.primary")}>
        {(data.repoNav ?? data.config.nav ?? []).map((item) => {
          const active = isActiveNav(item, data.route.canonicalUrl);
          if (item.items) {
            // Highlight the dropdown trigger if any of its children match.
            const childActive = item.items.some((sub) => isActiveNav(sub, data.route.canonicalUrl));
            return (
              <Menu key={item.text}>
                <MenuTrigger disableButtonEnhancement>
                  <button
                    type="button"
                    className={mergeClasses(
                      styles.navLink,
                      styles.navMenuTrigger,
                      childActive && styles.navLinkActive,
                    )}
                  >
                    {item.text}
                    <ChevronDown12Regular className={styles.navChevron} />
                  </button>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    {item.items.map((sub) => {
                      const isExternal = sub.link && /^[a-z]+:\/\//i.test(sub.link);
                      return (
                        <MenuItem
                          key={sub.text}
                          onClick={() => {
                            if (!sub.link) return;
                            if (isExternal) window.open(sub.link, "_blank", "noopener,noreferrer");
                            else navigate(sub.link);
                          }}
                        >
                          {sub.text}
                        </MenuItem>
                      );
                    })}
                  </MenuList>
                </MenuPopover>
              </Menu>
            );
          }
          const isExternal = item.link && /^[a-z]+:\/\//i.test(item.link);
          return (
            <Link
              key={item.text}
              href={item.link ?? "#"}
              appearance="subtle"
              className={mergeClasses(styles.navLink, active && styles.navLinkActive)}
              {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {item.text}
            </Link>
          );
        })}
      </nav>
      <div className={styles.spacer} />
      <div className={styles.actions}>
        {/* Mobile hamburger: opens the sidebar Drawer. Sits next to the
            search button so it picks up the same icon-row visual weight as
            the other actions. The wrapper span carries the responsive
            display rule because FluentUI's Button enforces its own
            `display: inline-flex` at our class's specificity. */}
        {onOpenSidebar && (
          <span className={styles.menuBtn}>
            <Button
              appearance="subtle"
              icon={<Navigation20Regular />}
              onClick={onOpenSidebar}
              aria-label={t("ui.nav.sidebar")}
            />
          </span>
        )}
        {/* Desktop / tablet: a field-style button with label + shortcut hint.
            Mobile (<540px): a plain subtle icon button with the same weight
            as the other actions. */}
        <button
          type="button"
          className={styles.searchBtn}
          onClick={onOpenSearch}
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Search16Regular />
          <span className={styles.searchLabel}>{t("ui.search")}</span>
          <kbd className={styles.kbd}>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <Button
          appearance="subtle"
          icon={<Search20Regular />}
          onClick={onOpenSearch}
          aria-label={t("ui.search")}
          className={styles.searchIconBtn}
        />
        {onOpenAskAi && <AskAiButton onClick={onOpenAskAi} />}
        <LocalePicker />
        <SocialLinks />
        <ThemeSwitch />
      </div>
    </header>
  );
}

// Theme picker: an icon button opening a small panel with the same
// System / Light / Dark segmented switch Prism has in its account menu.
function ThemeSwitch() {
  const styles = useStyles();
  const { theme, themeMode, setThemeMode, t } = useVellum();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(_, d) => setOpen(d.open)}
      positioning={{ position: "below", align: "end", offset: 6 }}
      trapFocus
    >
      <PopoverTrigger disableButtonEnhancement>
        <Tooltip content={t("ui.theme.label")} relationship="label">
          <Button
            appearance="subtle"
            icon={theme === "dark" ? <WeatherMoon20Regular /> : <WeatherSunny20Regular />}
            aria-label={t("ui.theme.label")}
          />
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface className={styles.prefPanel}>
        <div className={styles.prefRow}>
          <span>{t("ui.theme.label")}</span>
          <Segmented<ThemeMode>
            label={t("ui.theme.label")}
            value={themeMode}
            onChange={setThemeMode}
            options={[
              { value: "system", label: t("ui.theme.system"), content: <Desktop16Regular /> },
              { value: "light", label: t("ui.theme.light"), content: <WeatherSunny16Regular /> },
              { value: "dark", label: t("ui.theme.dark"), content: <WeatherMoon16Regular /> },
            ]}
          />
        </div>
      </PopoverSurface>
    </Popover>
  );
}

// VitePress-style social-link strip. Each link is an icon-only FluentUI
// Button that opens in a new tab. Built-in icons (github, x, discord, …) come
// from src/web/components/SocialIcons.tsx; authors can also pass `{ svg }` for
// anything not in the registry.
function SocialLinks() {
  const styles = useStyles();
  const { data } = useVellum();
  // Per-repo overrides site-level. The worker resolves vellum.json /
  // VitePress / RepoConfig sources into `repoSocialLinks`; only when none of
  // those produced anything do we fall back to the site-wide list.
  const links = data.repoSocialLinks ?? data.config.site.socialLinks ?? [];
  if (links.length === 0) return null;
  return (
    <div className={styles.socials} aria-label="Social links">
      {links.map((l, i) => {
        const label = l.ariaLabel ?? defaultSocialLabel(l.icon);
        const svg = getSocialIconSvg(l.icon);
        return (
          <Tooltip key={i} content={label} relationship="label">
            <Button
              as="a"
              href={l.link}
              target="_blank"
              rel="noopener noreferrer"
              appearance="subtle"
              aria-label={label}
              icon={
                <span
                  className={styles.socialIcon}
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              }
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

// VitePress-style active match: an item is active if `activeMatch` (a regex
// string against the current URL path within the repo) matches, or if the
// item's resolved link matches the current canonical URL.
function isActiveNav(item: { link?: string; activeMatch?: string }, canonicalUrl: string): boolean {
  if (item.activeMatch) {
    try {
      // activeMatch is written against the repo-relative path (e.g. "^/api"),
      // so we strip the /repo/[locale] prefix before testing. We just take
      // the substring starting at the first slash that isn't part of the prefix.
      const parts = canonicalUrl.split("/").filter(Boolean);
      // Drop repo slug + optional locale: keep everything from index 1 (or 2 if
      // the second segment is a 2-3 char locale). Cheap heuristic — locales in
      // configs are typically short codes.
      const localeLike = parts[1] && parts[1].length <= 5 && /^[a-z-]+$/.test(parts[1]);
      const rel = "/" + parts.slice(localeLike ? 2 : 1).join("/");
      return new RegExp(item.activeMatch).test(rel || "/");
    } catch {
      return false;
    }
  }
  if (!item.link) return false;
  // Strip query/hash from both sides for comparison.
  const stripped = item.link.split(/[?#]/)[0]!.replace(/\/$/, "");
  const current = canonicalUrl.replace(/\/$/, "");
  return stripped === current;
}

// When the site has more than this many locales the picker truncates and
// surfaces an "All languages" link to the dedicated /{prefix}/languages
// page. Picked so the menu never grows past ~12 rows on a typical screen
// — beyond that the dropdown becomes a scroll-heavy menu of dubious utility.
const LOCALE_DROPDOWN_LIMIT = 10;

function LocalePicker() {
  const { data, navigate, t } = useVellum();
  if (data.config.site.locales.length <= 1) return null;

  const currentLocale = data.route.localeCode;
  const repoSlug = data.route.repoSlug;
  const pagePath = data.route.pagePath;

  function linkFor(localeCode: string): string {
    const locale = data.config.site.locales.find((l) => l.code === localeCode)!;
    const prefix = locale.prefix ? `/${locale.prefix}` : "";
    // Special cases for the canonical short forms:
    //   - homepageRepo's index → `/{prefix}` (no slug, no "index" segment)
    //   - any other repo's index → `/{prefix}/{slug}` (no trailing "index")
    // Without these the link would be `/zh/homepage/index`, which is the
    // long form and immediately bounces through two redirects before
    // landing at `/zh`.
    if (pagePath === "index" && repoSlug === data.config.site.homepageRepo) return prefix || "/";
    if (pagePath === "index") return `${prefix}/${repoSlug}`;
    return `${prefix}/${repoSlug}/${pagePath}`.replace(/\/+/g, "/").replace(/\/$/, "");
  }

  // Link to /{currentPrefix}/languages, threading the current page through
  // ?page= so a click on a tile lands on the same page in the new locale
  // rather than the locale's home.
  function languagesPageUrl(): string {
    const prefix = data.config.site.locales.find((l) => l.code === currentLocale)?.prefix;
    const base = prefix ? `/${prefix}/languages` : "/languages";
    const target = pagePath === "index" ? `/${repoSlug}` : `/${repoSlug}/${pagePath}`;
    const cleaned = target.replace(/\/+/g, "/");
    return `${base}?page=${encodeURIComponent(cleaned)}`;
  }

  function chooseLocale(localeCode: string) {
    // Persist the explicit choice so the `/` entry-point redirect (which
    // reads this cookie before Accept-Language) honours it on future visits.
    // 1 year matches the server-side Max-Age so cookie expiry agrees.
    try {
      // eslint-disable-next-line react-hooks/immutability
      document.cookie = `vellum-locale=${encodeURIComponent(localeCode)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    } catch {
      // Some embedding contexts (sandboxed iframes) can throw on cookie writes;
      // navigation still works without the persistence.
    }
    navigate(linkFor(localeCode));
  }

  // Only show locales that have a translation for the current page.
  // Always include the current locale so the reader can't lose their
  // position even if translatedLocales is stale or incomplete.
  const available = data.page.meta.translatedLocales;
  const translated = available
    ? data.config.site.locales.filter((l) => available.includes(l.code) || l.code === currentLocale)
    : data.config.site.locales;

  // Sort: current locale first, then human-translated, then machine-
  // translated. Within each tier, alphabetical by label.
  const sorted = [...translated].sort((a, b) => {
    if (a.code === currentLocale) return -1;
    if (b.code === currentLocale) return 1;
    if (a.machineTranslated !== b.machineTranslated) return a.machineTranslated ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
  const overflow = sorted.length > LOCALE_DROPDOWN_LIMIT;
  const shown = overflow ? sorted.slice(0, LOCALE_DROPDOWN_LIMIT) : sorted;

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button appearance="subtle" icon={<Globe20Regular />} aria-label={t("ui.locale.label")} />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {shown.map((l) => (
            <MenuItem
              key={l.code}
              onClick={() => chooseLocale(l.code)}
              disabled={l.code === currentLocale}
            >
              {l.label}
            </MenuItem>
          ))}
          {overflow && <MenuDivider />}
          <MenuItem onClick={() => navigate(languagesPageUrl())}>
            {overflow
              ? `${t("ui.locale.allLanguages")} (${data.config.site.locales.length})`
              : t("ui.locale.moreLanguages")}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
