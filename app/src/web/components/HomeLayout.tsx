// Renders VitePress-style `layout: home` pages: hero block + action buttons + features grid,
// followed by any markdown body content authored beneath the frontmatter.
// Triggered by the Layout component when the page frontmatter contains layout: home.

import { Button, Card, Caption1, Image, tokens } from "@fluentui/react-components";
import { ArrowRight20Regular, Open20Regular } from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { MarkdownAst } from "./MarkdownAst";
import { MachineTranslatedBanner } from "./MachineTranslatedBanner";

type Theme = "brand" | "alt" | "sponsor";
interface HeroAction {
  theme?: Theme;
  text: string;
  link: string;
}
interface Hero {
  name?: string;
  text?: string;
  tagline?: string;
  image?: { src: string; alt?: string };
  actions?: HeroAction[];
}
interface Feature {
  icon?: string | { src: string; alt?: string };
  title: string;
  details?: string;
  link?: string;
  linkText?: string;
}

const useStyles = makeStyles({
  // Flat on the canvas like the rest of the shell: no glow, no gradient
  // text. Hierarchy comes from type size and the muted tagline.
  root: {
    position: "relative",
    padding: "56px 40px 48px",
    maxWidth: "1200px",
    marginInline: "auto",
    boxSizing: "border-box",
    "@media (max-width: 1024px)": { padding: "40px 24px" },
    "@media (max-width: 768px)": { padding: "24px 16px 32px" },
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "48px",
    alignItems: "center",
    paddingBlock: "24px",
    "@media (max-width: 960px)": {
      gridTemplateColumns: "1fr",
      paddingBlock: "8px",
    },
  },
  heroTextCol: { minWidth: 0 },
  heroHeading: {
    display: "block",
    marginBlock: 0,
    fontWeight: tokens.fontWeightSemibold,
  },
  heroName: {
    display: "block",
    fontSize: "clamp(36px, 5vw, 52px)",
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: 1.15,
    letterSpacing: "-0.025em",
    color: tokens.colorNeutralForeground1,
    marginBlock: 0,
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.8em",
    },
  },
  heroText: {
    display: "block",
    fontSize: "clamp(24px, 3vw, 32px)",
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: 1.25,
    letterSpacing: "-0.015em",
    color: tokens.colorNeutralForeground3,
    marginTop: "8px",
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.9em",
      backgroundColor: tokens.colorNeutralBackground3,
      paddingInline: "6px",
      paddingBlock: "2px",
      borderRadius: tokens.borderRadiusSmall,
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      color: tokens.colorNeutralForeground1,
    },
  },
  heroTagline: {
    display: "block",
    color: tokens.colorNeutralForeground3,
    marginTop: "16px",
    marginBottom: 0,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    maxWidth: "620px",
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.9em",
      backgroundColor: tokens.colorNeutralBackground3,
      paddingInline: "5px",
      paddingBlock: "2px",
      borderRadius: tokens.borderRadiusSmall,
      border: `1px solid ${tokens.colorNeutralStroke3}`,
    },
    "& a": {
      color: tokens.colorBrandForegroundLink,
      textDecoration: "none",
      "&:hover": { textDecoration: "underline" },
    },
  },
  heroActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "28px",
  },
  heroImageWrap: {
    position: "relative",
    width: "280px",
    height: "280px",
    "@media (max-width: 960px)": { display: "none" },
  },
  heroImage: {
    width: "280px",
    height: "280px",
    objectFit: "contain",
  },
  featuresSection: {
    marginTop: "48px",
  },
  // Section label in the Prism nav-section voice: small, muted, sentence case.
  featuresHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    margin: "0 0 12px",
    fontSize: "12px",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
  },
  featuresHeaderRule: {
    flex: 1,
    height: "1px",
    backgroundColor: tokens.colorNeutralStroke2,
  },
  features: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "12px",
  },
  // Bordered card on the canvas; no shadow.
  feature: {
    position: "relative",
    padding: "20px",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    boxShadow: "none",
    borderRadius: tokens.borderRadiusLarge,
    background: tokens.colorNeutralBackground1,
    "&::after": {
      borderTopColor: tokens.colorNeutralStroke2,
      borderRightColor: tokens.colorNeutralStroke2,
      borderBottomColor: tokens.colorNeutralStroke2,
      borderLeftColor: tokens.colorNeutralStroke2,
      borderRadius: tokens.borderRadiusLarge,
    },
  },
  // Bordered tile, as in Prism's empty states, rather than a brand-tinted chip.
  featureIconChip: {
    width: "40px",
    height: "40px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground3,
    fontSize: "20px",
    lineHeight: 1,
    marginBottom: "4px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  featureTitle: {
    display: "block",
    margin: 0,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.92em",
      backgroundColor: tokens.colorNeutralBackground3,
      paddingInline: "5px",
      paddingBlock: "1px",
      borderRadius: tokens.borderRadiusSmall,
      border: `1px solid ${tokens.colorNeutralStroke3}`,
      fontWeight: tokens.fontWeightRegular,
    },
  },
  featureDetails: {
    display: "block",
    margin: 0,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
    lineHeight: tokens.lineHeightBase300,
    flex: 1,
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.9em",
      backgroundColor: tokens.colorNeutralBackground3,
      paddingInline: "5px",
      paddingBlock: "1px",
      borderRadius: tokens.borderRadiusSmall,
      border: `1px solid ${tokens.colorNeutralStroke3}`,
      color: tokens.colorNeutralForeground1,
    },
    "& a": {
      color: tokens.colorBrandForegroundLink,
      textDecoration: "none",
      "&:hover": { textDecoration: "underline" },
    },
    "& strong": {
      color: tokens.colorNeutralForeground1,
      fontWeight: tokens.fontWeightSemibold,
    },
  },
  featureLinkBtn: {
    alignSelf: "flex-start",
    marginTop: tokens.spacingVerticalS,
    paddingInline: 0,
  },
  body: {
    marginTop: "48px",
    paddingTop: "32px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  siteFooter: {
    marginTop: "48px",
    paddingTop: "16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    textAlign: "center",
  },
  siteFooterText: {
    margin: 0,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
});

export function HomeLayout() {
  const styles = useStyles();
  const { data, t } = useVellum();
  const front = data.page.meta.frontmatter as {
    hero?: Hero;
    features?: Feature[];
  };
  const hero = front.hero ?? {};
  const features = front.features ?? [];
  const hasBody = data.page.ast.blocks.length > 0;

  return (
    <main className={styles.root}>
      <MachineTranslatedBanner />

      <section className={styles.hero}>
        <div className={styles.heroTextCol}>
          {(hero.name || hero.text) && (
            <h1 className={styles.heroHeading}>
              {hero.name && (
                <span className={styles.heroName} dangerouslySetInnerHTML={{ __html: hero.name }} />
              )}
              {hero.text && (
                <span className={styles.heroText} dangerouslySetInnerHTML={{ __html: hero.text }} />
              )}
            </h1>
          )}
          {hero.tagline && (
            <p className={styles.heroTagline} dangerouslySetInnerHTML={{ __html: hero.tagline }} />
          )}
          {hero.actions && hero.actions.length > 0 && (
            <div className={styles.heroActions}>
              {hero.actions.map((action, i) => {
                const isExternal = /^[a-z]+:\/\//i.test(action.link);
                return (
                  <Button
                    key={i}
                    as="a"
                    href={action.link}
                    appearance={
                      action.theme === "brand"
                        ? "primary"
                        : action.theme === "sponsor"
                          ? "outline"
                          : "secondary"
                    }
                    icon={isExternal ? <Open20Regular /> : <ArrowRight20Regular />}
                    iconPosition="after"
                    {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    {action.text}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
        {hero.image && (
          <div className={styles.heroImageWrap}>
            <Image
              src={hero.image.src}
              alt={hero.image.alt ?? hero.name ?? ""}
              className={styles.heroImage}
              fit="contain"
            />
          </div>
        )}
      </section>

      {features.length > 0 && (
        <section className={styles.featuresSection}>
          <Caption1 className={styles.featuresHeader} as="h2">
            <span>{t("ui.home.features")}</span>
            <span className={styles.featuresHeaderRule} aria-hidden="true" />
          </Caption1>
          <div className={styles.features}>
            {features.map((feat, i) => (
              <Card key={i} className={styles.feature} appearance="outline">
                {typeof feat.icon === "string" && (
                  <span className={styles.featureIconChip}>{feat.icon}</span>
                )}
                {feat.icon && typeof feat.icon === "object" && (
                  <span className={styles.featureIconChip}>
                    <Image src={feat.icon.src} alt={feat.icon.alt ?? ""} width={24} height={24} />
                  </span>
                )}
                <h3
                  className={styles.featureTitle}
                  dangerouslySetInnerHTML={{ __html: feat.title }}
                />
                {feat.details && (
                  <p
                    className={styles.featureDetails}
                    dangerouslySetInnerHTML={{ __html: feat.details }}
                  />
                )}
                {feat.link && (
                  <Button
                    as="a"
                    href={feat.link}
                    appearance="subtle"
                    size="small"
                    icon={<ArrowRight20Regular />}
                    iconPosition="after"
                    className={styles.featureLinkBtn}
                  >
                    {feat.linkText ?? t("ui.home.actions.getStarted")}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      {hasBody && (
        <section className={styles.body}>
          <MarkdownAst ast={data.page.ast} />
        </section>
      )}

      {data.config.site.footer && (
        <footer className={styles.siteFooter}>
          <p className={styles.siteFooterText}>{data.config.site.footer}</p>
        </footer>
      )}
    </main>
  );
}
