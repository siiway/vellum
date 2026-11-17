import { FluentProvider } from "@fluentui/react-components";
import { useMemo } from "react";
import { VellumProvider, useVellum } from "./context";
import { Layout } from "./components/Layout";
import { ErrorPage } from "./components/ErrorPage";
import { createVellumTheme } from "./theme";
import type { BootstrapPayload } from "../shared/types";

export function App({ data }: { data: BootstrapPayload }) {
  return (
    <VellumProvider data={data}>
      <ThemedShell />
    </VellumProvider>
  );
}

function ThemedShell() {
  const { theme, data } = useVellum();
  const accent = data.config.site.themeColor;
  const fluentTheme = useMemo(() => createVellumTheme(theme === "dark", accent), [theme, accent]);
  return (
    <FluentProvider
      // Not remounted when the theme flips: its tokens follow <html
      // data-theme> through ssr.tsx's rule for the other theme, from the
      // first paint on, so none stay stale. A remount would render the page
      // again, from a payload without its content (fillFromPage).
      theme={fluentTheme}
      style={{ minHeight: "100vh", width: "100%", background: "var(--vellum-canvas)" }}
    >
      {data.error ? <ErrorPage error={data.error} /> : <Layout />}
    </FluentProvider>
  );
}
