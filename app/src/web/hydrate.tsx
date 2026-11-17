// Client entry: hydrate the pre-rendered page. Its payload isn't in the HTML:
// the build writes it next to the page as JSON, and the page's head preloads
// it. That leaves out the content the HTML holds, which the client takes
// from the page.

import { createRoot, hydrateRoot } from "react-dom/client";
import { RendererProvider, createDOMRenderer, SSRProvider } from "@fluentui/react-components";
import { App } from "./App";
import { registerTools } from "./webmcp";
import { fillFromPage } from "./prerendered";
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
    fillFromPage(payload.page.ast);
    hydrateRoot(container, app(payload));
    void registerTools(payload.config);
    return;
  }
  // The page is from another build than its payload (the browser kept it
  // from before a deploy), or the payload didn't load. Render the page's
  // full payload instead, which needs nothing from the page.
  const full = await fetchPayload(payloadPath(location.pathname));
  createRoot(container).render(app(full));
  void registerTools(full.config);
}

// Without a payload the page stays as the build rendered it: readable, with
// links that load like on any static page.
start().catch((e) => console.error("[vellum] could not load the page's payload", e));
