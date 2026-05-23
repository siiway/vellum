import { Display, Body1, tokens } from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useState, useEffect, lazy, Suspense } from "react";
import { useVellum } from "../context";
import { NavBar } from "./NavBar";
import { Sidebar } from "./Sidebar";
import { Outline } from "./Outline";
import { MarkdownAst } from "./MarkdownAst";
import { PageFooter } from "./PageFooter";
import { LoadingBar } from "./LoadingBar";
import { VueIslands } from "./VueIslands";
import { SearchPage } from "./SearchPage";
import { HomeLayout } from "./HomeLayout";
import { MSLearnHome } from "./MSLearnHome";
import { AISummary } from "./AISummary";
import { AskAI } from "./AskAI";

// SearchDialog stays lazy because it's only mounted after the user opens search
// (Ctrl+K / "/"), so its chunk is never SSRed and the Suspense boundary lives
// purely on the client.
//
// HomeLayout and SearchPage are imported eagerly. They render under Suspense
// boundaries during SSR, and React 18's renderToString + lazy combo is fragile:
// when a client revisits a cached HTML page after the chunk hash has rotated,
// the lazy import 404s, the Suspense boundary fails to hydrate, and the user
// sees a runtime "Switched to client rendering" error (React #419). Bundling
// these into the main entry trades a small JS size win for a reliable SSR path.
const SearchDialog = lazy(() =>
  import("./SearchDialog").then((m) => ({ default: m.SearchDialog })),
);

const useStyles = makeStyles({
  shell: {
    minHeight: "100vh",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 300px) minmax(0, 1fr) minmax(220px, 260px)",
    "@media (max-width: 1200px)": {
      gridTemplateColumns: "minmax(260px, 300px) minmax(0, 1fr)",
    },
    "@media (max-width: 960px)": { gridTemplateColumns: "1fr" },
  },
  main: {
    paddingInline: tokens.spacingHorizontalXXXL,
    paddingBlock: tokens.spacingVerticalXXL,
    minWidth: 0,
    maxWidth: "100%",
    "@media (max-width: 720px)": {
      paddingInline: tokens.spacingHorizontalL,
      paddingBlock: tokens.spacingVerticalL,
    },
  },
  article: {
    maxWidth: "780px",
    marginInline: "auto",
  },
  hero: {
    marginBottom: tokens.spacingVerticalXXL,
  },
  title: {
    display: "block",
    letterSpacing: "-0.025em",
    lineHeight: 1.1,
    marginBlock: 0,
  },
  description: {
    display: "block",
    color: tokens.colorNeutralForeground2,
    marginTop: tokens.spacingVerticalM,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
  },
});

export function Layout() {
  const styles = useStyles();
  const { data, t } = useVellum();
  const [searchOpen, setSearchOpen] = useState(false);
  const [askAiOpen, setAskAiOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      } else if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { page, sidebar, config } = data;
  const outlineLabel = t("ui.outline");
  const layoutKind = page.meta.frontmatter?.layout;
  const isHome = layoutKind === "home";
  const isSearch = layoutKind === "search";
  const isMsLearn = layoutKind === "ms-learn";

  return (
    <div className={styles.shell}>
      <LoadingBar />
      <NavBar
        onOpenSearch={() => setSearchOpen(true)}
        // Hide the Ask AI button on landing-page layouts (home, ms-learn) —
        // those pages are summaries / hero content, not where readers ask
        // detailed questions. NavBar drops the button when this is
        // undefined.
        onOpenAskAi={isHome || isMsLearn ? undefined : () => setAskAiOpen(true)}
      />
      {isSearch ? (
        // Full-page cross-repo search. The component owns its own URL state
        // (?q=, ?repo=) and uses /api/search?repo=* under the hood. Imported
        // eagerly (not lazy) so any SSR error surfaces in the worker logs.
        <SearchPage />
      ) : isMsLearn ? (
        // Microsoft Learn-style landing page: hero with search + product/role
        // grids declared via structured frontmatter, then the markdown body
        // (which can use any registered React component).
        <MSLearnHome />
      ) : isHome ? (
        // Hero-style landing page: full-width, no sidebar/outline. HomeLayout
        // renders its own minimal footer so the divider+content stay inside the
        // 1200px container instead of bleeding to the viewport edges.
        <HomeLayout />
      ) : (
        <div className={`${styles.grid} vellum-grid`}>
          <Sidebar groups={sidebar} />
          <main className={styles.main}>
            <article className={styles.article}>
              {page.meta.title && (
                <header className={styles.hero}>
                  <Display as="h1" className={styles.title}>
                    {page.meta.title}
                  </Display>
                  {page.meta.description && (
                    <Body1 as="p" className={styles.description}>
                      {page.meta.description}
                    </Body1>
                  )}
                </header>
              )}
              <AISummary />
              <MarkdownAst ast={page.ast} />
              <PageFooter meta={page.meta} siteFooter={config.site.footer} />
            </article>
          </main>
          <Outline nodes={page.meta.outline} label={outlineLabel} />
        </div>
      )}
      {searchOpen && (
        <Suspense fallback={null}>
          <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
        </Suspense>
      )}
      <AskAI open={askAiOpen} onOpenChange={setAskAiOpen} />
      <VueIslands />
    </div>
  );
}
