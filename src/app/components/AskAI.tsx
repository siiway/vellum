import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

// useLayoutEffect on the server logs a warning and runs nothing. The drawer
// uses it to pin the message list to the bottom as tokens stream in — a
// client-only concern, no point doing it during SSR. Mirrors the same
// pattern in context.tsx.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import {
  Avatar,
  Badge,
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
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  ProgressBar,
  Radio,
  RadioGroup,
  Text,
  Textarea,
  Tooltip,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add24Regular,
  Checkmark16Regular,
  Copy20Regular,
  Delete20Regular,
  Dismiss24Regular,
  History24Regular,
  Person24Regular,
  Send24Filled,
  Sparkle24Regular,
  Stop24Filled,
  Wrench24Regular,
} from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { AiMarkdown } from "./AiMarkdown";
import { format } from "../../shared/i18n";

// "Ask AI about this docs". FluentUI Drawer pinned to the right edge,
// triggered from a button in the NavBar (see AskAiButton). The drawer owns
// the chat history (messages live in state until the visitor closes the
// drawer). A Turnstile-gated session token is requested on first send and
// reused for the rest of the conversation.

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // Tool calls the assistant ran inside this turn, surfaced in the UI as
  // collapsed chips so the visitor can see what the AI looked at. Stored
  // alongside the assistant message that "owns" them.
  toolCalls?: ToolCallEntry[];
}

interface ToolCallEntry {
  name: string;
  args?: Record<string, unknown>;
  summary?: string;
}

type Scope = "current-repo" | "site";

// Chat history is persisted as a list of sessions in localStorage. Each
// session is a separate conversation; the visitor can switch between them
// from the drawer header. The shape is versioned so future changes can drop
// incompatible blobs cleanly.
//
// Storage layout (v2):
//   {
//     version: 2,
//     activeId: string | null,  // id of the conversation currently in view
//     sessions: StoredSession[] // sorted newest-first when read back
//   }
const STORAGE_KEY = "vellum-ai-chat-v2";
const STORAGE_KEY_V1 = "vellum-ai-chat-v1";
// Cap on retained sessions. Bounds storage and the History menu length;
// oldest sessions roll off when the visitor exceeds it.
const MAX_SESSIONS = 20;

interface StoredSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  scope: Scope;
  createdAt: number;
  updatedAt: number;
}

interface StoredHistory {
  version: 2;
  activeId: string | null;
  sessions: StoredSession[];
}

function emptyHistory(): StoredHistory {
  return { version: 2, activeId: null, sessions: [] };
}

function loadHistory(): StoredHistory {
  if (typeof window === "undefined") return emptyHistory();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredHistory;
      if (parsed.version === 2 && Array.isArray(parsed.sessions)) {
        return parsed;
      }
    }
    // Migrate v1 single-conversation storage: lift the old blob into a
    // single session and delete the original key so we don't migrate twice.
    const rawV1 = window.localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const v1 = JSON.parse(rawV1) as {
        version?: number;
        messages?: ChatMessage[];
        scope?: Scope;
      };
      if (v1?.version === 1 && Array.isArray(v1.messages) && v1.messages.length > 0) {
        const now = Date.now();
        const session: StoredSession = {
          id: makeSessionId(),
          title: deriveTitle(v1.messages),
          messages: v1.messages,
          scope: v1.scope ?? "site",
          createdAt: now,
          updatedAt: now,
        };
        const history: StoredHistory = {
          version: 2,
          activeId: session.id,
          sessions: [session],
        };
        saveHistory(history);
        window.localStorage.removeItem(STORAGE_KEY_V1);
        return history;
      }
    }
  } catch {
    // ignore — fall through to empty
  }
  return emptyHistory();
}

function saveHistory(h: StoredHistory): void {
  if (typeof window === "undefined") return;
  try {
    // Trim to MAX_SESSIONS, keeping the most recently updated.
    const trimmed =
      h.sessions.length > MAX_SESSIONS
        ? [...h.sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS)
        : h.sessions;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...h, sessions: trimmed }));
  } catch {
    // Quota exceeded or storage disabled (private window / iOS quirks).
    // Failure here is non-fatal; the in-memory state still works.
  }
}

function clearHistoryStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(STORAGE_KEY_V1);
  } catch {
    // ignore
  }
}

function makeSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Derive a session title from the first user message. Used when minting a
// new session as the visitor sends their first question.
function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const text = first.content.trim().replace(/\s+/g, " ");
  return text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text;
}

// Compact relative timestamp for the history menu ("3m ago", "yesterday").
// Locale-aware enough for the common cases without pulling in a full date
// formatter — same approach as PageFooter's lastUpdated chip.
function relativeTime(ts: number, locale: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return locale === "zh" ? "刚刚" : "just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return locale === "zh" ? `${min} 分钟前` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === "zh" ? `${hr} 小时前` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return locale === "zh" ? "昨天" : "yesterday";
  if (day < 7) return locale === "zh" ? `${day} 天前` : `${day}d ago`;
  const date = new Date(ts);
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : locale);
}

interface SSEvent {
  event: string;
  data: unknown;
}

const useStyles = makeStyles({
  drawerHeader: {
    paddingBottom: tokens.spacingVerticalS,
  },
  headerInner: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorBrandForeground1,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    paddingInline: 0,
    paddingBlock: 0,
  },
  scopeRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  scopeLabel: {
    color: tokens.colorNeutralForeground3,
  },
  list: {
    flex: 1,
    overflowY: "auto",
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  empty: {
    margin: "auto",
    paddingInline: tokens.spacingHorizontalXL,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground2,
  },
  emptyIconWrap: {
    width: "56px",
    height: "56px",
    borderRadius: tokens.borderRadiusCircular,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  emptyIcon: { width: "28px", height: "28px" },
  examples: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    width: "100%",
    maxWidth: "320px",
    marginTop: tokens.spacingVerticalS,
  },
  example: {
    justifyContent: "flex-start",
    textAlign: "left",
    width: "100%",
    fontWeight: tokens.fontWeightRegular,
  },
  // Each message turn renders as a row: avatar + bubble + per-message
  // hover actions. The wrapper carries the alignment so the user side
  // stays flush right and the assistant side flush left.
  row: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    alignItems: "flex-start",
    maxWidth: "100%",
  },
  rowUser: {
    flexDirection: "row-reverse",
    alignSelf: "flex-end",
    maxWidth: "92%",
  },
  rowAssistant: {
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  avatar: { flexShrink: 0, marginTop: "2px" },
  bubbleCol: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    minWidth: 0,
  },
  bubble: {
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusLarge,
    wordBreak: "break-word",
    lineHeight: tokens.lineHeightBase300,
  },
  user: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    borderTopRightRadius: tokens.borderRadiusMedium,
    whiteSpace: "pre-wrap",
  },
  assistant: {
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    borderTopLeftRadius: tokens.borderRadiusMedium,
  },
  messageActions: {
    display: "flex",
    gap: "2px",
    opacity: 0,
    transition: "opacity 120ms",
  },
  // CSS-only hover reveal — beats wiring per-message hover state through
  // React. ":has" is well-supported in evergreen browsers and degrades to
  // always-visible on the rest, which is also fine.
  rowHover: {
    "&:hover [data-msg-actions]": { opacity: 1 },
    "&:focus-within [data-msg-actions]": { opacity: 1 },
  },
  toolChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
  },
  cursor: {
    display: "inline-block",
    width: "0.5em",
    height: "1em",
    verticalAlign: "text-bottom",
    backgroundColor: tokens.colorBrandForeground1,
    marginLeft: "2px",
    animationName: {
      "0%, 100%": { opacity: 1 },
      "50%": { opacity: 0 },
    },
    animationDuration: "1s",
    animationIterationCount: "infinite",
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
    alignSelf: "flex-start",
  },
  composer: {
    display: "flex",
    alignItems: "flex-end",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalL,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  textarea: {
    flex: 1,
  },
  disclaimer: {
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: "center",
  },
  // Floating row that sits between the message list and the disclaimer
  // while the model is streaming. Centers a single "Stop generating" pill
  // — the same pattern ChatGPT and Claude.ai use to keep the affordance
  // discoverable without crowding the composer.
  stopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingHorizontalM,
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  stopBtn: {
    borderRadius: tokens.borderRadiusCircular,
    boxShadow: tokens.shadow4,
  },
  // Provider-attempt FluentUI Field + ProgressBar lives next to the Stop
  // button while a failover is in progress. The bar advances through
  // endpoints, the field's validation state flips to "warning" when an
  // endpoint has just failed so the colour change reads as a status.
  providerProgress: {
    flex: 1,
    minWidth: 0,
  },
  turnstileSlot: {
    display: "flex",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: tokens.borderRadiusLarge,
    marginBlock: tokens.spacingVerticalS,
  },
});

// --- Turnstile interop (shares the loader pattern with AISummary.tsx) -----

interface TurnstileGlobal {
  render: (
    el: HTMLElement | string,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: (err: unknown) => void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
      size?: "normal" | "compact" | "flexible";
      execution?: "render" | "execute";
      appearance?: "always" | "execute" | "interaction-only";
      retry?: "auto" | "never";
      action?: string;
    },
  ) => string | undefined;
  execute: (container: HTMLElement | string) => void;
  reset: (container?: HTMLElement | string) => void;
  remove: (container?: HTMLElement | string) => void;
  getResponse: (container?: HTMLElement | string) => string | undefined;
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

let turnstileLoadPromise: Promise<TurnstileGlobal> | null = null;
function loadTurnstile(): Promise<TurnstileGlobal> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoadPromise) return turnstileLoadPromise;
  turnstileLoadPromise = new Promise<TurnstileGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-vellum-turnstile]");
    if (existing) {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }
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

let tsWidgetHost: HTMLElement | null = null;
let tsResolve: ((token: string) => void) | null = null;
let tsReject: ((err: Error) => void) | null = null;

function obtainTurnstileToken(siteKey: string, host: HTMLElement): Promise<string> {
  return new Promise((resolve, reject) => {
    loadTurnstile().then(
      (ts) => {
        tsResolve = resolve;
        tsReject = reject;

        if (tsWidgetHost === host) {
          ts.reset(host);
          ts.execute(host);
          return;
        }

        if (tsWidgetHost) {
          try {
            ts.remove(tsWidgetHost);
          } catch {
            /* ignore */
          }
        }
        ts.render(host, {
          sitekey: siteKey,
          size: "compact",
          execution: "execute",
          appearance: "interaction-only",
          retry: "auto",
          action: "ask-ai",
          callback: (token: string) => {
            if (tsResolve) {
              tsResolve(token);
              tsResolve = null;
              tsReject = null;
            }
          },
          "error-callback": () => {
            if (tsReject) {
              tsReject(new Error("Captcha error."));
              tsResolve = null;
              tsReject = null;
            }
          },
          "expired-callback": () => {
            if (tsReject) {
              tsReject(new Error("Captcha expired."));
              tsResolve = null;
              tsReject = null;
            }
          },
          "timeout-callback": () => {
            if (tsReject) {
              tsReject(new Error("Captcha timed out."));
              tsResolve = null;
              tsReject = null;
            }
          },
        });
        tsWidgetHost = host;
        ts.execute(host);
      },
      (err: Error) => reject(err),
    );
  });
}

// --- NavBar button --------------------------------------------------------

export function AskAiButton({ onClick }: { onClick: () => void }) {
  const { data, t } = useVellum();
  if (!data.config.site.aiChat) return null;
  // Icon-only button — the sparkle reads as "AI" and the tooltip / aria
  // label still carry the full string for accessibility.
  return (
    <Tooltip content={t("ui.askAi.button")} relationship="label">
      <Button
        appearance="subtle"
        icon={<Sparkle24Regular />}
        onClick={onClick}
        aria-label={t("ui.askAi.button")}
      />
    </Tooltip>
  );
}

// --- Drawer ---------------------------------------------------------------

export function AskAI({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const styles = useStyles();
  const { data, t } = useVellum();
  const ai = data.config.site.aiChat;
  const headingId = useId();

  const [scope, setScope] = useState<Scope>("site");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Provider-attempt status driven by the worker's `provider` SSE event.
  // Shows "Trying foo (1/3)…" inline while loading so a failover delay
  // doesn't look like a frozen request. Cleared on first token / done.
  const [provider, setProvider] = useState<{
    id: string;
    attempt: number;
    total: number;
    status: "trying" | "failed";
  } | null>(null);
  // All persisted sessions plus the id of the one currently in view.
  // `activeId === null` means we haven't started writing into a session yet
  // — the first user send mints one (so empty "New chat" states don't
  // clutter the history menu).
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Tracks whether the initial hydration from localStorage has completed.
  // Until it has, the auto-save effect is a no-op so we don't blow away the
  // stored sessions with the initial empty arrays.
  const [hydrated, setHydrated] = useState(false);

  const sessionTokenRef = useRef<string | null>(null);
  const sessionExpRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  const turnstileHostRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Hydrate from localStorage on first client render. Done in a useEffect
  // rather than useState's initializer so the SSR-rendered DOM (which can't
  // see localStorage) matches what the browser produces at hydration time.
  useEffect(() => {
    const h = loadHistory();
    setSessions(h.sessions);
    setActiveId(h.activeId);
    if (h.activeId) {
      const active = h.sessions.find((s) => s.id === h.activeId);
      if (active) {
        setMessages(active.messages);
        setScope(active.scope);
      }
    }
    setHydrated(true);
  }, []);

  // Persist on every change after the first hydration pass. The active
  // session in the array mirrors the live messages/scope state; saving
  // happens whenever either changes.
  useEffect(() => {
    if (!hydrated) return;
    // Build the updated session list: refresh the active session (or
    // insert it) with the current live state.
    let nextSessions = sessions;
    if (activeId) {
      const idx = sessions.findIndex((s) => s.id === activeId);
      if (idx >= 0) {
        const cur = sessions[idx]!;
        // Keep the first-message-derived title pinned; titles only update
        // when the title was the placeholder ("New chat") and a user
        // message has since arrived.
        const wantTitle =
          cur.title === "New chat" && messages.some((m) => m.role === "user")
            ? deriveTitle(messages)
            : cur.title;
        nextSessions = sessions.slice();
        nextSessions[idx] = {
          ...cur,
          title: wantTitle,
          messages,
          scope,
          updatedAt: Date.now(),
        };
      }
    }
    saveHistory({ version: 2, activeId, sessions: nextSessions });
    if (nextSessions !== sessions) setSessions(nextSessions);
    // We intentionally exclude `sessions` from the dep list — the effect
    // produces a new sessions array, and re-including it would cause a
    // double-save loop. activeId/messages/scope already capture every
    // change we care about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, activeId, messages, scope]);

  // Keep the message list pinned to the bottom as tokens stream in.
  useIsoLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  // Abort any in-flight stream when the drawer closes (history stays
  // intact in localStorage so a fresh open restores it).
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
    }
  }, [open]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // "New chat": start a fresh empty session. Keeps the chosen scope so
  // visitors who set "current-repo" don't keep reverting to site-wide.
  // We don't materialize the new session in the sessions array yet — that
  // happens on the first send, so a string of "New chat" clicks doesn't
  // pollute the history menu with empty entries.
  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setLoading(false);
    setActiveId(null);
  }, []);

  // Switch the active session to the one with the given id and load its
  // contents into the live state.
  const switchSession = useCallback(
    (id: string) => {
      const target = sessions.find((s) => s.id === id);
      if (!target) return;
      abortRef.current?.abort();
      setActiveId(id);
      setMessages(target.messages);
      setScope(target.scope);
      setError(null);
      setLoading(false);
    },
    [sessions],
  );

  // Wipe every persisted session and reset live state to the empty drawer.
  const clearAllHistory = useCallback(() => {
    abortRef.current?.abort();
    setSessions([]);
    setActiveId(null);
    setMessages([]);
    setError(null);
    setLoading(false);
    clearHistoryStorage();
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const ensureSessionToken = useCallback(async (): Promise<string | null> => {
    if (!ai) return null;
    if (!ai.turnstileSiteKey) return null;

    const now = Math.floor(Date.now() / 1000);
    const cur = sessionTokenRef.current;
    if (cur && sessionExpRef.current - 30 > now) return cur;

    if (!turnstileHostRef.current) {
      throw new Error("Captcha host not ready.");
    }
    const ts = await obtainTurnstileToken(ai.turnstileSiteKey, turnstileHostRef.current);
    const res = await fetch("/api/ai/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: ts }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Session HTTP ${res.status}`);
    }
    const data = (await res.json()) as { token: string; expiresIn: number };
    sessionTokenRef.current = data.token;
    sessionExpRef.current = Math.floor(Date.now() / 1000) + (data.expiresIn ?? 3600);
    return data.token;
  }, [ai]);

  // Shared sender that takes the question explicitly. Used by both the
  // composer's Enter handler and the example-prompt buttons in the empty
  // state. Keeping the input-state read out of here means the example
  // buttons don't have to round-trip through setInput.
  const sendWith = useCallback(
    async (q: string) => {
      if (!ai) return;
      if (!q.trim() || loading) return;

      setError(null);
      const nextMessages: ChatMessage[] = [
        ...messages,
        { role: "user", content: q },
        { role: "assistant", content: "", toolCalls: [] },
      ];

      // Mint a new session on the first send. Empty drafts don't earn a
      // history-menu entry — only once the visitor has actually asked
      // something do we materialize the session.
      if (!activeId) {
        const now = Date.now();
        const newSession: StoredSession = {
          id: makeSessionId(),
          title: deriveTitle(nextMessages),
          messages: nextMessages,
          scope,
          createdAt: now,
          updatedAt: now,
        };
        setSessions((prev) => [newSession, ...prev]);
        setActiveId(newSession.id);
      }

      setMessages(nextMessages);
      setLoading(true);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const sessionToken = await ensureSessionToken();
        const history = nextMessages.slice(0, -1).map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;

        const res = await fetch("/api/ask", {
          method: "POST",
          headers,
          signal: ac.signal,
          body: JSON.stringify({
            messages: history,
            scope,
            currentRepo: data.route.repoSlug,
            currentPage: data.route.pagePath,
            locale: data.route.localeCode,
          }),
        });
        if (!res.body) throw new Error(`HTTP ${res.status}`);

        await consumeStream(res.body, ac.signal, (ev) => {
          if (ev.event === "token") {
            const d = ev.data as { text?: string };
            if (!d.text) return;
            // First token committed — drop the provider-trying line
            // since the stream is flowing now.
            setProvider(null);
            setMessages((prev) => {
              const copy = prev.slice();
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: last.content + d.text };
              }
              return copy;
            });
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
          } else if (ev.event === "tool_call") {
            const d = ev.data as { name: string; args?: Record<string, unknown> };
            setMessages((prev) => {
              const copy = prev.slice();
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = {
                  ...last,
                  toolCalls: [...(last.toolCalls ?? []), { name: d.name, args: d.args }],
                };
              }
              return copy;
            });
          } else if (ev.event === "tool_result") {
            const d = ev.data as { name: string; summary?: string };
            setMessages((prev) => {
              const copy = prev.slice();
              const last = copy[copy.length - 1];
              if (last?.role === "assistant" && last.toolCalls?.length) {
                const calls = last.toolCalls.slice();
                // Match the most recent unsummarized call with this name.
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i]!.name === d.name && !calls[i]!.summary) {
                    calls[i] = { ...calls[i]!, summary: d.summary };
                    break;
                  }
                }
                copy[copy.length - 1] = { ...last, toolCalls: calls };
              }
              return copy;
            });
          } else if (ev.event === "error") {
            const d = ev.data as { message?: string };
            setError(d.message || "Unknown error.");
            setLoading(false);
            setProvider(null);
          } else if (ev.event === "done") {
            setLoading(false);
            setProvider(null);
          }
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message || "Failed to send message.");
        setLoading(false);
      }
    },
    [ai, activeId, data.route, ensureSessionToken, loading, messages, scope],
  );

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q) return;
    setInput("");
    await sendWith(q);
  }, [input, sendWith]);

  const sendDirect = useCallback(
    async (text: string) => {
      setInput("");
      await sendWith(text);
    },
    [sendWith],
  );

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline. Matches the convention of
    // every other chat UI in the wild.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  if (!ai) return null;

  const currentRepo = data.route.repo?.displayName ?? data.route.repoSlug;
  const examples = buildExamples(data.config);

  return (
    <Drawer
      type="overlay"
      separator
      open={open}
      onOpenChange={(_, v) => onOpenChange(v.open)}
      position="end"
      size="medium"
      aria-labelledby={headingId}
    >
      <DrawerHeader className={styles.drawerHeader}>
        <DrawerHeaderTitle
          action={
            <span style={{ display: "inline-flex", gap: 2 }}>
              <Tooltip content={t("ui.askAi.newChat")} relationship="label">
                <Button
                  appearance="subtle"
                  icon={<Add24Regular />}
                  aria-label={t("ui.askAi.newChat")}
                  onClick={newChat}
                  disabled={messages.length === 0 && !error}
                />
              </Tooltip>
              <HistoryMenu
                sessions={sessions}
                activeId={activeId}
                onPick={switchSession}
                onClearAll={clearAllHistory}
                locale={data.route.localeCode}
              />
              <Tooltip content={t("ui.askAi.close")} relationship="label">
                <Button
                  appearance="subtle"
                  icon={<Dismiss24Regular />}
                  aria-label={t("ui.askAi.close")}
                  onClick={() => onOpenChange(false)}
                />
              </Tooltip>
            </span>
          }
        >
          <span id={headingId} className={styles.headerInner}>
            <Sparkle24Regular />
            {t("ui.askAi.title")}
          </span>
        </DrawerHeaderTitle>
      </DrawerHeader>

      <DrawerBody className={styles.body}>
        <div className={styles.scopeRow}>
          <Caption1 className={styles.scopeLabel}>{t("ui.askAi.scope")}</Caption1>
          <RadioGroup
            value={scope}
            onChange={(_, v) => setScope(v.value as Scope)}
            layout="horizontal"
          >
            <Radio
              value="current-repo"
              label={`${t("ui.askAi.scope.currentRepo")}${currentRepo ? ` (${currentRepo})` : ""}`}
              disabled={!data.route.repoSlug}
            />
            <Radio value="site" label={t("ui.askAi.scope.site")} />
          </RadioGroup>
        </div>

        <div className={styles.list} ref={listRef}>
          {messages.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIconWrap} aria-hidden="true">
                <Sparkle24Regular className={styles.emptyIcon} />
              </span>
              <Body1Strong>{t("ui.askAi.empty.title")}</Body1Strong>
              <Body1>{t("ui.askAi.empty.body")}</Body1>
              <div className={styles.examples}>
                {examples.map((ex, i) => (
                  <Button
                    key={i}
                    appearance="outline"
                    className={styles.example}
                    onClick={() => void sendDirect(ex)}
                  >
                    {ex}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <MessageView key={i} message={m} loading={loading && i === messages.length - 1} />
            ))
          )}
          {error && <Text className={mergeClasses(styles.bubble, styles.error)}>{error}</Text>}
        </div>

        {/* Streaming affordance: a labelled "Stop generating" pill that's
            far more discoverable than swapping the send icon. Visible only
            while the model is producing tokens; abort cleans up the SSE
            stream and resolves loading. */}
        {loading && (
          <div className={styles.stopRow}>
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
            <Button
              appearance="outline"
              icon={<Stop24Filled />}
              onClick={stopGeneration}
              className={styles.stopBtn}
            >
              {t("ui.askAi.stop")}
            </Button>
          </div>
        )}

        <div ref={turnstileHostRef} className={styles.turnstileSlot} aria-hidden="true" />

        <div className={styles.disclaimer}>
          <Caption1>{t("ui.askAi.disclaimer")}</Caption1>
        </div>

        <div className={styles.composer}>
          <Textarea
            ref={textareaRef}
            className={styles.textarea}
            value={input}
            onChange={(_, v) => setInput(v.value)}
            onKeyDown={onKeyDown}
            placeholder={t("ui.askAi.placeholder")}
            resize="vertical"
            rows={2}
            disabled={loading}
          />
          <Button
            appearance="primary"
            icon={<Send24Filled />}
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            aria-label={t("ui.askAi.send")}
          />
        </div>
      </DrawerBody>
    </Drawer>
  );
}

// Site-aware example prompts shown on the empty state. Derived from the
// configured repos so the buttons read like genuine starting points instead
// of generic placeholders.
function buildExamples(config: {
  site: { title: string; homepageRepo: string };
  repos: Array<{
    slug: string;
    displayName: string;
    description?: string;
    excludeFromSearch?: boolean;
  }>;
}): string[] {
  const home = config.repos.find((r) => r.slug === config.site.homepageRepo);
  const realRepos = config.repos.filter(
    (r) => r.slug !== config.site.homepageRepo && !r.excludeFromSearch,
  );
  const out: string[] = [];
  out.push(`What is ${config.site.title} about?`);
  if (home) out.push(`How do I get started with ${home.displayName}?`);
  if (realRepos[0]) out.push(`Show me what's in ${realRepos[0].displayName}.`);
  return out;
}

// --- History menu --------------------------------------------------------

function HistoryMenu({
  sessions,
  activeId,
  onPick,
  onClearAll,
  locale,
}: {
  sessions: StoredSession[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClearAll: () => void;
  locale: string;
}) {
  const { t } = useVellum();
  // Sorted newest-first so the most recently touched conversation sits on
  // top — matches how every other chat UI orders its sidebar.
  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const hasSessions = ordered.length > 0;
  // Local state for the confirmation Dialog so the destructive "Clear all"
  // action goes through a FluentUI dialog rather than the OS confirm()
  // prompt. The Menu closes as soon as the visitor picks the item; the
  // Dialog opens afterwards via this flag.
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Tooltip content={t("ui.askAi.history")} relationship="label">
            <Button
              appearance="subtle"
              icon={<History24Regular />}
              aria-label={t("ui.askAi.history")}
              disabled={!hasSessions}
            />
          </Tooltip>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {ordered.map((s) => (
              <MenuItem
                key={s.id}
                icon={s.id === activeId ? <Checkmark16Regular /> : undefined}
                onClick={() => onPick(s.id)}
                secondaryContent={relativeTime(s.updatedAt, locale)}
              >
                {s.title}
              </MenuItem>
            ))}
            <MenuDivider />
            <MenuItem icon={<Delete20Regular />} onClick={() => setConfirmOpen(true)}>
              {t("ui.askAi.clearHistory")}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>

      <Dialog modalType="alert" open={confirmOpen} onOpenChange={(_, d) => setConfirmOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("ui.askAi.clearHistory")}</DialogTitle>
            <DialogContent>{t("ui.askAi.clearHistory.confirm")}</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setConfirmOpen(false)}>
                {t("ui.askAi.cancel")}
              </Button>
              <Button
                appearance="primary"
                icon={<Delete20Regular />}
                onClick={() => {
                  onClearAll();
                  setConfirmOpen(false);
                }}
              >
                {t("ui.askAi.clearHistory")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}

// --- Message view ---------------------------------------------------------

function MessageView({ message, loading }: { message: ChatMessage; loading: boolean }) {
  const styles = useStyles();
  const { t } = useVellum();
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!message.content) return;
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={mergeClasses(
        styles.row,
        styles.rowHover,
        isUser ? styles.rowUser : styles.rowAssistant,
      )}
    >
      {/* Icon-only avatars. FluentUI's Avatar prefers initials over the
          icon slot when `name` is also passed, so we omit name entirely
          and rely on the icon + aria-hidden (the role is already
          conveyed by the bubble alignment and tooltips on the actions). */}
      <Avatar
        className={styles.avatar}
        size={28}
        color={isUser ? "neutral" : "brand"}
        icon={isUser ? <Person24Regular /> : <Sparkle24Regular />}
        aria-hidden="true"
      />
      <div className={styles.bubbleCol}>
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className={styles.toolChips}>
            {message.toolCalls.map((call, i) => (
              <Badge
                key={i}
                appearance={call.summary ? "outline" : "tint"}
                color={call.summary ? "informative" : "brand"}
                shape="rounded"
                size="medium"
                icon={call.summary ? <Checkmark16Regular /> : <Wrench24Regular />}
              >
                {call.summary ?? `${call.name}${call.args ? `(${shortArgs(call.args)})` : ""}`}
              </Badge>
            ))}
          </div>
        )}
        <div className={mergeClasses(styles.bubble, isUser ? styles.user : styles.assistant)}>
          {isUser ? (
            <Text>{message.content}</Text>
          ) : message.content ? (
            // Assistant text is rendered as markdown so [Title](/repo/page)
            // citations become real links and **emphasis** doesn't show as
            // literal asterisks. The streaming caret lives inside the
            // renderer so it sits flush with the last token.
            <AiMarkdown source={message.content} streaming={loading} />
          ) : loading && message.toolCalls?.every((c) => c.summary) ? (
            // Tool round finished, model is composing the answer — show the
            // caret so the visitor sees something is happening.
            <span className={styles.cursor} aria-hidden="true" />
          ) : !loading ? (
            <Text italic>{t("ui.askAi.empty.body")}</Text>
          ) : null}
        </div>
        {/* Per-message actions revealed on hover. Only shown for completed
            messages with actual content — there's nothing to copy from the
            empty placeholder of a streaming assistant turn. */}
        {message.content && !loading && (
          <div className={styles.messageActions} data-msg-actions="">
            <Tooltip content={copied ? t("ui.copied") : t("ui.copy")} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={copied ? <Checkmark16Regular /> : <Copy20Regular />}
                onClick={copy}
                aria-label={t("ui.copy")}
              />
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}

function shortArgs(args: Record<string, unknown>): string {
  // One-line summary of tool arguments for the chip label.
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (parts.length >= 2) {
      parts.push("…");
      break;
    }
    const str = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
    parts.push(`${k}: ${str.length > 24 ? str.slice(0, 24) + "…" : str}`);
  }
  return parts.join(", ");
}

// --- SSE stream parser (same shape as AISummary's) ------------------------

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
        // ignore
      }
      onEvent({ event, data: parsed });
    }
  }
}
