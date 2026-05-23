// Endpoint failover helper. Every AI feature (summary, chat, translate)
// pulls from the same site-level `aiProviders` pool: a list of named
// endpoints the worker tries in order, falling over to the next when one
// returns a "used up" error (rate limit, quota exhausted, server failure).
//
// What counts as "used up":
//   - HTTP 429 (Too Many Requests)         — provider rate-limited
//   - HTTP 401 / 403                       — bad / revoked API key
//   - HTTP 402                             — out of funds (OpenRouter, …)
//   - HTTP 5xx                             — provider server error
//   - Network errors (timeout, fetch fail) — connection didn't complete
//   - "AI binding not available"           — workers-ai entry without binding
//
// Other 4xx codes (400 bad request, 404 model missing) propagate without
// retry — they're content / config problems and re-issuing the same
// payload elsewhere just burns the fallback budget for the same outcome.

import type { Env } from "./env";
import type { AiProvider, VellumConfig } from "../shared/types";

// A single attempt after env-var resolution. Self-contained so the
// runner functions don't need to thread `cfg` + `env` separately.
export interface ResolvedEndpoint {
  id: string;
  provider: AiProvider["provider"];
  model?: string;
  baseUrl?: string;
  // Resolved API key (looked up from the env var named on the entry).
  // May be undefined for workers-ai (which uses the AI binding) or when
  // the configured env var isn't set — the runner is responsible for
  // failing with a useful error so the failover loop can move on.
  apiKey?: string;
  // The env var name that produced `apiKey`, kept for log lines.
  apiKeyEnv: string;
  // Provider-level body extensions (DeepSeek thinking mode, extra
  // sampling params, etc). Runners merge this into the request body
  // before the worker's required fields. Keep undefined when the entry
  // had no extras so the JSON.stringify doesn't carry empty objects.
  extraBody?: Record<string, unknown>;
}

// What a feature needs from the runtime to participate in the failover
// loop: a feature-level `model` override (optional), and an optional
// list of provider ids to constrain the pool to.
export interface FeatureProviderSelection {
  model?: string;
  providers?: string[];
}

// Build the ordered attempt list. Reads `site.aiProviders` as the pool
// and, when the feature supplies a `providers` whitelist, narrows to
// just those ids (preserving the whitelist's order). When the pool is
// empty the list returned is empty too; callers throw on that path.
export function resolveEndpoints(
  feature: FeatureProviderSelection,
  site: VellumConfig,
  env: Env,
): ResolvedEndpoint[] {
  const pool = site.site.aiProviders ?? [];
  if (!pool.length) return [];

  let ordered: AiProvider[];
  if (feature.providers && feature.providers.length) {
    // Whitelist mode. Preserve the order the feature listed in — that's
    // the failover order for this feature. Drop unknown ids silently;
    // they'll show up at config-load time via the JSON schema check.
    const byId = new Map(pool.map((p) => [p.id, p]));
    ordered = feature.providers.map((id) => byId.get(id)).filter((p): p is AiProvider => !!p);
  } else {
    ordered = pool;
  }

  // Expand each pool entry into one attempt per API key. Two axes of
  // expansion stack on top of each other:
  //
  //   1. `apiKeyEnv: [A, B, …]`  — the field itself is an array of env
  //                                 var names; each becomes its own
  //                                 attempt.
  //   2. ${env[X]} contains newlines — one env var holds multiple keys
  //                                 separated by `\n` (handy when an
  //                                 operator wants to manage a key pool
  //                                 without juggling N secrets). Each
  //                                 line becomes its own attempt.
  //
  // Combined, an `apiKeyEnv: ["FOO", "BAR"]` with FOO="k1\nk2" and
  // BAR="k3" yields three attempts in order: k1, k2, k3.
  const envBag = env as unknown as Record<string, string | undefined>;
  return ordered.flatMap((p) => {
    const keyEnvs = normalizeKeyEnvs(p.apiKeyEnv);
    const baseUrl = p.baseUrl ?? env.VELLUM_AI_BASE_URL;
    // Feature-level model override wins over the pool entry's default.
    const model = feature.model ?? p.model;
    return keyEnvs.flatMap((envName) =>
      expandKeysFromEnv(envBag, envName).map<ResolvedEndpoint>(({ apiKey, apiKeyEnv }) => ({
        id: p.id,
        provider: p.provider,
        model,
        baseUrl,
        apiKey,
        apiKeyEnv,
        extraBody: p.extraBody,
      })),
    );
  });
}

function normalizeKeyEnvs(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) {
    const cleaned = raw.filter((s) => typeof s === "string" && s.length > 0);
    return cleaned.length ? cleaned : ["VELLUM_AI_API_KEY"];
  }
  return [raw ?? "VELLUM_AI_API_KEY"];
}

// Look up an env var and split its value on newlines. A single-line
// value (the common case) yields one entry whose label is the env var
// name itself; a multi-line value yields N entries labelled
// `${envName}#1`, `${envName}#2`, … so log lines can tell them apart
// during failover. Missing / empty env vars produce a single entry
// with apiKey=undefined so the runner's "API key is not set" error
// surfaces clearly (rather than the failover loop silently skipping
// the slot).
function expandKeysFromEnv(
  envBag: Record<string, string | undefined>,
  envName: string,
): Array<{ apiKey: string | undefined; apiKeyEnv: string }> {
  const raw = envBag[envName];
  if (!raw) return [{ apiKey: undefined, apiKeyEnv: envName }];
  // Tolerate Windows CRLF and bare CR alongside the more common LF.
  const keys = raw
    .split(/\r\n|\r|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (keys.length === 0) return [{ apiKey: undefined, apiKeyEnv: envName }];
  if (keys.length === 1) return [{ apiKey: keys[0]!, apiKeyEnv: envName }];
  return keys.map((apiKey, i) => ({
    apiKey,
    apiKeyEnv: `${envName}#${i + 1}`,
  }));
}

// Inspect an Error message produced by our provider runners and decide
// whether trying the next endpoint is worth it. We rely on the consistent
// "Upstream {status}: …" prefix the runners use; network failures bubble
// up as TypeError / "fetch failed" / "timed out" depending on platform,
// which we also catch.
export function isRetryableFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const m = error.message;
  // Status-code prefix. 4xx codes that signal quota / capacity issues:
  // 401 (bad key), 402 (out of credit), 403 (forbidden), 429 (rate limit).
  // Plus every 5xx (provider server error).
  if (/Upstream\s+4(0[123]|29)\b/.test(m)) return true;
  if (/Upstream\s+5\d\d\b/.test(m)) return true;
  // Network-level failures. Different runtimes phrase these differently,
  // so the regex stays loose.
  if (/network|fetch failed|timed out|connection reset|ECONNRESET/i.test(m)) return true;
  // Workers AI binding-missing error — treat as retryable so a fallback
  // configured to use openai-compatible / anthropic kicks in.
  if (/AI binding not available/i.test(m)) return true;
  return false;
}

// Status callback fired before each attempt and after each terminal
// outcome on it. Callers wire this to an SSE `provider` event so the
// UI can show "Trying foo (1/3)…" → "Switched to bar (2/3)…" → "ok".
// All fields are 1-indexed for human display; `total` is the length
// of the resolved endpoint list at the start of the loop.
export interface AttemptInfo {
  endpoint: ResolvedEndpoint;
  attempt: number;
  total: number;
  status: "trying" | "failed" | "ok";
  // Set when status === "failed"; the message that triggered the retry.
  error?: string;
}

// Run `runner` against each endpoint in order, returning the first success.
// On a retryable failure it logs the attempt and continues; on a non-
// retryable failure it surfaces immediately; if every endpoint fails the
// last error is rethrown.
//
// `onAttempt` fires around each iteration so the caller can mirror the
// progress to the client (SSE event, telemetry, …). Always fires once
// with `status: "trying"` before each attempt; once with `"ok"` on
// success, or with `"failed"` on retried failures (the final failure
// for non-retryable / exhausted paths is signaled by the thrown error
// itself, not by an additional callback).
export async function runWithFailover<T>(
  tag: string,
  endpoints: ResolvedEndpoint[],
  runner: (ep: ResolvedEndpoint) => Promise<T>,
  onAttempt?: (info: AttemptInfo) => void,
): Promise<T> {
  if (!endpoints.length) {
    throw new Error("No AI providers configured. Add at least one entry to site.aiProviders.");
  }
  let lastError: unknown;
  const total = endpoints.length;
  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i]!;
    const attempt = i + 1;
    onAttempt?.({ endpoint: ep, attempt, total, status: "trying" });
    try {
      const result = await runner(ep);
      onAttempt?.({ endpoint: ep, attempt, total, status: "ok" });
      if (i > 0) {
        console.log(
          `${tag} failover ok: succeeded on endpoint #${attempt} (id=${ep.id}, ${ep.provider})`,
        );
      }
      return result;
    } catch (err) {
      lastError = err;
      const last = i === endpoints.length - 1;
      const retryable = isRetryableFailure(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (!retryable || last) {
        if (i > 0) {
          console.warn(`${tag} all ${endpoints.length} endpoints exhausted; last error: ${msg}`);
        }
        throw err;
      }
      onAttempt?.({ endpoint: ep, attempt, total, status: "failed", error: msg });
      console.warn(
        `${tag} endpoint #${attempt} (id=${ep.id}, ${ep.provider}, key=${ep.apiKeyEnv}) failed (${msg}); trying #${attempt + 1}`,
      );
    }
  }
  // Unreachable; the loop always either returns or throws inside the
  // last iteration. TypeScript flow analysis can't see that without a cast.
  throw lastError ?? new Error("No endpoints succeeded.");
}
