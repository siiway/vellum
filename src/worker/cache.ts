// Layered edge cache:
//   L1 = CF Cache API (per-edge, automatic, free)
//   L2 = optional KV namespace (global, durable, manual invalidation by key prefix)
//
// Callers identify content by a stable key. We synthesize a Request from the key
// so the Cache API can store/retrieve arbitrary blobs.

import type { Env } from "./env";

const CACHE_HOST = "https://vellum.cache.internal";

function keyToCacheRequest(key: string): Request {
  return new Request(`${CACHE_HOST}/${encodeURIComponent(key)}`, {
    method: "GET",
  });
}

export interface CachedEntry<T> {
  value: T;
  storedAt: number;
}

export async function readCache<T>(env: Env, key: string): Promise<T | null> {
  // KV is the source of truth across regions; check it first when bound.
  if (env.VELLUM_CACHE) {
    try {
      const kv = await env.VELLUM_CACHE.get<CachedEntry<T>>(key, {
        type: "json",
      });
      if (kv) return kv.value;
    } catch {
      // KV transient errors: fall through to Cache API.
    }
  }

  try {
    const cache = (caches as unknown as { default: Cache }).default;
    const res = await cache.match(keyToCacheRequest(key));
    if (res) {
      const body = (await res.json()) as CachedEntry<T>;
      return body.value;
    }
  } catch {
    // Cache API unavailable (e.g. local dev with miniflare quirks).
  }
  return null;
}

export async function writeCache<T>(
  env: Env,
  key: string,
  value: T,
  ttlSeconds: number,
  ctx?: ExecutionContext,
): Promise<void> {
  const entry: CachedEntry<T> = { value, storedAt: Date.now() };
  const body = JSON.stringify(entry);

  if (env.VELLUM_CACHE) {
    const op = env.VELLUM_CACHE.put(key, body, {
      expirationTtl: Math.max(60, ttlSeconds),
    });
    if (ctx) ctx.waitUntil(op);
    else await op;
  }

  try {
    const cache = (caches as unknown as { default: Cache }).default;
    const res = new Response(body, {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
      },
    });
    const op = cache.put(keyToCacheRequest(key), res);
    if (ctx) ctx.waitUntil(op);
    else await op;
  } catch {
    // Best-effort.
  }
}

export async function invalidate(env: Env, keys: string[]): Promise<void> {
  if (env.VELLUM_CACHE) {
    await Promise.all(keys.map((k) => env.VELLUM_CACHE!.delete(k)));
  }
  try {
    const cache = (caches as unknown as { default: Cache }).default;
    await Promise.all(keys.map((k) => cache.delete(keyToCacheRequest(k))));
  } catch {
    // ignore
  }
}
