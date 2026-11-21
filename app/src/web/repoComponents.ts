// Loads a repo's React components (src/build/react.ts) for RepoComponent.tsx.
// A page's payload names, for each it uses, the component's module, the
// chunks that imports, the engine's modules those import and its
// stylesheets. The head of a page loaded with one already preloads and links
// them; after a client-side navigation they're loaded here, all at once
// rather than each after what imports it.
//
// In the build, which renders the components into pages, provideComponent
// gives them instead.

import { lazy, type ComponentType } from "react";
import type { BootstrapPayload, ReactComponentFiles } from "../shared/types";

type Props = Record<string, unknown>;

export interface LoadingComponent {
  // The component, once it has loaded.
  loaded: ComponentType<Props> | null;
  // Suspends until it has, then renders it.
  lazy: ComponentType<Props>;
  loading: Promise<ComponentType<Props>>;
}

// By the module's URL: a component loads once, and stays the same type.
const components = new Map<string, LoadingComponent>();

export function loadComponent(files: ReactComponentFiles): LoadingComponent {
  const url = files.js[0]!;
  let component = components.get(url);
  if (!component) {
    if (typeof document === "undefined") throw new Error(`The build didn't import ${url}`);
    const entry = { loaded: null } as LoadingComponent;
    entry.loading = (async () => {
      for (const file of files.js) preloadModule(file);
      const [{ engine }] = await Promise.all([
        import("virtual:vellum-engine"),
        ...files.css.map(addStylesheet),
      ]);
      await Promise.all(files.engine.map((spec) => engine[spec]?.()));
      const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
      if (!mod.default) throw new Error(`${url} exports no component`);
      return (entry.loaded = mod.default as ComponentType<Props>);
    })();
    // Rendering it shows a failure; loading it ahead doesn't. The next page
    // that shows it tries again: a network error mustn't last till a reload.
    entry.loading.catch(() => {
      if (components.get(url) === entry) components.delete(url);
    });
    entry.lazy = lazy(() => entry.loading.then((c) => ({ default: c })));
    components.set(url, (component = entry));
  }
  return component;
}

// Loads the components a page uses. Rejects when one doesn't load.
export function loadRepoComponents(data: BootstrapPayload): Promise<unknown> {
  return Promise.all(
    Object.values(data.reactComponents ?? {}).map((files) => loadComponent(files).loading),
  );
}

// The build's copy of a component, which it imported to render pages with.
export function provideComponent(
  files: ReactComponentFiles,
  component: ComponentType<Props>,
): void {
  components.set(files.js[0]!, {
    loaded: component,
    lazy: component,
    loading: Promise.resolve(component),
  });
}

function headLink(rel: string, href: string): HTMLLinkElement | undefined {
  return [...document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`)].find(
    (link) => link.getAttribute("href") === href,
  );
}

function preloadModule(href: string): void {
  if (headLink("modulepreload", href)) return;
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = href;
  document.head.append(link);
}

const stylesheets = new Map<string, Promise<void>>();

// Resolves once the stylesheet applies, so the component doesn't show
// unstyled first, or failed to load.
function addStylesheet(href: string): Promise<void> {
  let added = stylesheets.get(href);
  if (!added) {
    // The page's own had loaded before any script ran.
    if (headLink("stylesheet", href)) added = Promise.resolve();
    else {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      added = new Promise((done) => {
        link.onload = link.onerror = () => done();
      });
      document.head.append(link);
    }
    stylesheets.set(href, added);
  }
  return added;
}
