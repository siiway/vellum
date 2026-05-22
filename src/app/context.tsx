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
import { t as translate, type MessageKey } from "../shared/i18n";

// useLayoutEffect on the server logs a warning and runs nothing. We need its sync
// "after commit, before paint" semantics on the client (so a hash-scroll happens
// before the browser paints stale scroll position), but on the server we fall
// back to useEffect — which is a no-op during renderToString and avoids the warning.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface VellumContextValue {
  data: BootstrapPayload;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  // Client-side navigation. Returns a promise that resolves once the page swap is complete.
  navigate: (href: string, opts?: { replace?: boolean; scrollTo?: string | null }) => Promise<void>;
  isNavigating: boolean;
  // Translate a UI string using the current route's locale.
  t: (key: MessageKey, fallback?: string) => string;
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
  // Prefer the value the head pre-script wrote onto <html data-theme>; it already
  // resolved cookie -> prefers-color-scheme before paint. Fall back to whatever the
  // server picked (SSR, no DOM available).
  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    if (typeof document !== "undefined") {
      const t = document.documentElement.dataset.theme;
      if (t === "light" || t === "dark") return t;
    }
    return initial.initialTheme;
  });
  const [isNavigating, setNavigating] = useState(false);
  const lastFetch = useRef<AbortController | null>(null);
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

  const setTheme = useCallback((t: "light" | "dark") => {
    // Apply DOM side effects FIRST so the html[data-theme] CSS rules (page bg,
    // Shiki palette) flip in the same frame as the click. setThemeState then
    // schedules the React re-render that swaps FluentProvider's theme; doing
    // the DOM updates before the React commit avoids a window where the user
    // sees a partial swap and clicks again thinking nothing happened.
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = t;
      document.cookie = `vellum-theme=${t}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    }
    setThemeState(t);
  }, []);

  // Track OS-level theme changes when the user hasn't explicitly chosen one
  // (i.e. no vellum-theme cookie). The head pre-script picks the initial value;
  // this listener keeps the page in sync if the OS toggles light/dark mid-session.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (/(?:^|; )vellum-theme=/.test(document.cookie)) return;
      const next = e.matches ? "dark" : "light";
      setThemeState(next);
      document.documentElement.dataset.theme = next;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
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
      const url = new URL(href, window.location.href);

      // If we already have this page's payload rendered, treat it as in-page nav:
      // jump to hash, optionally update history, but don't refetch.
      const sameAsRendered =
        url.pathname === renderedRef.current.pathname && url.search === renderedRef.current.search;
      if (sameAsRendered) {
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
        const dataUrl = new URL(url.toString());
        dataUrl.searchParams.set("_data", "1");
        const res = await fetch(dataUrl.toString(), {
          signal: ac.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          // Fallback: hard-load the URL.
          window.location.href = url.toString();
          return;
        }
        const payload = (await res.json()) as BootstrapPayload;
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
      const el = document.getElementById(slug);
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
      let el: HTMLElement | null = e.target as HTMLElement;
      while (el && el !== document.body) {
        if (el.tagName === "A") break;
        el = el.parentElement;
      }
      if (!el || el.tagName !== "A") return;
      const anchor = el as HTMLAnchorElement;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // Skip if user marked it as non-routed, opens new tab, or downloads.
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.dataset.noRouter === "true") return;

      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Skip API + asset paths.
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/assets/")) return;

      e.preventDefault();
      navigate(url.toString());
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [navigate]);

  const locale = data.route.localeCode;
  const tFn = useCallback(
    (key: MessageKey, fallback?: string) => translate(locale, key, fallback),
    [locale],
  );

  const value = useMemo<VellumContextValue>(
    () => ({ data, theme, setTheme, navigate, isNavigating, t: tFn }),
    [data, theme, setTheme, navigate, isNavigating, tFn],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function scrollToHash(slug: string) {
  const target = document.getElementById(slug);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

export function useVellum(): VellumContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("VellumProvider missing");
  return v;
}
