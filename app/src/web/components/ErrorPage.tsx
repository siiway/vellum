// Full-page error, laid out like Prism's StatusPage: one bordered card on the
// canvas with the status code, a title, a line of explanation and where to go
// next.

import { Button, Image, Link, Text, Title2, tokens } from "@fluentui/react-components";
import {
  ChevronRight16Regular,
  Home20Regular,
  ArrowLeft20Regular,
  Search20Regular,
} from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import type { ErrorState } from "../../shared/types";

const useStyles = makeStyles({
  root: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    boxSizing: "border-box",
    background: "var(--vellum-canvas)",
  },
  card: {
    width: "100%",
    maxWidth: "520px",
    padding: "48px 40px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    textAlign: "center",
    boxSizing: "border-box",
    "@media (max-width: 540px)": { padding: "32px 20px" },
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  logo: { borderRadius: "6px" },
  status: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "72px",
    lineHeight: 1,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "-2px",
    color: tokens.colorBrandForeground1,
  },
  title: { margin: 0 },
  message: {
    color: tokens.colorNeutralForeground3,
  },
  hint: {
    alignSelf: "stretch",
    textAlign: "left",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "10px 12px",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    overflowX: "auto",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "8px",
    marginTop: "8px",
  },
  suggestions: {
    alignSelf: "stretch",
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    paddingTop: "16px",
    marginTop: "8px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    textAlign: "left",
  },
  suggestionsLabel: {
    padding: "0 10px 6px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  suggestionRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "32px",
    padding: "0 10px",
    borderRadius: tokens.borderRadiusMedium,
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    textDecoration: "none",
    "& svg": { color: tokens.colorNeutralForeground3, flexShrink: 0 },
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
      textDecoration: "none",
    },
  },
});

export function ErrorPage({ error }: { error: ErrorState }) {
  const styles = useStyles();
  const { data, t } = useVellum();
  const site = data.config.site;

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <div className={styles.brand}>
          {site.logo && (
            <Image src={site.logo} alt="" width={20} height={20} className={styles.logo} />
          )}
          <span>{site.title}</span>
        </div>

        <Text as="span" className={styles.status}>
          {error.status}
        </Text>
        <Title2 as="h1" className={styles.title}>
          {error.title}
        </Title2>
        <Text className={styles.message}>{error.message}</Text>

        {error.hint && <div className={styles.hint}>{error.hint}</div>}

        <div className={styles.actions}>
          <Button icon={<ArrowLeft20Regular />} onClick={() => window.history.back()}>
            {t("ui.notFound.back")}
          </Button>
          <Button
            icon={<Search20Regular />}
            onClick={() =>
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
            }
          >
            {t("ui.notFound.search")}
          </Button>
          <Button appearance="primary" icon={<Home20Regular />} as="a" href="/">
            {t("ui.notFound.home")}
          </Button>
        </div>

        {error.suggestions && error.suggestions.length > 0 && (
          <div className={styles.suggestions}>
            <div className={styles.suggestionsLabel}>{t("ui.notFound.suggestions")}</div>
            {error.suggestions.map((s) => (
              <Link key={s.link} href={s.link} className={styles.suggestionRow}>
                <ChevronRight16Regular />
                <span>{s.text}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
