import {
  Button,
  Image,
  Link,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  Tooltip,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { makeStyles } from "../css";
import {
  Search24Regular,
  Globe24Regular,
  WeatherSunny24Regular,
  WeatherMoon24Regular,
  ChevronDown16Regular,
} from "@fluentui/react-icons";
import { useVellum } from "../context";
import { getSocialIconSvg, defaultSocialLabel } from "./SocialIcons";

const useStyles = makeStyles({
  root: {
    position: "sticky",
    top: 0,
    zIndex: 100,
    backdropFilter: "saturate(180%) blur(14px)",
    WebkitBackdropFilter: "saturate(180%) blur(14px)",
    backgroundColor: tokens.colorNeutralBackgroundAlpha,
    boxShadow: `inset 0 -1px 0 ${tokens.colorNeutralStroke3}`,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    paddingInline: tokens.spacingHorizontalXL,
    height: "60px",
  },
  brandGroup: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalSNudge,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    textDecoration: "none",
    letterSpacing: "-0.01em",
    "&:hover": { color: tokens.colorBrandForeground1 },
  },
  brandRepo: {
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightRegular,
    "@media (max-width: 540px)": { display: "none" },
  },
  brandSep: {
    width: "1px",
    height: "18px",
    backgroundColor: tokens.colorNeutralStroke2,
    flexShrink: 0,
    "@media (max-width: 540px)": { display: "none" },
  },
  logo: { width: "26px", height: "26px", display: "block", flexShrink: 0 },
  logoSmall: { width: "22px", height: "22px", display: "block", flexShrink: 0 },
  spacer: { flex: 1 },
  navLinks: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    marginLeft: tokens.spacingHorizontalM,
    "@media (max-width: 720px)": { display: "none" },
  },
  navLink: {
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: "6px",
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground2,
    textDecoration: "none",
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightRegular,
    "&:hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
  },
  navLinkActive: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  navMenuTrigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: tokens.lineHeightBase300,
  },
  navChevron: {
    opacity: 0.6,
    marginLeft: "1px",
  },
  actions: { display: "flex", alignItems: "center", gap: "4px" },
  // Social-link row. Sits between the locale picker and the theme toggle in
  // the NavBar actions strip. Hidden when no links are configured.
  socials: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    "@media (max-width: 540px)": { display: "none" },
  },
  socialIcon: {
    display: "inline-flex",
    width: "20px",
    height: "20px",
    "& svg": { width: "100%", height: "100%", display: "block" },
  },
  searchBtn: {
    minWidth: "220px",
    height: "34px",
    justifyContent: "flex-start",
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    backgroundColor: tokens.colorNeutralBackground2,
    borderColor: tokens.colorNeutralStroke2,
    "@media (max-width: 720px)": { minWidth: "auto" },
    "&:hover": { backgroundColor: tokens.colorNeutralBackground2Hover },
  },
  searchLabel: { flex: 1, textAlign: "left", marginLeft: "4px" },
  kbd: {
    marginLeft: "auto",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: "1px 5px",
    fontFamily: tokens.fontFamilyMonospace,
    fontWeight: tokens.fontWeightSemibold,
    "@media (max-width: 720px)": { display: "none" },
  },
});

export interface NavBarProps {
  onOpenSearch: () => void;
}

export function NavBar({ onOpenSearch }: NavBarProps) {
  const styles = useStyles();
  const { data, theme, setTheme, navigate, t } = useVellum();
  const { site } = data.config;

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
          <Text weight="semibold">{site.title}</Text>
        </Link>
        {repo && !repo.hideInBrand && (
          <>
            <span className={styles.brandSep} aria-hidden="true" />
            <Link
              href={repoHref}
              className={mergeClasses(styles.brand, styles.brandRepo)}
              appearance="subtle"
            >
              {repo.logo && <Image src={repo.logo} alt="" className={styles.logoSmall} />}
              <Text>{repo.displayName}</Text>
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
                    <ChevronDown16Regular className={styles.navChevron} />
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
        <Button
          appearance="outline"
          icon={<Search24Regular />}
          onClick={onOpenSearch}
          className={styles.searchBtn}
        >
          <span style={{ flex: 1, textAlign: "left" }}>{t("ui.search")}</span>
          <span className={styles.kbd}>Ctrl K</span>
        </Button>
        <LocalePicker />
        <SocialLinks />
        <Tooltip
          content={theme === "dark" ? t("ui.theme.toggleToLight") : t("ui.theme.toggleToDark")}
          relationship="label"
        >
          <Button
            appearance="subtle"
            icon={theme === "dark" ? <WeatherSunny24Regular /> : <WeatherMoon24Regular />}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? t("ui.theme.toggleToLight") : t("ui.theme.toggleToDark")}
          />
        </Tooltip>
      </div>
    </header>
  );
}

// VitePress-style social-link strip. Each link is an icon-only FluentUI
// Button that opens in a new tab. Built-in icons (github, x, discord, …) come
// from src/app/components/SocialIcons.tsx; authors can also pass `{ svg }` for
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

function LocalePicker() {
  const { data, navigate, t } = useVellum();
  if (data.config.site.locales.length <= 1) return null;

  const currentLocale = data.route.localeCode;
  const repoSlug = data.route.repoSlug;
  const pagePath = data.route.pagePath;

  function linkFor(localeCode: string): string {
    const locale = data.config.site.locales.find((l) => l.code === localeCode)!;
    const prefix = locale.prefix ? `/${locale.prefix}` : "";
    // Locale-first: `/{prefix}/{repoSlug}/{pagePath}`.
    return (
      `${prefix}/${repoSlug}/${pagePath}`.replace(/\/+/g, "/").replace(/\/$/, "") ||
      `${prefix}/${repoSlug}`
    );
  }

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button appearance="subtle" icon={<Globe24Regular />} aria-label={t("ui.locale.label")} />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {data.config.site.locales.map((l) => (
            <MenuItem
              key={l.code}
              onClick={() => navigate(linkFor(l.code))}
              disabled={l.code === currentLocale}
            >
              {l.label}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
