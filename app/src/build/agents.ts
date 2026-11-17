// Files that let AI agents find their way around the site:
//
//   /.well-known/agent-skills/index.json      the skills index
//     (https://github.com/cloudflare/agent-skills-discovery-rfc), listing
//   /.well-known/agent-skills/{name}/SKILL.md one skill: what the site
//     documents, in which languages, and how to find and read a page
//   /.well-known/ard.json                     the ARD catalog
//     (https://agenticresourcediscovery.org), listing the same skill
//   /.well-known/ai-catalog.json              the same catalog at the path
//     of ARD's predecessor, which older readers and agent-readiness checkers
//     still look for
//
// They need absolute URLs, so like the sitemap they're only written when
// `site.url` is set. They depend only on the config.

import { createHash } from "node:crypto";
import type { VellumConfig } from "../shared/types";
import { canonicalHref } from "../shared/paths";

export const SKILLS_INDEX_PATH = "/.well-known/agent-skills/index.json";
export const ARD_PATH = "/.well-known/ard.json";
const AI_CATALOG_PATH = "/.well-known/ai-catalog.json";

// Output path → content.
export function buildAgentFiles(site: VellumConfig, origin: string): Record<string, string> {
  const host = new URL(origin);
  // The site's host as a skill name, so skills from different sites don't
  // clash: docs.example.com → docs-example-com.
  const name =
    host.hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/-+$/, "") || "docs";
  const skillPath = `/.well-known/agent-skills/${name}/SKILL.md`;
  const skill = buildSkill(site, origin, name);
  const digest = `sha256:${createHash("sha256").update(skill.text, "utf8").digest("hex")}`;

  const index = {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name,
        type: "skill-md",
        description: skill.description,
        url: `${origin}${skillPath}`,
        digest,
      },
    ],
  };

  const { title } = site.site;
  // The catalog asks for 2 to 5.
  const queries = [
    `${title} documentation`,
    ...skill.repos.map((repo) => `${repo.displayName} docs`),
  ].slice(0, 5);
  if (queries.length < 2) queries.push(`Search the ${title} docs`);
  const catalog = {
    specVersion: "1.0",
    host: {
      displayName: title,
      // did:web encodes a port's colon.
      identifier: `did:web:${host.host.replace(":", "%3A")}`,
    },
    entries: [
      {
        identifier: `urn:air:${host.hostname}:skills:${name}`,
        displayName: `${title} docs`,
        description: skill.description,
        type: "application/agent-skills+md",
        url: `${origin}${skillPath}`,
        digest,
        representativeQueries: queries,
      },
    ],
  };

  return {
    [skillPath]: skill.text,
    [SKILLS_INDEX_PATH]: json(index),
    [ARD_PATH]: json(catalog),
    [AI_CATALOG_PATH]: json(catalog),
  };
}

function buildSkill(site: VellumConfig, origin: string, name: string) {
  const { title, locales, defaultLocale } = site.site;
  const fallback = locales.find((l) => l.code === defaultLocale) ?? locales[0]!;
  const repos = site.repos.filter((r) => !r.excludeFromSearch);
  const names = repos.map((r) => r.displayName);
  const covers = names.length ? ` It covers ${list(names)}.` : "";
  // At most 1024 characters, the Agent Skills limit.
  const description =
    `Find and read the documentation published at ${origin} (${title}).${covers} Use it to answer questions from these docs.`.slice(
      0,
      1024,
    );

  const lines = [
    "---",
    // JSON strings are YAML strings.
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    `# ${title}`,
    "",
    `${origin} is a static documentation site. Every page is also published as`,
    "Markdown at its URL plus `.md` (`/guide/setup` → `/guide/setup.md`): fetch that",
    "instead of the HTML. Its links to other pages point at their Markdown.",
  ];
  if (repos.length) {
    lines.push("", "## Docs", "");
    for (const repo of repos) {
      const url = `${origin}${canonicalHref(`/${repo.slug}`, site, fallback.code)}`;
      const about = repo.description ? `: ${repo.description}` : "";
      lines.push(`- [${repo.displayName}](${url})${about}`);
    }
  }
  if (locales.length > 1) {
    const prefixed = locales.filter((l) => l.prefix);
    lines.push(
      "",
      "## Languages",
      "",
      `Pages are published in ${list(locales.map((l) => `${l.label} (\`${l.code}\`)`))}.`,
    );
    if (prefixed.length) {
      lines.push(
        `The first path segment names the language: ${list(prefixed.map((l) => `\`/${l.prefix}\` is ${l.label}`))}.`,
        "A translated page has the same path after it.",
      );
    }
  }
  lines.push(
    "",
    "## Finding a page",
    "",
    `${origin}/sitemap.xml lists every page, with links between its translations.`,
    "Page paths follow the docs' source files, so a path usually names its topic.",
    "In a browser that supports WebMCP, the site's pages also offer a `search_docs` tool.",
    "",
  );
  return { text: lines.join("\n"), description, repos };
}

// "a", "a and b", "a, b and c".
function list(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join("");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
