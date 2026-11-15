// Stands in for browser-only packages in the Worker bundle (the `alias` block
// in wrangler.jsonc). The client components that load them (MermaidBlock,
// VueIslands) do so from effects, which never run during SSR, so the Worker
// doesn't need the megabytes of code they'd add to every cold start. Any use
// here is a bug, and fails loudly.

function unavailable(): never {
  throw new Error("[vellum] a browser-only package was called in the Worker");
}

const stub: Record<string, unknown> = new Proxy({}, { get: () => unavailable });

export default stub;
