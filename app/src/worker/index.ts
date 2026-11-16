// Cloudflare Worker entry. Hands every request to the router.

import type { Env } from "./env";
import { dispatch } from "./router";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await dispatch(request, env, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[vellum]", message, err instanceof Error ? err.stack : "");
      return new Response(
        `<!doctype html><html><body style="font-family:system-ui;padding:2rem"><h1>Server error</h1><pre>${escape(message)}</pre></body></html>`,
        {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
  },
} satisfies ExportedHandler<Env>;

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
