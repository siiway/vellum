import { useCallback, useEffect, useState } from "react";
import {
  Body1,
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  ProgressBar,
  tokens,
} from "@fluentui/react-components";
import { Translate24Regular, Dismiss24Regular } from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import type { MessageKey } from "../../shared/i18n";
import {
  type TranslateJobState,
  readJobFromStorage,
  clearJobFromStorage,
  TranslateRepoDialog,
} from "./TranslateRepoDialog";

const useStyles = makeStyles({
  wrapper: {
    position: "fixed",
    bottom: tokens.spacingVerticalL,
    right: tokens.spacingHorizontalL,
    zIndex: 900,
    maxWidth: "420px",
    width: "calc(100vw - 32px)",
    "@media (max-width: 720px)": {
      bottom: tokens.spacingVerticalS,
      right: tokens.spacingHorizontalS,
      maxWidth: "calc(100vw - 16px)",
    },
  },
  bar: {
    width: "100%",
    cursor: "pointer",
    paddingBlock: tokens.spacingVerticalS,
    paddingInline: tokens.spacingHorizontalM,
    boxShadow: tokens.shadow16,
    borderRadius: tokens.borderRadiusMedium,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    width: "100%",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  progressRow: {
    marginTop: tokens.spacingVerticalXXS,
  },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  fileName: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  percent: {
    fontFamily: tokens.fontFamilyMonospace,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },
  dismiss: {
    flexShrink: 0,
  },
});

export function TranslationProgressBanner() {
  const styles = useStyles();
  const { data, t } = useVellum();

  const [job, setJob] = useState<TranslateJobState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Poll localStorage to detect active translation jobs
  useEffect(() => {
    const check = () => {
      const stored = readJobFromStorage();
      setJob(stored);
    };
    check();
    const id = setInterval(check, 1000);
    window.addEventListener("storage", check);
    return () => {
      clearInterval(id);
      window.removeEventListener("storage", check);
    };
  }, []);

  // Also poll server for progress if we have a running job but no SSE connection
  useEffect(() => {
    if (!job || job.phase !== "translating" || !job.currentRepoSlug) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/translate-repo?repo=${encodeURIComponent(job.currentRepoSlug)}&locale=${encodeURIComponent(job.locale)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, unknown>;
        if (data.status === "idle" || data.status === "no-db") return;
        const stored = readJobFromStorage();
        if (!stored) return;
        const updated: TranslateJobState = {
          ...stored,
          done: (data.done as number) ?? stored.done,
          total: (data.total as number) ?? stored.total,
          currentFile: (data.current as string) ?? stored.currentFile,
          currentPhase: (data.phase as string) ?? stored.currentPhase,
        };
        if (data.status === "complete" || data.status === "cancelled" || data.status === "error") {
          updated.phase = data.status as TranslateJobState["phase"];
          if (data.errorMessage) updated.errorMessage = data.errorMessage as string;
        }
        try {
          localStorage.setItem("vellum-translate-job", JSON.stringify(updated));
        } catch {
          // ignore
        }
        setJob(updated);
      } catch {
        // network error
      }
    }, 3000);
    return () => clearInterval(id);
  }, [job?.phase, job?.currentRepoSlug, job?.locale]);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    clearJobFromStorage();
    setJob(null);
  }, []);

  // Don't show if no active job, or if on the languages page (it has its own dialog)
  if (!job) return null;
  if (job.phase !== "translating" && job.phase !== "complete" && job.phase !== "cancelled")
    return null;

  const isLanguagesPage = data.page.meta.frontmatter?.layout === "languages";
  if (isLanguagesPage && dialogOpen) return null;

  const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
  const localeConfig = data.config.site.locales.find((l) => l.code === job.locale);
  const localeLabel = localeConfig?.label ?? job.locale;

  const isComplete = job.phase === "complete";
  const isCancelled = job.phase === "cancelled";

  return (
    <>
      <div className={styles.wrapper}>
        <MessageBar
          intent={isComplete ? "success" : isCancelled ? "warning" : "info"}
          className={styles.bar}
          icon={<Translate24Regular />}
          onClick={() => setDialogOpen(true)}
        >
          <MessageBarBody className={styles.body}>
            <div className={styles.headerRow}>
              <MessageBarTitle>
                {isComplete
                  ? t("ui.translateRepo.complete" as MessageKey, "Translation complete!")
                  : isCancelled
                    ? t("ui.translateRepo.cancelled" as MessageKey, "Translation cancelled.")
                    : `${t("ui.translateRepo.translating" as MessageKey, "Translating...")} ${localeLabel}`}
              </MessageBarTitle>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                {job.phase === "translating" && (
                  <Body1 className={styles.percent}>{percent}%</Body1>
                )}
                {(isComplete || isCancelled) && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss24Regular />}
                    className={styles.dismiss}
                    onClick={handleDismiss}
                    aria-label={t("ui.search.close" as MessageKey, "Close")}
                  />
                )}
              </div>
            </div>
            {job.phase === "translating" && (
              <>
                <div className={styles.progressRow}>
                  <ProgressBar
                    value={job.done}
                    max={Math.max(job.total, 1)}
                    shape="rounded"
                    thickness="medium"
                  />
                </div>
                <div className={styles.fileRow}>
                  <Caption1 className={styles.fileName}>
                    {job.done}/{job.total} {t("ui.translateRepo.pages" as MessageKey, "pages")}
                    {job.currentPhase === "page" && job.currentFile ? ` · ${job.currentFile}` : ""}
                  </Caption1>
                </div>
              </>
            )}
          </MessageBarBody>
        </MessageBar>
      </div>

      {dialogOpen && localeConfig && (
        <TranslateRepoDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          locale={localeConfig}
          repos={data.config.repos}
        />
      )}
    </>
  );
}
