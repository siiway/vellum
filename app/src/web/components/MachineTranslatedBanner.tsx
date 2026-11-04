import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Caption1,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  ProgressBar,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Translate24Regular, Warning24Regular } from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { fetchJobStatus, type TranslateJobState } from "./TranslateRepoDialog";

const INLINE_LIMIT = 6;

const useStyles = makeStyles({
  wrapper: {
    marginBlock: tokens.spacingVerticalXXL,
    marginInline: tokens.spacingHorizontalL,
  },
  bar: {
    width: "100%",
    paddingBlock: tokens.spacingVerticalM,
    paddingInline: tokens.spacingHorizontalL,
  },
  body: {
    display: "flex",
    flexDirection: "column",
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
  modelRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground3,
  },
  progressSection: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  progressLabel: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: tokens.colorNeutralForeground3,
  },
  progressPercent: {
    fontFamily: tokens.fontFamilyMonospace,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorBrandForeground1,
  },
});

export function MachineTranslatedBanner() {
  const styles = useStyles();
  const { data, t, navigate } = useVellum();
  const meta = data.page.meta;

  if (!meta.machineTranslated && !meta.translationAttempted) return null;

  const locales = data.config.site.locales;
  const currentLocale = data.route.localeCode;
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
          {isFallback && (
            <TranslationProgress
              repoSlug={data.route.repoSlug}
              locale={currentLocale}
              styles={styles}
            />
          )}
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

function TranslationProgress({
  repoSlug,
  locale,
  styles,
}: {
  repoSlug: string;
  locale: string;
  styles: Record<string, string>;
}) {
  const { t, navigate } = useVellum();
  const [job, setJob] = useState<TranslateJobState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reloadedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      const status = await fetchJobStatus(repoSlug, locale);
      if (!mounted) return;
      setJob(status);
      if (status && status.phase !== "translating") {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        if (status.phase === "complete" && !reloadedRef.current) {
          reloadedRef.current = true;
          navigate(window.location.href, { replace: true });
        }
      }
    };
    void poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      mounted = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [repoSlug, locale, navigate]);

  if (!job || job.phase !== "translating") return null;

  const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className={styles.progressSection}>
      <div className={styles.progressLabel}>
        <Caption1>
          {job.done}/{job.total} {t("ui.translateRepo.pages")}
          {job.currentPhase === "page" && job.currentFile ? ` · ${job.currentFile}` : ""}
        </Caption1>
        <Caption1 className={styles.progressPercent}>{percent}%</Caption1>
      </div>
      <ProgressBar
        value={job.done}
        max={Math.max(job.total, 1)}
        shape="rounded"
        thickness="medium"
      />
      {job.providerModel && (
        <div className={styles.modelRow}>
          <Caption1>{t("ui.translateRepo.tryingProvider")}</Caption1>
          <Badge appearance="outline" size="small">
            {job.providerModel}
          </Badge>
          {job.apiKeyHint && (
            <Caption1>
              {t("ui.translateRepo.keyHint")} {job.apiKeyHint}
            </Caption1>
          )}
        </div>
      )}
    </div>
  );
}
