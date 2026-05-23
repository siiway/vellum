// AI chat session tokens. Microsoft Learn's Copilot makes the visitor solve
// a captcha once when they open the chat, not on every message. We mimic
// that with HMAC-signed bearer tokens:
//
//   1. Visitor clicks "Ask AI" → invisible Turnstile widget produces a
//      single-use token.
//   2. Client POSTs /api/ai/session with that token. Worker verifies it
//      against Cloudflare's siteverify, then mints a session token.
//   3. Client sends every /api/ask request with
//        Authorization: Bearer <session-token>
//      The worker validates the HMAC + expiry without re-hitting siteverify.
//
// The token is opaque to the client. Format on the wire:
//   <base64url(payload)>.<base64url(hmac)>
// where payload = JSON({"iat":..., "exp":..., "kind":"ai-chat"}).

import type { Env } from "./env";

const TOKEN_LIFETIME_SECONDS = 60 * 60; // 1 hour

interface SessionPayload {
  iat: number;
  exp: number;
  kind: "ai-chat";
}

// --- Public surface -------------------------------------------------------

export async function handleAiSession(
  request: Request,
  env: Env,
  siteTurnstileKey: string | undefined,
): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  type Body = { turnstileToken?: string };
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Captcha gate. Skip when both sitekey and secret are absent (local dev
  // shorthand). Half-configured fails closed.
  if (siteTurnstileKey || env.VELLUM_TURNSTILE_SECRET) {
    if (!siteTurnstileKey || !env.VELLUM_TURNSTILE_SECRET) {
      return Response.json({ error: "Turnstile is half-configured." }, { status: 500 });
    }
    if (!body.turnstileToken) {
      return Response.json({ error: "Missing captcha token." }, { status: 400 });
    }
    const ok = await verifyTurnstile(
      env.VELLUM_TURNSTILE_SECRET,
      body.turnstileToken,
      request.headers.get("cf-connecting-ip"),
    );
    if (!ok) {
      return Response.json({ error: "Captcha verification failed." }, { status: 403 });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
    kind: "ai-chat",
  };
  const token = await signSession(env, payload);

  return Response.json({ token, expiresIn: TOKEN_LIFETIME_SECONDS });
}

// Pulls the session token from the request, verifies HMAC + expiry. Returns
// null when the token is missing / malformed / expired / forged so callers
// can return 401 themselves.
export async function verifySessionRequest(
  request: Request,
  env: Env,
): Promise<SessionPayload | null> {
  const auth = request.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifySession(env, m[1]!.trim());
}

// --- Crypto ---------------------------------------------------------------

// Fallback HMAC key for local dev when VELLUM_SESSION_SECRET isn't set. The
// const is initialized lazily so the random bytes only get pulled once per
// isolate. At edge scale this is the WRONG thing — tokens minted on isolate
// A can't be verified on isolate B — but it keeps `wrangler dev` working
// without forcing every developer to set a secret.
let devFallbackSecret: string | null = null;
function getSecret(env: Env): string {
  if (env.VELLUM_SESSION_SECRET && env.VELLUM_SESSION_SECRET.length >= 16) {
    return env.VELLUM_SESSION_SECRET;
  }
  if (!devFallbackSecret) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    devFallbackSecret = btoaUrl(bytes);
    console.warn(
      "[vellum] VELLUM_SESSION_SECRET is unset — using a per-isolate fallback. Chat sessions will not survive cross-isolate failover. Set the secret with `wrangler secret put VELLUM_SESSION_SECRET` for production.",
    );
  }
  return devFallbackSecret;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signSession(env: Env, payload: SessionPayload): Promise<string> {
  const key = await hmacKey(getSecret(env));
  const body = btoaUrl(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `${body}.${btoaUrl(sig)}`;
}

async function verifySession(env: Env, token: string): Promise<SessionPayload | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = atobUrl(sigPart);
  } catch {
    return null;
  }

  const key = await hmacKey(getSecret(env));
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(body));
  if (!ok) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(atobUrl(body))) as SessionPayload;
  } catch {
    return null;
  }
  if (payload.kind !== "ai-chat") return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  return payload;
}

// --- base64url helpers ----------------------------------------------------

function btoaUrl(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function atobUrl(s: string): Uint8Array<ArrayBuffer> {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 === 0 ? "" : "=".repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  // Construct an explicit ArrayBuffer-backed view so SubtleCrypto's
  // BufferSource type (Uint8Array<ArrayBuffer> | ArrayBuffer) is satisfied
  // — recent @cloudflare/workers-types tightened the generic.
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
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
