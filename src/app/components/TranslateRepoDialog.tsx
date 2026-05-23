import { useCallback, useEffect, useRef, useState } from "react";
import {
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  ProgressBar,
  tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular, Checkmark24Regular, ArrowSync24Regular } from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import type { LocaleConfig, RepoConfig } from "../../shared/types";
import type { MessageKey } from "../../shared/i18n";

// localStorage stores ONLY the cancel token — progress lives in D1.
const LS_TOKEN_KEY = "vellum-translate-cancel-token";

export interface TranslateJobState {
  phase: "idle" | "translating" | "complete" | "cancelled" | "error";
  done: number;
  total: number;
  currentFile: string;
  currentPhase: string;
  errorMessage?: string;
  repoIndex: number;
  repoCount: number;
  currentRepoSlug: string;
  locale: string;
}

const INITIAL_STATE: TranslateJobState = {
  phase: "idle",
  done: 0,
  total: 0,
  currentFile: "",
  currentPhase: "",
  repoIndex: 0,
  repoCount: 0,
  currentRepoSlug: "",
  locale: "",
};

// Cancel token helpers — only auth info in localStorage
export function readCancelToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LS_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeCancelToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearCancelToken() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LS_TOKEN_KEY);
  } catch {
    // ignore
  }
}

// Poll D1 for job status
export async function fetchJobStatus(
  repoSlug: string,
  locale: string,
): Promise<TranslateJobState | null> {
  try {
    const res = await fetch(
      `/api/translate-repo?repo=${encodeURIComponent(repoSlug)}&locale=${encodeURIComponent(locale)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (data.status === "idle" || data.status === "no-db") return null;
    return {
      phase:
        data.status === "running" ? "translating" : (data.status as TranslateJobState["phase"]),
      done: (data.done as number) ?? 0,
      total: (data.total as number) ?? 0,
      currentFile: (data.current as string) ?? "",
      currentPhase: (data.phase as string) ?? "",
      errorMessage: data.errorMessage as string | undefined,
      repoIndex: 0,
      repoCount: 1,
      currentRepoSlug: (data.repoSlug as string) ?? repoSlug,
      locale: (data.locale as string) ?? locale,
    };
  } catch {
    return null;
  }
}

const useStyles = makeStyles({
  content: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  progressSection: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  progressHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    color: tokens.colorNeutralForeground2,
  },
  progressPercent: {
    fontFamily: tokens.fontFamilyMonospace,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorBrandForeground1,
  },
  currentFile: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalXS,
  },
  fileName: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  phaseLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  stats: {
    display: "flex",
    gap: tokens.spacingHorizontalL,
    marginTop: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  complete: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorPaletteGreenForeground1,
  },
  cancelled: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground2,
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
  },
});

interface Props {
  open: boolean;
  onClose: () => void;
  locale: LocaleConfig;
  repos: RepoConfig[];
}

export function TranslateRepoDialog({ open, onClose, locale, repos }: Props) {
  const styles = useStyles();
  const { t } = useVellum();
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<TranslateJobState>({
    ...INITIAL_STATE,
    locale: locale.code,
    repoCount: repos.length,
  });

  // Poll D1 for progress
  const startPolling = useCallback(
    (repoSlug: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const job = await fetchJobStatus(repoSlug, locale.code);
        if (!job) return;
        setState((prev) => ({ ...prev, ...job }));
        if (job.phase !== "translating" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 2000);
    },
    [locale.code],
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startTranslation = useCallback(async () => {
    const ac = new AbortController();
    abortRef.current = ac;

    setState({
      ...INITIAL_STATE,
      phase: "translating",
      locale: locale.code,
      repoCount: repos.length,
      currentPhase: "sidebar",
    });

    for (let ri = 0; ri < repos.length; ri++) {
      if (ac.signal.aborted) return;
      const repo = repos[ri]!;

      setState((prev) => ({
        ...prev,
        repoIndex: ri,
        currentRepoSlug: repo.slug,
        currentFile: "",
        currentPhase: "sidebar",
      }));

      try {
        const res = await fetch(
          `/api/translate-repo?repo=${encodeURIComponent(repo.slug)}&locale=${encodeURIComponent(locale.code)}`,
          { method: "POST", signal: ac.signal },
        );

        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({ error: res.statusText }))) as {
            error?: string;
          };
          console.warn(`[translate-repo] ${repo.slug}: ${errBody.error ?? res.statusText}`);
          continue;
        }

        const reader = res.body?.getReader();
        if (!reader) continue;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ") && eventType) {
              try {
                const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
                if (eventType === "start") {
                  const cancelToken = data.cancelToken as string | undefined;
                  if (cancelToken) writeCancelToken(cancelToken);
                  setState((prev) => ({
                    ...prev,
                    total: data.total as number,
                    done: 0,
                  }));
                } else if (eventType === "progress") {
                  setState((prev) => ({
                    ...prev,
                    done: data.done as number,
                    total: data.total as number,
                    currentFile: data.current as string,
                    currentPhase: data.phase as string,
                  }));
                } else if (eventType === "complete") {
                  if (ri === repos.length - 1) {
                    setState((prev) => ({
                      ...prev,
                      done: data.done as number,
                      total: data.total as number,
                      phase: "complete",
                    }));
                  }
                } else if (eventType === "cancelled") {
                  setState((prev) => ({ ...prev, phase: "cancelled" }));
                } else if (eventType === "error") {
                  setState((prev) => ({
                    ...prev,
                    phase: "error",
                    errorMessage: data.message as string,
                  }));
                }
              } catch {
                // malformed JSON
              }
              eventType = "";
            } else if (line === "") {
              eventType = "";
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.warn(`[translate-repo] ${repo.slug} failed: ${(err as Error).message}`);
      }
    }

    if (!ac.signal.aborted) {
      setState((prev) => ({
        ...prev,
        phase: prev.phase === "cancelled" ? "cancelled" : "complete",
        done: prev.total,
      }));
    }
  }, [repos, locale.code]);

  // On open: check D1 for an existing running job first, otherwise start new
  useEffect(() => {
    if (!open) {
      stopPolling();
      return;
    }
    // Check if there's already a running job for any repo in this locale
    (async () => {
      for (const repo of repos) {
        const job = await fetchJobStatus(repo.slug, locale.code);
        if (job && job.phase === "translating") {
          setState(job);
          startPolling(repo.slug);
          return;
        }
      }
      // No running job — start fresh
      if (state.phase === "idle") {
        void startTranslation();
      }
    })();
    return stopPolling;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const percent = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;

  const handleCancel = async () => {
    const token = readCancelToken();
    if (!token || !state.currentRepoSlug) return;
    try {
      await fetch(
        `/api/translate-repo?repo=${encodeURIComponent(state.currentRepoSlug)}&locale=${encodeURIComponent(locale.code)}`,
        { method: "DELETE", headers: { "x-cancel-token": token } },
      );
    } catch {
      // best-effort
    }
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, phase: "cancelled" }));
  };

  const handleClose = () => onClose();

  const handleDone = () => {
    clearCancelToken();
    onClose();
  };

  const ownsJob = !!readCancelToken();

  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => {
        if (!d.open) handleClose();
      }}
      modalType="alert"
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            {t("ui.translateRepo.title" as MessageKey, `Translate to ${locale.label}`)}
          </DialogTitle>
          <DialogContent className={styles.content}>
            {state.phase === "translating" && (
              <div className={styles.progressSection}>
                <div className={styles.progressHeader}>
                  <Body1 className={styles.progressLabel}>
                    {state.repoCount > 1
                      ? `${state.currentRepoSlug} (${state.repoIndex + 1}/${state.repoCount})`
                      : t("ui.translateRepo.translating" as MessageKey, "Translating...")}
                  </Body1>
                  <Body1Strong className={styles.progressPercent}>{percent}%</Body1Strong>
                </div>
                <ProgressBar
                  value={state.done}
                  max={Math.max(state.total, 1)}
                  shape="rounded"
                  thickness="large"
                />
                <div className={styles.currentFile}>
                  <Caption1 className={styles.phaseLabel}>
                    {state.currentPhase === "sidebar"
                      ? t(
                          "ui.translateRepo.phaseSidebar" as MessageKey,
                          "Translating sidebar & index...",
                        )
                      : t("ui.translateRepo.phasePage" as MessageKey, "Translating page:")}
                  </Caption1>
                  {state.currentPhase === "page" && (
                    <Caption1 className={styles.fileName}>{state.currentFile}</Caption1>
                  )}
                </div>
                <div className={styles.stats}>
                  <span>
                    {state.done} / {state.total}{" "}
                    {t("ui.translateRepo.pages" as MessageKey, "pages")}
                  </span>
                </div>
              </div>
            )}

            {state.phase === "complete" && (
              <div className={styles.complete}>
                <Checkmark24Regular />
                <Body1Strong>
                  {t("ui.translateRepo.complete" as MessageKey, "Translation complete!")}
                </Body1Strong>
              </div>
            )}

            {state.phase === "cancelled" && (
              <div className={styles.cancelled}>
                <Dismiss24Regular />
                <Body1Strong>
                  {t("ui.translateRepo.cancelled" as MessageKey, "Translation cancelled.")}
                </Body1Strong>
              </div>
            )}

            {state.phase === "error" && (
              <div className={styles.error}>
                <Body1>{state.errorMessage}</Body1>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            {state.phase === "translating" ? (
              <>
                <Button appearance="secondary" onClick={handleClose}>
                  {t("ui.search.close" as MessageKey, "Close")}
                </Button>
                {ownsJob && (
                  <Button
                    appearance="secondary"
                    icon={<Dismiss24Regular />}
                    onClick={() => void handleCancel()}
                  >
                    {t("ui.askAi.cancel" as MessageKey, "Cancel")}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  appearance="primary"
                  icon={state.phase === "complete" ? <Checkmark24Regular /> : undefined}
                  onClick={handleDone}
                >
                  {state.phase === "complete"
                    ? t("ui.translateRepo.done" as MessageKey, "Done")
                    : t("ui.search.close" as MessageKey, "Close")}
                </Button>
                {(state.phase === "complete" || state.phase === "cancelled") && ownsJob && (
                  <Button
                    appearance="secondary"
                    icon={<ArrowSync24Regular />}
                    onClick={() => {
                      clearCancelToken();
                      setState({
                        ...INITIAL_STATE,
                        locale: locale.code,
                        repoCount: repos.length,
                      });
                    }}
                  >
                    {t("ui.translateRepo.retranslate" as MessageKey, "Retranslate")}
                  </Button>
                )}
              </>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
