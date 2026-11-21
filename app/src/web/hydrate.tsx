// Client entry: hydrate the pre-rendered page. Its payload isn't in the HTML:
// the build writes it next to the page as JSON, and the page's head preloads
// it. That leaves out the content the HTML holds, which the client takes
// from the page.

import { createRoot, hydrateRoot } from "react-dom/client";
import { RendererProvider, createDOMRenderer, SSRProvider } from "@fluentui/react-components";
import { App } from "./App";
import { registerTools } from "./webmcp";
import { fillFromPage } from "./prerendered";
import { preloadComponents } from "./reactComponents";
import { loadRepoComponents } from "./repoComponents";
import { componentNames } from "../shared/markdown";
import { PAYLOAD_LINK_ID, payloadPath } from "../shared/paths";
import type { BootstrapPayload } from "../shared/types";

async function fetchPayload(url: string): Promise<BootstrapPayload> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as BootstrapPayload;
}

function app(data: BootstrapPayload) {
  return (
    <RendererProvider renderer={createDOMRenderer(document)}>
      <SSRProvider>
        <App data={data} />
      </SSRProvider>
    </RendererProvider>
  );
}

async function start(): Promise<void> {
  const container = document.getElementById("vellum-root");
  const link = document.getElementById(PAYLOAD_LINK_ID) as HTMLLinkElement | null;
  if (!container || !link) return;
  // The same request as the preload, so the browser answers it from there.
  const payload = await fetchPayload(link.href).catch((e: unknown) => {
    console.warn("[vellum] could not load the page's payload", e);
    return null;
  });
  if (payload && payload.build === link.dataset.build) {
    if (fillFromPage(payload.page.ast)) {
      // The components the page shows, so none suspends while it hydrates:
      // an update that reached one then (the reader's theme) would throw its
      // pre-rendered HTML away. The registry's lazy ones, and the repo's
      // own, from what the head preloads.
      const [, repo] = await Promise.allSettled([
        preloadComponents(componentNames(payload.page.ast)).catch((e: unknown) =>
          console.warn("[vellum] could not load the page's components", e),
        ),
        loadRepoComponents(payload),
      ]);
      if (repo.status === "fulfilled") {
        hydrateRoot(container, app(payload));
        void registerTools(payload.config);
        return;
      }
      console.warn("[vellum] could not load the repo's components", repo.reason);
    } else {
      console.warn("[vellum] the page lacks content its payload leaves out");
    }
  }
  // The page is from another build than its payload (the browser kept it
  // from before a deploy), the payload didn't load, the page lacks what the
  // payload leaves out, or a component it shows didn't load. Render the
  // page's full payload instead, which needs nothing from the page, and
  // shows a component that doesn't load as failed.
  const full = await fetchPayload(payloadPath(location.pathname));
  createRoot(container).render(app(full));
  void registerTools(full.config);
}

// Without a payload the page stays as the build rendered it: readable, with
// links that load like on any static page.
//
// Once a window. A newer build's engine, which a tab kept from before a
// deploy can still load for a page it renders, imports this module too, its
// own copy: that one mustn't start a second app over this one.
const STARTED = Symbol.for("vellum.started");
const started = window as unknown as Record<symbol, boolean>;
if (!started[STARTED]) {
  started[STARTED] = true;
  start().catch((e) => console.error("[vellum] could not load the page's payload", e));
}
