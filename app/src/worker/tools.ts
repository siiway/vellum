// Docs tools surfaced to LLMs. Same implementations are reused by:
//   - /api/ask: the in-browser chat agent, called server-side inside the
//     tool-calling loop.
//   - /api/mcp: an external MCP transport, so Claude Desktop / ChatGPT
//     Connectors / any MCP client can drive the same tools from outside.
//
// Each tool returns a small JSON payload the model can read. The text
// fields are deliberately compact — we strip markdown the same way the
// summarize endpoint does to keep token budgets sane.

import type { Env } from "./env";
import type { RepoConfig, VellumConfig } from "../shared/types";
import { localeSourcePrefix } from "../shared/types";
import { fetchSourceFile, fetchSourceTree, repoRef, docsRootPrefix } from "./sources";
import { markdownToPlain } from "./summarize";

// --- Tool descriptors -----------------------------------------------------
//
// The descriptor table is the source of truth for the tool's name +
// description + JSON schema. Both /api/ask and /api/mcp lift their tool
// catalogues from here so the model and the external client see the same
// shape.

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export type ToolScope = "current-repo" | "site";

// Build the catalogue. When scope is "current-repo" we still expose the
// repo parameter so the model can fall back gracefully if the user broadens
// the question — but the catalogue's description nudges it to stay put.
export function buildToolDefs(scope: ToolScope, currentRepo: string | null): ToolDef[] {
  const repoHint =
    scope === "current-repo" && currentRepo
      ? ` When the user is reading the "${currentRepo}" repo, prefer staying in that repo unless the question is clearly cross-repo.`
      : "";

  return [
    {
      name: "search_docs",
      description:
        "Full-text search across documentation pages. Returns at most 10 hits with page URL, title, and a one-line excerpt. Use this first when you need to locate the page that answers a question." +
        repoHint,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Search query — words, exact phrases ("..."), or `title:foo` / `-term` operators.',
          },
          repo: {
            type: "string",
            description: "Restrict to a single repo slug. Omit to search every repo on the site.",
          },
          locale: {
            type: "string",
            description: 'Locale code, e.g. "en", "zh". Defaults to the site default locale.',
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "fetch_page",
      description:
        "Fetch a single documentation page as plain text (markdown stripped). Use when you have a specific page URL or you want to read more than the search excerpt shows." +
        repoHint,
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repo slug." },
          page: {
            type: "string",
            description:
              'Repo-relative page path without `.md` and without locale prefix, e.g. "configuration" or "guides/auth/setup". Use "index" for the repo root.',
          },
          locale: {
            type: "string",
            description: 'Locale code, e.g. "en", "zh". Defaults to the site default locale.',
          },
        },
        required: ["repo", "page"],
        additionalProperties: false,
      },
    },
    {
      name: "list_repos",
      description:
        "List every repo on this docs site, with slug, display name, and short description. Use to discover what's available before searching.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "list_pages",
      description:
        "List every markdown page in a repo. Returns up to 200 page paths. Use to find the right page when search doesn't quite match." +
        repoHint,
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Repo slug." },
          locale: {
            type: "string",
            description: "Locale code. Defaults to the site default locale.",
          },
        },
        required: ["repo"],
        additionalProperties: false,
      },
    },
  ];
}

// --- Tool dispatch --------------------------------------------------------

export interface ToolContext {
  env: Env;
  ctx: ExecutionContext;
  site: VellumConfig;
  scope: ToolScope;
  currentRepo: string | null;
  defaultLocale: string;
}

export interface ToolResult {
  // Compact JSON-serializable payload returned to the model.
  content: unknown;
  // One-line summary surfaced to the chat UI ("Searched 'auth' → 4 hits").
  // Not seen by the model — pure UX affordance.
  summary: string;
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  tctx: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case "search_docs":
      return searchDocs(args, tctx);
    case "fetch_page":
      return fetchPage(args, tctx);
    case "list_repos":
      return listRepos(tctx);
    case "list_pages":
      return listPages(args, tctx);
    default:
      return {
        content: { error: `Unknown tool: ${name}` },
        summary: `Unknown tool: ${name}`,
      };
  }
}

// --- Implementations ------------------------------------------------------

async function searchDocs(args: Record<string, unknown>, tctx: ToolContext): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { content: { error: "Empty query." }, summary: "Empty query." };

  const repoFilter = enforceScope(args.repo, tctx);
  const locale = pickLocale(args.locale, tctx);

  // Delegate to the public search endpoint so we benefit from the existing
  // index + cache layer. We hit it as an internal fetch so any improvements
  // to ranking land here for free.
  const url = new URL("https://vellum.internal/api/search");
  url.searchParams.set("q", query);
  url.searchParams.set("locale", locale);
  url.searchParams.set("limit", "10");
  if (repoFilter) url.searchParams.set("repo", repoFilter);
  else url.searchParams.set("repo", "*");

  // Inline import to avoid an import cycle with router.ts.
  const { handleSearch } = await import("./search");
  const res = await handleSearch(new Request(url.toString()), tctx.env, tctx.ctx, tctx.site);
  type SearchResp = {
    hits?: Array<{
      url: string;
      title: string;
      repoDisplayName: string;
      excerpts?: Array<{ html: string }>;
    }>;
  };
  const json = (await res.json()) as SearchResp;
  const hits = (json.hits ?? []).slice(0, 10).map((h) => ({
    url: h.url,
    title: h.title,
    repo: h.repoDisplayName,
    excerpt: stripHtml(h.excerpts?.[0]?.html ?? "").slice(0, 240),
  }));

  return {
    content: { query, hits },
    summary: `Searched "${query}" → ${hits.length} hit${hits.length === 1 ? "" : "s"}${repoFilter ? ` in ${repoFilter}` : ""}`,
  };
}

async function fetchPage(args: Record<string, unknown>, tctx: ToolContext): Promise<ToolResult> {
  const repoSlug = String(args.repo ?? "");
  const pagePath = String(args.page ?? "").replace(/^\/+|\/+$/g, "");
  if (!repoSlug || !pagePath) {
    return { content: { error: "repo and page are required." }, summary: "Missing args." };
  }
  if (pagePath.includes("..") || pagePath.includes("\\")) {
    return { content: { error: "Bad page path." }, summary: "Bad page path." };
  }

  const repo = tctx.site.repos.find((r) => r.slug === repoSlug);
  if (!repo) {
    return {
      content: { error: `Unknown repo: ${repoSlug}` },
      summary: `Unknown repo: ${repoSlug}`,
    };
  }
  if (tctx.scope === "current-repo" && tctx.currentRepo && repoSlug !== tctx.currentRepo) {
    return {
      content: {
        error: `Out of scope: this conversation is restricted to "${tctx.currentRepo}".`,
      },
      summary: `Refused fetch outside ${tctx.currentRepo}.`,
    };
  }

  const locale = pickLocale(args.locale, tctx);
  // URL-side prefix (BCP47 form like "en-US", "zh-CN") for building user-
  // facing links; source-side prefix (empty for the default locale, short
  // `code` for others — see `localeSourcePrefix`) for locating the actual
  // markdown file. The two are decoupled by design.
  const localeConfig = tctx.site.site.locales.find((l) => l.code === locale);
  const localeUrlPrefix = localeConfig?.prefix ?? "";
  const localeSrcPrefix = localeConfig
    ? localeSourcePrefix(localeConfig, tctx.site.site.defaultLocale)
    : "";
  const branch = repoRef(repo);

  const source = await firstMatch(tctx.env, tctx.ctx, repo, branch, localeSrcPrefix, pagePath);
  if (!source) {
    return {
      content: { error: `Page not found: ${repoSlug}/${pagePath}` },
      summary: `Not found: ${repoSlug}/${pagePath}`,
    };
  }

  const { plainText, title } = markdownToPlain(source);
  // Models pay per-token, so cap the body. 8K chars is plenty for one page
  // worth of context; larger pages get summarized by their leading prose.
  const trimmed = plainText.length > 8000 ? plainText.slice(0, 8000) + "\n…(truncated)" : plainText;

  return {
    content: {
      repo: repoSlug,
      page: pagePath,
      locale,
      title: title ?? deriveTitle(pagePath),
      url: buildPageUrl(repoSlug, pagePath, localeUrlPrefix),
      text: trimmed,
    },
    summary: `Fetched ${repoSlug}/${pagePath}`,
  };
}

function listRepos(tctx: ToolContext): Promise<ToolResult> {
  const repos = tctx.site.repos
    .filter((r) => !r.excludeFromSearch)
    .map((r) => ({
      slug: r.slug,
      displayName: r.displayName,
      description: r.description,
      source: r.source ?? "github",
    }));
  return Promise.resolve({
    content: { repos },
    summary: `Listed ${repos.length} repo${repos.length === 1 ? "" : "s"}`,
  });
}

async function listPages(args: Record<string, unknown>, tctx: ToolContext): Promise<ToolResult> {
  const repoSlug = enforceScope(args.repo, tctx);
  if (!repoSlug) {
    return { content: { error: "repo is required." }, summary: "Missing repo." };
  }
  const repo = tctx.site.repos.find((r) => r.slug === repoSlug);
  if (!repo) {
    return {
      content: { error: `Unknown repo: ${repoSlug}` },
      summary: `Unknown repo: ${repoSlug}`,
    };
  }

  const locale = pickLocale(args.locale, tctx);
  // Tree paths follow the on-disk layout, so we filter with the source-side
  // prefix (empty for default locale, short `code` for others), not the
  // BCP47 URL prefix.
  const localeConfig = tctx.site.site.locales.find((l) => l.code === locale);
  const localeSrcPrefix = localeConfig
    ? localeSourcePrefix(localeConfig, tctx.site.site.defaultLocale)
    : "";
  const branch = repoRef(repo);

  const tree = await fetchSourceTree(tctx.env, repo, branch, { ctx: tctx.ctx });
  const docsPrefix = docsRootPrefix(repo.docsRoot);
  const locPrefix = localeSrcPrefix ? `${localeSrcPrefix}/` : "";

  const pages = tree
    .filter((e) => e.type === "blob" && e.path.endsWith(".md"))
    .map((e) =>
      docsPrefix && e.path.startsWith(docsPrefix) ? e.path.slice(docsPrefix.length) : e.path,
    )
    .map((p) => p.replace(/\.md$/, ""))
    // Strip the locale prefix and the README/index special cases.
    .filter((p) => (locPrefix ? p.startsWith(locPrefix) : !hasLocaleSrcPrefix(p, tctx.site)))
    .map((p) => (locPrefix && p.startsWith(locPrefix) ? p.slice(locPrefix.length) : p))
    .filter((p) => p && !p.endsWith("/_includes") && !p.startsWith("_"))
    .slice(0, 200);

  return {
    content: { repo: repoSlug, locale, pages },
    summary: `Listed ${pages.length} page${pages.length === 1 ? "" : "s"} in ${repoSlug}`,
  };
}

// --- Helpers --------------------------------------------------------------

function enforceScope(argValue: unknown, tctx: ToolContext): string | null {
  const requested = typeof argValue === "string" && argValue.length ? argValue : null;
  if (tctx.scope === "current-repo" && tctx.currentRepo) {
    // Force-pin to the current repo regardless of what the model asks for.
    return tctx.currentRepo;
  }
  return requested;
}

function pickLocale(argValue: unknown, tctx: ToolContext): string {
  if (typeof argValue === "string") {
    const hit = tctx.site.site.locales.find((l) => l.code === argValue);
    if (hit) return hit.code;
  }
  return tctx.defaultLocale;
}

// Match against the source-side layout (subdir named after each non-default
// locale's short `code`) — used to exclude translated pages when the caller
// asked for the default locale.
function hasLocaleSrcPrefix(path: string, site: VellumConfig): boolean {
  return site.site.locales.some((l) => {
    const src = localeSourcePrefix(l, site.site.defaultLocale);
    return src && path.startsWith(`${src}/`);
  });
}

function deriveTitle(pagePath: string): string {
  const name = pagePath.split("/").pop() ?? pagePath;
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildPageUrl(repoSlug: string, pagePath: string, localePrefix: string): string {
  const base = localePrefix ? `/${localePrefix}/${repoSlug}` : `/${repoSlug}`;
  return pagePath === "index" ? base : `${base}/${pagePath}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function firstMatch(
  env: Env,
  ctx: ExecutionContext,
  repo: RepoConfig,
  branch: string,
  localePrefix: string,
  pagePath: string,
): Promise<string | null> {
  const base = docsRootPrefix(repo.docsRoot);
  const loc = localePrefix ? `${localePrefix}/` : "";
  const candidates = new Set<string>();
  candidates.add(`${base}${loc}${pagePath}.md`);
  candidates.add(`${base}${loc}${pagePath}/index.md`);
  if (pagePath === "index") {
    candidates.add(`${base}${loc}index.md`);
    candidates.add(`${base}${loc}README.md`);
  }
  for (const path of [...candidates].map((p) => p.replace(/\/+/g, "/"))) {
    const text = await fetchSourceFile(env, repo, branch, path, { ctx });
    if (text) return text;
  }
  return null;
}
