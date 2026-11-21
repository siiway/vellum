// Client-side search over the indexes the build publishes, one per repo per
// locale (see build/search-index.ts). The dialog and the full-page search
// both call `search`; it's loaded with a dynamic import, so the scoring code
// stays out of the entry bundle until someone searches.
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

import type { VellumConfig } from "./types";
import { searchIndexPath } from "./paths";

export interface IndexedSection {
  // Slug of the nearest preceding heading. Anchors built by anchors.ts use
  // the same slugifier, so a hit's #anchor lands on the same heading.
  slug: string;
  title: string;
  // Byte offset of the section's start within `text`. Used to map an excerpt
  // position back to a section heading.
  offset: number;
}

export interface IndexedDoc {
  url: string;
  title: string;
  // Concatenated searchable text: frontmatter title/description/hero/features
  // (for home pages) followed by the stripped body. Hero text appears first so
  // it shows up prominently in excerpts.
  text: string;
  sections: IndexedSection[];
}

export interface SearchIndex {
  docs: IndexedDoc[];
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
// likely to have used.
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
      // A qualifier still being typed (`title:`) is no term yet, so the
      // rest of the query keeps its results.
      if ((key === "title" || key === "repo") && !value) continue;
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

// --- Search --------------------------------------------------------------

export interface SearchParams {
  q: string;
  // A repo slug, or "*" for every repo that isn't excluded from search.
  repo: string;
  locale: string;
  // The most hits to return: by default 30 across every repo, 10 in one.
  limit?: number;
  // Wider excerpt windows, more excerpts per hit and a longer no-match
  // intro. The full-page search opts in; the compact dialog stays narrow.
  verbose?: boolean;
}

// Each index is fetched once per page load.
const indexes = new Map<string, Promise<IndexedDoc[]>>();

function loadIndex(locale: string, repo: string): Promise<IndexedDoc[]> {
  const url = searchIndexPath(locale, repo);
  let hit = indexes.get(url);
  if (!hit) {
    hit = fetch(url).then(async (res) => {
      // A repo with no pages in this locale has no index.
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return ((await res.json()) as SearchIndex).docs;
    });
    // A failed fetch is retried by the next search.
    hit.catch(() => indexes.delete(url));
    indexes.set(url, hit);
  }
  return hit;
}

export async function search(config: VellumConfig, params: SearchParams): Promise<SearchHit[]> {
  const q = params.q.trim();
  if (!q) return [];
  const wantAll = params.repo === "*";
  const limit = Math.max(1, Math.min(50, Math.trunc(params.limit ?? (wantAll ? 30 : 10))));
  const excerptOpts = params.verbose ? VERBOSE_EXCERPT_OPTS : COMPACT_EXCERPT_OPTS;

  // The site-level parse only decides the target list (it honours the
  // `repo:slug` qualifier); each repo re-parses with its own alias overrides
  // layered on top so its synonyms take effect during scoring.
  const parsed = parseQuery(q, resolveAliasMap(config.site));

  // `excludeFromSearch` is honoured for cross-repo search, where the reader
  // didn't name a repo. A search scoped to an excluded repo still runs.
  let targets = wantAll
    ? config.repos.filter((r) => !r.excludeFromSearch)
    : config.repos.filter((r) => r.slug === params.repo);
  if (parsed.repoFilter) {
    targets = targets.filter((r) => r.slug.toLowerCase() === parsed.repoFilter);
  }
  if (targets.length === 0) return [];

  const repoHits = await Promise.all(
    targets.map(async (repo) => {
      const repoParsed = parseQuery(q, resolveAliasMap(config.site, repo));
      const docs = await loadIndex(params.locale, repo.slug);
      return score(docs, repoParsed, repo.slug, repo.displayName, excerptOpts).slice(0, limit);
    }),
  );

  const merged = repoHits.flat().sort((a, b) => b.score - a.score);
  return merged.slice(0, limit).map(({ score: _s, ...rest }) => rest);
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
