// Full-page cross-repo search. Rendered by Layout when frontmatter.layout === "search".
// Drives the same search as SearchDialog, but with repo=* so results
// fan out across every configured repo, and keeps the query in sync with the URL
// so results can be linked / shared / refreshed.

import {
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Image,
  mergeClasses,
  Spinner,
  Tab,
  TabList,
  Text,
  Title2,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowEnterLeft24Regular,
  ArrowUp16Regular,
  ArrowDown16Regular,
  ChevronRight16Regular,
  Dismiss20Regular,
  Document24Regular,
  Search24Regular,
  History16Regular,
  Dismiss12Regular,
} from "@fluentui/react-icons";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { SearchField } from "./SearchField";
import { addRecent, clearRecent, loadRecent, removeRecent } from "../recentSearches";

interface ExcerptOut {
  html: string;
  sectionSlug?: string;
  sectionTitle?: string;
  // Section title with inline markdown rendered (backtick spans → `<code>`).
  // Preferred over `sectionTitle` so headings like `` `teams` `` style as
  // code instead of showing literal backticks.
  sectionTitleHtml?: string;
}

interface SearchHit {
  title: string;
  // Title with `<mark>` wrapping matched terms. Falls back to plain title
  // when no terms matched. Rendered via dangerouslySetInnerHTML like the
  // excerpts.
  titleHtml?: string;
  // Up to 3 excerpts per page, each clustered around a distinct match position.
  // Each excerpt is optionally tagged with the slug + title of the nearest
  // preceding heading so the result row can link to /url#sectionSlug.
  excerpts: ExcerptOut[];
  url: string;
  repo: string;
  repoDisplayName?: string;
}

const useStyles = makeStyles({
  root: {
    minHeight: "calc(100vh - 52px)",
    paddingBlock: tokens.spacingVerticalXXXL,
    paddingInline: tokens.spacingHorizontalXXXL,
    maxWidth: "960px",
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
    letterSpacing: "-0.02em",
  },
  subtitle: {
    display: "block",
    marginTop: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground2,
  },
  filters: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalL,
  },
  filterChipIcon: {
    width: "16px",
    height: "16px",
    objectFit: "contain",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: tokens.spacingVerticalL,
    minHeight: "24px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  results: {
    marginTop: tokens.spacingVerticalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXL,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingBlock: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    marginBottom: tokens.spacingVerticalXS,
  },
  groupLogo: {
    width: "20px",
    height: "20px",
    objectFit: "contain",
    flexShrink: 0,
  },
  groupTitle: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  groupCount: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  hit: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalM,
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground1,
    textDecoration: "none",
    cursor: "pointer",
    border: "1px solid transparent",
    transition: "background-color 80ms ease, border-color 80ms ease",
    outline: "none",
    "&:focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "2px",
    },
  },
  hitActive: {
    backgroundColor: tokens.colorNeutralBackground1Hover,
    borderTopColor: tokens.colorNeutralStroke1,
    borderRightColor: tokens.colorNeutralStroke1,
    borderBottomColor: tokens.colorNeutralStroke1,
    borderLeftColor: tokens.colorNeutralStroke1,
  },
  hitIcon: {
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
    marginTop: "2px",
  },
  hitText: { flex: 1, minWidth: 0 },
  hitTitle: {
    display: "block",
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
    "& mark": {
      // Yellow status-palette tokens give a high-visibility highlight that
      // adapts to both themes — light yellow on dark text in light mode,
      // saturated yellow on bright text in dark mode. Way more legible than
      // the soft brand tint we used before.
      backgroundColor: tokens.colorPaletteYellowBackground2,
      color: tokens.colorPaletteYellowForeground1,
      paddingInline: "3px",
      borderRadius: "2px",
      fontWeight: tokens.fontWeightSemibold,
    },
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.92em",
      paddingInline: "4px",
      paddingBlock: "1px",
      borderRadius: tokens.borderRadiusSmall,
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  // One excerpt block — wraps the section caption + the highlighted snippet.
  // Hoverable so users see it's its own clickable target (jumps to the
  // section anchor inside the destination page).
  hitExcerptBlock: {
    display: "block",
    marginTop: tokens.spacingVerticalS,
    paddingInline: tokens.spacingHorizontalS,
    paddingBlock: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusSmall,
    borderInlineStart: `2px solid ${tokens.colorNeutralStroke3}`,
    cursor: "pointer",
    "&:hover": {
      borderInlineStartColor: tokens.colorBrandStroke1,
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
  },
  hitSection: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: "2px",
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.95em",
      paddingInline: "4px",
      paddingBlock: "1px",
      borderRadius: tokens.borderRadiusSmall,
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  hitExcerpt: {
    display: "block",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    lineHeight: 1.45,
    "& mark": {
      // Yellow status-palette tokens give a high-visibility highlight that
      // adapts to both themes — light yellow on dark text in light mode,
      // saturated yellow on bright text in dark mode. Way more legible than
      // the soft brand tint we used before.
      backgroundColor: tokens.colorPaletteYellowBackground2,
      color: tokens.colorPaletteYellowForeground1,
      paddingInline: "3px",
      borderRadius: "2px",
      fontWeight: tokens.fontWeightSemibold,
    },
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.92em",
      paddingInline: "4px",
      paddingBlock: "1px",
      borderRadius: tokens.borderRadiusSmall,
      backgroundColor: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
    },
  },
  hitMeta: {
    display: "block",
    marginTop: "6px",
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalM,
    paddingBlock: tokens.spacingVerticalXXXL,
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
  },
  // The start screen, shown until the reader types: recent searches, a card
  // per repo to scope the search, and the query syntax.
  start: {
    display: "flex",
    flexDirection: "column",
    gap: "28px",
    marginTop: "28px",
  },
  section: { display: "flex", flexDirection: "column", gap: "10px" },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    minHeight: "24px",
  },
  sectionLabel: {
    margin: 0,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },
  chips: { display: "flex", flexWrap: "wrap", gap: "8px" },
  // A recent search: the query, which searches it again, and a button that
  // removes it.
  chip: {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "100%",
    height: "30px",
    boxSizing: "border-box",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground1,
    "&:hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  chipMain: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    height: "100%",
    paddingLeft: "10px",
    paddingRight: "4px",
    border: 0,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground2,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    cursor: "pointer",
    "& svg": { color: tokens.colorNeutralForeground3, flexShrink: 0 },
    "&:hover": { color: tokens.colorNeutralForeground1 },
    "&:focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}` },
  },
  chipRemove: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: "22px",
    height: "22px",
    marginRight: "4px",
    padding: 0,
    border: 0,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground3,
    cursor: "pointer",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      color: tokens.colorNeutralForeground1,
    },
    "&:focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}` },
  },
  chipText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  repoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: "8px",
  },
  repoCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "12px 14px",
    textAlign: "start",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "background-color 80ms ease, border-color 80ms ease",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      borderTopColor: tokens.colorNeutralStroke1Hover,
      borderRightColor: tokens.colorNeutralStroke1Hover,
      borderBottomColor: tokens.colorNeutralStroke1Hover,
      borderLeftColor: tokens.colorNeutralStroke1Hover,
    },
    "&:focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "1px",
    },
  },
  repoLogo: {
    width: "24px",
    height: "24px",
    objectFit: "contain",
    flexShrink: 0,
  },
  repoIcon: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  repoText: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  repoName: {
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  repoDesc: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground3,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  tips: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    alignItems: "baseline",
    columnGap: "16px",
    rowGap: "8px",
    margin: 0,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    "& dd": { margin: 0 },
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.92em",
      padding: "1px 6px",
      borderRadius: tokens.borderRadiusSmall,
      backgroundColor: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
    },
  },
  hintBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalXXL,
    paddingTop: tokens.spacingVerticalL,
    borderTop: `1px dashed ${tokens.colorNeutralStroke3}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  hintRow: { display: "inline-flex", alignItems: "center", gap: "6px" },
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "20px",
    height: "20px",
    paddingInline: "6px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottomWidth: "2px",
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "11px",
    lineHeight: 1,
  },
  clearBtn: {
    minWidth: "auto",
  },
});

export function SearchPage() {
  const styles = useStyles();
  const { data, navigate, t } = useVellum();
  const repos = data.config.repos;

  // Initial state is intentionally empty so SSR and the first client render
  // produce identical HTML. The actual URL params (?q=, ?repo=) are read in an
  // effect below — reading window.location during render would mismatch SSR.
  const [q, setQ] = useState("");
  // null = all repos; otherwise a single repo slug to scope to.
  const [scope, setScope] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  // `urlHydrated` flips to true after we've pulled state out of the URL. The
  // URL-sync effect waits on it so it doesn't clobber the URL's ?q= with the
  // empty default before we've had a chance to read it.
  const [urlHydrated, setUrlHydrated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // True only when the last activeIdx change came from arrow keys. The
  // scroll-into-view effect reads this so mouse hovers don't auto-scroll
  // partially-offscreen cards into full view.
  const keyboardNavRef = useRef(false);

  // Whether the reader has started a search; until then the page shows the
  // start screen.
  const started = q.trim() !== "";
  // The repos a cross-repo search covers, offered as scopes on the start
  // screen.
  const searchable = useMemo(() => repos.filter((r) => !r.excludeFromSearch), [repos]);
  const word = t("ui.search.tip.word");
  const tips: [string, string][] = [
    [t("ui.search.tip.phraseExample"), t("ui.search.tip.phrase")],
    [`-${word}`, t("ui.search.tip.exclude")],
    [`title:${word}`, t("ui.search.tip.title")],
    [`repo:${(searchable[0] ?? repos[0])?.slug ?? "slug"}`, t("ui.search.tip.repo")],
  ];

  // After mount: pull ?q= and ?repo= out of the URL, then load recent searches
  // and focus the input. Runs once.
  useEffect(() => {
    const initialQ = readQueryParam();
    const initialScope = readScopeParam(repos.map((r) => r.slug));
    if (initialQ) setQ(initialQ);
    if (initialScope) setScope(initialScope);
    setUrlHydrated(true);
    inputRef.current?.focus();
    setRecent(loadRecent());
    // Effect intentionally runs only once. repos is stable for a given config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search. The same search that powers the dialog, but with
  // repo=* to fan out across every configured repo (search merges and
  // score-sorts the hits).
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      setActiveIdx(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { search } = await import("../../shared/search");
        // verbose asks for wider excerpt windows + more excerpts per hit.
        // The compact dialog gets the default; the full-page view has room
        // to show actual body content.
        const found = await search(data.config, {
          q,
          repo: scope ?? "*",
          locale: data.route.localeCode,
          limit: 30,
          verbose: true,
        });
        if (!cancelled) {
          setHits(found);
          setActiveIdx(0);
        }
      } catch (e) {
        console.error("[vellum] search failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, scope, data.config, data.route.localeCode]);

  // Keep `?q=` and `?repo=` in the URL so a result page is shareable + refreshable.
  // replaceState (not pushState) avoids polluting back-button history with every keystroke.
  // Gated on urlHydrated so the first run (which reads the URL) doesn't get clobbered
  // by an immediate write of the still-empty default state.
  useEffect(() => {
    if (typeof window === "undefined" || !urlHydrated) return;
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    if (scope) url.searchParams.set("repo", scope);
    else url.searchParams.delete("repo");
    const next = url.pathname + (url.search ? url.search : "");
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [q, scope, urlHydrated]);

  // Group hits by repo while preserving search's score-sorted ordering. We
  // attach each group's display name from the first hit (search tags it) or fall
  // back to the configured repo name.
  const grouped = useMemo(() => {
    const groups = new Map<string, { displayName: string; logo?: string; hits: SearchHit[] }>();
    for (const h of hits) {
      const existing = groups.get(h.repo);
      if (existing) {
        existing.hits.push(h);
      } else {
        const repoCfg = repos.find((r) => r.slug === h.repo);
        groups.set(h.repo, {
          displayName: h.repoDisplayName || repoCfg?.displayName || h.repo,
          logo: repoCfg?.logo,
          hits: [h],
        });
      }
    }
    return [...groups.entries()];
  }, [hits, repos]);

  // Flat list mirrors the visual order so arrow-key navigation matches what the user sees.
  const flat = useMemo(() => grouped.flatMap(([, g]) => g.hits), [grouped]);

  const persistRecent = useCallback((query: string) => setRecent(addRecent(query)), []);

  // Navigate to a hit, optionally jumping to a specific section anchor inside
  // the page. Passing `sectionSlug` lets each excerpt link to the exact
  // heading the match was under.
  const goToHit = useCallback(
    (hit: SearchHit, sectionSlug?: string) => {
      persistRecent(q);
      const target = sectionSlug ? `${hit.url}#${sectionSlug}` : hit.url;
      navigate(target);
    },
    [navigate, persistRecent, q],
  );

  // Page-level keyboard nav. Listening on `window` (not just the search
  // input) means arrow keys still drive the active hit after Tab moves
  // focus to a repo-scope tab or a card — readers don't expect the input
  // to be the sole "carrier" of keyboard navigation on a full-page list.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Don't fight global shortcuts the Layout owns (Ctrl/Cmd+K, "/").
      if (e.key === "ArrowDown") {
        if (flat.length === 0) return;
        e.preventDefault();
        keyboardNavRef.current = true;
        setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        if (flat.length === 0) return;
        e.preventDefault();
        keyboardNavRef.current = true;
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        // Only intercept Enter when the active row is what's focused or when
        // focus is on the search input. Letting Enter on a button or link
        // bubble preserves their native semantics.
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        const inCard = (document.activeElement as HTMLElement | null)?.dataset?.hitIndex != null;
        if (!inCard && tag !== "INPUT") return;
        const hit = flat[activeIdx];
        if (!hit) return;
        e.preventDefault();
        goToHit(hit);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, activeIdx, goToHit]);

  // Scroll the active hit into view as the user arrows through results,
  // and shift DOM focus along with it so subsequent Tab presses continue
  // from the right spot. Mouse-driven activeIdx changes skip both —
  // hovering a card whose edge is just offscreen would otherwise yank the
  // page to fully reveal it, and stealing focus on hover is hostile.
  useEffect(() => {
    if (!keyboardNavRef.current) return;
    keyboardNavRef.current = false;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-hit-index="${activeIdx}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.focus({ preventScroll: true });
  }, [activeIdx]);

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <Title2 as="h1" className={styles.title}>
          {t("ui.search")}
        </Title2>
        <Body1 as="p" className={styles.subtitle}>
          {t("ui.search.fullPageSubtitle")}
        </Body1>
      </header>

      <SearchField
        ref={inputRef}
        size="large"
        placeholder={t("ui.search.placeholder")}
        value={q}
        onChange={(_, d) => setQ(d.value)}
        aria-label={t("ui.search")}
        autoComplete="off"
        spellCheck={false}
      >
        {loading && <Spinner size="extra-tiny" />}
        {q && (
          <Button
            appearance="subtle"
            size="small"
            icon={<Dismiss20Regular />}
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            aria-label={t("ui.search.clear")}
            className={styles.clearBtn}
          />
        )}
      </SearchField>

      {/* FluentUI TabList for the repo scope filter, once there's a query or
          a scope: the start screen's repo cards stand in for it before.
          Tab values are strings (FluentUI's TabValue is `string | number`),
          so we map the null "all repos" sentinel to a literal "__all__" at
          the boundary. */}
      {(started || scope) && (
        <TabList
          className={styles.filters}
          selectedValue={scope ?? "__all__"}
          onTabSelect={(_, d) => setScope(d.value === "__all__" ? null : (d.value as string))}
          aria-label={t("ui.search.scope")}
          appearance="subtle"
          size="medium"
        >
          <Tab value="__all__">{t("ui.search.allRepos")}</Tab>
          {/* The repos a cross-repo search covers, and an excluded one
              when the URL scopes the search to it (?repo=). */}
          {repos
            .filter((r) => !r.excludeFromSearch || r.slug === scope)
            .map((r) => (
              <Tab
                key={r.slug}
                value={r.slug}
                icon={
                  r.logo ? (
                    <Image src={r.logo} alt="" className={styles.filterChipIcon} />
                  ) : undefined
                }
              >
                {r.displayName}
              </Tab>
            ))}
        </TabList>
      )}

      {!started && (
        <div className={styles.start}>
          {recent.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionLabel}>{t("ui.search.recent")}</h2>
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => setRecent(clearRecent())}
                  aria-label={t("ui.search.clearRecent")}
                >
                  {t("ui.search.clear")}
                </Button>
              </div>
              <div className={styles.chips}>
                {recent.map((r) => (
                  <span key={r} className={styles.chip}>
                    <button
                      type="button"
                      className={styles.chipMain}
                      onClick={() => {
                        setQ(r);
                        inputRef.current?.focus();
                      }}
                    >
                      <History16Regular />
                      <span className={styles.chipText}>{r}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.chipRemove}
                      onClick={() => setRecent(removeRecent(r))}
                      aria-label={`${t("ui.search.removeRecent")}: ${r}`}
                    >
                      <Dismiss12Regular />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Scoping only means something with more than one repo. Once a
              scope is picked, the tabs show it instead. */}
          {!scope && searchable.length > 1 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionLabel}>{t("ui.search.inRepo")}</h2>
              </div>
              <div className={styles.repoGrid}>
                {searchable.map((r) => (
                  <button
                    key={r.slug}
                    type="button"
                    className={styles.repoCard}
                    onClick={() => {
                      setScope(r.slug);
                      inputRef.current?.focus();
                    }}
                  >
                    {r.logo ? (
                      <Image src={r.logo} alt="" className={styles.repoLogo} />
                    ) : (
                      <Document24Regular className={styles.repoIcon} />
                    )}
                    <span className={styles.repoText}>
                      <span className={styles.repoName}>{r.displayName}</span>
                      {r.description && <span className={styles.repoDesc}>{r.description}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionLabel}>{t("ui.search.tips")}</h2>
            </div>
            <dl className={styles.tips}>
              {tips.map(([example, text]) => (
                <Fragment key={example}>
                  <dt>
                    <code>{example}</code>
                  </dt>
                  <dd>{text}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        </div>
      )}

      {started && (
        <div className={styles.statusRow}>
          <span>
            {loading
              ? `${t("ui.search.searching")}…`
              : hits.length > 0
                ? `${hits.length} ${hits.length === 1 ? t("ui.search.result") : t("ui.search.results")}`
                : ""}
          </span>
        </div>
      )}

      <div ref={listRef} className={styles.results}>
        {started && !loading && hits.length === 0 && (
          <div className={styles.empty}>
            <Search24Regular fontSize={48} />
            <Body1Strong>
              {t("ui.search.empty")} "{q}"
            </Body1Strong>
            <Caption1>{t("ui.search.noResultsHint")}</Caption1>
          </div>
        )}

        {grouped.map(([slug, group]) => {
          // Compute each group's starting index in the flat list so arrow-key
          // navigation can light up the right hit even though the visual order
          // is split across multiple repo sections.
          let runningIdx = 0;
          for (const [s, g] of grouped) {
            if (s === slug) break;
            runningIdx += g.hits.length;
          }
          return (
            <section key={slug} className={styles.group}>
              <div className={styles.groupHeader}>
                {group.logo && <Image src={group.logo} alt="" className={styles.groupLogo} />}
                <Text className={styles.groupTitle}>{group.displayName}</Text>
                <Caption1 className={styles.groupCount}>
                  · {group.hits.length}{" "}
                  {group.hits.length === 1 ? t("ui.search.result") : t("ui.search.results")}
                </Caption1>
              </div>
              {group.hits.map((h, j) => {
                const idx = runningIdx + j;
                const isActive = idx === activeIdx;
                return (
                  <div
                    key={h.url}
                    className={mergeClasses(styles.hit, isActive && styles.hitActive)}
                    data-hit-index={idx}
                    tabIndex={0}
                    onMouseEnter={() => setActiveIdx(idx)}
                    // Sync activeIdx with focus so Tab walking the list and
                    // arrow nav both highlight the same row.
                    onFocus={() => setActiveIdx(idx)}
                    onClick={() => goToHit(h)}
                    role="option"
                    aria-selected={isActive}
                  >
                    <Document24Regular className={styles.hitIcon} />
                    <div className={styles.hitText}>
                      {/* Plain `span` — FluentUI's `Text` filters out
                          `dangerouslySetInnerHTML` (not in its allowed-props
                          list), so going through it renders empty. */}
                      <span
                        className={styles.hitTitle}
                        dangerouslySetInnerHTML={{
                          __html: h.titleHtml ?? escapeHtml(h.title),
                        }}
                      />
                      {/* Render every excerpt search returned. Each carries
                          the nearest preceding heading (when it has one), so
                          a click on the excerpt jumps to /url#sectionSlug. */}
                      {h.excerpts.map((ex, k) => (
                        <div
                          key={k}
                          className={styles.hitExcerptBlock}
                          onClick={(e) => {
                            // Don't bubble to the outer hit click — that would
                            // navigate without the section anchor.
                            e.stopPropagation();
                            goToHit(h, ex.sectionSlug);
                          }}
                        >
                          {ex.sectionTitle && (
                            <Caption1 className={styles.hitSection}>
                              <ChevronRight16Regular />{" "}
                              {ex.sectionTitleHtml ? (
                                <span dangerouslySetInnerHTML={{ __html: ex.sectionTitleHtml }} />
                              ) : (
                                ex.sectionTitle
                              )}
                            </Caption1>
                          )}
                          <span
                            className={styles.hitExcerpt}
                            dangerouslySetInnerHTML={{ __html: ex.html }}
                          />
                        </div>
                      ))}
                      <Text className={styles.hitMeta}>{h.url}</Text>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      {flat.length > 0 && (
        <div className={styles.hintBar}>
          <span className={styles.hintRow}>
            <span className={styles.kbd}>
              <ArrowUp16Regular />
            </span>
            <span className={styles.kbd}>
              <ArrowDown16Regular />
            </span>
            {t("ui.search.navigate")}
          </span>
          <span className={styles.hintRow}>
            <span className={styles.kbd}>
              <ArrowEnterLeft24Regular style={{ width: 12, height: 12 }} />
            </span>
            {t("ui.search.openHint")}
          </span>
        </div>
      )}
    </main>
  );
}

function readQueryParam(): string {
  if (typeof window === "undefined") return "";
  const sp = new URLSearchParams(window.location.search);
  return sp.get("q") ?? "";
}

function readScopeParam(validSlugs: string[]): string | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const v = sp.get("repo");
  if (!v || v === "*") return null;
  return validSlugs.includes(v) ? v : null;
}

// Defensive escape for a hit without titleHtml, which falls back to its
// plain title.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
