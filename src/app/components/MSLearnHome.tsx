// Microsoft Learn-style landing page: hero with brand-coloured gradient + a
// prominent search bar, then a stack of card grids (get-started → products →
// roles → resources). Triggered by `layout: ms-learn` in the page frontmatter.
//
// Frontmatter shape (see local-docs/homepage/index.md for the canonical
// example):
//
//   hero:        { title, tagline, searchPlaceholder?, actions?: [{ text, link, theme? }] }
//   getStarted:  { title, description?, items: Item[] }
//   products:    { title, description?, items: Item[] }   // logo URL in `icon`
//   roles:       { title, description?, items: Item[] }   // FluentUI icon name in `icon`
//   resources:   { title, description?, items: Item[] }   // FluentUI icon name in `icon`
//
// where each Item is { title, description?, icon?, link, linkText? }. `icon`
// is either a URL (rendered with <Image>) or the PascalCase name of an exported
// @fluentui/react-icons component. The frontmatter is shipped as-is in the
// bootstrap payload — nothing here is dynamic, so SSR is straightforward.

import {
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Card,
  CardHeader,
  Image,
  Input,
  Link,
  Subtitle1,
  Text,
  Title1,
  Title3,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowRight24Regular,
  BookOpen24Regular,
  BranchFork24Regular,
  ChatMultiple24Regular,
  Code24Regular,
  HeartPulse24Regular,
  Open24Regular,
  PeopleTeam24Regular,
  Rocket24Regular,
  Search24Regular,
  Server24Regular,
  TagMultiple24Regular,
} from "@fluentui/react-icons";
import { useCallback, useState, type ComponentType, type ReactNode } from "react";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { MarkdownAst } from "./MarkdownAst";
import { MachineTranslatedBanner } from "./MachineTranslatedBanner";

// --- Types ---------------------------------------------------------------

interface HeroAction {
  text: string;
  link: string;
  theme?: "brand" | "alt";
}
interface Hero {
  title?: string;
  tagline?: string;
  searchPlaceholder?: string;
  actions?: HeroAction[];
}
interface Item {
  title: string;
  description?: string;
  icon?: string;
  link: string;
  linkText?: string;
}
interface Section {
  title?: string;
  description?: string;
  items?: Item[];
}
interface HomeFrontmatter {
  hero?: Hero;
  getStarted?: Section;
  products?: Section;
  roles?: Section;
  resources?: Section;
}

// Curated icon registry. Adding a new icon to a frontmatter entry means
// importing it here too — keeps the bundle predictable. Unknown icon names
// fall back to a small placeholder dot so the card still lays out.
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Rocket24Regular,
  BookOpen24Regular,
  HeartPulse24Regular,
  Code24Regular,
  Server24Regular,
  PeopleTeam24Regular,
  BranchFork24Regular,
  TagMultiple24Regular,
  ChatMultiple24Regular,
  ArrowRight24Regular,
  Open24Regular,
};

// --- Styles --------------------------------------------------------------

const useStyles = makeStyles({
  root: {
    minHeight: "calc(100vh - 60px)",
    paddingBottom: tokens.spacingVerticalXXXL,
    color: tokens.colorNeutralForeground1,
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    paddingBlock: "96px",
    paddingInline: tokens.spacingHorizontalXXXL,
    textAlign: "center",
    backgroundImage: `
      radial-gradient(900px 480px at 18% -10%, ${tokens.colorBrandBackground2} 0%, transparent 70%),
      radial-gradient(900px 480px at 82% -10%, ${tokens.colorPaletteBerryBackground2} 0%, transparent 70%),
      radial-gradient(600px 300px at 50% 110%, ${tokens.colorBrandBackground2} 0%, transparent 70%)
    `,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    "@media (max-width: 720px)": {
      paddingBlock: "56px",
      paddingInline: tokens.spacingHorizontalL,
    },
  },
  heroInner: {
    position: "relative",
    zIndex: 1,
    maxWidth: "880px",
    marginInline: "auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    // Bigger gap so the gradient title's descenders / glyph overflow can't
    // get visually swallowed by the tagline below. Previously spacingVerticalL
    // (16px) wasn't enough at large hero font sizes.
    gap: tokens.spacingVerticalXXL,
  },
  heroTitle: {
    display: "block",
    margin: 0,
    fontSize: "clamp(40px, 5.5vw, 64px)",
    fontWeight: tokens.fontWeightBold,
    // Generous lineHeight + paddingBlock prevent the gradient title from
    // clipping. WebkitBackgroundClip:text uses the span's content box as the
    // mask; CJK characters and Latin descenders (g/p/y) sit slightly outside
    // the cap-height box, so a tight line-height shaves their edges. 1.35 +
    // 0.3em padding covers every script + diacritic combo we render.
    lineHeight: 1.35,
    letterSpacing: "-0.03em",
    paddingBlock: "0.3em",
    overflow: "visible",
    "& > span": {
      // Inline-block so the span owns a real box and its line-height stops
      // collapsing into the parent's. Padding inside the span itself gives
      // the gradient clip-mask room for descenders / accents / CJK strokes
      // that the cap-height box doesn't account for.
      display: "inline-block",
      lineHeight: 1.35,
      paddingBlock: "0.15em",
      paddingInline: "0.02em",
      overflow: "visible",
      background: `linear-gradient(135deg, ${tokens.colorBrandForeground1} 0%, ${tokens.colorPaletteBerryForeground1} 100%)`,
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
    },
  },
  heroTagline: {
    display: "block",
    margin: 0,
    maxWidth: "640px",
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    color: tokens.colorNeutralForeground2,
  },
  heroSearch: {
    width: "min(560px, 100%)",
    marginTop: tokens.spacingVerticalM,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground1,
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: "6px",
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow8,
    transition: "border-color 120ms ease, box-shadow 120ms ease",
    "&:focus-within": {
      borderColor: tokens.colorBrandStroke1,
      boxShadow: tokens.shadow16,
    },
  },
  heroSearchIcon: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  heroSearchInput: {
    flex: 1,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    borderTop: "0 !important" as any,
    borderLeft: "0 !important" as any,
    borderRight: "0 !important" as any,
    borderBottom: "0 !important" as any,
    backgroundColor: "transparent !important" as any,
    /* eslint-enable @typescript-eslint/no-explicit-any */
    "& input": { fontSize: tokens.fontSizeBase400 },
  },
  heroActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    justifyContent: "center",
    marginTop: tokens.spacingVerticalM,
  },

  section: {
    maxWidth: "1200px",
    marginInline: "auto",
    paddingInline: tokens.spacingHorizontalXXXL,
    marginTop: tokens.spacingVerticalXXXL,
    "@media (max-width: 720px)": { paddingInline: tokens.spacingHorizontalL },
  },
  sectionHeader: { marginBottom: tokens.spacingVerticalL },
  sectionTitle: {
    display: "block",
    marginBlock: 0,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "-0.01em",
  },
  sectionDescription: {
    display: "block",
    marginTop: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground2,
  },

  // Three-up grid that collapses to two then one across viewports — same
  // breakpoints as MS Learn.
  grid3: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    "@media (max-width: 960px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },

  // Card-link wrapper: a FluentUI Link styled to behave like a block-level
  // affordance over the whole Card. We can't use `<Card as="a">` because
  // Card's `as` prop is typed to "div" only in FluentUI v9. Stretches via
  // display:flex so the inner Card can claim the full grid-row height — keeps
  // every card in the row visually the same size, regardless of how much copy
  // each one carries.
  cardLink: {
    display: "flex",
    textDecoration: "none",
    color: tokens.colorNeutralForeground1,
    "&:hover": { textDecoration: "none" },
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    width: "100%",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    color: tokens.colorNeutralForeground1,
    // Only the border colour shifts on hover — no transform, no shadow, no
    // size change. Keeps the page calm.
    transition: "border-color 120ms ease, background-color 120ms ease",
    "&:hover": {
      borderColor: tokens.colorBrandStroke1,
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  cardIconChip: {
    width: "48px",
    height: "48px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    border: `1px solid ${tokens.colorBrandStroke2}`,
    flexShrink: 0,
  },
  cardLogo: { width: "32px", height: "32px", objectFit: "contain" },
  cardTitle: {
    display: "block",
    marginBlock: 0,
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase500,
  },
  cardDescription: {
    display: "block",
    color: tokens.colorNeutralForeground2,
    flex: 1,
  },
  cardCta: {
    alignSelf: "flex-start",
    marginTop: tokens.spacingVerticalS,
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },

  // Resources is denser — narrower cards, more per row.
  grid4: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    "@media (max-width: 960px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
  resourceCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    color: tokens.colorNeutralForeground1,
    textDecoration: "none",
    transition: "background-color 120ms ease, border-color 120ms ease",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground2Hover,
      borderColor: tokens.colorBrandStroke2,
    },
  },
  resourceIcon: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
    marginTop: "2px",
  },
  resourceText: { minWidth: 0, flex: 1 },
  resourceTitle: {
    display: "block",
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  resourceDescription: {
    display: "block",
    marginTop: "2px",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },

  body: {
    maxWidth: "1200px",
    marginInline: "auto",
    paddingInline: tokens.spacingHorizontalXXXL,
    marginTop: tokens.spacingVerticalXXXL,
    paddingTop: tokens.spacingVerticalXL,
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    "@media (max-width: 720px)": { paddingInline: tokens.spacingHorizontalL },
    // Cancel MarkdownAst's own max-width / margin-auto so the body content
    // can stretch the full landing-page width when authors want it to.
    "& > div": { maxWidth: "100%" },
  },

  footer: {
    maxWidth: "1200px",
    marginInline: "auto",
    paddingInline: tokens.spacingHorizontalXXXL,
    marginTop: tokens.spacingVerticalXXXL,
    paddingTop: tokens.spacingVerticalXL,
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    "@media (max-width: 720px)": { paddingInline: tokens.spacingHorizontalL },
  },
});

// --- Component -----------------------------------------------------------

export function MSLearnHome() {
  const styles = useStyles();
  const { data } = useVellum();
  const front = (data.page.meta.frontmatter ?? {}) as HomeFrontmatter;
  // Markdown body after the frontmatter is rendered below the structured
  // sections. The body goes through the regular MarkdownAst renderer so any
  // registered React component (`<Button>`, `<Card>`, …) the author drops in
  // is mounted as the real FluentUI primitive — same registry as docs pages.
  const hasBody = data.page.ast.blocks.length > 0;

  return (
    <main className={styles.root}>
      <MachineTranslatedBanner />
      <HeroSection hero={front.hero} styles={styles} />
      {hasItems(front.getStarted) && (
        <CardGridSection section={front.getStarted} variant="iconChip" styles={styles} />
      )}
      {hasItems(front.products) && (
        <CardGridSection section={front.products} variant="logo" styles={styles} />
      )}
      {hasItems(front.roles) && (
        <CardGridSection section={front.roles} variant="iconChip" styles={styles} />
      )}
      {hasItems(front.resources) && <ResourceSection section={front.resources} styles={styles} />}
      {hasBody && (
        <section className={styles.body}>
          <MarkdownAst ast={data.page.ast} />
        </section>
      )}
      {data.config.site.footer && (
        <footer className={styles.footer}>{data.config.site.footer}</footer>
      )}
    </main>
  );
}

function hasItems(s: Section | undefined): s is Section & { items: Item[] } {
  return !!s && Array.isArray(s.items) && s.items.length > 0;
}

// --- Hero ----------------------------------------------------------------

function HeroSection({
  hero,
  styles,
}: {
  hero: Hero | undefined;
  styles: ReturnType<typeof useStyles>;
}) {
  const { navigate, data } = useVellum();
  const [q, setQ] = useState("");

  // Submit → /search?q=…, locale-prefixed so a zh visitor stays in zh.
  const onSubmit = useCallback(() => {
    const localePrefix =
      data.config.site.locales.find((l) => l.code === data.route.localeCode)?.prefix ?? "";
    const base = localePrefix ? `/${localePrefix}/search` : "/search";
    navigate(q.trim() ? `${base}?q=${encodeURIComponent(q.trim())}` : base);
  }, [navigate, q, data.config.site.locales, data.route.localeCode]);

  return (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        {/* hero.title and hero.tagline are pre-rendered HTML from the worker's
            processHomeFrontmatter() pass. FluentUI's typography components
            drop the `dangerouslySetInnerHTML` prop through their slot system,
            so we wrap the HTML in a child <span> instead. The gradient
            styles in `heroTitle` target `& > span` so the clip-to-text
            effect lives on the same element that owns the text. */}
        {hero?.title && (
          <Title1 as="h1" className={styles.heroTitle}>
            <span dangerouslySetInnerHTML={{ __html: hero.title }} />
          </Title1>
        )}
        {hero?.tagline && (
          <Body1 as="p" className={styles.heroTagline}>
            <span dangerouslySetInnerHTML={{ __html: hero.tagline }} />
          </Body1>
        )}
        <div className={styles.heroSearch}>
          <Search24Regular className={styles.heroSearchIcon} />
          <Input
            className={styles.heroSearchInput}
            appearance="filled-lighter"
            size="large"
            placeholder={hero?.searchPlaceholder ?? "Search the docs"}
            value={q}
            onChange={(_, d) => setQ(d.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
          />
          <Button appearance="primary" onClick={onSubmit}>
            Search
          </Button>
        </div>
        {hero?.actions && hero.actions.length > 0 && (
          <div className={styles.heroActions}>
            {hero.actions.map((a, i) => {
              const isExternal = /^[a-z]+:\/\//i.test(a.link);
              return (
                <Button
                  key={i}
                  as="a"
                  href={a.link}
                  appearance={a.theme === "brand" ? "primary" : "outline"}
                  size="large"
                  icon={isExternal ? <Open24Regular /> : <ArrowRight24Regular />}
                  iconPosition="after"
                  {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {a.text}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// --- Card grid section (get-started, products, roles) --------------------

function CardGridSection({
  section,
  variant,
  styles,
}: {
  section: Section & { items: Item[] };
  variant: "iconChip" | "logo";
  styles: ReturnType<typeof useStyles>;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        {/* FluentUI typography drops dangerouslySetInnerHTML through its slot
            system, so wrap the worker-rendered HTML in a child <span>. */}
        {section.title && (
          <Title3 as="h2" className={styles.sectionTitle}>
            <span dangerouslySetInnerHTML={{ __html: section.title }} />
          </Title3>
        )}
        {section.description && (
          <Subtitle1 as="p" className={styles.sectionDescription}>
            <span dangerouslySetInnerHTML={{ __html: section.description }} />
          </Subtitle1>
        )}
      </header>
      <div className={styles.grid3}>
        {section.items.map((item, i) => (
          <ItemCard key={i} item={item} variant={variant} styles={styles} />
        ))}
      </div>
    </section>
  );
}

function ItemCard({
  item,
  variant,
  styles,
}: {
  item: Item;
  variant: "iconChip" | "logo";
  styles: ReturnType<typeof useStyles>;
}) {
  const { t } = useVellum();
  const isExternal = /^[a-z]+:\/\//i.test(item.link);
  // Title / description / linkText are pre-rendered HTML from the worker
  // (processHomeFrontmatter). Inline markdown (`code`, **bold**, links) is
  // dropped via a child <span> — FluentUI's typography components don't pass
  // dangerouslySetInnerHTML through their slots.
  return (
    <Link
      href={item.link}
      appearance="subtle"
      className={styles.cardLink}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <Card className={styles.card} appearance="outline">
        <CardHeader
          image={<IconOrLogo icon={item.icon} variant={variant} styles={styles} />}
          header={
            <Body1Strong as="h3" className={styles.cardTitle}>
              <span dangerouslySetInnerHTML={{ __html: item.title }} />
            </Body1Strong>
          }
        />
        {item.description && (
          <Text as="p" className={styles.cardDescription}>
            <span dangerouslySetInnerHTML={{ __html: item.description }} />
          </Text>
        )}
        <span className={styles.cardCta}>
          {item.linkText ? (
            <span dangerouslySetInnerHTML={{ __html: item.linkText }} />
          ) : (
            t("ui.home.learnMore")
          )}
          {isExternal ? <Open24Regular /> : <ArrowRight24Regular />}
        </span>
      </Card>
    </Link>
  );
}

function IconOrLogo({
  icon,
  variant,
  styles,
}: {
  icon: string | undefined;
  variant: "iconChip" | "logo";
  styles: ReturnType<typeof useStyles>;
}): ReactNode {
  if (!icon)
    return (
      <span className={styles.cardIconChip} aria-hidden="true">
        ·
      </span>
    );
  if (variant === "logo") {
    return <Image src={icon} alt="" className={styles.cardLogo} fit="contain" />;
  }
  const Icon = ICONS[icon];
  if (!Icon)
    return (
      <span className={styles.cardIconChip} aria-hidden="true">
        ·
      </span>
    );
  return (
    <span className={styles.cardIconChip} aria-hidden="true">
      <Icon />
    </span>
  );
}

// --- Resources -----------------------------------------------------------

function ResourceSection({
  section,
  styles,
}: {
  section: Section & { items: Item[] };
  styles: ReturnType<typeof useStyles>;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        {section.title && (
          <Title3 as="h2" className={styles.sectionTitle}>
            <span dangerouslySetInnerHTML={{ __html: section.title }} />
          </Title3>
        )}
        {section.description && (
          <Subtitle1 as="p" className={styles.sectionDescription}>
            <span dangerouslySetInnerHTML={{ __html: section.description }} />
          </Subtitle1>
        )}
      </header>
      <div className={styles.grid4}>
        {section.items.map((item, i) => {
          const Icon = item.icon ? ICONS[item.icon] : null;
          const isExternal = /^[a-z]+:\/\//i.test(item.link);
          return (
            <Link
              key={i}
              href={item.link}
              appearance="subtle"
              className={styles.resourceCard}
              {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {Icon && (
                <span className={styles.resourceIcon} aria-hidden="true">
                  <Icon />
                </span>
              )}
              <span className={styles.resourceText}>
                <Text as="span" className={styles.resourceTitle}>
                  <span dangerouslySetInnerHTML={{ __html: item.title }} />
                </Text>
                {item.description && (
                  <Caption1 as="span" className={styles.resourceDescription}>
                    <span dangerouslySetInnerHTML={{ __html: item.description }} />
                  </Caption1>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
