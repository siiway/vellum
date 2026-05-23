// Regenerates src/shared/site-schema.json from the VellumConfig TypeScript
// interface in src/shared/types.ts.
//
// The bulk (shape, required-vs-optional, enum members) comes from
// ts-json-schema-generator reading the .ts file directly, so adding a field to
// VellumConfig automatically flows through. A small CURATED_OVERRIDES table
// then layers on the things TypeScript can't express:
//
//   - human-readable descriptions for each property
//   - regex patterns (slug, theme-color hex)
//   - conditional requireds (owner/repo/branch only when source==="github")
//   - oneOf on NavItem (link XOR items)
//   - additionalProperties:false on every object so config typos squiggle
//
// Run with `bun scripts/gen-site-schema.ts` (or `bun run gen:schema`).

import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGenerator, type Config } from "ts-json-schema-generator";

const ROOT = resolve(import.meta.dir, "..");
const TYPES_PATH = resolve(ROOT, "src/shared/types.ts");
const OUTPUT_PATH = resolve(ROOT, "src/shared/site-schema.json");

const config: Config = {
  path: TYPES_PATH,
  tsconfig: resolve(ROOT, "tsconfig.json"),
  type: "VellumConfig",
  // Keep only the types reachable from VellumConfig — we don't want every
  // unrelated interface in types.ts ending up in $defs.
  expose: "export",
  jsDoc: "extended",
  topRef: false,
  // Strict means the generator errors instead of silently skipping unsupported
  // constructs. Worth the noise.
  skipTypeCheck: false,
};

console.log(`Reading ${TYPES_PATH}`);
const generator = createGenerator(config);
const generated = generator.createSchema("VellumConfig") as Schema;

// --- Curated overrides ---------------------------------------------------
//
// Each entry is keyed by the type name as it appears in `$defs` after
// generation (matching the interface name in types.ts). Properties listed in
// `descriptions` overwrite the property's `description` field; `propertyPatches`
// is a deep-merge applied to the property's schema.

interface OverrideTable {
  descriptions?: Record<string, string>;
  propertyPatches?: Record<string, Record<string, unknown>>;
  required?: string[];
  allOf?: unknown[];
  oneOf?: unknown[];
}

const OVERRIDES: Record<string, OverrideTable> = {
  VellumConfig: {
    descriptions: {
      site: "Site-wide settings (brand, locales, landing page).",
      repos: "Documentation sources rendered by this Vellum deployment.",
      nav: "Site-level top navigation. Each repo can also declare its own nav (vellum.json `nav` or VitePress themeConfig.nav) which takes precedence inside that repo.",
    },
  },
  SiteConfig: {
    descriptions: {
      title: "Brand name shown in the NavBar and as the SSR <title> suffix.",
      tagline: "Short subtitle shown on the landing page hero.",
      logo: "URL of the site logo (SVG recommended).",
      favicon: "URL of the favicon.",
      themeColor: '<meta name="theme-color"> value, e.g. "#0078d4".',
      footer: "Footer text rendered below every page.",
      homepageRepo:
        "Slug of the repo whose root acts as the site's landing page. `/` redirects here, and the NavBar brand link points here with the current locale preserved.",
      defaultLocale: "Locale code used when the URL has no locale prefix.",
      locales: "All supported locales. Order is preserved in the language picker.",
      socialLinks:
        'Icon-only links rendered in the NavBar between the locale picker and theme toggle. Built-in icons cover github / gitlab / x / discord / slack / mastodon / bluesky / youtube / linkedin / instagram / facebook / npm / rss / stackoverflow / reddit / twitch / telegram; custom glyphs go via `{ svg: "<svg ...>" }`.',
      aiSummary:
        'Microsoft Learn-style "AI Summary" button rendered below the page title on doc pages. Omit the whole block to disable the feature. Credentials (API keys, Turnstile secret) live in worker env vars, not this file.',
      aiChat:
        '"Ask AI" chat drawer. Floating button bottom-right opens a chat panel; the model can call docs tools (search_docs, fetch_page, list_repos, list_pages) to answer questions across the site. Omit the whole block to disable. Shares provider credentials with aiSummary.',
      translate:
        "Machine translation. When configured, the worker fills in every locale listed in `targets` by running source markdown, sidebar labels, frontmatter strings, UI labels, and repo display strings through the provider. Translations are cached in the VELLUM_TRANSLATION_DB D1 binding and refreshed on webhook (per repo) or after `refreshDays` (hourly cron). Hand-translated files in a repo's locale subdir always win over the machine output. Omit to disable.",
      searchAliases:
        "Search synonyms. Each key is a term a reader might type; the value is the list of words the docs author probably used for the same concept. A reader searching for any of these terms also matches pages containing the others (alias hits score below primary hits). Merged on top of a built-in baseline (latex/math, auth/oauth, ws/websocket, …) so config only needs to spell out product-specific vocabulary.",
    },
    propertyPatches: {
      themeColor: {
        pattern: "^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
      },
      logo: { format: "uri-reference" },
      favicon: { format: "uri-reference" },
    },
  },
  AiSummaryConfig: {
    descriptions: {
      provider:
        '"workers-ai" uses the env.AI binding (Cloudflare Workers AI; no API key needed). "openai-compatible" calls any OpenAI-shaped Chat Completions endpoint (OpenAI itself, OpenRouter, Together, Groq, llama.cpp, …) using VELLUM_AI_API_KEY and VELLUM_AI_BASE_URL. "anthropic" calls the Anthropic Messages API with VELLUM_AI_API_KEY.',
      model:
        'Model identifier passed verbatim to the provider. Defaults: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" (workers-ai), "openai/gpt-4o-mini" (openai-compatible), "claude-haiku-4-5" (anthropic).',
      baseUrl:
        'Base URL override for openai-compatible providers, e.g. "https://openrouter.ai/api/v1". The VELLUM_AI_BASE_URL env var takes precedence when set.',
      turnstileSiteKey:
        "Cloudflare Turnstile site key. When set, the AI Summary button mounts an invisible Turnstile widget and the worker verifies the token before calling the model. Pairs with the VELLUM_TURNSTILE_SECRET worker secret.",
      cacheTtlSeconds:
        "How long to retain a generated summary in KV before regenerating it. Defaults to 604800 (7 days).",
    },
    propertyPatches: {
      baseUrl: { format: "uri-reference" },
      cacheTtlSeconds: { minimum: 60 },
    },
  },
  AiChatConfig: {
    descriptions: {
      provider:
        'Same matrix as AiSummaryConfig.provider. Note that tool calling (used by the chat agent to fetch docs) is most reliably supported by "openai-compatible" and "anthropic"; "workers-ai" works with a smaller model menu.',
      model:
        'Model id. Defaults: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" (workers-ai), "openai/gpt-4o-mini" (openai-compatible), "claude-haiku-4-5" (anthropic). A stronger reasoning model is often worth the extra cost here.',
      baseUrl: "Base URL override for openai-compatible providers.",
      turnstileSiteKey:
        "Cloudflare Turnstile site key. When set, the visitor solves one invisible challenge per chat session and the worker issues a 60-minute signed session token that subsequent messages present. Pairs with VELLUM_TURNSTILE_SECRET.",
      maxIterations:
        "Maximum agent loop iterations (model-call → tool-call rounds) per user message. Defaults to 6.",
    },
    propertyPatches: {
      baseUrl: { format: "uri-reference" },
      maxIterations: { minimum: 1, maximum: 12 },
    },
  },
  LocaleConfig: {
    descriptions: {
      code: 'Locale code (e.g. "en", "zh", "ja"). Used in cache keys and i18n lookup.',
      label: "Human-readable name shown in the language picker.",
      prefix:
        'URL segment for this locale (e.g. "zh" → /repo/zh/...). Empty string means the locale lives at the root of each repo.',
      machineTranslated:
        "Set automatically at config load when this locale comes from `site.translate.targets` rather than being declared explicitly. Authors should never set this by hand. UI uses it to badge translated pages and to skip the locale-subdir lookup.",
    },
  },
  TranslateConfig: {
    descriptions: {
      provider:
        'Same matrix as AiSummaryConfig.provider. "workers-ai" can use a dedicated MT model (e.g. @cf/meta/m2m100-1.2b); "openai-compatible" and "anthropic" route through a general chat model with a markdown-preserving system prompt.',
      model:
        'Model id. Defaults: "@cf/meta/m2m100-1.2b" (workers-ai), "openai/gpt-4o-mini" (openai-compatible), "claude-haiku-4-5" (anthropic).',
      baseUrl: "Base URL override for openai-compatible providers.",
      targets:
        'Locale codes to auto-translate into. Pass an array of BCP47-style codes (e.g. `["es", "fr", "ja", "zh-CN"]`) or the sentinel `"all"` to expand to every language in the IANA ISO 639-1 registry (~180 bare-language codes, sourced via the `iso-639-1` npm package). Region-coded variants like `zh-CN`/`pt-BR` aren\'t in the bare ISO 639-1 base set — list them explicitly. Each resolved code is merged into `site.locales` at load time with machineTranslated:true and a label resolved via ISO 639-1 / Intl.DisplayNames. Codes already declared in `site.locales` are skipped.',
      refreshDays:
        "How long a cached translation row is considered fresh. Defaults to 5. The hourly cron tick re-runs the provider on rows older than this. Webhooks bust rows immediately on push, so this is the background-drift interval.",
      concurrency:
        "Max in-flight translation calls per refresh tick. Defaults to 4. Tune against provider rate limits.",
      batchSize:
        "Per-tick row budget for the scheduled refresher. Defaults to 50. Caps CPU + outbound-fetch time per cron invocation.",
    },
    propertyPatches: {
      baseUrl: { format: "uri-reference" },
      refreshDays: { minimum: 1, maximum: 365 },
      concurrency: { minimum: 1, maximum: 32 },
      batchSize: { minimum: 1, maximum: 500 },
    },
  },
  RepoConfig: {
    descriptions: {
      slug: 'URL segment for the repo (e.g. "prism" → /prism/...). Must be unique within `repos[]`.',
      source:
        'Where the markdown lives. "github" (default) reads from raw.githubusercontent.com; "local" reads from local-docs/{slug}/ bundled into the worker\'s ASSETS at build time.',
      owner: 'GitHub owner. Required when source is "github".',
      repo: 'GitHub repo name. Required when source is "github".',
      branch:
        "Default branch to fetch from. Used as the cache key suffix and as the fallback when no `versions[]` is declared.",
      docsRoot:
        'Path inside the repo (or local source) to the docs tree, e.g. "docs". Empty string means the repo root is the docs root.',
      displayName: "Human-readable name shown in the NavBar brand crumb and 404 suggestions.",
      description:
        "Short tagline shown on the repo's home page and as the SSR meta description fallback.",
      logo: "URL of the per-repo logo (SVG recommended).",
      editLinkPattern:
        'Template for the "Edit this page" link in the page footer. `:path` is substituted with the docs-root-relative path. Omit for local repos.',
      versions:
        "Optional version selector. Default version is used when no version is encoded in the URL.",
      localPath:
        "Override for where local-source files live. Defaults to `local-docs/{slug}`. Path is relative to the project root.",
      hideInBrand:
        "When true, the NavBar omits this repo's displayName crumb after the site title. Useful for the homepageRepo so the brand doesn't read \"Site | Site\".",
      excludeFromSearch:
        'When true, the repo is omitted from search results in both the per-repo dialog scope picker and the cross-repo full-page search. Use for landing-page repos and other "system" content the reader shouldn\'t be sent to by a query.',
      socialLinks:
        "Per-repo override for site.socialLinks. Shown in the NavBar while the reader is inside this repo. The repo's own vellum.json#socialLinks or VitePress themeConfig.socialLinks take higher priority when present.",
      searchAliases:
        "Per-repo search synonyms. Layered on top of the site-level alias map (and the built-in baseline) when searching within this repo. Use for vocabulary that only makes sense for this product — e.g. mapping a code-name to its public-facing term.",
    },
    propertyPatches: {
      slug: { pattern: "^[a-z0-9][a-z0-9-]*$" },
      logo: { format: "uri-reference" },
      source: { default: "github" },
    },
    // Conditional required: github source ⇒ owner+repo+branch all required.
    // Encoded as an if/then so the JSON-Schema-aware editors actually enforce
    // it, not just document it.
    allOf: [
      {
        if: {
          anyOf: [
            { not: { required: ["source"] } },
            { properties: { source: { const: "github" } } },
          ],
        },
        then: {
          required: ["owner", "repo", "branch"],
        },
      },
    ],
  },
  RepoVersion: {
    descriptions: {
      label: 'Human-readable label shown in the version picker (e.g. "v2", "main", "next").',
      branch: "Git branch / ref this version corresponds to.",
      default: "True for the version selected when no explicit version is encoded in the URL.",
    },
  },
  NavItem: {
    descriptions: {
      text: "Label shown in the NavBar.",
      link: "Destination URL or site-relative path. Omit when this item is a dropdown trigger (use `items`).",
      items: "Children — turns this nav entry into a dropdown menu.",
      activeMatch:
        "Regex (against the current page's repo-relative path) that marks this entry as active. Lets a nav entry stay highlighted across a whole section.",
    },
    propertyPatches: {
      activeMatch: { format: "regex" },
    },
    // A nav entry without either `link` or `items` is unreachable — surface
    // that as a schema error rather than letting the author ship dead chrome.
    oneOf: [{ required: ["link"] }, { required: ["items"] }],
  },
};

applyOverrides(generated);

// --- Final shape ---------------------------------------------------------
//
// Spread `generated` FIRST, then overlay our header keys, so the
// generator-supplied `$schema` (draft-07) doesn't clobber our explicit one,
// and our `title`/`description` survive in the published file.

const finalSchema = {
  ...generated,
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://siiway.org/vellum/site-schema.json",
  title: "Vellum site config",
  description:
    "Top-level config consumed by the Vellum worker. Generated from " +
    "src/shared/types.ts by scripts/gen-site-schema.ts — edit the types " +
    "or that script's OVERRIDES table, not this file.",
};

// Allow `$schema` on the root config so the existing
// `"$schema": "./src/shared/site-schema.json"` line in vellum.config.json
// doesn't trip the additionalProperties:false guard below.
if (finalSchema.type === "object") {
  finalSchema.additionalProperties = false;
  (finalSchema.properties as Record<string, unknown>) = {
    $schema: { type: "string" },
    ...(finalSchema.properties as Record<string, unknown> | undefined),
  };
}

const serialized = JSON.stringify(finalSchema, null, 2) + "\n";

// Skip write when the file is already up-to-date so CI can run this in
// --check mode and `git diff --exit-code` stays clean.
let previous: string | null = null;
try {
  previous = readFileSync(OUTPUT_PATH, "utf8");
} catch {
  // ENOENT — first run.
}

if (previous === serialized) {
  console.log(`No changes; ${OUTPUT_PATH} already matches generator output.`);
} else {
  writeFileSync(OUTPUT_PATH, serialized);
  console.log(`Wrote ${OUTPUT_PATH} (${serialized.length} bytes).`);
}

// -------------------------------------------------------------------------
// Helpers

interface Schema {
  // ts-json-schema-generator emits draft-07 `definitions`. Keep both keys in
  // the type so the overrides walker doesn't care which dialect upstream
  // happens to use.
  definitions?: Record<string, ObjectSchema>;
  $defs?: Record<string, ObjectSchema>;
  type?: string;
  properties?: Record<string, ObjectSchema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  [k: string]: unknown;
}

interface ObjectSchema extends Schema {
  description?: string;
  pattern?: string;
  format?: string;
  enum?: unknown[];
  items?: ObjectSchema | ObjectSchema[];
  default?: unknown;
  anyOf?: ObjectSchema[];
  allOf?: ObjectSchema[];
  oneOf?: ObjectSchema[];
}

function applyOverrides(root: Schema): void {
  // Either dialect; ts-json-schema-generator uses `definitions` (draft-07).
  const defs = root.$defs ?? root.definitions ?? {};
  for (const [typeName, table] of Object.entries(OVERRIDES)) {
    const def = typeName === "VellumConfig" ? root : defs[typeName];
    if (!def) {
      console.warn(`OVERRIDES references missing type "${typeName}" — skipped.`);
      continue;
    }

    // Force additionalProperties:false on every object def so authors get
    // squiggles on typos. Skipping the root is intentional — handled below
    // alongside the $schema property allow-list.
    if (typeName !== "VellumConfig" && def.type === "object") {
      def.additionalProperties = false;
    }

    if (table.descriptions && def.properties) {
      for (const [prop, desc] of Object.entries(table.descriptions)) {
        const target = def.properties[prop];
        if (!target) {
          console.warn(`OVERRIDES.${typeName}.descriptions["${prop}"] — property missing.`);
          continue;
        }
        target.description = desc;
      }
    }

    if (table.propertyPatches && def.properties) {
      for (const [prop, patch] of Object.entries(table.propertyPatches)) {
        const target = def.properties[prop];
        if (!target) {
          console.warn(`OVERRIDES.${typeName}.propertyPatches["${prop}"] — property missing.`);
          continue;
        }
        Object.assign(target, patch);
      }
    }

    if (table.allOf) def.allOf = [...(def.allOf ?? []), ...(table.allOf as ObjectSchema[])];
    if (table.oneOf) def.oneOf = [...(def.oneOf ?? []), ...(table.oneOf as ObjectSchema[])];
    if (table.required) {
      def.required = Array.from(new Set([...(def.required ?? []), ...table.required]));
    }
  }
}
