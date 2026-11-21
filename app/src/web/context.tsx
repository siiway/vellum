import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BootstrapPayload } from "../shared/types";
import { canonicalHref, payloadPath } from "../shared/paths";
import { t as translate, type MessageKey } from "../shared/i18n";

// useLayoutEffect on the server logs a warning and runs nothing. We need its sync
// "after commit, before paint" semantics on the client (so a hash-scroll happens
// before the browser paints stale scroll position), but on the server we fall
// back to useEffect — which is a no-op during renderToString and avoids the warning.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface VellumContextValue {
  data: BootstrapPayload;
  // Resolved scheme currently on screen.
  theme: "light" | "dark";
  // What the reader picked: an explicit scheme, or "system" to follow the OS.
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  // Client-side navigation. Returns a promise that resolves once the page swap is complete.
  navigate: (href: string, opts?: { replace?: boolean; scrollTo?: string | null }) => Promise<void>;
  isNavigating: boolean;
  // Translate a UI string using the current route's locale.
  t: (key: MessageKey, fallback?: string) => string;
}

export type ThemeMode = "system" | "light" | "dark";

const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Points the head's link to the page's Markdown, which the server wrote for
// the first page, at the page now shown, or removes it from a page without
// Markdown.
function setMarkdownLink(url: string | undefined): void {
  let link = document.head.querySelector<HTMLLinkElement>(
    'link[rel="alternate"][type="text/markdown"]',
  );
  if (!url) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "alternate";
    link.type = "text/markdown";
    document.head.append(link);
  }
  link.href = url;
}

function osPrefersDark(): boolean {
  return (
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

const Ctx = createContext<VellumContextValue | null>(null);

export function VellumProvider({
  data: initial,
  children,
}: {
  data: BootstrapPayload;
  children: ReactNode;
}) {
  const [data, setData] = useState<BootstrapPayload>(initial);
  // Hydrate in the theme the page was rendered in, so the markup matches, then
  // take the one the head pre-script put on <html data-theme> (cookie, else
  // OS). They differ on a first visit or after an OS theme switch. The page
  // CSS and FluentUI tokens already follow data-theme before this runs; the
  // switch only updates theme-dependent JS such as icons and mermaid SVGs.
  const [theme, setThemeState] = useState<"light" | "dark">(initial.initialTheme);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    if (t === "light" || t === "dark") setThemeState(t);
  }, []);
  const [isNavigating, setNavigating] = useState(false);
  const lastFetch = useRef<AbortController | null>(null);
  // The page on screen, for callbacks that outlive a render.
  const dataRef = useRef(initial);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  // Tracks the URL whose payload we currently have rendered.
  // On `popstate` the browser has *already* mutated window.location to the
  // destination URL before our listener fires, so we can't compare against
  // window.location to decide whether to refetch — we'd always early-return.
  // This ref is the source of truth for "what's actually on screen."
  const renderedRef = useRef<{ pathname: string; search: string }>(
    typeof window === "undefined"
      ? { pathname: "", search: "" }
      : { pathname: window.location.pathname, search: window.location.search },
  );

  // Scroll behavior across a cross-page navigation can't run inline after `setData`:
  // React hasn't committed the new DOM yet, so `getElementById(hash)` returns null.
  // We stash the intent here and a useLayoutEffect drains it once the payload is
  // committed and headings exist.
  type PendingScroll = { type: "hash"; slug: string } | { type: "top" } | null;
  const pendingScrollRef = useRef<PendingScroll>(null);
  const firstRenderRef = useRef(true);

  // The explicit `vellum-theme` cookie is the reader's choice; without it the
  // page follows the OS. Read on the client only: the mode is
  // shown inside a popover that isn't part of the SSR markup, so there is no
  // hydration mismatch.
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    if (typeof document === "undefined") return "system";
    const m = document.cookie.match(/(?:^|; )vellum-theme=(light|dark)/);
    return m ? (m[1] as "light" | "dark") : "system";
  });

  const setThemeMode = useCallback((mode: ThemeMode) => {
    // Apply DOM side effects FIRST so the html[data-theme] CSS rules (page bg,
    // Shiki palette) flip in the same frame as the click. setThemeState then
    // schedules the React re-render that swaps FluentProvider's theme; doing
    // the DOM updates before the React commit avoids a window where the user
    // sees a partial swap and clicks again thinking nothing happened.
    const next: "light" | "dark" = mode === "system" ? (osPrefersDark() ? "dark" : "light") : mode;
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
      if (mode === "system") {
        document.cookie = "vellum-theme=; path=/; max-age=0; samesite=lax";
      } else {
        document.cookie = `vellum-theme=${mode}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
      }
    }
    setThemeModeState(mode);
    setThemeState(next);
  }, []);

  // Track OS-level theme changes while following the system (no vellum-theme
  // cookie). The head pre-script picks the initial value; this listener keeps
  // the page in sync if the OS toggles light/dark mid-session.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (/(?:^|; )vellum-theme=(light|dark)/.test(document.cookie)) return;
      const next = e.matches ? "dark" : "light";
      setThemeState(next);
      document.documentElement.dataset.theme = next;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Payloads fetched ahead of a likely click (see the prefetch listeners
  // below), keyed by payload URL. navigate() takes one instead of fetching.
  const prefetches = useRef(
    new Map<string, { at: number; page: Promise<BootstrapPayload | null> }>(),
  );

  const isRendered = (url: URL) =>
    url.pathname === renderedRef.current.pathname && url.search === renderedRef.current.search;

  const prefetch = useCallback((link: URL) => {
    const url = canonicalUrl(link, dataRef.current);
    if (isRendered(url)) return;
    const key = payloadUrl(url);
    const now = Date.now();
    for (const [k, v] of prefetches.current) {
      if (now - v.at > PREFETCH_TTL_MS) prefetches.current.delete(k);
    }
    if (prefetches.current.has(key)) return;
    const page = fetchPage(key);
    // A failed prefetch is dropped; navigate() then fetches on its own.
    page.catch(() => prefetches.current.delete(key));
    prefetches.current.set(key, { at: now, page });
  }, []);

  const navigate = useCallback(
    async (
      href: string,
      opts: {
        replace?: boolean;
        scrollTo?: string | null;
        skipHistory?: boolean;
      } = {},
    ) => {
      // Links that would redirect (no locale, a short locale code, a repo's
      // landing page) go straight to their page, in the reader's locale.
      const url = canonicalUrl(new URL(href, window.location.href), dataRef.current);

      // If we already have this page's payload rendered, treat it as in-page nav:
      // jump to hash, optionally update history, but don't refetch.
      if (isRendered(url)) {
        // A click back to this page cancels a navigation still loading.
        if (lastFetch.current) {
          lastFetch.current.abort();
          lastFetch.current = null;
          setNavigating(false);
        }
        if (!opts.skipHistory) {
          history[opts.replace ? "replaceState" : "pushState"](null, "", url.toString());
        }
        if (url.hash) scrollToHash(url.hash.slice(1));
        return;
      }

      lastFetch.current?.abort();
      const ac = new AbortController();
      lastFetch.current = ac;
      setNavigating(true);
      try {
        const dataUrl = payloadUrl(url);
        const prefetched = prefetches.current.get(dataUrl);
        prefetches.current.delete(dataUrl);
        const payload =
          prefetched && Date.now() - prefetched.at <= PREFETCH_TTL_MS
            ? await prefetched.page
            : await fetchPage(dataUrl, ac.signal);
        // A later navigation took over while this one was loading.
        if (ac.signal.aborted) return;
        if (!payload) {
          // No payload: a redirect, a 404 or the root locale picker. Load
          // the URL itself so the browser gets the real response.
          window.location.href = url.toString();
          return;
        }
        // Keep current theme so the user's toggle survives navigation.
        payload.initialTheme = theme;
        // popstate already changed the URL for us - don't touch history there.
        if (!opts.skipHistory) {
          history[opts.replace ? "replaceState" : "pushState"](
            { vellum: true },
            "",
            url.toString(),
          );
        }
        // Queue the scroll BEFORE setData; the useLayoutEffect on `data` will
        // drain it as soon as React commits the new DOM (i.e. when the heading
        // for the hash actually exists).
        pendingScrollRef.current = url.hash
          ? { type: "hash", slug: url.hash.slice(1) }
          : { type: "top" };
        renderedRef.current = { pathname: url.pathname, search: url.search };
        setData(payload);
        // Update document title.
        document.title = payload.page.meta.title
          ? `${payload.page.meta.title} · ${payload.config.site.title}`
          : payload.config.site.title;
        setMarkdownLink(payload.page.meta.markdownUrl);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          window.location.href = url.toString();
        }
      } finally {
        if (lastFetch.current === ac) {
          setNavigating(false);
          lastFetch.current = null;
        }
      }
    },
    [theme],
  );

  // Wire up popstate so the browser back/forward buttons work. The browser has
  // already updated window.location; we just need to fetch the destination and
  // swap state. Pass skipHistory so we don't double-up on the history entry.
  useEffect(() => {
    function onPop() {
      navigate(window.location.href, { skipHistory: true });
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigate]);

  // Drain pending scroll once the new payload is in the DOM. Retries across a
  // few frames because:
  //   1. Async children (mermaid panes, code groups) may not have mounted yet.
  //   2. Layout shifts as fonts / images / Fluent styles settle would otherwise
  //      strand a smooth-scroll at a stale Y. Re-applying scrollIntoView each
  //      frame keeps us pinned to the heading's *current* position.
  useIsoLayoutEffect(() => {
    if (firstRenderRef.current) {
      // The SSR HTML already placed the user wherever the URL hash said; don't
      // fight the browser's native restoration on first hydrate.
      firstRenderRef.current = false;
      return;
    }
    const pending = pendingScrollRef.current;
    pendingScrollRef.current = null;
    if (!pending) return;

    if (pending.type === "top") {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      return;
    }

    const slug = pending.slug;
    let frame = 0;
    const maxFrames = 12;
    const tick = () => {
      const el = fragmentTarget(slug);
      if (el) {
        // Instant (not smooth): a cross-page jump should behave like the browser's
        // native hash navigation. Smooth scroll also locks its target Y at start,
        // so any layout shift afterwards leaves the user at the wrong spot.
        el.scrollIntoView({
          behavior: "instant" as ScrollBehavior,
          block: "start",
        });
      }
      if (frame++ < maxFrames) requestAnimationFrame(tick);
    };
    tick();
  }, [data]);

  // Intercept clicks on internal links anywhere in the document.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const url = routableLink(e.target);
      if (!url) return;
      e.preventDefault();
      navigate(url.toString());
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [navigate]);

  // Fetch a link's payload when the reader shows intent to follow it: a
  // pointer resting on it, a touch, or keyboard focus. The click then
  // renders from the prefetched payload instead of waiting on the network.
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    let timer: number | undefined;
    function onHover(e: Event) {
      window.clearTimeout(timer);
      const url = routableLink(e.target);
      // Skip links the pointer only passes over.
      if (url) timer = window.setTimeout(() => prefetch(url), PREFETCH_HOVER_MS);
    }
    function onIntent(e: Event) {
      const url = routableLink(e.target);
      if (url) prefetch(url);
    }
    document.addEventListener("pointerover", onHover);
    document.addEventListener("touchstart", onIntent, { passive: true });
    document.addEventListener("focusin", onIntent);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onHover);
      document.removeEventListener("touchstart", onIntent);
      document.removeEventListener("focusin", onIntent);
    };
  }, [prefetch]);

  const locale = data.route.localeCode;
  const tFn = useCallback(
    (key: MessageKey, fallback?: string) => translate(locale, key, fallback),
    [locale],
  );

  const value = useMemo<VellumContextValue>(
    () => ({ data, theme, themeMode, setThemeMode, navigate, isNavigating, t: tFn }),
    [data, theme, themeMode, setThemeMode, navigate, isNavigating, tFn],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// How long a prefetched payload may stand in for a fresh fetch.
const PREFETCH_TTL_MS = 30_000;
// How long the pointer rests on a link before its payload is prefetched.
const PREFETCH_HOVER_MS = 80;

// The canonical URL of an internal link (see canonicalHref).
function canonicalUrl(url: URL, data: BootstrapPayload): URL {
  const out = new URL(url);
  out.pathname = canonicalHref(url.pathname, data.config, data.route.localeCode);
  return out;
}

// The JSON payload URL for a page URL. The query string and hash don't
// change the payload.
function payloadUrl(url: URL): string {
  return new URL(payloadPath(url.pathname), url.origin).toString();
}

// The page's payload, or null when it has none (navigate() then hard-loads
// the page).
async function fetchPage(dataUrl: string, signal?: AbortSignal): Promise<BootstrapPayload | null> {
  const res = await fetch(dataUrl, { signal, headers: { accept: "application/json" } });
  return res.ok ? ((await res.json()) as BootstrapPayload) : null;
}

// The URL to navigate to client-side for an event on `target`, or null when
// it isn't on an internal page link and the browser should handle it.
function routableLink(target: EventTarget | null): URL | null {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body && el.tagName !== "A") el = el.parentElement;
  if (!el || el.tagName !== "A") return null;
  const anchor = el as HTMLAnchorElement;
  const href = anchor.getAttribute("href");
  if (!href) return null;
  // Skip if user marked it as non-routed, opens new tab, or downloads.
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.dataset.noRouter === "true") return null;

  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  // Skip build output that isn't a page.
  if (url.pathname.startsWith("/_vellum/") || url.pathname.startsWith("/assets/")) return null;
  return url;
}

function scrollToHash(fragment: string) {
  const target = fragmentTarget(fragment);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// The element a URL's fragment points to, found as the browser finds it: by
// the fragment as written, then decoded. URL.hash keeps anything but ASCII
// encoded, so the heading `安全` is `#%E5%AE%89%E5%85%A8` there.
function fragmentTarget(fragment: string): HTMLElement | null {
  const target = document.getElementById(fragment);
  if (target) return target;
  try {
    return document.getElementById(decodeURIComponent(fragment));
  } catch {
    // Not valid percent-encoding.
    return null;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function useVellum(): VellumContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("VellumProvider missing");
  return v;
}
