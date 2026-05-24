import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Body1,
  Caption1,
  Card,
  ProgressBar,
  Subtitle1,
  Title1,
  tokens,
} from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import type { MessageKey } from "../../shared/i18n";

interface JobSummary {
  status: string;
  done: number;
  total: number;
  current: string;
  phase: string;
  repoSlug: string;
  locale: string;
  errorMessage?: string;
  providerModel?: string;
  apiKeyHint?: string;
  updatedAt: number;
}

const useStyles = makeStyles({
  root: {
    minHeight: "calc(100vh - 60px)",
    paddingBlock: tokens.spacingVerticalXXXL,
    paddingInline: tokens.spacingHorizontalXXXL,
    maxWidth: "900px",
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
  list: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  card: {
    padding: tokens.spacingHorizontalL,
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  cardTitle: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  cardMeta: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
  },
  progressRow: {
    marginTop: tokens.spacingVerticalS,
  },
  statsRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  percent: {
    fontFamily: tokens.fontFamilyMonospace,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorBrandForeground1,
  },
  providerRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  errorMsg: {
    marginTop: tokens.spacingVerticalXS,
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  empty: {
    color: tokens.colorNeutralForeground2,
    marginTop: tokens.spacingVerticalXXL,
  },
});

export function TranslateTasksPage() {
  const styles = useStyles();
  const { data, t } = useVellum();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/translate-repo");
        if (!res.ok) return;
        const body = (await res.json()) as { jobs?: JobSummary[] };
        if (mounted && body.jobs) {
          setJobs(body.jobs);
          setNow(Date.now());
        }
      } catch {
        // network error
      }
    };
    void poll();
    pollRef.current = setInterval(poll, 3000);
    return () => {
      mounted = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  function statusBadge(status: string) {
    const map: Record<
      string,
      { color: "success" | "danger" | "warning" | "brand"; label: string }
    > = {
      running: {
        color: "brand",
        label: t("ui.translateTasks.status.running" as MessageKey, "Running"),
      },
      complete: {
        color: "success",
        label: t("ui.translateTasks.status.complete" as MessageKey, "Complete"),
      },
      cancelled: {
        color: "warning",
        label: t("ui.translateTasks.status.cancelled" as MessageKey, "Cancelled"),
      },
      error: { color: "danger", label: t("ui.translateTasks.status.error" as MessageKey, "Error") },
    };
    const entry = map[status] ?? { color: "brand" as const, label: status };
    return (
      <Badge appearance="tint" color={entry.color}>
        {entry.label}
      </Badge>
    );
  }

  function localeLabel(code: string): string {
    const loc = data.config.site.locales.find((l) => l.code === code);
    return loc?.label ?? code;
  }

  function timeAgo(ts: number): string {
    const diff = now - ts;
    if (diff < 60_000) return "<1m ago";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return `${Math.floor(diff / 86400_000)}d ago`;
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Title1 className={styles.title}>
          {t("ui.translateTasks.title" as MessageKey, "Translation tasks")}
        </Title1>
        <Body1 className={styles.subtitle}>
          {t(
            "ui.translateTasks.subtitle" as MessageKey,
            "Active and completed translation jobs across all repos.",
          )}
        </Body1>
      </header>

      {jobs.length === 0 ? (
        <Body1 className={styles.empty}>
          {t("ui.translateTasks.noJobs" as MessageKey, "No translation jobs found.")}
        </Body1>
      ) : (
        <div className={styles.list}>
          {jobs.map((job) => {
            const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
            return (
              <Card
                key={`${job.repoSlug}:${job.locale}`}
                className={styles.card}
                appearance="outline"
              >
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    <Subtitle1>{job.repoSlug}</Subtitle1>
                    <Badge appearance="outline">{localeLabel(job.locale)}</Badge>
                    {statusBadge(job.status)}
                  </div>
                  <Caption1 className={styles.cardMeta}>{timeAgo(job.updatedAt)}</Caption1>
                </div>

                {(job.status === "running" || job.done > 0) && (
                  <>
                    <div className={styles.progressRow}>
                      <ProgressBar
                        value={job.done}
                        max={Math.max(job.total, 1)}
                        shape="rounded"
                        thickness="medium"
                      />
                    </div>
                    <div className={styles.statsRow}>
                      <Caption1>
                        {job.done}/{job.total} {t("ui.translateRepo.pages" as MessageKey, "pages")}
                        {job.status === "running" && job.phase === "page" && job.current
                          ? ` · ${job.current}`
                          : ""}
                      </Caption1>
                      <Caption1 className={styles.percent}>{percent}%</Caption1>
                    </div>
                  </>
                )}

                {job.providerModel && (
                  <div className={styles.providerRow}>
                    <Caption1>
                      {t("ui.translateRepo.tryingProvider" as MessageKey, "AI provider")}
                    </Caption1>
                    <Badge appearance="outline" size="small">
                      {job.providerModel}
                    </Badge>
                    {job.apiKeyHint && (
                      <Caption1>
                        {t("ui.translateRepo.keyHint" as MessageKey, "key")} {job.apiKeyHint}
                      </Caption1>
                    )}
                  </div>
                )}

                {job.errorMessage && (
                  <Caption1 className={styles.errorMsg}>{job.errorMessage}</Caption1>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
