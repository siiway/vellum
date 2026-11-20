// The `vellum` module a repo's React component imports (src/build/react.ts):
// `import { usePage } from "vellum"`.

import { useVellum } from "./context";
import { normalizeHex } from "./theme";

// The page the component is on, and its theme.
export function usePage() {
  const { data, theme } = useVellum();
  const { meta } = data.page;
  return {
    lang: data.route.localeCode,
    isDark: theme === "dark",
    // The site's accent colour, `#rrggbb`.
    accent: normalizeHex(data.config.site.themeColor),
    path: data.route.canonicalUrl,
    title: meta.title,
    description: meta.description ?? "",
    frontmatter: meta.frontmatter,
  };
}
