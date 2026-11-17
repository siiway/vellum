// Builds the search index of one repo in one locale: the pages' titles,
// searchable text and section map, which shared/search.ts scores in the
// browser.

import matter from "gray-matter";
import type { IndexedDoc, IndexedSection, SearchIndex } from "../shared/search";

// Caps that keep one index a reasonable download.
const MAX_DOCS = 200;
const MAX_TEXT = 12000;

export interface IndexPage {
  // The page's canonical URL.
  url: string;
  // Its source path, used for a title of last resort.
  path: string;
  raw: string;
}

export function buildSearchIndex(pages: IndexPage[], repoDisplayName: string): SearchIndex {
  const docs: IndexedDoc[] = [...pages]
    .sort((a, b) => a.url.localeCompare(b.url))
    .slice(0, MAX_DOCS)
    .map((page) => {
      const built = extractIndexableContent(page.raw, page.path, repoDisplayName);
      return {
        url: page.url,
        title: built.title,
        text: built.text.slice(0, MAX_TEXT),
        sections: built.sections,
      };
    });
  return { docs };
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
    // Options skip gray-matter's cache, which would keep every file for the
    // whole build.
    const parsed = matter(raw, {});
    front = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch {
    // Malformed frontmatter — fall back to the raw file. Worst case: a noisy
    // index entry, not a failed build.
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
