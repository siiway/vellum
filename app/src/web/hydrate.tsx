// Client entry: hydrate the pre-rendered page. Its payload isn't in the HTML:
// the build writes it next to the page as JSON, and the page's head preloads
// it. That leaves out the content the HTML holds, which the client takes
// from the page.

import { hydrateRoot } from "react-dom/client";
import { RendererProvider, createDOMRenderer, SSRProvider } from "@fluentui/react-components";
import { App } from "./App";
import { registerTools } from "./webmcp";
import { fillFromPage } from "./prerendered";
import { PAYLOAD_LINK_ID } from "../shared/paths";
import type { BootstrapPayload } from "../shared/types";

async function loadPayload(): Promise<BootstrapPayload> {
  const link = document.getElementById(PAYLOAD_LINK_ID) as HTMLLinkElement | null;
  if (!link) throw new Error("the page links no payload");
  // The same request as the preload, so the browser answers it from there.
  const res = await fetch(link.href);
  if (!res.ok) throw new Error(`${link.href}: HTTP ${res.status}`);
  return (await res.json()) as BootstrapPayload;
}

async function start(): Promise<void> {
  const container = document.getElementById("vellum-root");
  if (!container) return;
  const data = await loadPayload();
  fillFromPage(data.page.ast);
  hydrateRoot(
    container,
    <RendererProvider renderer={createDOMRenderer(document)}>
      <SSRProvider>
        <App data={data} />
      </SSRProvider>
    </RendererProvider>,
  );
  void registerTools(data.config);
}

// Without its payload the page stays as the build rendered it: readable, with
// links that load like on any static page.
start().catch((e) => console.error("[vellum] could not load the page's payload", e));
