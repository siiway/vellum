import { Button, Divider, Link, mergeClasses, tokens, Text } from "@fluentui/react-components";
import { makeStyles } from "../css";
import {
  Edit16Regular,
  ChevronLeft16Regular,
  ChevronRight16Regular,
  DocumentPdf16Regular,
} from "@fluentui/react-icons";
import type { PageMeta } from "../../shared/types";
import { useVellum } from "../context";

const useStyles = makeStyles({
  root: {
    marginTop: tokens.spacingVerticalXXL,
    paddingTop: tokens.spacingVerticalL,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    flexWrap: "wrap",
  },
  prevNext: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: tokens.spacingHorizontalL,
    marginTop: tokens.spacingVerticalL,
    "@media (max-width: 720px)": { gridTemplateColumns: "1fr" },
  },
  // Bordered card on the canvas; hover darkens the hairline and lifts the
  // fill by a shade, nothing more.
  card: {
    padding: "14px 16px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    textDecoration: "none",
    color: tokens.colorNeutralForeground1,
    transition: "border-color 80ms ease, background-color 80ms ease",
    "&:hover": {
      borderTopColor: tokens.colorNeutralStroke1Hover,
      borderRightColor: tokens.colorNeutralStroke1Hover,
      borderBottomColor: tokens.colorNeutralStroke1Hover,
      borderLeftColor: tokens.colorNeutralStroke1Hover,
      backgroundColor: tokens.colorNeutralBackground1Hover,
      color: tokens.colorNeutralForeground1,
      textDecoration: "none",
    },
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  title: {
    display: "block",
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    marginTop: "4px",
  },
  end: { textAlign: "right" },
});

export function PageFooter({ meta, siteFooter }: { meta: PageMeta; siteFooter?: string }) {
  const styles = useStyles();
  const { t, data } = useVellum();
  const dateFmt = data.route.localeCode === "zh" ? "zh-CN" : data.route.localeCode;

  return (
    <footer className={styles.root}>
      <Divider />
      <div className={styles.meta} style={{ marginTop: 16 }}>
        <div>
          {meta.lastUpdated && (
            <Text>
              {t("ui.lastUpdated")} {new Date(meta.lastUpdated.iso).toLocaleDateString(dateFmt)}
              {meta.lastUpdated.author
                ? ` · ${t("ui.lastUpdatedBy")} ${meta.lastUpdated.author}`
                : ""}
            </Text>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} className="vellum-no-print">
          <Button
            appearance="subtle"
            size="small"
            icon={<DocumentPdf16Regular />}
            onClick={() => {
              // Browser print dialog -> "Save as PDF". The @media print rules in
              // ssr.tsx hide the chrome so the saved PDF is just the article.
              // document.title becomes the default filename.
              window.print();
            }}
          >
            {t("ui.pdf")}
          </Button>
          {meta.editUrl && (
            <Button
              appearance="subtle"
              size="small"
              icon={<Edit16Regular />}
              as="a"
              href={meta.editUrl}
            >
              {t("ui.edit")}
            </Button>
          )}
        </div>
      </div>
      {(meta.prev || meta.next) && (
        <div className={styles.prevNext}>
          {meta.prev ? (
            <Link className={styles.card} href={meta.prev.link} appearance="subtle">
              <div className={styles.label}>
                <ChevronLeft16Regular /> {t("ui.prev")}
              </div>
              <Text className={styles.title}>{meta.prev.text}</Text>
            </Link>
          ) : (
            <div />
          )}
          {meta.next ? (
            <Link
              className={mergeClasses(styles.card, styles.end)}
              href={meta.next.link}
              appearance="subtle"
            >
              <div className={`${styles.label}`} style={{ justifyContent: "flex-end" }}>
                {t("ui.next")} <ChevronRight16Regular />
              </div>
              <Text className={styles.title}>{meta.next.text}</Text>
            </Link>
          ) : (
            <div />
          )}
        </div>
      )}
      {siteFooter && (
        <Text
          style={{
            display: "block",
            marginTop: 24,
            color: "var(--colorNeutralForeground3)",
          }}
        >
          {siteFooter}
        </Text>
      )}
    </footer>
  );
}
