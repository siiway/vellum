// Full-page locale chooser. Rendered when frontmatter.layout === "languages".
// Lists every configured locale (hand-curated + machine-translated targets)
// grouped by continent, with a link back to whichever page the reader was
// on when they triggered the picker.
//
// Continent grouping uses `Intl.Locale.maximize().region` to get the
// likely-region for a language, then `countries-list` to map that region
// to a continent. Both are external sources — no hardcoded mapping in
// this codebase.
//
// The reader's current target page comes in via `?page=` (sanitised; must
// start with `/`, no `..`, no protocol prefix). Each card click swaps
// locale without changing page.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Card,
  Input,
  Subtitle1,
  Title1,
  Title2,
  Tooltip,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Search24Regular, Translate24Regular } from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { displayLocaleCode, localeContinent, type LocaleConfig } from "../../shared/types";
import type { MessageKey } from "../../shared/i18n";
import { TranslateRepoDialog } from "./TranslateRepoDialog";

const useStyles = makeStyles({
  root: {
    minHeight: "calc(100vh - 60px)",
    paddingBlock: tokens.spacingVerticalXXXL,
    paddingInline: tokens.spacingHorizontalXXXL,
    maxWidth: "1100px",
    marginInline: "auto",
    "@media (max-width: 720px)": {
      paddingInline: tokens.spacingHorizontalL,
      paddingBlock: tokens.spacingVerticalXL,
    },
  },
  header: {
    marginBottom: tokens.spacingVerticalXL,
  },
  title: {
    display: "block",
    marginBlock: 0,
    color: tokens.colorNeutralForeground1,
  },
  subtitle: {
    marginTop: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground2,
  },
  search: {
    marginTop: tokens.spacingVerticalL,
    maxWidth: "420px",
  },
  section: {
    marginTop: tokens.spacingVerticalXXL,
  },
  sectionFirst: {
    marginTop: tokens.spacingVerticalL,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sectionTitle: {
    color: tokens.colorNeutralForeground1,
  },
  sectionCount: {
    color: tokens.colorNeutralForeground3,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: tokens.spacingHorizontalM,
    // Equal-row heights: every card in a row stretches to the tallest
    // sibling so a card with a "Machine-translated" badge doesn't sit
    // taller than the bare ones next to it.
    gridAutoRows: "1fr",
  },
  // The clickable wrapper. We pair a block-level <a> with a FluentUI Card
  // so the anchor's bounding box exactly matches the card's visuals
  // (`display: block`, full width + height, takes its size from the grid
  // track). The Card supplies the FluentUI appearance / tokens; the
  // anchor handles navigation + right-click semantics.
  linkWrap: {
    display: "block",
    width: "100%",
    height: "100%",
    textDecoration: "none",
    color: "inherit",
    borderRadius: tokens.borderRadiusMedium,
    "&:focus-visible": {
      outline: `2px solid ${tokens.colorBrandStroke1}`,
      outlineOffset: "2px",
    },
  },
  // Card-level styling. The Card already supplies the appearance tokens;
  // we only need to wire up the colour-only interaction states (no
  // transform / shadow — the hitbox must stay aligned with the visuals).
  card: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    cursor: "pointer",
    transition: "background-color 80ms ease, border-color 80ms ease",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground2Hover,
      borderColor: tokens.colorBrandStroke1,
    },
    "&:active": {
      backgroundColor: tokens.colorNeutralBackground2Pressed,
    },
  },
  // Current locale gets a brand-tinted background and is non-interactive —
  // no pointer cursor, no hover colour shift.
  cardCurrent: {
    borderColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorBrandBackground2,
    cursor: "default",
    "&:hover": {
      backgroundColor: tokens.colorBrandBackground2,
      borderColor: tokens.colorBrandStroke1,
    },
  },
  cardLabel: {
    display: "block",
    color: "inherit",
  },
  cardCode: {
    display: "block",
    marginTop: tokens.spacingVerticalXXS,
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
  },
  badgeRow: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    // Pushes the badge row to the bottom of the card via flex; combined
    // with the card's `height: 100%` this keeps badged and bare cards at
    // the same height in any row.
    marginTop: "auto",
    paddingTop: tokens.spacingVerticalS,
    flexWrap: "wrap",
  },
  // Reserves the same vertical space when a card has no badges, so the
  // header (label + code) sits at the same Y position on every card.
  // Height matches the badge row's content height (~24px badge plus the
  // paddingTop above).
  badgeRowPlaceholder: {
    marginTop: "auto",
    paddingTop: tokens.spacingVerticalS,
    minHeight: "24px",
  },
  translateBtn: {
    marginTop: tokens.spacingVerticalXS,
    minWidth: 0,
    padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
    fontSize: tokens.fontSizeBase200,
  },
  empty: {
    color: tokens.colorNeutralForeground2,
    marginTop: tokens.spacingVerticalXXL,
  },
});

// Ordered list of continent buckets shown on the page. Keeping the order
// hardcoded (rather than alphabetical) lets us put densely-populated
// continents first so the reader sees relevant entries above the fold.
const CONTINENT_ORDER = ["AS", "EU", "AF", "NA", "SA", "OC", "AN", "OTHER"] as const;

type Bucket = (typeof CONTINENT_ORDER)[number];

export function LanguagesPage() {
  const styles = useStyles();
  const { data, navigate, t } = useVellum();
  const locales = data.config.site.locales;
  const translatedSet = useMemo(
    () => (data.page.meta.translatedLocales ? new Set(data.page.meta.translatedLocales) : null),
    [data.page.meta.translatedLocales],
  );
  const defaultLocale = data.config.site.defaultLocale;
  const hasTranslateConfig = !!data.config.site.translate;

  const [target, setTarget] = useState<string>(() => readTargetFromUrl());
  useEffect(() => {
    const onPop = () => setTarget(readTargetFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const [filter, setFilter] = useState("");

  const [translateLocale, setTranslateLocale] = useState<LocaleConfig | null>(null);
  const onTranslateClick = useCallback((e: React.MouseEvent, locale: LocaleConfig) => {
    e.preventDefault();
    e.stopPropagation();
    setTranslateLocale(locale);
  }, []);

  // Bucket locales by continent. Each bucket is sorted by native label so
  // readers can scan alphabetically inside a section. Filter applies before
  // bucketing — empty buckets get pruned from the rendered output.
  const buckets = useMemo(() => {
    const lower = filter.trim().toLowerCase();
    const filtered = lower
      ? locales.filter(
          (l) =>
            l.label.toLowerCase().includes(lower) ||
            l.code.toLowerCase().includes(lower) ||
            (l.prefix && l.prefix.toLowerCase().includes(lower)) ||
            displayLocaleCode(l).toLowerCase().includes(lower),
        )
      : locales;

    const map = new Map<Bucket, LocaleConfig[]>();
    for (const l of filtered) {
      const continent = localeContinent(l.code) ?? "OTHER";
      const bucket = (CONTINENT_ORDER as readonly string[]).includes(continent)
        ? (continent as Bucket)
        : ("OTHER" as Bucket);
      const arr = map.get(bucket) ?? [];
      arr.push(l);
      map.set(bucket, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.label.localeCompare(b.label));
    }
    return map;
  }, [locales, filter]);

  function urlFor(locale: LocaleConfig): string {
    const prefix = locale.prefix ? `/${locale.prefix}` : "";
    if (!target || target === "/") return prefix || "/";
    return `${prefix}${target}`.replace(/\/+/g, "/").replace(/\/$/, "") || prefix || "/";
  }

  function onChoose(e: React.MouseEvent<HTMLAnchorElement>, locale: LocaleConfig) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    try {
      document.cookie = `vellum-locale=${encodeURIComponent(locale.code)}; Path=/; Max-Age=${
        60 * 60 * 24 * 365
      }; SameSite=Lax`;
    } catch {
      // ignore
    }
    navigate(urlFor(locale));
  }

  const totalShown = Array.from(buckets.values()).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Title1 className={styles.title}>{t("ui.languages.title")}</Title1>
        <Body1 className={styles.subtitle}>{t("ui.languages.subtitle")}</Body1>
        <div className={styles.search}>
          <Input
            placeholder={t("ui.search.placeholder")}
            value={filter}
            onChange={(_, d) => setFilter(d.value)}
            contentBefore={<Search24Regular />}
            appearance="outline"
          />
        </div>
      </header>

      {totalShown === 0 ? (
        <Body1 className={styles.empty}>{t("ui.languages.empty")}</Body1>
      ) : (
        CONTINENT_ORDER.map((bucket, sectionIndex) => {
          const items = buckets.get(bucket);
          if (!items || !items.length) return null;
          const continentKey = `ui.languages.continent.${bucket}` as MessageKey;
          return (
            <section
              key={bucket}
              className={sectionIndex === 0 ? styles.sectionFirst : styles.section}
            >
              <header className={styles.sectionHeader}>
                <Title2 className={styles.sectionTitle}>{t(continentKey)}</Title2>
                <Caption1 className={styles.sectionCount}>({items.length})</Caption1>
              </header>
              <div className={styles.grid}>
                {items.map((l) => {
                  const isCurrent = l.code === data.route.localeCode;
                  const isSource = l.code === defaultLocale;
                  const isTranslated = !translatedSet || translatedSet.has(l.code);
                  const href = urlFor(l);
                  const displayCode = displayLocaleCode(l);

                  const badges: Array<{
                    label: string;
                    appearance: "tint" | "outline";
                    color: "brand" | "informative" | "subtle";
                  }> = [];
                  if (isCurrent)
                    badges.push({
                      label: t("ui.languages.current"),
                      appearance: "tint",
                      color: "brand",
                    });
                  if (isSource)
                    badges.push({
                      label: t("ui.languages.source"),
                      appearance: "outline",
                      color: "informative",
                    });
                  else if (l.machineTranslated && isTranslated)
                    badges.push({
                      label: t("ui.languages.machineTranslated"),
                      appearance: "outline",
                      color: "brand",
                    });
                  else if (l.machineTranslated && !isTranslated)
                    badges.push({
                      label: t("ui.languages.notTranslatedYet"),
                      appearance: "outline",
                      color: "subtle",
                    });

                  return (
                    <a
                      key={l.code}
                      href={href}
                      onClick={(e) => !isCurrent && onChoose(e, l)}
                      className={styles.linkWrap}
                      aria-current={isCurrent ? "page" : undefined}
                      aria-disabled={isCurrent || undefined}
                    >
                      <Card
                        appearance={isCurrent ? "filled-alternative" : "outline"}
                        className={mergeClasses(styles.card, isCurrent && styles.cardCurrent)}
                      >
                        <Subtitle1 className={styles.cardLabel}>{l.label}</Subtitle1>
                        <Caption1 className={styles.cardCode}>{displayCode}</Caption1>
                        {badges.length > 0 ||
                        (hasTranslateConfig && l.machineTranslated && !isSource) ? (
                          <div className={styles.badgeRow}>
                            {badges.map((b) => (
                              <Badge key={b.label} appearance={b.appearance} color={b.color}>
                                {b.label}
                              </Badge>
                            ))}
                            {hasTranslateConfig && l.machineTranslated && !isSource && (
                              <Tooltip
                                content={t(
                                  "ui.languages.translateRepo" as MessageKey,
                                  "Translate all pages in every repo to this language",
                                )}
                                relationship="label"
                              >
                                <Button
                                  size="small"
                                  appearance="subtle"
                                  icon={<Translate24Regular />}
                                  className={styles.translateBtn}
                                  onClick={(e) => onTranslateClick(e, l)}
                                >
                                  {t("ui.languages.translateAll" as MessageKey, "Translate all")}
                                </Button>
                              </Tooltip>
                            )}
                          </div>
                        ) : (
                          <div className={styles.badgeRowPlaceholder} aria-hidden="true" />
                        )}
                      </Card>
                    </a>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {translateLocale && (
        <TranslateRepoDialog
          open={!!translateLocale}
          onClose={() => setTranslateLocale(null)}
          locale={translateLocale}
          repos={data.config.repos}
        />
      )}
    </div>
  );
}

function readTargetFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("page") ?? "";
  if (!raw) return "";
  if (!raw.startsWith("/")) return "";
  if (raw.includes("..")) return "";
  if (/^\/\//.test(raw)) return "";
  return raw;
}
