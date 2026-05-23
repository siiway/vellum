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

type Phase = "idle" | "translating" | "complete" | "error";

interface TranslationState {
  phase: Phase;
  done: number;
  total: number;
  currentFile: string;
  currentPhase: string;
  errorMessage?: string;
  repoIndex: number;
  repoCount: number;
  currentRepoSlug: string;
}

export function TranslateRepoDialog({ open, onClose, locale, repos }: Props) {
  const styles = useStyles();
  const { t } = useVellum();
  const abortRef = useRef<AbortController | null>(null);

  const [state, setState] = useState<TranslationState>({
    phase: "idle",
    done: 0,
    total: 0,
    currentFile: "",
    currentPhase: "",
    repoIndex: 0,
    repoCount: repos.length,
    currentRepoSlug: "",
  });

  const startTranslation = useCallback(async () => {
    const ac = new AbortController();
    abortRef.current = ac;

    setState({
      phase: "translating",
      done: 0,
      total: 0,
      currentFile: "",
      currentPhase: "sidebar",
      repoIndex: 0,
      repoCount: repos.length,
      currentRepoSlug: "",
    });

    let globalDone = 0;
    let globalTotal = 0;

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
                handleSSEEvent(
                  eventType,
                  data,
                  ri,
                  repos.length,
                  globalDone,
                  globalTotal,
                  setState,
                  (d, t) => {
                    globalDone = d;
                    globalTotal = t;
                  },
                );
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
        phase: "complete",
        done: prev.total,
      }));
    }
  }, [repos, locale.code]);

  useEffect(() => {
    if (open && state.phase === "idle") {
      void startTranslation();
    }
  }, [open, state.phase, startTranslation]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setState({
        phase: "idle",
        done: 0,
        total: 0,
        currentFile: "",
        currentPhase: "",
        repoIndex: 0,
        repoCount: repos.length,
        currentRepoSlug: "",
      });
    }
  }, [open, repos.length]);

  const percent = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

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
                  {t(
                    "ui.translateRepo.complete" as MessageKey,
                    `Translation complete! ${state.done} pages translated.`,
                  )}
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
              <Button appearance="secondary" icon={<Dismiss24Regular />} onClick={handleClose}>
                {t("ui.askAi.cancel" as MessageKey, "Cancel")}
              </Button>
            ) : (
              <Button
                appearance="primary"
                icon={state.phase === "complete" ? <Checkmark24Regular /> : undefined}
                onClick={handleClose}
              >
                {state.phase === "complete"
                  ? t("ui.translateRepo.done" as MessageKey, "Done")
                  : t("ui.search.close" as MessageKey, "Close")}
              </Button>
            )}
            {state.phase === "complete" && (
              <Button
                appearance="secondary"
                icon={<ArrowSync24Regular />}
                onClick={() => {
                  setState((prev) => ({ ...prev, phase: "idle" }));
                }}
              >
                {t("ui.translateRepo.retranslate" as MessageKey, "Retranslate")}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function handleSSEEvent(
  event: string,
  data: Record<string, unknown>,
  repoIndex: number,
  repoCount: number,
  _globalDone: number,
  _globalTotal: number,
  setState: React.Dispatch<React.SetStateAction<TranslationState>>,
  updateGlobals: (done: number, total: number) => void,
) {
  if (event === "start") {
    const total = data.total as number;
    updateGlobals(0, total);
    setState((prev) => ({
      ...prev,
      total,
      done: 0,
      phase: "translating",
      repoIndex,
      repoCount,
    }));
  } else if (event === "progress") {
    const done = data.done as number;
    const total = data.total as number;
    const current = data.current as string;
    const phase = data.phase as string;
    updateGlobals(done, total);
    setState((prev) => ({
      ...prev,
      done,
      total,
      currentFile: current,
      currentPhase: phase,
      phase: "translating",
    }));
  } else if (event === "complete") {
    const done = data.done as number;
    const total = data.total as number;
    updateGlobals(done, total);
    if (repoIndex === repoCount - 1) {
      setState((prev) => ({
        ...prev,
        done,
        total,
        phase: "complete",
      }));
    }
  } else if (event === "error") {
    setState((prev) => ({
      ...prev,
      phase: "error",
      errorMessage: data.message as string,
    }));
  }
}
