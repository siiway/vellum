// WebMCP (https://webmachinelearning.github.io/webmcp/): offers the site's
// search as a tool to an AI agent working in the reader's browser. Browsers
// without the API skip it. The tool runs the same client-side search as the
// search dialog, loaded only when an agent calls it.

import type { LocaleConfig, VellumConfig } from "../shared/types";

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema?: object;
  execute: (input: Record<string, unknown> | undefined) => Promise<unknown>;
  annotations?: { readOnlyHint?: boolean };
}

interface ModelContext {
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void> | void;
}

export async function registerTools(config: VellumConfig): Promise<void> {
  // Older Chrome builds put it on navigator.
  const context =
    (document as { modelContext?: ModelContext }).modelContext ??
    (navigator as { modelContext?: ModelContext }).modelContext;
  if (!context) return;

  const { title, locales } = config.site;
  const repos = config.repos.filter((r) => !r.excludeFromSearch);
  const localeList = locales.map((l) => `${l.code} (${l.label})`).join(", ");
  const properties: Record<string, object> = {
    query: {
      type: "string",
      description:
        'Words every result must contain. Also supports "exact phrase", -excluded and title:word.',
    },
  };
  if (repos.length) {
    properties.repo = {
      type: "string",
      description: `Only search these docs: ${repos.map((r) => `${r.slug} (${r.displayName})`).join(", ")}. Leave out to search them all.`,
      enum: repos.map((r) => r.slug),
    };
  }
  properties.locale = {
    type: "string",
    description: `Language of the pages: ${localeList}. Defaults to the current page's.`,
    enum: locales.map((l) => l.code),
  };

  try {
    await context.registerTool({
      name: "search_docs",
      description: `Search the documentation on this site (${title}). Returns the best matching pages, each with its URL and excerpts under the section they appear in.`,
      inputSchema: { type: "object", properties, required: ["query"] },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const { query, repo, locale } = input ?? {};
        if (typeof query !== "string" || !query.trim()) {
          throw new Error("query must be a non-empty string");
        }
        // An unknown value would search nothing and look like no match.
        const slug = given(repo) ? String(repo).toLowerCase() : "*";
        if (slug !== "*" && !repos.some((r) => r.slug === slug)) {
          throw new Error(
            `Unknown repo ${JSON.stringify(repo)}. Use one of: ${repos.map((r) => r.slug).join(", ")}.`,
          );
        }
        const target = given(locale) ? findLocale(locales, String(locale)) : currentLocale(config);
        if (!target) {
          throw new Error(`Unknown locale ${JSON.stringify(locale)}. Use one of: ${localeList}.`);
        }

        const { search } = await import("../shared/search");
        const hits = await search(config, { q: query, repo: slug, locale: target.code });
        return {
          results: hits.map((hit) => {
            const url = new URL(hit.url, location.origin).href;
            return {
              title: hit.title,
              url,
              docs: hit.repoDisplayName,
              excerpts: hit.excerpts.map((e) => ({
                section: e.sectionTitle,
                url: e.sectionSlug ? `${url}#${e.sectionSlug}` : undefined,
                text: plainText(e.html),
              })),
            };
          }),
        };
      },
    });
  } catch (e) {
    console.warn("[vellum] WebMCP: registering search_docs failed", e);
  }
}

function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

// A locale by its code ("en") or URL prefix ("en-US"), the form the site's
// URLs show.
function findLocale(locales: LocaleConfig[], value: string): LocaleConfig | undefined {
  const v = value.toLowerCase();
  return locales.find(
    (l) => l.code.toLowerCase() === v || (l.prefix && l.prefix.toLowerCase() === v),
  );
}

// The locale of the page the reader is on, from its URL's prefix.
function currentLocale(config: VellumConfig): LocaleConfig | undefined {
  const { locales, defaultLocale } = config.site;
  const first = location.pathname.split("/")[1] ?? "";
  return (
    locales.find((l) => l.prefix && l.prefix === first) ??
    locales.find((l) => !l.prefix) ??
    locales.find((l) => l.code === defaultLocale) ??
    locales[0]
  );
}

// An excerpt's highlighted HTML as text.
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
