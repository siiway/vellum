import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Body1Strong,
  Button,
  Caption1,
  Card,
  CardFooter,
  CardHeader,
  Field,
  ProgressBar,
  Spinner,
  Text,
  tokens,
  mergeClasses,
} from "@fluentui/react-components";
import { AiMarkdown } from "./AiMarkdown";
import {
  Sparkle24Regular,
  Copy24Regular,
  Checkmark24Regular,
  ArrowSync24Regular,
  Dismiss24Regular,
} from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { format } from "../../shared/i18n";

// Microsoft Learn-style "AI Summary" widget. Lives below the page hero and
// above the article body. Two states:
//   - collapsed: pill button with a sparkle icon.
//   - expanded:  Card with a header (label + actions), body, and disclaimer
//                footer. All chrome is FluentUI v9 — Button / Card /
//                CardHeader / CardFooter / Spinner / typography ramps — so
//                the widget tracks the same design tokens (focus rings,
//                hover surfaces, dark-mode palette) as the rest of the shell.
//
// On first expand we open an SSE stream to /api/summarize and append every
// `token` event into the body. The captcha hop (Turnstile) runs before the
// POST when the site config sets `aiSummary.turnstileSiteKey`.

interface SSEvent {
  event: string;
  data: unknown;
}

const useStyles = makeStyles({
  wrapper: {
    marginBottom: tokens.spacingVerticalXXL,
  },
  // Pill button takes its colours from `appearance="outline"` + the brand
  // colour overrides below. Microsoft Learn's button uses a subtle gradient
  // border; we approximate with the brand stroke + brand foreground so it
  // reads as "AI surface" without competing with the H1.
  pill: {
    borderRadius: tokens.borderRadiusCircular,
    borderColor: tokens.colorBrandStroke1,
    color: tokens.colorBrandForeground1,
    "&:hover": {
      backgroundColor: tokens.colorBrandBackground2,
      borderColor: tokens.colorBrandStroke1,
      color: tokens.colorBrandForeground1,
    },
    "&:active, &:hover:active": {
      backgroundColor: tokens.colorBrandBackground2Hover,
      borderColor: tokens.colorBrandStroke1,
      color: tokens.colorBrandForeground1,
    },
  },
  card: {
    // Card's default `appearance="filled"` matches our shell's surface; we
    // only need to clamp the width so the card stays inside the article
    // column rather than stretching to the grid edge.
    width: "100%",
  },
  headerTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorBrandForeground1,
  },
  headerActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  body: {
    paddingBlock: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground1,
    minHeight: "60px",
    wordBreak: "break-word",
  },
  loadingRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground2,
  },
  // Provider-attempt progress sits under the spinner row as a FluentUI
  // Field + ProgressBar. The bar fills as the failover loop advances
  // through endpoints; the field's validation state flips to "warning"
  // when an endpoint has just failed so the colour change reads as a
  // status, not just decoration.
  providerProgress: {
    marginTop: tokens.spacingVerticalS,
  },
  // CardFooter is a flex row by default; we just need to push the two
  // <Text>s apart and tone them down.
  disclaimer: {
    justifyContent: "space-between",
    color: tokens.colorNeutralForeground3,
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
  },
  turnstileSlot: {
    // Reserved for the invisible Turnstile iframe. The widget injects its own
    // visible UI only when the visitor is challenged; in that case Turnstile
    // positions a modal on top of the page, so we don't need to allocate room
    // here. We keep the node mounted so widget IDs stay valid across renders.
    position: "absolute",
    width: 0,
    height: 0,
    overflow: "hidden",
  },
});

interface TurnstileGlobal {
  render: (
    el: HTMLElement | string,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: (err: unknown) => void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
      size?: "normal" | "compact" | "invisible";
      appearance?: "always" | "execute" | "interaction-only";
      retry?: "auto" | "never";
      action?: string;
    },
  ) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

// Promise-cached script loader so concurrent expands don't inject the script
// twice. The script auto-discovers `[data-sitekey]` widgets by default; we
// pass `?render=explicit` so it only acts on our explicit render() call.
let turnstileLoadPromise: Promise<TurnstileGlobal> | null = null;
function loadTurnstile(): Promise<TurnstileGlobal> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoadPromise) return turnstileLoadPromise;

  turnstileLoadPromise = new Promise<TurnstileGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-vellum-turnstile]");
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error("Turnstile loaded without exposing the global."));
      });
      existing.addEventListener("error", () => reject(new Error("Turnstile script failed.")));
      return;
    }
    const s = document.createElement("script");
    s.src = `${TURNSTILE_SRC}?render=explicit`;
    s.async = true;
    s.defer = true;
    s.dataset.vellumTurnstile = "1";
    s.addEventListener("load", () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile loaded without exposing the global."));
    });
    s.addEventListener("error", () => reject(new Error("Turnstile script failed.")));
    document.head.appendChild(s);
  });
  return turnstileLoadPromise;
}

// Wraps Turnstile's callback-shaped render() into a one-shot promise the
// caller can await. The widget is rendered as `invisible` so the visitor
// never sees a CAPTCHA UI unless Cloudflare decides a challenge is needed.
function obtainTurnstileToken(siteKey: string, host: HTMLElement): Promise<string> {
  return new Promise((resolve, reject) => {
    loadTurnstile().then(
      (ts) => {
        let widgetId = "";
        const finish = (val: string | null, err?: string) => {
          try {
            if (widgetId) ts.remove(widgetId);
          } catch {
            // ignore
          }
          if (val) resolve(val);
          else reject(new Error(err ?? "Captcha cancelled."));
        };
        widgetId = ts.render(host, {
          sitekey: siteKey,
          size: "invisible",
          retry: "auto",
          action: "summarize",
          callback: (token: string) => finish(token),
          "error-callback": () => finish(null, "Captcha error."),
          "expired-callback": () => finish(null, "Captcha expired."),
          "timeout-callback": () => finish(null, "Captcha timed out."),
        });
        // For invisible widgets, render() returns immediately but the
        // challenge isn't kicked off until execute() runs.
        ts.execute(widgetId);
      },
      (err: Error) => reject(err),
    );
  });
}

export function AISummary() {
  const styles = useStyles();
  const { data, t } = useVellum();
  const ai = data.config.site.aiSummary;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [copied, setCopied] = useState(false);
  // Provider-attempt state. Driven by the `provider` SSE event the worker
  // emits around each failover step. Cleared when streaming actually
  // starts (first `token` event) so the status line doesn't linger
  // beside the spinner once content is flowing.
  const [provider, setProvider] = useState<{
    id: string;
    attempt: number;
    total: number;
    status: "trying" | "failed";
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnstileHostRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();

  // Cleanup on unmount: abort any in-flight stream.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // On SPA navigation, the route changes but the component instance is reused
  // (Layout.tsx renders this between hero and MarkdownAst). Reset state so the
  // previous page's summary doesn't bleed into the next one.
  useEffect(() => {
    abortRef.current?.abort();
    setOpen(false);
    setText("");
    setError(null);
    setModel(null);
    setCached(false);
    setLoading(false);
    setProvider(null);
  }, [data.route.repoSlug, data.route.localeCode, data.route.pagePath]);

  const run = useCallback(
    async (fresh: boolean) => {
      if (!ai) return;
      setLoading(true);
      setError(null);
      setText("");
      setModel(null);
      setCached(false);
      setProvider(null);

      // Cancel any prior stream.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        let token: string | undefined;
        if (ai.turnstileSiteKey) {
          if (!turnstileHostRef.current) {
            throw new Error("Captcha host not ready.");
          }
          token = await obtainTurnstileToken(ai.turnstileSiteKey, turnstileHostRef.current);
        }

        const res = await fetch("/api/summarize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repo: data.route.repoSlug,
            branch: data.route.version.branch,
            locale: data.route.localeCode,
            page: data.route.pagePath,
            turnstileToken: token,
            fresh,
          }),
          signal: ac.signal,
        });

        if (!res.body) {
          throw new Error(`HTTP ${res.status}`);
        }
        // Even with a non-2xx, the body is still an SSE event with the
        // human-readable reason. Parse it the same way.
        await consumeStream(res.body, ac.signal, (ev) => {
          if (ev.event === "token") {
            const d = ev.data as { text?: string };
            if (d.text) {
              // First token committed — clear the provider-trying status so
              // the loading area swaps to the streaming-text view cleanly.
              setProvider(null);
              setText((prev) => prev + d.text);
            }
          } else if (ev.event === "provider") {
            const d = ev.data as {
              id?: string;
              attempt?: number;
              total?: number;
              status?: "trying" | "failed" | "ok";
            };
            if (
              d.id &&
              typeof d.attempt === "number" &&
              typeof d.total === "number" &&
              (d.status === "trying" || d.status === "failed")
            ) {
              setProvider({
                id: d.id,
                attempt: d.attempt,
                total: d.total,
                status: d.status,
              });
            }
          } else if (ev.event === "done") {
            const d = ev.data as { model?: string; cached?: boolean };
            if (d.model) setModel(d.model);
            if (d.cached) setCached(true);
            setLoading(false);
            setProvider(null);
          } else if (ev.event === "error") {
            const d = ev.data as { message?: string };
            setError(d.message || "Unknown error.");
            setLoading(false);
            setProvider(null);
          }
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message || "Failed to load AI summary.");
        setLoading(false);
      }
    },
    [ai, data.route],
  );

  // Hide the widget entirely when the feature isn't configured.
  if (!ai) return null;

  function expand() {
    if (!open) {
      setOpen(true);
      if (!text && !loading) {
        void run(false);
      }
    }
  }

  function regenerate() {
    void run(true);
  }

  function close() {
    abortRef.current?.abort();
    setOpen(false);
  }

  function copy() {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!open) {
    return (
      <div className={mergeClasses(styles.wrapper, "vellum-no-print")}>
        <Button
          appearance="outline"
          shape="circular"
          icon={<Sparkle24Regular />}
          onClick={expand}
          className={styles.pill}
        >
          {t("ui.aiSummary.button")}
        </Button>
        <div ref={turnstileHostRef} className={styles.turnstileSlot} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className={mergeClasses(styles.wrapper, "vellum-no-print")}
      role="region"
      aria-labelledby={headingId}
    >
      <Card className={styles.card} appearance="filled">
        <CardHeader
          header={
            <Body1Strong id={headingId} className={styles.headerTitle}>
              <Sparkle24Regular />
              {t("ui.aiSummary.title")}
            </Body1Strong>
          }
          action={
            <div className={styles.headerActions}>
              <Button
                appearance="subtle"
                size="small"
                icon={copied ? <Checkmark24Regular /> : <Copy24Regular />}
                onClick={copy}
                disabled={!text}
                aria-label={t("ui.copy")}
              >
                {copied ? t("ui.copied") : t("ui.copy")}
              </Button>
              <Button
                appearance="subtle"
                size="small"
                icon={<ArrowSync24Regular />}
                onClick={regenerate}
                disabled={loading}
                aria-label={t("ui.aiSummary.regenerate")}
              >
                {t("ui.aiSummary.regenerate")}
              </Button>
              <Button
                appearance="subtle"
                size="small"
                icon={<Dismiss24Regular />}
                onClick={close}
                aria-label={t("ui.aiSummary.close")}
              />
            </div>
          }
        />
        <div className={styles.body}>
          {error ? (
            <Text className={styles.error}>{error}</Text>
          ) : text ? (
            <AiMarkdown source={text} streaming={loading} />
          ) : loading ? (
            <div>
              <div className={styles.loadingRow}>
                <Spinner size="extra-tiny" />
                <Text>{t("ui.aiSummary.loading")}</Text>
              </div>
              {provider && (
                <Field
                  className={styles.providerProgress}
                  validationState={provider.status === "failed" ? "warning" : "none"}
                  validationMessage={
                    provider.status === "failed"
                      ? format(t("ui.ai.providerFailed"), { id: provider.id })
                      : format(t("ui.ai.tryingProvider"), {
                          id: provider.id,
                          attempt: provider.attempt,
                          total: provider.total,
                        })
                  }
                >
                  <ProgressBar
                    value={provider.attempt}
                    max={provider.total}
                    shape="rounded"
                    thickness="medium"
                  />
                </Field>
              )}
            </div>
          ) : null}
        </div>
        <CardFooter className={styles.disclaimer}>
          <Caption1>{t("ui.aiSummary.disclaimer")}</Caption1>
          <Caption1>
            {model ?? ""}
            {cached ? ` · ${t("ui.aiSummary.cached")}` : ""}
          </Caption1>
        </CardFooter>
      </Card>
      <div ref={turnstileHostRef} className={styles.turnstileSlot} aria-hidden="true" />
    </div>
  );
}

// Parses an SSE stream produced by our /api/summarize endpoint. Each frame
// has `event: <name>` and `data: <json>` lines; we yield one parsed event
// per frame so the caller can update React state incrementally.
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (ev: SSEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (signal.aborted) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      return;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (!dataLines.length) continue;
      const raw = dataLines.join("\n");
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Keep the raw string if the upstream broke JSON.
      }
      onEvent({ event, data: parsed });
    }
  }
}
