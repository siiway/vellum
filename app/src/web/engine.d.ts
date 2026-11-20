// The engine's loaders (scripts/vite-engine.ts): one for each module a repo's
// React component can import from the page, by its specifier.
declare module "virtual:vellum-engine" {
  export const engine: Record<string, () => Promise<unknown>>;
}
