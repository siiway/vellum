// Mounts Vue components used inside markdown docs.
// We rewrite `<ComponentName />` HTML tags into `<div data-vue-island="Name">`
// placeholders during render; this component scans for those placeholders after
// each page render and lazy-loads vue + vue3-sfc-loader to mount the SFC.
//
// Mounting happens in a separate Vue app per island so component state stays
// isolated. The `vitepress` module is shimmed with a `useData()` that returns
// the current locale so existing VitePress components keep working.

import { useEffect, useRef } from "react";
import { useVellum } from "../context";

interface MountedIsland {
  el: HTMLElement;
  appPromise: Promise<{ unmount: () => void } | null>;
}

export function VueIslands() {
  const { data, theme } = useVellum();
  const mountedRef = useRef<MountedIsland[]>([]);
  const components = data.repoComponents ?? [];
  const repoSlug = data.route.repoSlug;
  const locale = data.route.localeCode;

  useEffect(() => {
    // Nothing to do if the page can't have islands.
    if (components.length === 0) return;

    let cancelled = false;

    (async () => {
      const placeholders = Array.from(
        document.querySelectorAll<HTMLElement>("[data-vue-island]"),
      ).filter((el) => !el.dataset.vueMounted);
      if (placeholders.length === 0) return;

      // Lazy-load the heavy Vue + loader bundle only when a page actually
      // contains an island. Subsequent pages reuse the cached modules.
      const [vueMod, loaderMod] = await Promise.all([
        import("vue"),
        // @ts-expect-error - vue3-sfc-loader ships types under a path the
        // package.json `exports` field doesn't surface.
        import("vue3-sfc-loader"),
      ]);
      if (cancelled) return;

      const { createApp, h, ref } = vueMod;
      const { loadModule } = loaderMod;

      // Shim for `import { useData } from "vitepress"`. Returns the bits Vue
      // components commonly need; expand if components reach for more.
      const vitepressShim = {
        useData: () => ({
          lang: ref(locale),
          // Approximate site/theme reactive — read-only refs are fine for most uses.
          isDark: ref(theme === "dark"),
          site: ref({ base: `/${repoSlug}/`, lang: locale }),
          theme: ref({}),
          page: ref({}),
          frontmatter: ref(data.page.meta.frontmatter ?? {}),
          title: ref(data.page.meta.title ?? ""),
          description: ref(data.page.meta.description ?? ""),
        }),
        useRoute: () => ({ path: data.route.canonicalUrl, data: {} }),
      };

      const options = {
        moduleCache: {
          vue: vueMod,
          vitepress: vitepressShim,
        },
        async getFile(url: string) {
          // The path is the repo-rooted file path; route it via our worker proxy
          // so the same auth + caching apply.
          const proxied = `/api/vue?repo=${encodeURIComponent(repoSlug)}&path=${encodeURIComponent(url)}`;
          const res = await fetch(proxied);
          if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
          return await res.text();
        },
        addStyle(textContent: string) {
          // Append the SFC's <style> to <head>. Scoped styles are already
          // attribute-scoped by the loader.
          const style = document.createElement("style");
          style.setAttribute("data-vue-island-style", "");
          style.textContent = textContent;
          document.head.appendChild(style);
        },
        log(type: string, ...args: unknown[]) {
          if (type === "info") return;
          (console as unknown as Record<string, (...a: unknown[]) => void>)[type]?.(...args);
        },
      };

      for (const el of placeholders) {
        const name = el.dataset.vueIsland!;
        const ref = components.find((c) => c.name === name);
        if (!ref) continue;
        // Mark before awaiting so we don't double-mount.
        el.dataset.vueMounted = "1";

        const appPromise = (async () => {
          try {
            const propsJson = el.dataset.vueProps;
            const props = propsJson ? JSON.parse(decodeURIComponent(propsJson)) : {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const Component = await loadModule(ref.path, options as any);
            // Clear placeholder content (e.g. literal text from the original tag).
            el.textContent = "";
            const app = createApp({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              render: () => h(Component as any, props as Record<string, unknown>),
            });
            app.mount(el);
            return app;
          } catch (e) {
            console.error(`[vellum] Failed to mount Vue component <${name} />`, e);
            el.innerHTML = `<div style="padding:12px;border:1px solid #c50;border-radius:6px;color:#c50;font-family:monospace;font-size:12px">Failed to load Vue component &lt;${name} /&gt;: ${escape((e as Error).message ?? String(e))}</div>`;
            return null;
          }
        })();
        mountedRef.current.push({ el, appPromise });
      }
    })();

    return () => {
      cancelled = true;
      // Tear down everything we mounted on this page so the next page starts
      // clean — Vue's reactivity outlives the DOM node otherwise.
      const islands = mountedRef.current;
      mountedRef.current = [];
      for (const m of islands) {
        m.appPromise.then((app) => app?.unmount()).catch(() => {});
        delete m.el.dataset.vueMounted;
      }
      // Also drop any per-island styles we appended.
      document.querySelectorAll("[data-vue-island-style]").forEach((s) => s.remove());
    };
    // `data.page` changes drive remounts after client-side navigations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.page, theme, locale, components.length]);

  return null;
}

function escape(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// Rewrites markdown HTML so registered Vue tags become mountable placeholders.
// Handles both `<Name ... />` (self-closing) and `<Name ...>...</Name>` forms.
// Attribute values become JSON-encoded props on the placeholder.
// eslint-disable-next-line react-refresh/only-export-components
export function rewriteVueTags(html: string, components: { name: string }[]): string {
  if (components.length === 0) return html;
  let out = html;
  for (const c of components) {
    const escName = c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Self-closing: <Name ... />
    const selfClose = new RegExp(`<${escName}\\b([^>]*?)\\s*/>`, "g");
    out = out.replace(selfClose, (_, attrs) => placeholder(c.name, attrs ?? ""));
    // Paired: <Name ...>children</Name>. Greedy match limited per-component.
    const paired = new RegExp(`<${escName}\\b([^>]*)>([\\s\\S]*?)</${escName}>`, "g");
    out = out.replace(paired, (_, attrs) => placeholder(c.name, attrs ?? ""));
  }
  return out;
}

function placeholder(name: string, attrsSrc: string): string {
  const props = parseAttrs(attrsSrc);
  const propsAttr = Object.keys(props).length
    ? ` data-vue-props="${encodeURIComponent(JSON.stringify(props))}"`
    : "";
  return `<div data-vue-island="${escape(name)}"${propsAttr}></div>`;
}

function parseAttrs(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Match name="value", name='value', name=value (unquoted), or bare name.
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const key = m[1]!;
    const value = m[2] ?? m[3] ?? m[4];
    if (value === undefined) {
      out[key] = true;
    } else {
      // Try to JSON-parse numbers / booleans; otherwise keep as string.
      if (/^-?\d+(\.\d+)?$/.test(value)) out[key] = Number(value);
      else if (value === "true") out[key] = true;
      else if (value === "false") out[key] = false;
      else out[key] = value;
    }
  }
  return out;
}
