// Renders VitePress-style `layout: home` pages: hero block + action buttons + features grid,
// followed by any markdown body content authored beneath the frontmatter.
// Triggered by the Layout component when the page frontmatter contains layout: home.

import { Button, Card, Caption1, Image, tokens } from "@fluentui/react-components";
import { ArrowRight24Regular, Open24Regular } from "@fluentui/react-icons";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { MarkdownAst } from "./MarkdownAst";

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
  root: {
    position: "relative",
    paddingBlock: tokens.spacingVerticalXXXL,
    paddingInline: tokens.spacingHorizontalXXXL,
    maxWidth: "1200px",
    marginInline: "auto",
    "@media (max-width: 720px)": {
      paddingInline: tokens.spacingHorizontalL,
      paddingBlock: tokens.spacingVerticalXXL,
    },
  },
  backdrop: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 0,
    overflow: "hidden",
    "&::before": {
      content: '""',
      position: "absolute",
      top: "-20%",
      left: "50%",
      width: "min(1100px, 95%)",
      height: "560px",
      transform: "translateX(-50%)",
      background: `radial-gradient(60% 60% at 50% 50%, ${tokens.colorBrandBackground2} 0%, transparent 70%)`,
      opacity: 0.7,
      filter: "blur(40px)",
    },
  },
  hero: {
    position: "relative",
    zIndex: 1,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: tokens.spacingHorizontalXXXL,
    alignItems: "center",
    paddingBlock: tokens.spacingVerticalXXL,
    "@media (max-width: 960px)": {
      gridTemplateColumns: "1fr",
      paddingBlock: tokens.spacingVerticalL,
    },
  },
  heroTextCol: { minWidth: 0 },
  heroHeading: {
    display: "block",
    marginBlock: 0,
    fontWeight: tokens.fontWeightBold,
  },
  heroName: {
    display: "block",
    fontSize: "clamp(44px, 6vw, 68px)",
    fontWeight: tokens.fontWeightBold,
    lineHeight: 1.2,
    letterSpacing: "-0.04em",
    overflow: "visible",
    background: `linear-gradient(120deg, ${tokens.colorBrandForeground1} 0%, ${tokens.colorPaletteBerryForeground1} 100%)`,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    marginBlock: 0,
    // Pad the title's own block-end by ~descender-height so the descender of
    // "g" / "p" / "y" lives INSIDE the heroName's content box. Without this,
    // descenders extend below the line box and a small marginTop on heroText
    // still gets eaten. With it, heroText.marginTop measures from below the
    // descender, so even marginTop:0 leaves a clean baseline.
    paddingBlockEnd: "0.2em",
    "& code": {
      WebkitTextFillColor: tokens.colorNeutralForeground1,
      background: "none",
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.8em",
    },
  },
  heroText: {
    display: "block",
    fontSize: "clamp(28px, 3.5vw, 40px)",
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: 1.25,
    letterSpacing: "-0.02em",
    color: tokens.colorNeutralForeground1,
    // 0.25em ≈ 7–10px depending on viewport. Combined with heroName's
    // paddingBlockEnd (0.2em ≈ 9–14px at title size), the total visible gap
    // settles around 16–24px — proportional to the title, not the subtitle.
    marginTop: "0.25em",
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: "0.9em",
      backgroundColor: tokens.colorNeutralBackground3,
      paddingInline: "6px",
      paddingBlock: "2px",
      borderRadius: tokens.borderRadiusSmall,
      border: `1px solid ${tokens.colorNeutralStroke3}`,
      WebkitBackgroundClip: "border-box",
      WebkitTextFillColor: tokens.colorNeutralForeground1,
      backgroundClip: "border-box",
    },
  },
  heroTagline: {
    display: "block",
    color: tokens.colorNeutralForeground2,
    marginTop: tokens.spacingVerticalL,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
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
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalXXL,
  },
  heroImageWrap: {
    position: "relative",
    width: "320px",
    height: "320px",
    "@media (max-width: 960px)": { display: "none" },
    "&::before": {
      content: '""',
      position: "absolute",
      inset: "-20px",
      borderRadius: "50%",
      background: `conic-gradient(from 180deg, ${tokens.colorBrandBackground2}, transparent, ${tokens.colorBrandBackground2})`,
      opacity: 0.5,
      filter: "blur(28px)",
      zIndex: -1,
    },
  },
  heroImage: {
    width: "320px",
    height: "320px",
    objectFit: "contain",
  },
  featuresSection: {
    position: "relative",
    zIndex: 1,
    marginTop: tokens.spacingVerticalXXXL,
  },
  featuresHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalL,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    color: tokens.colorNeutralForeground3,
    letterSpacing: "0.08em",
  },
  featuresHeaderRule: {
    flex: 1,
    height: "1px",
    backgroundColor: tokens.colorNeutralStroke3,
  },
  features: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: tokens.spacingHorizontalL,
  },
  feature: {
    position: "relative",
    padding: tokens.spacingHorizontalL,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  featureIconChip: {
    width: "44px",
    height: "44px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontSize: "24px",
    lineHeight: 1,
    marginBottom: tokens.spacingVerticalXS,
    border: `1px solid ${tokens.colorBrandStroke2}`,
  },
  featureTitle: {
    display: "block",
    margin: 0,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
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
    color: tokens.colorNeutralForeground2,
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
    position: "relative",
    zIndex: 1,
    marginTop: tokens.spacingVerticalXXXL,
    paddingTop: tokens.spacingVerticalXXL,
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  siteFooter: {
    position: "relative",
    zIndex: 1,
    marginTop: tokens.spacingVerticalXXXL,
    paddingTop: tokens.spacingVerticalXL,
    textAlign: "center",
  },
  siteFooterRule: {
    width: "60px",
    height: "2px",
    backgroundColor: tokens.colorNeutralStroke3,
    borderRadius: tokens.borderRadiusCircular,
    marginInline: "auto",
    marginBottom: tokens.spacingVerticalL,
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
      <div className={styles.backdrop} aria-hidden="true" />

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
                    size="large"
                    icon={isExternal ? <Open24Regular /> : <ArrowRight24Regular />}
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
                    icon={<ArrowRight24Regular />}
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
          <div className={styles.siteFooterRule} aria-hidden="true" />
          <p className={styles.siteFooterText}>{data.config.site.footer}</p>
        </footer>
      )}
    </main>
  );
}
