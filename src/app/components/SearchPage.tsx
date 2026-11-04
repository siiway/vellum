// Full-page cross-repo search. Rendered by Layout when frontmatter.layout === "search".
// Drives the same /api/search endpoint as SearchDialog, but with repo=* so results
// fan out across every configured repo, and keeps the query in sync with the URL
// so results can be linked / shared / refreshed.

import {
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Image,
  Input,
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
  History24Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeStyles } from "../css";
import { useVellum } from "../context";

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

const RECENT_KEY = "vellum.search.recent";
const RECENT_MAX = 8;

const useStyles = makeStyles({
  root: {
    minHeight: "calc(100vh - 60px)",
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
  searchBar: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalSNudge,
    boxShadow: tokens.shadow4,
    transition: "border-color 120ms ease, box-shadow 120ms ease",
    "&:focus-within": {
      borderColor: tokens.colorBrandStroke1,
      boxShadow: tokens.shadow8,
    },
  },
  searchIcon: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    borderTop: "0 !important" as any,
    borderLeft: "0 !important" as any,
    borderRight: "0 !important" as any,
    borderBottom: "0 !important" as any,
    backgroundColor: "transparent !important" as any,
    /* eslint-enable @typescript-eslint/no-explicit-any */
    "& input": { fontSize: tokens.fontSizeBase400 },
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
    backgroundColor: tokens.colorBrandBackground2,
    borderColor: tokens.colorBrandStroke2,
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
  recentList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    marginTop: tokens.spacingVerticalM,
  },
  recentRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    color: tokens.colorNeutralForeground2,
    "&:hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
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

  // After mount: pull ?q= and ?repo= out of the URL, then load recent searches
  // and focus the input. Runs once.
  useEffect(() => {
    const initialQ = readQueryParam();
    const initialScope = readScopeParam(repos.map((r) => r.slug));
    if (initialQ) setQ(initialQ);
    if (initialScope) setScope(initialScope);
    setUrlHydrated(true);
    inputRef.current?.focus();
    try {
      const stored = localStorage.getItem(RECENT_KEY);
      if (stored) setRecent(JSON.parse(stored));
    } catch {}
    // Effect intentionally runs only once. repos is stable for a given config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced fetch. The same /api/search endpoint that powers the dialog, but
  // with repo=* to fan out across every configured repo (the worker handles the
  // merge + score-sort).
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
        const repoParam = scope ?? "*";
        // verbose=1 asks the worker for wider excerpt windows + more
        // excerpts per hit. The compact dialog gets the default; the
        // full-page view has room to show actual body content.
        const r = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&repo=${encodeURIComponent(repoParam)}&locale=${encodeURIComponent(data.route.localeCode)}&limit=30&verbose=1`,
        );
        const j = (await r.json()) as { hits: SearchHit[] };
        if (!cancelled) {
          setHits(j.hits ?? []);
          setActiveIdx(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, scope, data.route.localeCode]);

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

  // Group hits by repo while preserving the worker's score-sorted ordering. We
  // attach each group's display name from the first hit (worker tags it) or fall
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

  const persistRecent = useCallback(
    (query: string) => {
      if (!query.trim()) return;
      try {
        const next = [query, ...recent.filter((r) => r !== query)].slice(0, RECENT_MAX);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        setRecent(next);
      } catch {}
    },
    [recent],
  );

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
          {t("ui.search.allRepos")}
        </Title2>
        <Body1 as="p" className={styles.subtitle}>
          {t("ui.search.fullPageSubtitle")}
        </Body1>
      </header>

      <div className={styles.searchBar}>
        <Search24Regular className={styles.searchIcon} />
        <Input
          ref={inputRef}
          className={styles.input}
          size="large"
          appearance="filled-lighter"
          placeholder={t("ui.search.placeholder")}
          value={q}
          onChange={(_, d) => setQ(d.value)}
          aria-label={t("ui.search")}
          autoComplete="off"
          spellCheck={false}
        />
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
      </div>

      {/* FluentUI TabList for the repo scope filter. Tab values are strings
          (FluentUI's TabValue is `string | number`), so we map the null
          "all repos" sentinel to a literal "__all__" at the boundary. */}
      <TabList
        className={styles.filters}
        selectedValue={scope ?? "__all__"}
        onTabSelect={(_, d) => setScope(d.value === "__all__" ? null : (d.value as string))}
        aria-label={t("ui.search.scope")}
        appearance="subtle"
        size="medium"
      >
        <Tab value="__all__">{t("ui.search.allRepos")}</Tab>
        {repos.map((r) => (
          <Tab
            key={r.slug}
            value={r.slug}
            icon={
              r.logo ? <Image src={r.logo} alt="" className={styles.filterChipIcon} /> : undefined
            }
          >
            {r.displayName}
          </Tab>
        ))}
      </TabList>

      <div className={styles.statusRow}>
        <span>
          {loading
            ? `${t("ui.search.searching")}…`
            : q.trim()
              ? hits.length === 0
                ? ""
                : `${hits.length} ${hits.length === 1 ? t("ui.search.result") : t("ui.search.results")}`
              : ""}
        </span>
      </div>

      <div ref={listRef} className={styles.results}>
        {!q && recent.length > 0 && (
          <section className={styles.group}>
            <div className={styles.groupHeader}>
              <History24Regular className={styles.hitIcon} />
              <Text className={styles.groupTitle}>{t("ui.search.recent")}</Text>
            </div>
            <div className={styles.recentList}>
              {recent.map((r, i) => (
                <div key={i} className={styles.recentRow} onClick={() => setQ(r)}>
                  <History24Regular />
                  <Text>{r}</Text>
                </div>
              ))}
            </div>
          </section>
        )}

        {!q && recent.length === 0 && (
          <div className={styles.empty}>
            <Search24Regular fontSize={48} />
            <Body1Strong>{t("ui.search.start")}</Body1Strong>
            <Caption1>{t("ui.search.crossRepoHint")}</Caption1>
          </div>
        )}

        {q && !loading && hits.length === 0 && (
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
                      {/* Render every excerpt the worker returned. Each carries
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

// Defensive escape for the (rare) case where a cached /api/search response
// predates the titleHtml field and we have to fall back to the plain text.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
