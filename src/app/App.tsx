import { FluentProvider } from "@fluentui/react-components";
import { VellumProvider, useVellum } from "./context";
import { Layout } from "./components/Layout";
import { ErrorPage } from "./components/ErrorPage";
import { vellumDarkTheme, vellumLightTheme } from "./theme";
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
      theme={theme === "dark" ? vellumDarkTheme : vellumLightTheme}
      style={{ minHeight: "100vh", width: "100%" }}
    >
      {data.error ? <ErrorPage error={data.error} /> : <Layout />}
    </FluentProvider>
  );
}
