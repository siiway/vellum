import {
  Button,
  Caption1,
  Card,
  CardHeader,
  Display,
  Image,
  Link,
  Text,
  Title2,
  Body1,
  tokens,
} from "@fluentui/react-components";
import {
  ChevronRight24Regular,
  Home24Regular,
  ArrowLeft24Regular,
  DocumentSearch24Regular,
} from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import type { ErrorState } from "../../shared/types";

const useStyles = makeStyles({
  root: {
    minHeight: "calc(100vh - 60px)",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    placeItems: "center",
    paddingInline: tokens.spacingHorizontalXXL,
    paddingBlock: tokens.spacingVerticalXXXL,
    backgroundImage: `radial-gradient(1200px 400px at 50% -10%, ${tokens.colorBrandBackground2}, transparent)`,
  },
  card: {
    width: "100%",
    maxWidth: "640px",
    padding: tokens.spacingHorizontalXXL,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow16,
  },
  status: {
    fontSize: "104px",
    lineHeight: 1,
    fontWeight: tokens.fontWeightBold,
    background: `linear-gradient(135deg, ${tokens.colorBrandForeground1}, ${tokens.colorPaletteBerryForeground1})`,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    letterSpacing: "-0.04em",
    marginBottom: tokens.spacingVerticalM,
  },
  title: {
    marginBottom: tokens.spacingVerticalM,
    display: "block",
  },
  message: {
    color: tokens.colorNeutralForeground2,
    marginBottom: tokens.spacingVerticalL,
    display: "block",
  },
  hint: {
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    marginBottom: tokens.spacingVerticalL,
    overflowX: "auto",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalL,
  },
  suggestions: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    marginTop: tokens.spacingVerticalM,
  },
  suggestionRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    "&:hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalL,
  },
});

export function ErrorPage({ error }: { error: ErrorState }) {
  const styles = useStyles();
  const { data, t } = useVellum();
  const site = data.config.site;

  return (
    <main className={styles.root}>
      <Card className={styles.card}>
        <CardHeader
          image={site.logo ? <Image src={site.logo} alt="" width={32} height={32} /> : undefined}
          header={<Caption1>{site.title}</Caption1>}
          description={<Caption1>Edge-rendered docs</Caption1>}
        />

        <Display as="span" className={styles.status}>
          {error.status}
        </Display>
        <Title2 as="h1" className={styles.title}>
          {error.title}
        </Title2>
        <Body1 className={styles.message}>{error.message}</Body1>

        {error.hint && <div className={styles.hint}>{error.hint}</div>}

        <div className={styles.actions}>
          <Button appearance="primary" icon={<Home24Regular />} as="a" href="/">
            {t("ui.notFound.home")}
          </Button>
          <Button
            appearance="outline"
            icon={<ArrowLeft24Regular />}
            onClick={() => window.history.back()}
          >
            {t("ui.notFound.back")}
          </Button>
          <Button
            appearance="outline"
            icon={<DocumentSearch24Regular />}
            onClick={() =>
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
            }
          >
            {t("ui.notFound.search")}
          </Button>
        </div>

        {error.suggestions && error.suggestions.length > 0 && (
          <>
            <Caption1>{t("ui.notFound.suggestions")}</Caption1>
            <div className={styles.suggestions}>
              {error.suggestions.map((s) => (
                <Link key={s.link} href={s.link} className={styles.suggestionRow}>
                  <ChevronRight24Regular />
                  <Text>{s.text}</Text>
                </Link>
              ))}
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
