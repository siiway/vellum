// Client-side entry: hydrate the SSR'd shell with the bootstrap payload the worker injected.

import { hydrateRoot, createRoot } from "react-dom/client";
import { RendererProvider, createDOMRenderer, SSRProvider } from "@fluentui/react-components";
import { App } from "./App";
import type { BootstrapPayload } from "../shared/types";

function bootstrap(): BootstrapPayload | null {
  if (typeof window === "undefined") return null;
  const raw = window.__VELLUM__;
  if (raw) return raw;
  // Fallback: look for an embedded <script id="__VELLUM_DATA__"> tag.
  const tag = document.getElementById("__VELLUM_DATA__");
  if (tag?.textContent) {
    try {
      return JSON.parse(tag.textContent) as BootstrapPayload;
    } catch (e) {
      console.error("[vellum] failed to parse bootstrap payload", e);
    }
  }
  return null;
}

const data = bootstrap();
const container = document.getElementById("vellum-root");

if (data && container) {
  const renderer = createDOMRenderer(document);
  const tree = (
    <RendererProvider renderer={renderer}>
      <SSRProvider>
        <App data={data} />
      </SSRProvider>
    </RendererProvider>
  );

  // Use createRoot when no SSR content is present (e.g. dev mode), hydrateRoot otherwise.
  if (container.childElementCount === 0) {
    createRoot(container).render(tree);
  } else {
    hydrateRoot(container, tree);
  }
} else if (container) {
  container.innerHTML =
    '<p style="font-family: system-ui; padding: 2rem;">Bootstrap payload missing. Reload the page.</p>';
}
