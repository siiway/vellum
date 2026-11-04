// Command-palette style search. Keyboard nav (↑/↓/Enter/Esc), grouping by repo,
// recent searches, debounce indicator, and SPA-navigation hand-off.

import {
  Body1Strong,
  Button,
  Caption1,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogContent,
  Input,
  mergeClasses,
  Spinner,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  Search24Regular,
  Document24Regular,
  ArrowEnterLeft24Regular,
  ArrowUp16Regular,
  ArrowDown16Regular,
  Dismiss24Regular,
  History24Regular,
  Globe24Regular,
  ChevronRight20Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeStyles } from "../css";
import { useVellum } from "../context";

interface ExcerptOut {
  html: string;
  sectionSlug?: string;
  sectionTitle?: string;
}

interface SearchHit {
  title: string;
  // Title with `<mark>` wrapping matched terms — same convention as the
  // excerpts. Falls back to escaped `title` when no terms matched.
  titleHtml?: string;
  // The worker returns up to 3 excerpts per hit. The dialog only shows the
  // first one to keep the result row compact; the full-page SearchPage shows
  // all of them.
  excerpts: ExcerptOut[];
  url: string;
  repo: string;
}

const RECENT_KEY = "vellum.search.recent";
const RECENT_MAX = 6;

const useStyles = makeStyles({
  surface: {
    maxWidth: "720px",
    width: "92vw",
    padding: 0,
    overflow: "hidden",
    borderRadius: tokens.borderRadiusXLarge,
  },
  body: { padding: 0 },
  content: { padding: 0 },
  inputWrap: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
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
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: tokens.colorNeutralForeground3,
    cursor: "pointer",
    padding: "4px 6px",
    borderRadius: tokens.borderRadiusSmall,
    "&:hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
  },
  status: {
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground2,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  results: {
    maxHeight: "min(56vh, 480px)",
    overflowY: "auto",
    padding: tokens.spacingHorizontalS,
  },
  group: { marginBlock: tokens.spacingVerticalS },
  groupHeader: {
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    fontSize: "11px",
    fontWeight: tokens.fontWeightSemibold,
  },
  hit: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground1,
    textDecoration: "none",
    cursor: "pointer",
    border: "1px solid transparent",
  },
  hitActive: {
    backgroundColor: tokens.colorBrandBackground2,
    borderColor: tokens.colorBrandStroke2,
    color: tokens.colorBrandForeground1,
  },
  hitIcon: {
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
  },
  hitText: { flex: 1, minWidth: 0 },
  hitTitle: {
    display: "block",
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    "& mark": {
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
  hitExcerpt: {
    display: "block",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    marginTop: "2px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display_: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    lineHeight: 1.4,
    "& mark": {
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
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginTop: "2px",
    display: "block",
    fontFamily: tokens.fontFamilyMonospace,
  },
  empty: {
    paddingInline: tokens.spacingHorizontalXXL,
    paddingBlock: tokens.spacingVerticalXXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalM,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  footerHints: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  hintRow: { display: "inline-flex", alignItems: "center", gap: "4px" },
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "18px",
    height: "18px",
    paddingInline: "5px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottomWidth: "2px",
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "11px",
    lineHeight: 1,
  },
  recentRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    color: tokens.colorNeutralForeground2,
    "&:hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      color: tokens.colorNeutralForeground1,
    },
  },
  seeAllRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
    marginInline: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    color: tokens.colorBrandForeground1,
    border: `1px dashed ${tokens.colorBrandStroke2}`,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    "&:hover": { backgroundColor: tokens.colorBrandBackground2 },
    "& .seeAllArrow": { marginLeft: "auto", opacity: 0.7 },
  },
});

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const styles = useStyles();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { data, navigate, t } = useVellum();

  // Load recent searches on open.
  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
      setActiveIdx(0);
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 50);
    try {
      const stored = localStorage.getItem(RECENT_KEY);
      if (stored) setRecent(JSON.parse(stored));
    } catch {}
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&repo=${encodeURIComponent(data.route.repoSlug)}&locale=${data.route.localeCode}`,
        );
        const j = (await r.json()) as { hits: SearchHit[] };
        if (!cancelled) {
          setHits(j.hits ?? []);
          setActiveIdx(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, data.route.repoSlug, data.route.localeCode]);

  // Group hits by repo for headers.
  const grouped = useMemo(() => {
    const groups = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const list = groups.get(h.repo) ?? [];
      list.push(h);
      groups.set(h.repo, list);
    }
    return [...groups.entries()];
  }, [hits]);

  // Flat list for keyboard navigation that preserves visual order.
  const flat = useMemo(() => grouped.flatMap(([, h]) => h), [grouped]);

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

  const goToHit = useCallback(
    (hit: SearchHit) => {
      persistRecent(q);
      onOpenChange(false);
      navigate(hit.url);
    },
    [navigate, onOpenChange, persistRecent, q],
  );

  // Escalate from the in-repo dialog to the full cross-repo /search page. Carries
  // the current query so the destination boots straight into results.
  const goToFullSearch = useCallback(() => {
    persistRecent(q);
    onOpenChange(false);
    const localePrefix =
      data.config.site.locales.find((l) => l.code === data.route.localeCode)?.prefix ?? "";
    const base = localePrefix ? `/${localePrefix}/search` : "/search";
    navigate(q ? `${base}?q=${encodeURIComponent(q)}` : base);
  }, [navigate, onOpenChange, persistRecent, q, data.config.site.locales, data.route.localeCode]);

  // Keyboard navigation.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = flat[activeIdx];
        if (hit) goToHit(hit);
      } else if (e.key === "Escape") {
        onOpenChange(false);
      }
    },
    [flat, activeIdx, goToHit, onOpenChange],
  );

  // Scroll active hit into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-hit-index="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  return (
    <Dialog open={open} onOpenChange={(_, d) => onOpenChange(d.open)}>
      <DialogSurface className={styles.surface}>
        <DialogBody className={styles.body}>
          <DialogContent className={styles.content}>
            <div className={styles.inputWrap}>
              <Search24Regular />
              <Input
                ref={inputRef}
                className={styles.input}
                size="large"
                appearance="filled-lighter"
                placeholder={t("ui.search.placeholder")}
                value={q}
                onChange={(_, d) => setQ(d.value)}
                onKeyDown={onKeyDown}
                aria-label={t("ui.search")}
                autoComplete="off"
                spellCheck={false}
              />
              {loading && <Spinner size="extra-tiny" />}
              <Button
                appearance="subtle"
                icon={<Dismiss24Regular />}
                onClick={() => onOpenChange(false)}
                aria-label={t("ui.search.close")}
              />
            </div>

            <div ref={listRef} className={styles.results}>
              {!q && recent.length > 0 && (
                <div className={styles.group}>
                  <Caption1 className={styles.groupHeader}>{t("ui.search.recent")}</Caption1>
                  {recent.map((r, i) => (
                    <div key={i} className={styles.recentRow} onClick={() => setQ(r)}>
                      <History24Regular />
                      <Text>{r}</Text>
                    </div>
                  ))}
                </div>
              )}

              {!q && recent.length === 0 && (
                <div className={styles.empty}>
                  <Search24Regular fontSize={40} />
                  <Body1Strong>{t("ui.search.start")}</Body1Strong>
                  <Caption1>{t("ui.search.shortcut")}</Caption1>
                </div>
              )}

              {q && !loading && hits.length === 0 && (
                <div className={styles.empty}>
                  <Search24Regular fontSize={40} />
                  <Body1Strong>
                    {t("ui.search.empty")} "{q}"
                  </Body1Strong>
                </div>
              )}

              {q && (
                <div
                  className={styles.seeAllRow}
                  onClick={goToFullSearch}
                  role="button"
                  aria-label={`${t("ui.search.seeAllResults")} "${q}"`}
                >
                  <Globe24Regular />
                  <span>
                    {t("ui.search.seeAllResults")} "{q}"
                  </span>
                  <ChevronRight20Regular className="seeAllArrow" />
                </div>
              )}

              {grouped.map(([repo, items]) => {
                let runningIdx = 0;
                // Find this group's starting index by summing earlier groups' sizes.
                for (const [r, list] of grouped) {
                  if (r === repo) break;
                  runningIdx += list.length;
                }
                return (
                  <div key={repo} className={styles.group}>
                    <Caption1 className={styles.groupHeader}>{repo}</Caption1>
                    {items.map((h, j) => {
                      const idx = runningIdx + j;
                      const isActive = idx === activeIdx;
                      return (
                        <div
                          key={h.url}
                          className={mergeClasses(styles.hit, isActive && styles.hitActive)}
                          data-hit-index={idx}
                          onMouseEnter={() => setActiveIdx(idx)}
                          onClick={() => goToHit(h)}
                          role="option"
                          aria-selected={isActive}
                        >
                          <Document24Regular className={styles.hitIcon} />
                          <div className={styles.hitText}>
                            {/* Plain `span` — FluentUI's `Text` filters out
                                `dangerouslySetInnerHTML` (not in its allowed
                                native-props list), so the highlighted HTML
                                never reaches the DOM through it. */}
                            <span
                              className={styles.hitTitle}
                              dangerouslySetInnerHTML={{
                                __html: h.titleHtml ?? escapeHtml(h.title),
                              }}
                            />
                            <span
                              className={styles.hitExcerpt}
                              dangerouslySetInnerHTML={{
                                __html: h.excerpts[0]?.html ?? "",
                              }}
                            />
                            <Text className={styles.hitMeta}>{h.url}</Text>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className={styles.footer}>
              <div className={styles.footerHints}>
                <span className={styles.hintRow}>
                  <span className={styles.kbd}>
                    <ArrowUp16Regular />
                  </span>
                  <span className={styles.kbd}>
                    <ArrowDown16Regular />
                  </span>{" "}
                  {t("ui.search.navigate")}
                </span>
                <span className={styles.hintRow}>
                  <span className={styles.kbd}>
                    <ArrowEnterLeft24Regular style={{ width: 12, height: 12 }} />
                  </span>{" "}
                  {t("ui.search.openHint")}
                </span>
                <span className={styles.hintRow}>
                  <span className={styles.kbd}>esc</span> {t("ui.search.close").toLowerCase()}
                </span>
              </div>
              {hits.length > 0 && (
                <Caption1>
                  {hits.length} {hits.length === 1 ? t("ui.search.result") : t("ui.search.results")}
                </Caption1>
              )}
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// Defensive: older `/api/search` responses (cached before this client
// shipped) don't include titleHtml, so we fall back to plain text and
// escape it like the worker does for excerpts.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
