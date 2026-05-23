// /api/mcp — Model Context Protocol server.
//
// Exposes the same docs tools (search_docs, fetch_page, list_repos,
// list_pages) as /api/ask, but over JSON-RPC 2.0 so any MCP-aware client
// (Claude Desktop, ChatGPT Connectors, mcp-inspector, your own agent) can
// query this docs site directly.
//
// Transport: "Streamable HTTP" per the MCP spec — a single POST request
// per RPC, with JSON-RPC framing in the body. We don't need the SSE leg
// of the transport because none of our tools push notifications to the
// client.
//
// The server is intentionally read-only: no resources/write, no prompts,
// no sampling. That keeps it safe to expose publicly with no auth (a docs
// site is already public; the tools just give a structured view of it).

import type { Env } from "./env";
import type { VellumConfig } from "../shared/types";
import { buildToolDefs, dispatchTool, type ToolContext, type ToolScope } from "./tools";

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "vellum-docs";
const SERVER_VERSION = "0.1.0";

export async function handleMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
): Promise<Response> {
  // CORS preflight + GET handshake. Some clients ping with GET to test the
  // endpoint before issuing the first POST.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method === "GET") {
    return Response.json(
      { server: SERVER_NAME, version: SERVER_VERSION, protocol: PROTOCOL_VERSION },
      { headers: corsHeaders() },
    );
  }
  if (request.method !== "POST") {
    return Response.json(jsonRpcError(null, -32600, "Only POST is supported."), {
      status: 405,
      headers: corsHeaders(),
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(jsonRpcError(null, -32700, "Parse error."), {
      status: 400,
      headers: corsHeaders(),
    });
  }

  // Single message vs batch. JSON-RPC 2.0 allows arrays; MCP rarely uses
  // them but we handle it for spec compliance.
  if (Array.isArray(body)) {
    const replies = await Promise.all(body.map((m) => dispatchRpc(m, env, ctx, site)));
    const out = replies.filter((r) => r !== null);
    return Response.json(out, { headers: corsHeaders() });
  }

  const reply = await dispatchRpc(body, env, ctx, site);
  if (reply === null) {
    // Notification — JSON-RPC says no response.
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  return Response.json(reply, { headers: corsHeaders() });
}

// --- JSON-RPC dispatch ----------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcOk {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcErr {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcOk | JsonRpcErr;

async function dispatchRpc(
  msg: unknown,
  env: Env,
  ctx: ExecutionContext,
  site: VellumConfig,
): Promise<JsonRpcResponse | null> {
  if (!isRpcRequest(msg)) {
    return jsonRpcError(null, -32600, "Invalid request.");
  }

  const isNotification = msg.id === undefined;
  const id = msg.id ?? null;

  try {
    switch (msg.method) {
      case "initialize":
        return ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });

      case "ping":
        return ok(id, {});

      case "notifications/initialized":
        // Per spec the client may emit this after initialize. Nothing for us
        // to do, but we must not respond — it's a notification.
        return null;

      case "tools/list": {
        const tools = buildToolDefs("site", null).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return ok(id, { tools });
      }

      case "tools/call": {
        const params = (msg.params as { name?: string; arguments?: Record<string, unknown> }) ?? {};
        if (!params.name) {
          return jsonRpcError(id, -32602, "Missing tool name.");
        }
        const tctx: ToolContext = {
          env,
          ctx,
          site,
          scope: "site" as ToolScope,
          currentRepo: null,
          defaultLocale: site.site.defaultLocale,
        };
        const result = await dispatchTool(params.name, params.arguments ?? {}, tctx);
        const isError =
          typeof result.content === "object" &&
          result.content !== null &&
          "error" in (result.content as Record<string, unknown>);
        // MCP's tools/call result wraps the content in an array of content
        // blocks. We package everything as a single JSON text block so
        // clients that respect the structured-output convention can parse
        // it back into a record.
        return ok(id, {
          content: [
            {
              type: "text",
              text:
                typeof result.content === "string"
                  ? result.content
                  : JSON.stringify(result.content, null, 2),
            },
          ],
          isError,
        });
      }

      case "resources/list":
        return ok(id, { resources: [] });

      case "prompts/list":
        return ok(id, { prompts: [] });

      default:
        return jsonRpcError(id, -32601, `Method not found: ${msg.method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonRpcError(id, -32603, `Internal error: ${message}`);
  } finally {
    if (isNotification) {
      // No-op; notifications never produce a response. The early-returns
      // above already handle the supported notifications.
    }
  }
}

// --- Helpers --------------------------------------------------------------

function isRpcRequest(v: unknown): v is JsonRpcRequest {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>).jsonrpc === "2.0" &&
    typeof (v as Record<string, unknown>).method === "string"
  );
}

function ok(id: string | number | null, result: unknown): JsonRpcOk {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErr {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

function corsHeaders(): HeadersInit {
  // MCP clients live anywhere — Claude Desktop, ChatGPT's connector
  // sandbox, browser extensions. A public read-only docs server has
  // nothing to hide behind same-origin, so allow * with no credentials.
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, mcp-session-id",
    "access-control-max-age": "86400",
    "x-vellum": "mcp",
  };
}
