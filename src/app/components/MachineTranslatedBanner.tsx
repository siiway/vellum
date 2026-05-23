import {
  Badge,
  Caption1,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Translate24Regular, Warning24Regular } from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";

// Status banner shown above the article body any time the machine-translation
// pipeline touched the current page render. Two states:
//
//   - `machineTranslated: true` — the worker actually produced a translation
//     and the reader is looking at it. We show the "AI translated" notice
//     plus an inline list of other locales the page is available in.
//
//   - `translationAttempted: true && !machineTranslated` — MT was triggered
//     but the provider call no-op'd (no API key, network error, rate limit).
//     The reader is seeing the source content under their requested URL.
//     We surface a separate "translation not ready" banner so the reader
//     knows the page isn't actually in their locale yet.
//
// Both layouts cap the inline locale list at INLINE_LIMIT and surface a
// link to /{prefix}/languages when there are more.

const INLINE_LIMIT = 6;

const useStyles = makeStyles({
  wrapper: {
    // Symmetric block margin so the banner doesn't kiss whatever sits above
    // it (the hero / page title / outline). Inline margin keeps the banner
    // off the viewport edges on layouts whose `<main>` has no horizontal
    // padding (MSLearnHome). Doc + Home layouts already pad their content,
    // so this extra inset reads as a slight indent rather than a clash.
    marginBlock: tokens.spacingVerticalXXL,
    marginInline: tokens.spacingHorizontalL,
  },
  bar: {
    width: "100%",
    // FluentUI's MessageBar ships with a tight default padding that crowds
    // the icon against the title and squashes a multi-row body. Bump the
    // internal padding so the title / locale chips / notice each have
    // breathing room from the bar's border.
    paddingBlock: tokens.spacingVerticalM,
    paddingInline: tokens.spacingHorizontalL,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    // Each child (title, links, notice) gets a vertical gap rather than
    // sitting on top of each other. M lines up with the bar's internal
    // padding so the rhythm reads consistently top-to-bottom.
    gap: tokens.spacingVerticalS,
  },
  links: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
    color: tokens.colorNeutralForeground2,
  },
  sep: {
    color: tokens.colorNeutralForeground4,
  },
  notice: {
    color: tokens.colorNeutralForeground3,
  },
  // Row that pairs the "Translated by" label with a Badge wrapping the
  // upstream id. Inline-flex so the badge sits on the same baseline as
  // the label text, with a small gap so they don't crowd each other.
  modelRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground3,
  },
});

export function MachineTranslatedBanner() {
  const styles = useStyles();
  const { data, t, navigate } = useVellum();
  const meta = data.page.meta;

  // Don't render unless the MT pipeline touched this page.
  if (!meta.machineTranslated && !meta.translationAttempted) return null;

  const locales = data.config.site.locales;
  const currentLocale = data.route.localeCode;
  // Only surface locales that can actually resolve this same page — that's
  // the set the router populated into translatedLocales (default + hand-
  // curated + MT locales with a cached row in D1). When the field is
  // missing fall back to "everything except current" so older payloads
  // still render something useful.
  const available = meta.translatedLocales;
  const allowed = available ? new Set(available) : null;
  const others = locales
    .filter((l) => l.code !== currentLocale)
    .filter((l) => (allowed ? allowed.has(l.code) : true))
    .sort((a, b) => {
      const dflt = data.config.site.defaultLocale;
      if (a.code === dflt) return -1;
      if (b.code === dflt) return 1;
      return a.label.localeCompare(b.label);
    });

  const overflow = others.length > INLINE_LIMIT;
  const inline = overflow ? others.slice(0, INLINE_LIMIT) : others;

  function urlFor(localeCode: string): string {
    const locale = locales.find((l) => l.code === localeCode);
    const prefix = locale?.prefix ? `/${locale.prefix}` : "";
    const slug = data.route.repoSlug;
    const page = data.route.pagePath;
    if (page === "index" && slug === data.config.site.homepageRepo) return prefix || "/";
    if (page === "index") return `${prefix}/${slug}`;
    return `${prefix}/${slug}/${page}`.replace(/\/+/g, "/").replace(/\/$/, "");
  }

  function languagesPageUrl(): string {
    const prefix = locales.find((l) => l.code === currentLocale)?.prefix;
    const base = prefix ? `/${prefix}/languages` : "/languages";
    const slug = data.route.repoSlug;
    const page = data.route.pagePath;
    const target = `/${slug}${page === "index" ? "" : `/${page}`}`.replace(/\/+/g, "/");
    return `${base}?page=${encodeURIComponent(target)}`;
  }

  function onLink(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  }

  const isFallback = !meta.machineTranslated && meta.translationAttempted;
  const intent = isFallback ? "warning" : "info";
  const icon = isFallback ? <Warning24Regular /> : <Translate24Regular />;
  const title = t(isFallback ? "ui.translated.unavailableBanner" : "ui.translated.banner");
  const notice = t(isFallback ? "ui.translated.unavailableNotice" : "ui.translated.notice");

  return (
    <div className={mergeClasses(styles.wrapper, "vellum-no-print")}>
      <MessageBar intent={intent} className={styles.bar} icon={icon}>
        <MessageBarBody className={styles.body}>
          <MessageBarTitle>{title}</MessageBarTitle>
          {others.length > 0 && (
            <div className={styles.links}>
              {inline.map((l, i) => {
                const href = urlFor(l.code);
                return (
                  <span key={l.code} style={{ display: "inline-flex", alignItems: "center" }}>
                    {i > 0 && (
                      <span className={styles.sep} aria-hidden="true">
                        ·&nbsp;
                      </span>
                    )}
                    <Link href={href} onClick={(e) => onLink(e, href)}>
                      {l.label}
                    </Link>
                  </span>
                );
              })}
              {overflow && (
                <span style={{ display: "inline-flex", alignItems: "center" }}>
                  <span className={styles.sep} aria-hidden="true">
                    ·&nbsp;
                  </span>
                  <Link href={languagesPageUrl()} onClick={(e) => onLink(e, languagesPageUrl())}>
                    {t("ui.locale.allLanguages")} ({locales.length})
                  </Link>
                </span>
              )}
            </div>
          )}
          <Caption1 className={styles.notice}>{notice}</Caption1>
          {meta.translatedBy &&
            (() => {
              // Split the localized "Translated by {model}" string at the
              // placeholder so we can embed a FluentUI Badge in place of
              // the model id — gives the upstream identifier a chip-style
              // affordance that reads at a glance.
              const template = t("ui.translated.byModel");
              const [before, after] = template.split("{model}");
              return (
                <Caption1 className={styles.modelRow}>
                  {before}
                  <Badge appearance="outline" size="small">
                    {meta.translatedBy}
                  </Badge>
                  {after}
                </Caption1>
              );
            })()}
        </MessageBarBody>
      </MessageBar>
    </div>
  );
}
