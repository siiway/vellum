// Wipes every key in the VELLUM_CACHE KV namespace.
//
// Usage:
//   bun scripts/drop-kv-cache.ts            # production / remote KV
//   bun scripts/drop-kv-cache.ts --local    # local wrangler-dev simulator
//   bun scripts/drop-kv-cache.ts --preview  # the preview KV namespace
//
// The script:
//   1. Reads wrangler.jsonc to find the namespace id bound as VELLUM_CACHE
//      (or preview_id when --preview is passed).
//   2. Lists every key via `wrangler kv key list`.
//   3. Bulk-deletes them via `wrangler kv bulk delete`.
//
// We deliberately do NOT touch the Cache API layer — that lives at each edge
// PoP and can't be purged from a deploy machine. Edits will roll out naturally
// as Cache entries hit their max-age, or you can rotate the cache key prefix
// in src/worker/cache.ts to invalidate everything in one go.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const isLocal = args.has("--local");
const isPreview = args.has("--preview");

// --- Resolve namespace id from wrangler.jsonc ----------------------------

function readJsonc(path: string): unknown {
  // Strip line/block comments and trailing commas so the file parses as JSON.
  // Avoids pulling in a JSONC dep for this one read.
  const raw = readFileSync(path, "utf8");
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}

interface WranglerKv {
  binding: string;
  id?: string;
  preview_id?: string;
}
interface WranglerConfig {
  kv_namespaces?: WranglerKv[];
}

const cfg = readJsonc("wrangler.jsonc") as WranglerConfig;
const binding = cfg.kv_namespaces?.find((n) => n.binding === "VELLUM_CACHE");

if (!binding) {
  console.error(
    "VELLUM_CACHE binding not found in wrangler.jsonc. The kv_namespaces\n" +
      "block is commented out by default — uncomment it and paste the id from\n" +
      "`wrangler kv namespace create VELLUM_CACHE`, then re-run this script.",
  );
  process.exit(2);
}

const namespaceId = isPreview ? binding.preview_id : binding.id;
if (!namespaceId) {
  console.error(
    `No ${isPreview ? "preview_id" : "id"} on the VELLUM_CACHE binding. ` +
      `Add it to wrangler.jsonc and re-run.`,
  );
  process.exit(2);
}

console.log(
  `Targeting VELLUM_CACHE${isPreview ? " (preview)" : ""} id=${namespaceId}${isLocal ? " --local" : ""}`,
);

// --- List keys -----------------------------------------------------------

function wrangler(...extra: string[]): string {
  const cmd = "wrangler";
  const argv = ["kv", ...extra];
  if (isLocal) argv.push("--local");
  const result = spawnSync(cmd, argv, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) {
    console.error(`wrangler ${argv.join(" ")} exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

const listOut = wrangler("key", "list", `--namespace-id=${namespaceId}`);
const keys = (JSON.parse(listOut) as Array<{ name: string }>).map((k) => k.name);

if (keys.length === 0) {
  console.log("Namespace is already empty — nothing to do.");
  process.exit(0);
}

console.log(`Found ${keys.length} keys. Deleting...`);

// --- Bulk delete ---------------------------------------------------------

// wrangler kv bulk delete reads a JSON file of either string[] or {name:string}[].
// String[] is the simpler shape and is accepted by every supported wrangler version.
const tmpDir = mkdtempSync(join(tmpdir(), "vellum-kv-"));
const tmpFile = join(tmpDir, "keys.json");
writeFileSync(tmpFile, JSON.stringify(keys));

try {
  wrangler("bulk", "delete", `--namespace-id=${namespaceId}`, tmpFile);
  console.log(`Deleted ${keys.length} keys.`);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
