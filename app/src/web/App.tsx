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
      // key={theme} forces FluentProvider to remount when the theme flips.
      // Without it FluentProvider was occasionally holding onto stale CSS
      // variables from the previous theme, which produced a "click twice to
      // actually switch" symptom (the cookie + data-theme updated on the first
      // click, but FluentUI tokens stayed on the old theme until something
      // else caused a re-render). Remounting on theme change is cheap relative
      // to the visual correctness it buys.
      key={theme}
      theme={fluentTheme}
      style={{ minHeight: "100vh", width: "100%", background: "var(--vellum-canvas)" }}
    >
      {data.error ? <ErrorPage error={data.error} /> : <Layout />}
    </FluentProvider>
  );
}
