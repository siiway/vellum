// Cloudflare Worker entry. Hands every request to the router and runs the
// hourly cron tick that prunes stale translation rows.

import type { Env } from "./env";
import { dispatch } from "./router";
import { pruneStaleRows } from "./translate";
import config from "../../vellum.config.json";
import type { VellumConfig } from "../shared/types";

const SITE: VellumConfig = config as VellumConfig;

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

  // Cron tick. Configured at `0 * * * *` in wrangler.jsonc (every hour at
  // :00). Prunes translation rows older than `site.translate.refreshDays`
  // so the next read for the affected page/locale re-translates lazily via
  // translate.ts's write-through. Batch size capped per tick so a huge
  // table doesn't blow the CPU budget. Deletion (rather than in-place
  // re-translation here) keeps the cron handler simple — fetching the
  // source per kind would duplicate every source-resolver across the
  // codebase.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cfg = SITE.site.translate;
    if (!cfg || !env.VELLUM_TRANSLATION_DB) return;
    const refreshDays = Math.max(1, cfg.refreshDays ?? 5);
    const batchSize = Math.max(1, Math.min(500, cfg.batchSize ?? 50));
    const cutoff = Date.now() - refreshDays * 24 * 60 * 60 * 1000;
    ctx.waitUntil(
      pruneStaleRows(env, cutoff, batchSize)
        .then((deleted) => {
          if (deleted > 0) {
            console.log(
              `[vellum] cron: pruned ${deleted} stale translation row(s) older than ${refreshDays}d`,
            );
          }
        })
        .catch((err) => {
          console.error("[vellum] cron: failed to prune stale rows", err);
        }),
    );
  },
} satisfies ExportedHandler<Env>;

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
