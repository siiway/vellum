// Search endpoint: scans the cached markdown corpus for hits.
// First request per repo+locale walks the tree, fetches every markdown, and builds
// a tiny inverted index that we cache in KV/Cache API. Subsequent requests are O(query).
//
// Query syntax:
//   plain words           AND-matched against title or body
//   "exact phrase"        AND-matched as a literal substring
//   -term                 negated; doc is dropped if the term appears anywhere
//   title:foo             only docs whose title contains foo
//   repo:slug             scope the cross-repo search to a specific repo
//
// Hits include up to 3 excerpts, each tagged with the nearest preceding
// heading (slug + title) so the client can render them under section headers
// and link to the exact anchor.

import matter from "gray-matter";
import type { Env } from "./env";
import type { VellumConfig } from "../shared/types";
import { localeSourcePrefix } from "../shared/types";
import { fetchSourceFile, fetchSourceTree, repoRef, docsRootPrefix } from "./sources";
import { readCache, writeCache } from "./cache";
import { ttlSeconds } from "./env";

interface IndexedSection {
  // Slug of the nearest preceding heading. Anchors built by anchors.ts use
  // the same slugifier, so a hit's #anchor lands on the same heading.
  slug: string;
  title: string;
  // Byte offset of the section's start within `text`. Used to map an excerpt
  // position back to a section heading.
  offset: number;
}

interface IndexedDoc {
  url: string;
  title: string;
  // Concatenated searchable text: frontmatter title/description/hero/features
  // (for home pages) followed by the stripped body. Hero text appears first so
  // it shows up prominently in excerpts.
  text: string;
  sections: IndexedSection[];
}

interface SearchIndex {
  docs: IndexedDoc[];
  built: number;
}

export interface ExcerptOut {
  html: string;
  sectionSlug?: string;
  sectionTitle?: string;
  // Section title with inline markdown rendered to HTML (backtick spans →
  // `<code>`). When present, clients should render this via
  // dangerouslySetInnerHTML instead of `sectionTitle` so headings like
  // `` `teams` `` style as code rather than showing literal backticks.
  sectionTitleHtml?: string;
}

export interface SearchHit {
  url: string;
  title: string;
  // Title with `<mark>` wrapping any query term that appears in it. Clients
  // render it via dangerouslySetInnerHTML the same way they render
  // excerpts; falls back to the plain `title` when no terms matched.
  titleHtml: string;
  excerpts: ExcerptOut[];
  repo: string;
  repoDisplayName: string;
}

// --- Aliases -------------------------------------------------------------
//
// Docs index one canonical term per concept; readers almost never type the
// canonical one. The alias map expands each query term to a small pool of
// synonyms / abbreviations / canonical names that the docs author is more
// likely to have used. Same vocabulary as the AI prompt's "examples of the
// kind of leap to make" list — both paths benefit from the same coverage.
//
// Matching an alias scores LESS than matching the primary term so the
// original word still wins when both are present. Aliases are also folded
// into the highlight pool so the user sees what actually matched.
//
// The map is intentionally bidirectional and not transitive — if a reader
// types `mathjax`, we expand to `latex` too, and vice versa. Adding a new
// concept means writing both directions.
//
// `DEFAULT_ALIASES` is the baseline. Author-written overrides come from
// `site.searchAliases` and `repo.searchAliases`; resolveAliasMap layers
// them on top so config only needs to spell out product-specific vocab.
const DEFAULT_ALIASES: Record<string, string[]> = {
  // Math typesetting
  latex: ["mathjax", "katex", "math", "maths", "equations", "formulas"],
  mathjax: ["latex", "katex", "math", "maths", "equations"],
  katex: ["latex", "mathjax", "math"],
  math: ["mathjax", "latex", "maths", "equations"],
  maths: ["math", "mathjax", "latex", "equations"],
  equation: ["equations", "math", "mathjax", "latex"],
  equations: ["equation", "math", "mathjax", "latex"],
  // Auth
  auth: ["authentication", "authorization", "oauth", "oidc", "sso", "login", "signin", "sign-in"],
  authentication: ["auth", "login", "signin", "sign-in", "oauth", "sso"],
  authorization: ["auth", "oauth", "oidc"],
  oauth: ["auth", "oidc", "openid", "authorization"],
  oidc: ["oauth", "openid", "auth"],
  sso: ["auth", "single-sign-on", "single sign-on"],
  login: ["auth", "signin", "sign-in", "authentication"],
  signin: ["login", "sign-in", "auth"],
  "sign-in": ["login", "signin", "auth"],
  // Env / config
  env: ["environment", "envvar", "secret", "binding", "configuration"],
  envvar: ["env", "environment variable", "env var", "configuration"],
  config: ["configuration", "settings", "options"],
  configuration: ["config", "settings", "options"],
  // Networking
  ws: ["websocket", "websockets"],
  websocket: ["ws", "websockets", "realtime", "streaming"],
  websockets: ["ws", "websocket"],
  // Languages
  js: ["javascript"],
  javascript: ["js"],
  ts: ["typescript"],
  typescript: ["ts"],
  // Storage
  db: ["database", "datastore", "kv", "d1"],
  database: ["db", "datastore"],
  // Errors
  crash: ["error", "exception", "fatal", "panic", "fail"],
  error: ["exception", "fail", "crash", "failure"],
  exception: ["error", "throw", "panic"],
  // Common docs concepts
  install: ["installation", "setup", "getting started"],
  installation: ["install", "setup", "getting-started"],
  setup: ["install", "installation", "getting started", "getting-started"],
  api: ["endpoint", "reference"],
  cli: ["command-line", "command line", "terminal"],
  ui: ["interface", "frontend"],
};

// Expand a single term into its alias group using the resolved alias map.
// The first element is always the primary (original) term; the rest are
// aliases in priority order.
function expandTerm(term: string, aliases: Record<string, string[]>): string[] {
  const lower = term.toLowerCase().trim();
  if (!lower) return [];
  const list = aliases[lower];
  if (!list) return [lower];
  // Dedupe while preserving primary-first order.
  const seen = new Set<string>([lower]);
  const out = [lower];
  for (const a of list) {
    const al = a.toLowerCase();
    if (!seen.has(al)) {
      seen.add(al);
      out.push(al);
    }
  }
  return out;
}

// Layer config-supplied alias maps on top of the built-in baseline. Site
// aliases override defaults; repo aliases override both. Each entry is
// fully replaced — there's no "merge values into the existing array"
// semantics, so config can intentionally narrow a default if needed.
function resolveAliasMap(
  site: VellumConfig["site"],
  repo?: { searchAliases?: Record<string, string[]> } | null,
): Record<string, string[]> {
  const out: Record<string, string[]> = { ...DEFAULT_ALIASES };
  const apply = (extra?: Record<string, string[]>) => {
    if (!extra) return;
    for (const [key, vals] of Object.entries(extra)) {
      if (!Array.isArray(vals)) continue;
      out[key.toLowerCase()] = vals.map((v) => String(v).toLowerCase());
    }
  };
  apply(site.searchAliases);
  apply(repo?.searchAliases);
  return out;
}

export async function handleSearch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const repoParam = url.searchParams.get("repo");
  const localeCode = url.searchParams.get("locale") ?? site.site.defaultLocale;
  const limit = clampInt(url.searchParams.get("limit"), 10, 1, 50);
  // verbose=1 widens the excerpt windows, allows more excerpts per hit,
  // and grows the no-match fallback intro. The full-page SearchPage opts
  // in so visitors see substantial body content; the compact dialog stays
  // narrow.
  const verbose = url.searchParams.get("verbose") === "1";
  const excerptOpts = verbose ? VERBOSE_EXCERPT_OPTS : COMPACT_EXCERPT_OPTS;
  if (!q) return Response.json({ hits: [] });

  // Initial parse uses the site-level alias map. We only need it here to
  // honour the `repo:slug` qualifier and decide the target list — each
  // repo re-parses with its own alias overrides layered on top so its
  // synonyms take effect during scoring.
  const siteAliases = resolveAliasMap(site.site);
  const parsed = parseQuery(q, siteAliases);

  // repo=* (or omitted with explicit `all=1`) fans out across every configured repo.
  // Keeping `repo` defaulting to the current repo preserves the in-dialog behaviour
  // — callers that want global search opt in with repo=*.
  const wantAll = repoParam === "*" || url.searchParams.get("all") === "1";
  let targets = wantAll
    ? site.repos
    : site.repos.filter((r) => r.slug === (repoParam ?? site.site.homepageRepo));

  // `excludeFromSearch` is honoured for cross-repo search (where the reader
  // didn't explicitly name a repo). When a caller asks `?repo=excluded-slug`
  // we still serve it — they obviously meant it.
  if (wantAll) {
    targets = targets.filter((r) => !r.excludeFromSearch);
  }

  // `repo:slug` query qualifier filters the in-flight target list further.
  if (parsed.repoFilter) {
    targets = targets.filter((r) => r.slug.toLowerCase() === parsed.repoFilter);
  }

  if (targets.length === 0) return Response.json({ hits: [] });

  const perRepoLimit = wantAll ? Math.max(limit, 10) : limit;
  const repoHits = await Promise.all(
    targets.map(async (repo) => {
      // Re-parse per repo so repo.searchAliases takes effect. Cheap (regex
      // tokenization) compared to the index lookup that follows.
      const repoAliases = resolveAliasMap(site.site, repo);
      const repoParsed = parseQuery(q, repoAliases);
      const index = await getOrBuildIndex(env, ctx, site, repo.slug, localeCode);
      return score(index.docs, repoParsed, repo.slug, repo.displayName, excerptOpts).slice(
        0,
        perRepoLimit,
      );
    }),
  );

  const merged = repoHits.flat().sort((a, b) => b.score - a.score);
  const hits = (wantAll ? merged.slice(0, Math.max(limit, 30)) : merged.slice(0, limit)).map(
    ({ score: _s, ...rest }) => rest,
  );
  return Response.json({ hits });
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw == null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// --- Query parsing -------------------------------------------------------

// Variants of a single bare-word term: primary first, then aliases. The
// scorer AND-matches across groups — within a group, any variant satisfies
// the requirement (primary scores higher than an alias).
type AliasGroup = string[];

interface ParsedQuery {
  required: AliasGroup[]; // bare words (AND, alias-expanded)
  phrases: string[]; // "quoted phrases" (AND, substring, no alias expansion)
  excluded: string[]; // -term (NOT)
  titleTerms: string[]; // title:foo (must appear in title, AND, no expansion)
  repoFilter?: string; // repo:slug (route-level filter)
  // Highlight pool — every term we want to <mark> in the rendered excerpts
  // and titles. Includes the primary required terms, all aliases, all
  // phrases, and titleTerms (not excluded or repoFilter).
  highlights: string[];
}

function parseQuery(raw: string, aliases: Record<string, string[]>): ParsedQuery {
  const out: ParsedQuery = {
    required: [],
    phrases: [],
    excluded: [],
    titleTerms: [],
    highlights: [],
  };

  // Tokenize while respecting double-quoted phrases.
  const tokens: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const c = raw[i]!;
    if (c === '"') {
      const end = raw.indexOf('"', i + 1);
      if (end > i) {
        tokens.push(raw.slice(i, end + 1));
        i = end + 1;
      } else {
        tokens.push(raw.slice(i));
        i = raw.length;
      }
    } else if (/\s/.test(c)) {
      i++;
    } else {
      let end = i;
      while (end < raw.length && !/\s/.test(raw[end]!)) end++;
      tokens.push(raw.slice(i, end));
      i = end;
    }
  }

  const unquote = (s: string) =>
    s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s;

  for (const tokRaw of tokens) {
    if (!tokRaw) continue;
    const lower = tokRaw.toLowerCase();

    // -term (negation). `-"phrase"` is allowed too.
    if (lower.startsWith("-") && lower.length > 1) {
      const v = unquote(tokRaw.slice(1)).toLowerCase();
      if (v) out.excluded.push(v);
      continue;
    }

    // title:value, repo:value (case-insensitive on the key).
    const colon = tokRaw.indexOf(":");
    if (colon > 0) {
      const key = tokRaw.slice(0, colon).toLowerCase();
      const value = unquote(tokRaw.slice(colon + 1)).toLowerCase();
      if (key === "title" && value) {
        out.titleTerms.push(value);
        out.highlights.push(value);
        continue;
      }
      if (key === "repo" && value) {
        out.repoFilter = value;
        continue;
      }
      // Unknown qualifier — fall through and treat as a plain term.
    }

    // Quoted phrase.
    if (tokRaw.startsWith('"') && tokRaw.endsWith('"') && tokRaw.length >= 2) {
      const phrase = tokRaw.slice(1, -1).toLowerCase();
      if (phrase) {
        out.phrases.push(phrase);
        out.highlights.push(phrase);
      }
      continue;
    }

    // Plain word — alias-expand into a variant pool. The whole pool joins
    // the highlight set so the user sees what actually matched (e.g.
    // searching "latex" highlights "mathjax" hits too).
    const variants = expandTerm(lower, aliases);
    if (variants.length > 0) {
      out.required.push(variants);
      for (const v of variants) out.highlights.push(v);
    }
  }

  return out;
}

// --- Index builder -------------------------------------------------------

async function getOrBuildIndex(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  repoSlug: string,
  localeCode: string,
): Promise<SearchIndex> {
  // Cache key carries a schema version: bumped when the IndexedDoc shape
  // changes so old entries (missing `sections`, the old `excerpt:string`
  // shape, etc.) are quietly replaced rather than crashing the scorer.
  const key = `index9:${repoSlug}:${localeCode}`;
  const cached = await readCache<SearchIndex>(env, key);
  if (cached) return cached;

  const repo = site.repos.find((r) => r.slug === repoSlug)!;
  const branch = repoRef(
    repo,
    repo.versions?.find((v) => v.default),
  );
  const tree = await fetchSourceTree(env, repo, branch, { ctx });

  const localeConfig = site.site.locales.find((l) => l.code === localeCode);
  const localeUrlPrefix = localeConfig?.prefix ?? "";
  // Source-side prefix can differ from the URL prefix (default locale lives
  // at the docs root even when its URL is locale-prefixed).
  const localeSrcPrefix = localeConfig
    ? localeSourcePrefix(localeConfig, site.site.defaultLocale)
    : "";
  const docs: IndexedDoc[] = [];
  // When docsRoot is empty / "/" (local-source repos or remote ones with
  // content at the source root), don't prefix-match — local tree paths are
  // like "index.md" not "/index.md", and the empty-string match would shadow
  // them otherwise.
  const rootPrefix = docsRootPrefix(repo.docsRoot);
  const scoped = tree.filter(
    (e) =>
      e.type === "blob" &&
      (!rootPrefix || e.path.startsWith(rootPrefix)) &&
      e.path.endsWith(".md") &&
      (localeSrcPrefix
        ? e.path.includes(`/${localeSrcPrefix}/`) || e.path.startsWith(`${localeSrcPrefix}/`)
        : !site.site.locales.some(
            (l) =>
              l.prefix && (e.path.includes(`/${l.prefix}/`) || e.path.startsWith(`${l.prefix}/`)),
          )),
  );

  // Limit corpus to keep cold-start tractable; large repos can re-tune.
  const MAX = 200;
  await Promise.all(
    scoped.slice(0, MAX).map(async (entry) => {
      const raw = await fetchSourceFile(env, repo, branch, entry.path, { ctx });
      if (!raw) return;
      const url = pageUrl(entry.path, repo, localeSrcPrefix, localeUrlPrefix, repoSlug);
      const built = extractIndexableContent(raw, entry.path, repo.displayName);
      docs.push({
        url,
        title: built.title,
        text: built.text.slice(0, 12000),
        sections: built.sections,
      });
    }),
  );

  const index: SearchIndex = { docs, built: Date.now() };
  ctx.waitUntil(writeCache(env, key, index, ttlSeconds(env, "raw") * 4, ctx));
  return index;
}

// Pulls title + searchable text + section map from a raw markdown file.
// Sections are computed from `#`/`##`/etc. headings; each section's text
// (stripped) is concatenated in order, and the section's offset is the byte
// offset of its first character in the combined text.
function extractIndexableContent(
  raw: string,
  path: string,
  repoDisplayName: string,
): { title: string; text: string; sections: IndexedSection[] } {
  let front: Record<string, unknown> = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    front = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch {
    // Malformed frontmatter — fall back to the raw file. Worst case: a noisy
    // index entry, not a broken endpoint.
  }

  const isHome = (front.layout as string | undefined) === "home";
  const hero = (front.hero as Record<string, unknown> | undefined) ?? {};
  const features = Array.isArray(front.features)
    ? (front.features as Array<Record<string, unknown>>)
    : [];

  const frontTitle = typeof front.title === "string" ? front.title : undefined;
  const heroName = typeof hero.name === "string" ? hero.name : undefined;
  const heroText = typeof hero.text === "string" ? hero.text : undefined;
  const heroTagline = typeof hero.tagline === "string" ? hero.tagline : undefined;
  const description = typeof front.description === "string" ? front.description : undefined;

  let title = "";
  if (frontTitle) title = frontTitle;
  else if (isHome) title = [heroName, heroText].filter(Boolean).join(" — ");
  if (!title) {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1]!.trim();
  }
  if (!title) {
    // index.md on a repo root → use the repo display name; otherwise the slug.
    const slug = path.replace(/\.md$/, "").split("/").pop() ?? "";
    title = slug === "index" ? repoDisplayName : slug;
  }

  const frontPieces: string[] = [];
  if (frontTitle) frontPieces.push(frontTitle);
  if (description) frontPieces.push(description);
  if (heroName) frontPieces.push(heroName);
  if (heroText) frontPieces.push(heroText);
  if (heroTagline) frontPieces.push(heroTagline);
  for (const f of features) {
    if (typeof f.title === "string") frontPieces.push(f.title);
    if (typeof f.details === "string") frontPieces.push(f.details);
    if (typeof f.linkText === "string") frontPieces.push(f.linkText);
  }

  const frontText = stripMarkdown(frontPieces.join("\n")).replace(/\s+/g, " ").trim();
  const bodySegments = splitBodyByHeadings(body);

  // Build the combined text + section map. The frontmatter prelude (when
  // present) is attributed to a synthetic "page top" section so excerpts
  // hitting hero/description don't link to a nonexistent anchor.
  let combined = "";
  const sections: IndexedSection[] = [];
  if (frontText) {
    combined = frontText;
  }
  for (const seg of bodySegments) {
    const stripped = stripMarkdown(seg.body).replace(/\s+/g, " ").trim();
    // Section start = current combined length (after appending a separator).
    if (combined.length > 0) combined += " ";
    const offset = combined.length;
    if (seg.heading) {
      sections.push({
        slug: seg.heading.slug,
        title: seg.heading.title,
        offset,
      });
      combined += seg.heading.title + (stripped ? " " + stripped : "");
    } else {
      combined += stripped;
    }
  }

  return { title, text: combined, sections };
}

// Splits a markdown body into segments at heading boundaries. Each segment
// holds its preceding heading (or null for the prelude before the first H#)
// and the raw markdown body that belongs to it. Heading title is the literal
// inline text; slug is the slugified form anchors.ts would produce.
//
// Tracks fenced code block state so a `# comment` line inside a ```bash
// block isn't misread as an ATX heading. Without this, the splitter would
// cut the fence in half and `stripMarkdown` couldn't pair the orphaned
// ``` markers — the entire code block leaked into search excerpts.
function splitBodyByHeadings(
  body: string,
): Array<{ heading: { slug: string; title: string } | null; body: string }> {
  const lines = body.split("\n");
  const out: Array<{
    heading: { slug: string; title: string } | null;
    body: string;
  }> = [];
  let current: {
    heading: { slug: string; title: string } | null;
    body: string;
  } = { heading: null, body: "" };
  // Tracks the fence string currently open ("```", "````", "~~~", …) so we
  // only close on the matching marker. CommonMark allows ≥ 3 of either
  // character; this is good enough for our excerpt-quality use case.
  let openFence: string | null = null;
  for (const line of lines) {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1]!;
      if (openFence === null) openFence = marker;
      else if (marker[0] === openFence[0] && marker.length >= openFence.length) openFence = null;
      current.body += line + "\n";
      continue;
    }
    if (openFence === null) {
      const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (m) {
        if (current.heading || current.body.trim()) out.push(current);
        const title = m[2]!.replace(/\s*\{[^}]*\}\s*$/, "").trim(); // strip {#explicit-id} trailing attrs
        current = { heading: { slug: slugify(title), title }, body: "" };
        continue;
      }
    }
    current.body += line + "\n";
  }
  if (current.heading || current.body.trim()) out.push(current);
  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/`[^`]*`/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function pageUrl(
  path: string,
  repo: { slug: string; docsRoot: string },
  srcPrefix: string,
  urlPrefix: string,
  repoSlug: string,
): string {
  const rootPrefix = docsRootPrefix(repo.docsRoot);
  const rel = (
    rootPrefix && path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path
  ).replace(/\.md$/, "");
  const stripped =
    srcPrefix && rel.startsWith(`${srcPrefix}/`) ? rel.slice(srcPrefix.length + 1) : rel;
  const final = stripped === "index" ? "" : stripped;
  // Locale-first URL shape — matches the canonical form produced by router.ts.
  const base = `${urlPrefix ? `/${urlPrefix}` : ""}/${repoSlug}`;
  return `${base}/${final}`.replace(/\/+/g, "/").replace(/\/$/, "") || base;
}

// Strip markdown formatting that's noisy in search excerpts while preserving
// content that should style as code in the rendered hit (backtick spans).
// Backticks survive into the indexed text so renderInlineMarkdown can wrap
// them in `<code>` after the highlighter has injected `<mark>` tags. Table
// pipes get collapsed — otherwise excerpts spanning a table read as a wall
// of "| | |".
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → link text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1") // emphasis with underscores
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1") // emphasis with asterisks
    .replace(/~~([^~]+)~~/g, "$1") // strikethrough
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/^\s*#{1,6}\s+/gm, "") // ATX headings (defensive — splitter already removed)
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, " ") // table separator rows (---|---|---)
    .replace(/\s*\|\s*/g, " ") // remaining table pipes → spaces
    .replace(/\s+/g, " ")
    .trim();
}

// Render the small slice of inline markdown that survives stripMarkdown into
// HTML. Currently just backtick code spans — applied to escaped + highlighted
// strings, so `<mark>` injected by the highlighter stays intact when it's
// inside (or wraps part of) a code span.
//
// Two defences against the snippet-boundary problem: excerpt extraction cuts
// text mid-content, so the resulting slice can have unbalanced backticks
// that would otherwise pair up wrong.
//
//   1. Strip any orphan leading/trailing backtick when the total count is
//      odd. Pre-trim is cheaper than trying to reason about which pairing
//      is "right" after the fact.
//   2. Cap the inner content at 100 chars. Real inline code is rarely
//      longer than that; if a match grows past, it's almost certainly a
//      pair spanning unrelated code spans and would render large runs of
//      prose as monospace.
function renderInlineMarkdown(html: string): string {
  const ticks = (html.match(/`/g) || []).length;
  let s = html;
  if (ticks % 2 === 1) {
    // Heuristic: drop the orphan that's closest to a content edge. If the
    // first backtick is near the start, it's likely the leftover closer
    // from a code span the snippet cut into; otherwise drop the last one.
    const first = s.indexOf("`");
    const last = s.lastIndexOf("`");
    if (first >= 0 && (first < s.length - last || last < 0)) {
      s = s.slice(0, first) + s.slice(first + 1);
    } else if (last >= 0) {
      s = s.slice(0, last) + s.slice(last + 1);
    }
  }
  return s.replace(/`([^`\n]{1,100})`/g, "<code>$1</code>");
}

// --- Scoring -------------------------------------------------------------

function score(
  docs: IndexedDoc[],
  query: ParsedQuery,
  repoSlug: string,
  repoDisplayName: string,
  excerptOpts: ExcerptOpts,
): Array<SearchHit & { score: number }> {
  const hits: Array<SearchHit & { score: number }> = [];
  for (const doc of docs) {
    const hay = doc.text.toLowerCase();
    const titleHay = doc.title.toLowerCase();
    let s = 0;
    let matched = false;

    // title:foo — require all title terms in the title.
    let titleOk = true;
    for (const t of query.titleTerms) {
      if (!titleHay.includes(t)) {
        titleOk = false;
        break;
      }
      s += 10;
      matched = true;
    }
    if (!titleOk) continue;

    // Required (bare) terms — AND across alias groups. Within a group,
    // ANY variant satisfies the requirement; primary matches score higher
    // than alias matches so a doc using the canonical term still wins.
    let requiredOk = true;
    for (const group of query.required) {
      let bestPoints = 0;
      for (let v = 0; v < group.length; v++) {
        const variant = group[v]!;
        const inTitle = titleHay.includes(variant);
        const inBody = hay.includes(variant);
        if (!inTitle && !inBody) continue;
        // Primary (v === 0) keeps the original weights; aliases scale down
        // so canonical-term hits float above alias-only hits.
        const titleScore = inTitle ? (v === 0 ? 5 : 2) : 0;
        const bodyScore = inBody ? (v === 0 ? 1 : 0.4) : 0;
        const points = titleScore + bodyScore;
        if (points > bestPoints) bestPoints = points;
      }
      if (bestPoints === 0) {
        requiredOk = false;
        break;
      }
      s += bestPoints;
      matched = true;
    }
    if (!requiredOk) continue;

    // Phrases — same AND, but the phrase must be a substring.
    let phrasesOk = true;
    for (const p of query.phrases) {
      const inTitle = titleHay.includes(p);
      const inBody = hay.includes(p);
      if (!inTitle && !inBody) {
        phrasesOk = false;
        break;
      }
      if (inTitle) s += 8;
      if (inBody) s += 3;
      matched = true;
    }
    if (!phrasesOk) continue;

    // Excluded terms — drop doc if any appear in title or body.
    let excluded = false;
    for (const t of query.excluded) {
      if (titleHay.includes(t) || hay.includes(t)) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;

    // No positive terms at all (query was only excludes / repo:) — skip.
    if (!matched) continue;

    hits.push({
      url: doc.url,
      title: doc.title,
      titleHtml: highlightText(doc.title, query.highlights),
      excerpts: makeExcerpts(doc.text, doc.sections, query.highlights, excerptOpts),
      repo: repoSlug,
      repoDisplayName,
      score: s,
    });
  }
  return hits.sort((a, b) => b.score - a.score);
}

// Wraps every occurrence of any highlight term in `<mark>`. Used for the
// title cell and the excerpt clustering logic.
//
// Single-pass alternation regex (longest first) so an alias that contains
// the primary term as a substring — e.g. `config` expanded to
// `["config", "configuration"]` — doesn't re-mark text the longer variant
// already wrapped, which would produce broken `<mark><mark>…</mark>…</mark>`.
//
// Inline markdown (backtick code spans) is rendered after highlighting so
// `<mark>` already wraps any matched term inside the eventual `<code>`.
function highlightText(text: string, terms: string[]): string {
  const escaped = escapeHtml(text);
  const re = buildHighlightRegex(terms);
  const marked = re ? escaped.replace(re, "<mark>$1</mark>") : escaped;
  return renderInlineMarkdown(marked);
}

function buildHighlightRegex(terms: string[]): RegExp | null {
  const uniq = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (uniq.length === 0) return null;
  return new RegExp(`(${uniq.map(escapeRe).join("|")})`, "ig");
}

// --- Excerpts ------------------------------------------------------------

// Tunables for the excerpt-building stage. Two presets live below: a
// compact one for the in-dialog list (one short snippet per hit) and a
// verbose one the full-page search uses to show substantial body content.
interface ExcerptOpts {
  maxExcerpts: number;
  // Match positions within this distance get merged into one cluster so we
  // don't emit overlapping snippets.
  clusterGap: number;
  // Chars of body context to include before / after the first / last
  // matched position in a cluster.
  padBefore: number;
  padAfter: number;
  // Length of the "no body match" intro snippet. Hits matched only via
  // their title get this slice of the page's prelude / first section.
  introLen: number;
}

const COMPACT_EXCERPT_OPTS: ExcerptOpts = {
  maxExcerpts: 3,
  clusterGap: 200,
  padBefore: 60,
  padAfter: 140,
  introLen: 200,
};

const VERBOSE_EXCERPT_OPTS: ExcerptOpts = {
  maxExcerpts: 5,
  clusterGap: 500,
  padBefore: 220,
  padAfter: 480,
  introLen: 600,
};

function makeExcerpts(
  text: string,
  sections: IndexedSection[],
  terms: string[],
  opts: ExcerptOpts,
): ExcerptOut[] {
  const intro = (): ExcerptOut => {
    const slice = text.slice(0, opts.introLen);
    const suffix = text.length > opts.introLen ? "…" : "";
    return { html: escapeHtml(slice) + suffix };
  };

  if (terms.length === 0) return [intro()];

  const lower = text.toLowerCase();
  // Collect every match position for every term. Cap total positions so a
  // term that appears 1000 times doesn't dominate cluster building.
  const positions: number[] = [];
  for (const t of terms) {
    let from = 0;
    let found = 0;
    while (found < 50) {
      const pos = lower.indexOf(t, from);
      if (pos < 0) break;
      positions.push(pos);
      from = pos + Math.max(1, t.length);
      found++;
    }
  }
  positions.sort((a, b) => a - b);

  // No matches in the body (e.g. matched only via title) — return a single
  // intro snippet so the card isn't blank.
  if (positions.length === 0) return [intro()];

  // Cluster nearby positions so we don't emit overlapping excerpts.
  const clusters: number[][] = [];
  for (const p of positions) {
    const last = clusters[clusters.length - 1];
    if (last && p - last[last.length - 1]! < opts.clusterGap) {
      last.push(p);
    } else {
      clusters.push([p]);
    }
  }

  const out: ExcerptOut[] = [];
  const highlightRe = buildHighlightRegex(terms);
  for (const cluster of clusters.slice(0, opts.maxExcerpts)) {
    const first = cluster[0]!;
    const last = cluster[cluster.length - 1]!;
    const start = Math.max(0, first - opts.padBefore);
    const end = Math.min(text.length, last + opts.padAfter);
    const snip = text.slice(start, end);
    const escaped = escapeHtml(snip);
    const marked = highlightRe ? escaped.replace(highlightRe, "<mark>$1</mark>") : escaped;
    const html = renderInlineMarkdown(marked);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < text.length ? "…" : "";
    const section = findSection(sections, first);
    out.push({
      html: prefix + html + suffix,
      sectionSlug: section?.slug,
      sectionTitle: section?.title,
      sectionTitleHtml: section ? renderInlineMarkdown(escapeHtml(section.title)) : undefined,
    });
  }
  return out;
}

function findSection(sections: IndexedSection[] | undefined, pos: number): IndexedSection | null {
  if (!sections) return null;
  let best: IndexedSection | null = null;
  for (const s of sections) {
    if (s.offset > pos) break;
    best = s;
  }
  return best;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
