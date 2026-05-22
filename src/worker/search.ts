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
}

export interface SearchHit {
  url: string;
  title: string;
  excerpts: ExcerptOut[];
  repo: string;
  repoDisplayName: string;
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
  if (!q) return Response.json({ hits: [] });

  const parsed = parseQuery(q);

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
      const index = await getOrBuildIndex(env, ctx, site, repo.slug, localeCode);
      return score(index.docs, parsed, repo.slug, repo.displayName).slice(0, perRepoLimit);
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

interface ParsedQuery {
  required: string[]; // bare words (AND)
  phrases: string[]; // "quoted phrases" (AND, substring)
  excluded: string[]; // -term (NOT)
  titleTerms: string[]; // title:foo (must appear in title, AND)
  repoFilter?: string; // repo:slug (route-level filter)
  // Highlight pool — every term we want to <mark> in the rendered excerpts.
  // Includes required + phrases + titleTerms (not excluded or repoFilter).
  highlights: string[];
}

function parseQuery(raw: string): ParsedQuery {
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

    // Plain word.
    out.required.push(lower);
    out.highlights.push(lower);
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
  const key = `index4:${repoSlug}:${localeCode}`;
  const cached = await readCache<SearchIndex>(env, key);
  if (cached) return cached;

  const repo = site.repos.find((r) => r.slug === repoSlug)!;
  const branch = repoRef(
    repo,
    repo.versions?.find((v) => v.default),
  );
  const tree = await fetchSourceTree(env, repo, branch, { ctx });

  const localePrefix = site.site.locales.find((l) => l.code === localeCode)?.prefix ?? "";
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
      (localePrefix
        ? e.path.includes(`/${localePrefix}/`) || e.path.startsWith(`${localePrefix}/`)
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
      const url = pageUrl(entry.path, repo, localePrefix, repoSlug);
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
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      if (current.heading || current.body.trim()) out.push(current);
      const title = m[2]!.replace(/\s*\{[^}]*\}\s*$/, "").trim(); // strip {#explicit-id} trailing attrs
      current = { heading: { slug: slugify(title), title }, body: "" };
    } else {
      current.body += line + "\n";
    }
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
  localePrefix: string,
  repoSlug: string,
): string {
  const rootPrefix = docsRootPrefix(repo.docsRoot);
  const rel = (
    rootPrefix && path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path
  ).replace(/\.md$/, "");
  const stripped =
    localePrefix && rel.startsWith(`${localePrefix}/`) ? rel.slice(localePrefix.length + 1) : rel;
  const final = stripped === "index" ? "" : stripped;
  // Locale-first URL shape — matches the canonical form produced by router.ts.
  const base = `${localePrefix ? `/${localePrefix}` : ""}/${repoSlug}`;
  return `${base}/${final}`.replace(/\/+/g, "/").replace(/\/$/, "") || base;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Scoring -------------------------------------------------------------

function score(
  docs: IndexedDoc[],
  query: ParsedQuery,
  repoSlug: string,
  repoDisplayName: string,
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

    // Required (bare) terms — AND across title OR body.
    let requiredOk = true;
    for (const t of query.required) {
      const inTitle = titleHay.includes(t);
      const inBody = hay.includes(t);
      if (!inTitle && !inBody) {
        requiredOk = false;
        break;
      }
      if (inTitle) s += 5;
      if (inBody) s += 1;
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
      excerpts: makeExcerpts(doc.text, doc.sections, query.highlights),
      repo: repoSlug,
      repoDisplayName,
      score: s,
    });
  }
  return hits.sort((a, b) => b.score - a.score);
}

// --- Excerpts ------------------------------------------------------------

const MAX_EXCERPTS = 3;
const CLUSTER_GAP = 200; // chars — matches within this distance cluster together
const EXCERPT_PAD_BEFORE = 60;
const EXCERPT_PAD_AFTER = 140;

function makeExcerpts(text: string, sections: IndexedSection[], terms: string[]): ExcerptOut[] {
  if (terms.length === 0) {
    return [{ html: text.slice(0, 200) + (text.length > 200 ? "..." : "") }];
  }

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

  if (positions.length === 0) {
    // No matches in the body (e.g. matched only via title) — return a single
    // intro snippet so the card isn't blank.
    return [{ html: text.slice(0, 200) + (text.length > 200 ? "..." : "") }];
  }

  // Cluster nearby positions so we don't emit overlapping excerpts.
  const clusters: number[][] = [];
  for (const p of positions) {
    const last = clusters[clusters.length - 1];
    if (last && p - last[last.length - 1]! < CLUSTER_GAP) {
      last.push(p);
    } else {
      clusters.push([p]);
    }
  }

  const out: ExcerptOut[] = [];
  for (const cluster of clusters.slice(0, MAX_EXCERPTS)) {
    const first = cluster[0]!;
    const last = cluster[cluster.length - 1]!;
    const start = Math.max(0, first - EXCERPT_PAD_BEFORE);
    const end = Math.min(text.length, last + EXCERPT_PAD_AFTER);
    const snip = text.slice(start, end);
    let html = escapeHtml(snip);
    for (const t of terms) {
      const re = new RegExp(`(${escapeRe(t)})`, "ig");
      html = html.replace(re, "<mark>$1</mark>");
    }
    const prefix = start > 0 ? "..." : "";
    const suffix = end < text.length ? "..." : "";
    const section = findSection(sections, first);
    out.push({
      html: prefix + html + suffix,
      sectionSlug: section?.slug,
      sectionTitle: section?.title,
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
