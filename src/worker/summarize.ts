// AI Summary endpoint. Microsoft Learn-style "AI Summary" button at the top of
// every doc page POSTs here; the worker fetches the page's markdown, strips it
// to plain text, runs it through the provider configured in
// `vellum.config.json → site.aiSummary`, and streams tokens back over SSE.
//
// Provider matrix:
//   - workers-ai        →  env.AI binding (no API key needed)
//   - openai-compatible →  bearer-auth POST to {baseUrl}/chat/completions
//                          (OpenAI, OpenRouter, Together, Groq, llama.cpp, …)
//   - anthropic         →  x-api-key POST to /v1/messages
//
// Each provider's native stream format is normalized to a single SSE shape:
//   event: token   data: {"text":"…"}
//   event: done    data: {"model":"…","cached":false}
//   event: error   data: {"message":"…"}
//
// Final summaries land in KV (per repo/branch/locale/page) so the next reader
// gets the cached version in one shot, no model call, no captcha hop.

import matter from "gray-matter";
import type { Env } from "./env";
import type { AiSummaryConfig, RepoConfig, VellumConfig } from "../shared/types";
import { localeSourcePrefix } from "../shared/types";
import { fetchSourceFile, repoRef, docsRootPrefix } from "./sources";
import { readCache, writeCache } from "./cache";
import { resolveEndpoints, runWithFailover, type ResolvedEndpoint } from "./ai-endpoints";

// --- Public entrypoint ----------------------------------------------------

export async function handleSummarize(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
): Promise<Response> {
  const ai = site.site.aiSummary;
  if (!ai) {
    return sseError("AI Summary is disabled for this site.", 404);
  }

  if (request.method !== "POST") {
    return sseError("Method not allowed.", 405);
  }

  type Body = {
    repo?: string;
    branch?: string;
    locale?: string;
    // Repo-relative page path with no leading slash and no `.md` suffix.
    // Matches the same shape the router resolves URLs into.
    page?: string;
    // Cloudflare Turnstile token, present only when aiSummary.turnstileSiteKey
    // is configured site-wide.
    turnstileToken?: string;
    // Cache-bypass for the regenerate button.
    fresh?: boolean;
  };

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return sseError("Invalid JSON body.", 400);
  }

  const route = resolveRoute(site, body);
  if (!route) {
    return sseError("Unknown repo / locale / page.", 404);
  }

  // Captcha gate. We skip it if the site config doesn't set a sitekey OR the
  // env doesn't carry a secret — that combination lets local dev work without
  // shoving fake tokens around. Misconfigurations (sitekey without secret, or
  // vice versa) fail closed.
  if (ai.turnstileSiteKey || env.VELLUM_TURNSTILE_SECRET) {
    if (!ai.turnstileSiteKey || !env.VELLUM_TURNSTILE_SECRET) {
      return sseError(
        "Turnstile is half-configured: set both site.aiSummary.turnstileSiteKey and VELLUM_TURNSTILE_SECRET.",
        500,
      );
    }
    if (!body.turnstileToken) {
      return sseError("Missing captcha token.", 400);
    }
    const ok = await verifyTurnstile(
      env.VELLUM_TURNSTILE_SECRET,
      body.turnstileToken,
      request.headers.get("cf-connecting-ip"),
    );
    if (!ok) {
      return sseError("Captcha verification failed.", 403);
    }
  }

  const cacheKey = summaryCacheKey(route);
  const ttl = Math.max(60, ai.cacheTtlSeconds ?? 60 * 60 * 24 * 7);

  if (!body.fresh) {
    const cached = await readCache<{ summary: string; model: string }>(env, cacheKey);
    if (cached?.summary) {
      return streamCached(cached.summary, cached.model);
    }
  }

  // Fetch the underlying markdown. We deliberately use the SAME path resolver
  // the router uses (locale prefix + .md / /index.md) so cached summaries
  // line up with the URL the reader is on.
  const source = await fetchPageMarkdown(env, ctx, site, route);
  if (!source) {
    return sseError("Could not load the page source to summarize.", 404);
  }

  const { plainText, title } = markdownToPlain(source);
  if (plainText.length < 80) {
    return sseError("This page is too short to summarize.", 400);
  }

  const prompt = buildPrompt({
    title,
    body: truncate(plainText, 12_000),
    locale: route.localeCode,
  });

  return streamFromProvider(env, site, ai, prompt, ctx, cacheKey, ttl);
}

// --- Route resolution -----------------------------------------------------

function resolveRoute(
  site: VellumConfig,
  body: { repo?: string; branch?: string; locale?: string; page?: string },
): { repo: RepoConfig; branch: string; localeCode: string; pagePath: string } | null {
  if (!body.repo || !body.page) return null;
  const repo = site.repos.find((r) => r.slug === body.repo);
  if (!repo) return null;

  const localeCode =
    body.locale && site.site.locales.find((l) => l.code === body.locale)
      ? body.locale
      : site.site.defaultLocale;

  const branch = body.branch || repoRef(repo);

  // Defence in depth: reject anything that looks like a path traversal so an
  // adversarial caller can't read e.g. ../.git/config through the source
  // fetcher. The router already constrains real URLs to safe shapes.
  const cleaned = body.page.replace(/^\/+|\/+$/g, "");
  if (cleaned.includes("..") || cleaned.includes("\\")) return null;

  return { repo, branch, localeCode, pagePath: cleaned || "index" };
}

async function fetchPageMarkdown(
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
  route: { repo: RepoConfig; branch: string; localeCode: string; pagePath: string },
): Promise<string | null> {
  // Source-side prefix is decoupled from the URL prefix: the default locale's
  // files sit at the docs root regardless of its URL prefix, and non-default
  // locales live under a subdir named after the short `code` (not the BCP47
  // `prefix`). See `localeSourcePrefix` and the matching logic in router.ts.
  const localeConfig = site.site.locales.find((l) => l.code === route.localeCode);
  const localePath = localeConfig ? localeSourcePrefix(localeConfig, site.site.defaultLocale) : "";
  for (const path of pageCandidates(route.repo, localePath, route.pagePath)) {
    const text = await fetchSourceFile(env, route.repo, route.branch, path, { ctx });
    if (text) return text;
  }
  return null;
}

function pageCandidates(repo: RepoConfig, localePath: string, pagePath: string): string[] {
  const base = docsRootPrefix(repo.docsRoot);
  const loc = localePath ? `${localePath}/` : "";
  const path = pagePath.replace(/^\/+/, "");
  const list = new Set<string>();
  list.add(`${base}${loc}${path}.md`);
  list.add(`${base}${loc}${path}/index.md`);
  if (path === "index") {
    list.add(`${base}${loc}index.md`);
    list.add(`${base}${loc}README.md`);
  }
  return [...list].map((p) => p.replace(/\/+/g, "/"));
}

function summaryCacheKey(route: {
  repo: RepoConfig;
  branch: string;
  localeCode: string;
  pagePath: string;
}): string {
  return `aisum:v1:${route.repo.slug}@${route.branch}:${route.localeCode}:${route.pagePath}`;
}

// --- Markdown stripper ----------------------------------------------------

interface PlainPage {
  plainText: string;
  title: string | null;
}

// Turn markdown into something a small model can chew through without choking
// on triple-colon containers, code fences, or HTML. This isn't a real parser
// — we already have one in src/worker/markdown — but reaching into that AST
// would mean re-rendering through the full Shiki + Kroki pipeline just to
// throw the result away. A regex pass is two orders of magnitude cheaper.
export function markdownToPlain(source: string): PlainPage {
  // Pull frontmatter out so its YAML scalars don't end up in the prose.
  const { content, data } = matter(source);
  const fmTitle = typeof data.title === "string" ? data.title.trim() : null;

  let s = content;

  // Code fences (```…```) and inline code (`…`) — replace with a placeholder
  // so models can tell something was elided without trying to summarise it.
  s = s.replace(/```[a-zA-Z0-9_-]*\n[\s\S]*?```/g, " [code] ");
  s = s.replace(/~~~[a-zA-Z0-9_-]*\n[\s\S]*?~~~/g, " [code] ");
  s = s.replace(/`([^`\n]+)`/g, "$1");

  // VitePress/OPS containers — keep the body, drop the marker.
  s = s.replace(/^:::+\s*[^\n]*$/gm, "");

  // OPS shorthands — `[!INCLUDE [...]]`, `[!code-...]`, `[!NOTE]`, …
  s = s.replace(/\[!INCLUDE\s+\[[^\]]*\]\([^)]*\)\]/g, "");
  s = s.replace(/\[!code-[^\]]+\]\([^)]*\)/g, " [code] ");
  s = s.replace(/\[!\w+\]/g, "");

  // Raw HTML / Vue components — strip tags, keep inner text.
  s = s.replace(/<[^>]+>/g, " ");

  // Images — keep alt text only.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Links — keep label, drop URL.
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");

  // Reference-style link definitions, e.g. `[id]: https://…`.
  s = s.replace(/^\s*\[[^\]]+\]:\s*\S.*$/gm, "");

  // Heading markers + emphasis markers + blockquote markers.
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/_([^_]+)_/g, "$1");
  s = s.replace(/~~([^~]+)~~/g, "$1");
  s = s.replace(/^>\s?/gm, "");

  // Tables — strip the leading/trailing pipes and the alignment row.
  s = s.replace(/^\s*\|?\s*[:-]+\s*(\|\s*[:-]+\s*)+\|?\s*$/gm, "");
  s = s.replace(/\|/g, " ");

  // List bullets / task markers.
  s = s.replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");

  // Collapse runaway whitespace.
  s = s
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { plainText: s, title: fmTitle };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // Cut at the nearest sentence boundary if there is one inside the last
  // few hundred chars; otherwise hard-cut at the limit.
  const slice = text.slice(0, max);
  const lastStop = slice.lastIndexOf(".");
  return lastStop > max - 400 ? slice.slice(0, lastStop + 1) : slice;
}

// --- Prompt ---------------------------------------------------------------

function buildPrompt(args: { title: string | null; body: string; locale: string }): {
  system: string;
  user: string;
} {
  // Locale-aware response language. We don't enumerate every locale here;
  // the model is told to "respond in the language of the article" plus we
  // give it the BCP-47-ish code as a hint.
  const localeHint =
    args.locale === "zh"
      ? "Respond in Simplified Chinese (zh-CN)."
      : args.locale === "en"
        ? "Respond in English."
        : `Respond in the language whose code is "${args.locale}".`;

  const system =
    "You produce concise documentation summaries in the style of Microsoft Learn's AI Summary feature. " +
    "Output 2 to 4 short paragraphs, plain prose, no lists, no headings, no code blocks, no markdown decorations. " +
    "Focus on what the page is about, who it's for, and the key facts a reader would want before diving in. " +
    "Do not invent details that aren't in the source. Do not preface the summary with phrases like " +
    `"This page" or "Summary:". ${localeHint}`;

  const user = (args.title ? `Title: ${args.title}\n\n` : "") + `Article:\n${args.body}`;

  return { system, user };
}

// --- Streaming providers --------------------------------------------------

function streamFromProvider(
  env: Env,
  site: VellumConfig,
  ai: AiSummaryConfig,
  prompt: { system: string; user: string },
  ctx: ExecutionContext,
  cacheKey: string,
  ttl: number,
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = (event: string, data: unknown) =>
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  // Buffer of accumulated tokens, written to KV on completion.
  let collected = "";
  let modelLabel = ai.model ?? "ai";

  const finish = async (err?: unknown) => {
    if (err) {
      await send("error", { message: err instanceof Error ? err.message : String(err) });
    } else if (collected.trim().length > 0) {
      await send("done", { model: modelLabel, cached: false });
      ctx.waitUntil(
        writeCache(env, cacheKey, { summary: collected.trim(), model: modelLabel }, ttl, ctx),
      );
    } else {
      await send("error", { message: "Model returned an empty response." });
    }
    await writer.close();
  };

  const onToken = async (text: string) => {
    if (!text) return;
    collected += text;
    await send("token", { text });
  };

  // Two-phase provider call so failover can fire on the upstream's POST
  // response status without re-emitting any tokens that have already been
  // streamed to the client:
  //
  //   1. `openProvider(ep)` issues the POST, throws on a non-2xx so
  //      `runWithFailover` can retry against the next endpoint.
  //   2. The returned `drain` closure consumes the upstream stream
  //      verbatim into onToken. Mid-stream errors here propagate as
  //      stream errors — no retry, no duplicate tokens.
  ctx.waitUntil(
    (async () => {
      try {
        const endpoints = resolveEndpoints(ai, site, env);
        const drain = await runWithFailover(
          "[vellum][summarize]",
          endpoints,
          async (ep) => {
            const model = ep.model ?? defaultModelFor(ep.provider);
            modelLabel = `${ep.id}:${model}`;
            if (ep.provider === "workers-ai") {
              return openWorkersAi(env, ep, model, prompt);
            }
            if (ep.provider === "anthropic") {
              return openAnthropic(ep, model, prompt);
            }
            return openOpenAi(ep, model, prompt);
          },
          (info) => {
            // Mirror failover state to the client so a "Trying foo (1/3)…"
            // status line can render under the loading spinner. Non-fatal;
            // we swallow the writer error if the client has hung up.
            void send("provider", {
              id: info.endpoint.id,
              provider: info.endpoint.provider,
              model: info.endpoint.model,
              attempt: info.attempt,
              total: info.total,
              status: info.status,
              error: info.error,
            }).catch(() => undefined);
          },
        );
        await drain(onToken);
        await finish();
      } catch (err) {
        await finish(err).catch(() => undefined);
      }
    })(),
  );

  return new Response(readable, { status: 200, headers: sseHeaders() });
}

// Drains the upstream into onToken. Returned by each `open*` runner so
// the failover wrapper can decide whether to retry (open phase) or
// commit (drain phase).
type Drain = (onToken: (text: string) => Promise<void>) => Promise<void>;

function defaultModelFor(provider: "workers-ai" | "openai-compatible" | "anthropic"): string {
  switch (provider) {
    case "workers-ai":
      return "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    case "openai-compatible":
      return "openai/gpt-4o-mini";
    case "anthropic":
      return "claude-haiku-4-5";
  }
}

// --- Workers AI -----------------------------------------------------------

async function openWorkersAi(
  env: Env,
  ep: ResolvedEndpoint,
  model: string,
  prompt: { system: string; user: string },
): Promise<Drain> {
  if (!env.AI) {
    throw new Error("AI binding not available. Add [ai] to wrangler.jsonc.");
  }
  // Workers AI returns a ReadableStream of SSE chunks when stream:true.
  const result = (await env.AI.run(model, {
    max_tokens: 600,
    ...(ep.extraBody ?? {}),
    // Structural fields win over extraBody so streaming + message
    // shape can't be broken via config.
    stream: true,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  })) as unknown;

  if (!(result instanceof ReadableStream)) {
    // Some Workers AI models don't honour `stream` and return the whole
    // payload synchronously. Fall back to that shape so the feature still
    // works on those models.
    const obj = result as { response?: string };
    if (obj?.response) {
      const text = obj.response;
      return async (onToken) => {
        await onToken(text);
      };
    }
    throw new Error("Workers AI returned an unexpected response shape.");
  }

  const stream = result;
  return async (onToken) => {
    await consumeSse(stream, async (data) => {
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data) as { response?: string };
        if (parsed.response) await onToken(parsed.response);
      } catch {
        // Some models emit raw text per chunk instead of JSON; treat that
        // as a token literal.
        await onToken(data);
      }
    });
  };
}

// --- OpenAI-compatible (OpenAI, OpenRouter, Together, Groq, …) ------------

async function openOpenAi(
  ep: ResolvedEndpoint,
  model: string,
  prompt: { system: string; user: string },
): Promise<Drain> {
  if (!ep.apiKey) {
    throw new Error(`OpenAI-compatible API key is not set (expected env var ${ep.apiKeyEnv}).`);
  }
  const baseUrl = (ep.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ep.apiKey}`,
      // OpenRouter rewards / requires these — harmless for vanilla OpenAI.
      "http-referer": "https://github.com/siiway/vellum",
      "x-title": "Vellum AI Summary",
    },
    body: JSON.stringify({
      // Tunable defaults; extraBody can override.
      max_tokens: 600,
      temperature: 0.3,
      ...(ep.extraBody ?? {}),
      // Structural fields win over extraBody so streaming + message
      // shape can't be broken via config.
      model,
      stream: true,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    throw new Error(`Upstream ${upstream.status}: ${errText.slice(0, 200) || upstream.statusText}`);
  }

  const body = upstream.body;
  return async (onToken) => {
    await consumeSse(body, async (data) => {
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) await onToken(delta);
      } catch {
        // Ignore malformed lines (keep-alives, partial buffers).
      }
    });
  };
}

// --- Anthropic ------------------------------------------------------------

async function openAnthropic(
  ep: ResolvedEndpoint,
  model: string,
  prompt: { system: string; user: string },
): Promise<Drain> {
  if (!ep.apiKey) {
    throw new Error(`Anthropic API key is not set (expected env var ${ep.apiKeyEnv}).`);
  }
  const baseUrl = (ep.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");

  const upstream = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ep.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      max_tokens: 600,
      ...(ep.extraBody ?? {}),
      // Structural fields win over extraBody.
      model,
      stream: true,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    throw new Error(`Upstream ${upstream.status}: ${errText.slice(0, 200) || upstream.statusText}`);
  }

  const body = upstream.body;
  return async (onToken) => {
    await consumeSse(body, async (data) => {
      try {
        const json = JSON.parse(data) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
          const text = json.delta.text ?? "";
          if (text) await onToken(text);
        }
      } catch {
        // Anthropic also emits `event:` lines and pings; consumeSse already
        // hands us just `data:` payloads so anything we can't parse here is
        // just noise.
      }
    });
  };
}

// --- SSE helpers ----------------------------------------------------------

// Pulls `data: …` payloads out of an upstream SSE stream. Calls `onData` with
// the raw payload string (one frame per call, with the `data: ` prefix
// stripped). Multi-line frames are joined with newlines per the SSE spec.
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => Promise<void>,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (dataLines.length) {
        await onData(dataLines.join("\n"));
      }
    }
  }

  // Drain any straggler.
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    await onData(tail.slice(5).replace(/^ /, "").trim());
  }
}

function sseHeaders(): HeadersInit {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-vellum": "ai-summary",
  };
}

function sseError(message: string, status: number): Response {
  const body = `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
  return new Response(body, { status, headers: sseHeaders() });
}

function streamCached(summary: string, model: string): Response {
  // Replay the cached summary as one big token frame followed by `done` — the
  // client renders the same way it would for a live stream.
  const body =
    `event: token\ndata: ${JSON.stringify({ text: summary })}\n\n` +
    `event: done\ndata: ${JSON.stringify({ model, cached: true })}\n\n`;
  return new Response(body, { status: 200, headers: sseHeaders() });
}

// --- Turnstile ------------------------------------------------------------

async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (remoteIp) form.set("remoteip", remoteIp);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
