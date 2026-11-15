// Layered edge cache:
//   L0 = isolate memory (per isolate, short-lived, free)
//   L1 = CF Cache API (per edge location, automatic, free)
//   L2 = optional KV namespace (global, durable, manual invalidation by key)
//
// Reads walk L0 -> L1 -> L2 and copy a hit into the faster layers. Callers
// identify content by a stable key; L1 stores it under a synthetic Request.
//
// A stored `null` is a hit like any other value, so callers can cache misses
// (a 404 from GitHub, a repo without an xrefmap) and skip the round trip
// next time. `readEntry` tells the two apart; `readCache` folds them back
// together for callers that only cache real values.

import type { Env } from "./env";

const CACHE_HOST = "https://vellum.cache.internal";

function keyToCacheRequest(key: string): Request {
  return new Request(`${CACHE_HOST}/${encodeURIComponent(key)}`, {
    method: "GET",
  });
}

export interface CacheEntry<T> {
  value: T;
  storedAt: number;
  // Past this point the entry is stale: `swr` still serves it but refreshes
  // it in the background. Plain reads ignore it.
  freshUntil?: number;
  // Past this point the entry is gone from every layer.
  expiresAt?: number;
}

// --- L0: isolate memory -----------------------------------------------------

// Entries are kept as their JSON text, not as objects, so a caller that
// mutates what it read can't change what the next reader gets.
interface MemoryEntry {
  body: string;
  until: number;
}

const MEMORY_MAX_BYTES = 8 * 1024 * 1024;
// Other isolates don't see a webhook's invalidation, so memory never holds an
// entry for long. L1 and L2 carry the full TTL.
const MEMORY_MAX_AGE_MS = 30_000;

const memory = new Map<string, MemoryEntry>();
let memoryBytes = 0;

function memoryGet(key: string): string | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.until <= Date.now()) {
    memoryDelete(key);
    return null;
  }
  // Re-insert so Map order tracks recency for eviction.
  memory.delete(key);
  memory.set(key, hit);
  return hit.body;
}

function memorySet(key: string, body: string, expiresAt: number): void {
  memoryDelete(key);
  // One large page shouldn't push out everything else.
  if (body.length > MEMORY_MAX_BYTES / 8) return;
  memory.set(key, { body, until: Math.min(expiresAt, Date.now() + MEMORY_MAX_AGE_MS) });
  memoryBytes += body.length;
  for (const [k] of memory) {
    if (memoryBytes <= MEMORY_MAX_BYTES) break;
    memoryDelete(k);
  }
}

function memoryDelete(key: string): void {
  const hit = memory.get(key);
  if (!hit) return;
  memory.delete(key);
  memoryBytes -= hit.body.length;
}

// --- Reads ------------------------------------------------------------------

function defaultCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

function parseEntry<T>(body: string): CacheEntry<T> | null {
  try {
    const entry = JSON.parse(body) as CacheEntry<T>;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) return null;
    return entry;
  } catch {
    return null;
  }
}

// Returns the stored entry, or null when no layer holds the key. Pass `ctx`
// so a KV hit can be copied into the Cache API after the response.
export async function readEntry<T>(
  env: Env,
  key: string,
  ctx?: ExecutionContext,
): Promise<CacheEntry<T> | null> {
  const mem = memoryGet(key);
  if (mem !== null) {
    const entry = parseEntry<T>(mem);
    if (entry) return entry;
  }

  try {
    const res = await defaultCache().match(keyToCacheRequest(key));
    if (res) {
      const body = await res.text();
      const entry = parseEntry<T>(body);
      if (entry) {
        memorySet(key, body, entry.expiresAt ?? Date.now() + MEMORY_MAX_AGE_MS);
        return entry;
      }
    }
  } catch {
    // Cache API unavailable (e.g. local dev with miniflare quirks).
  }

  if (env.VELLUM_CACHE) {
    try {
      const body = await env.VELLUM_CACHE.get(key, { type: "text" });
      if (body !== null) {
        const entry = parseEntry<T>(body);
        if (entry) {
          const expiresAt = entry.expiresAt ?? Date.now() + MEMORY_MAX_AGE_MS;
          memorySet(key, body, expiresAt);
          if (ctx) ctx.waitUntil(putCacheApi(key, body, expiresAt).catch(() => {}));
          return entry;
        }
      }
    } catch {
      // KV transient errors count as a miss.
    }
  }
  return null;
}

// The cached value, or null on a miss. A stored `null` reads as a miss too:
// use `readEntry` or `cached` when null is a value worth caching.
export async function readCache<T>(env: Env, key: string): Promise<T | null> {
  const entry = await readEntry<T>(env, key);
  return entry ? entry.value : null;
}

// --- Writes -----------------------------------------------------------------

function putCacheApi(key: string, body: string, expiresAt: number): Promise<void> {
  const seconds = Math.max(1, Math.round((expiresAt - Date.now()) / 1000));
  const res = new Response(body, {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${seconds}, s-maxage=${seconds}`,
    },
  });
  return defaultCache().put(keyToCacheRequest(key), res);
}

export interface WriteOptions {
  // Seconds the entry counts as fresh for `swr`. Defaults to the full TTL.
  freshSeconds?: number;
}

// Stores `value` in every layer for `ttlSeconds`. With `ctx`, the L1 and L2
// writes finish after the response; without it they're awaited.
export async function writeCache<T>(
  env: Env,
  key: string,
  value: T,
  ttlSeconds: number,
  ctx?: ExecutionContext,
  opts: WriteOptions = {},
): Promise<CacheEntry<T>> {
  const now = Date.now();
  const ttl = Math.max(1, ttlSeconds);
  const entry: CacheEntry<T> = {
    value,
    storedAt: now,
    freshUntil: now + Math.min(ttl, opts.freshSeconds ?? ttl) * 1000,
    expiresAt: now + ttl * 1000,
  };
  const body = JSON.stringify(entry);
  memorySet(key, body, entry.expiresAt!);

  const ops: Promise<unknown>[] = [];
  if (env.VELLUM_CACHE) {
    // KV's minimum expiration is 60 seconds; the entry's own expiresAt
    // still ends it on time.
    ops.push(env.VELLUM_CACHE.put(key, body, { expirationTtl: Math.max(60, ttl) }));
  }
  try {
    ops.push(putCacheApi(key, body, entry.expiresAt!));
  } catch {
    // Best-effort.
  }
  const all = Promise.all(ops.map((op) => op.catch(() => {})));
  if (ctx) ctx.waitUntil(all);
  else await all;
  return entry;
}

export async function invalidate(env: Env, keys: string[]): Promise<void> {
  for (const k of keys) memoryDelete(k);
  if (env.VELLUM_CACHE) {
    await Promise.all(keys.map((k) => env.VELLUM_CACHE!.delete(k)));
  }
  try {
    const cache = defaultCache();
    await Promise.all(keys.map((k) => cache.delete(keyToCacheRequest(k))));
  } catch {
    // ignore
  }
}

// --- Request-scoped de-duplication -----------------------------------------

// One request often asks for the same thing from several places at once (the
// sidebar, nav and social-link loaders all read vellum.json). `dedupe` runs
// `fn` once per key per request and hands every caller the same promise.
// Scoped to the request because a Worker can't safely await I/O that another
// request started.
const inflight = new WeakMap<ExecutionContext, Map<string, Promise<unknown>>>();

export function dedupe<T>(
  ctx: ExecutionContext | undefined,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!ctx) return fn();
  let scope = inflight.get(ctx);
  if (!scope) {
    scope = new Map();
    inflight.set(ctx, scope);
  }
  const running = scope.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn();
  scope.set(key, p);
  // A failure shouldn't stick for the rest of the request.
  p.catch(() => scope!.delete(key));
  return p;
}

// Read-through cache. Returns the cached value when any layer has `key`,
// otherwise runs `load`, stores the result (null included) and returns it.
// `ttlSeconds` may depend on the value, e.g. a shorter TTL for a miss.
// `load` throwing stores nothing.
export function cached<T>(
  env: Env,
  key: string,
  ttlSeconds: number | ((value: T) => number),
  load: () => Promise<T>,
  ctx?: ExecutionContext,
): Promise<T> {
  return dedupe(ctx, `cached:${key}`, async () => {
    const hit = await readEntry<T>(env, key, ctx);
    if (hit) return hit.value;
    const value = await load();
    const ttl = typeof ttlSeconds === "function" ? ttlSeconds(value) : ttlSeconds;
    await writeCache(env, key, value, ttl, ctx);
    return value;
  });
}

// --- Stale-while-revalidate -------------------------------------------------

// Keys this isolate is refreshing right now, with the time each started, so
// a burst of requests for one stale page triggers one rebuild.
const refreshing = new Map<string, number>();
const REFRESH_TIMEOUT_MS = 30_000;

export interface SwrOptions<T> {
  // Seconds an entry stays fresh.
  freshSeconds: number;
  // Seconds an entry is kept in total. After `freshSeconds`, and until this,
  // it's served stale while a background rebuild replaces it. Equal to
  // `freshSeconds` to never serve stale.
  ttlSeconds: number;
  // Builds the value. Return `store: false` for results that shouldn't be
  // cached (a 404 page); a background rebuild that does so also drops the
  // stale entry.
  build: () => Promise<{ value: T; store: boolean }>;
}

export interface SwrResult<T> {
  entry: CacheEntry<T>;
  // fresh: served from cache. stale: served from cache, rebuild started.
  // miss: built for this request.
  status: "fresh" | "stale" | "miss";
}

// Returns the cached entry when it exists, rebuilding a stale one in the
// background (`ctx.waitUntil`), or builds it now on a miss.
export async function swr<T>(
  env: Env,
  ctx: ExecutionContext,
  key: string,
  opts: SwrOptions<T>,
): Promise<SwrResult<T>> {
  const hit = await readEntry<T>(env, key, ctx);
  const now = Date.now();
  if (hit && (hit.freshUntil ?? Infinity) > now) return { entry: hit, status: "fresh" };
  if (hit) {
    const started = refreshing.get(key);
    if (started === undefined || now - started > REFRESH_TIMEOUT_MS) {
      refreshing.set(key, now);
      ctx.waitUntil(
        rebuild(env, ctx, key, opts, true)
          .catch((err) => console.error("[vellum] background refresh failed", key, err))
          .finally(() => refreshing.delete(key)),
      );
    }
    return { entry: hit, status: "stale" };
  }
  return { entry: await rebuild(env, ctx, key, opts, false), status: "miss" };
}

async function rebuild<T>(
  env: Env,
  ctx: ExecutionContext,
  key: string,
  opts: SwrOptions<T>,
  replacing: boolean,
): Promise<CacheEntry<T>> {
  const { value, store } = await opts.build();
  if (!store) {
    // What was cached is gone (a deleted page). Drop the stale copy so the
    // next request gets the uncached result instead.
    if (replacing) await invalidate(env, [key]);
    return { value, storedAt: Date.now() };
  }
  return writeCache(env, key, value, Math.max(opts.ttlSeconds, opts.freshSeconds), ctx, {
    freshSeconds: opts.freshSeconds,
  });
}
