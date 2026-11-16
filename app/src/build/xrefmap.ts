// Per-repo xref resolver. Loads xrefmap.yml (or xrefmap.json) from the docs
// root and exposes a uid → href lookup, loaded once per repo per build.
//
// We parse a strict subset of YAML — enough for the canonical DocFX xrefmap
// shape (`references: [{ uid, href, name }, ...]`). For richer needs a real
// YAML parser would be appropriate; this optional feature doesn't need one.

import type { RepoConfig } from "../shared/types";
import { readSourceFile, docsRootPrefix } from "./sources";
import { memo } from "./memo";

export interface XrefEntry {
  uid: string;
  href: string;
  name?: string;
}

export interface XrefMap {
  byUid: Record<string, XrefEntry>;
}

const CANDIDATE_PATHS = ["xrefmap.yml", "xrefmap.yaml", "xrefmap.json"];

export function loadXrefMap(repo: RepoConfig): Promise<XrefMap | null> {
  return memo(`xrefmap:${repo.slug}`, async () => {
    const prefix = docsRootPrefix(repo.docsRoot);
    // First candidate, in order, that exists and parses wins.
    for (const file of CANDIDATE_PATHS) {
      const raw = await readSourceFile(repo, `${prefix}${file}`);
      if (!raw) continue;
      const map = file.endsWith(".json") ? parseJson(raw) : parseYaml(raw);
      if (map) return map;
    }
    return null;
  });
}

function parseJson(raw: string): XrefMap | null {
  try {
    const data = JSON.parse(raw) as { references?: XrefEntry[] };
    const refs = data.references ?? [];
    return buildIndex(refs);
  } catch {
    return null;
  }
}

// Tiny YAML reader for the DocFX xrefmap shape:
//
//   references:
//   - uid: System.Console
//     href: https://learn.microsoft.com/...
//     name: Console
//   - uid: ...
//
// We accept arbitrary key order, ignore unknown keys, and tolerate quoted
// strings. Anything more exotic falls through and the map is treated as
// unparseable (rather than crashing the page render).
function parseYaml(raw: string): XrefMap | null {
  try {
    const lines = raw.split(/\r?\n/);
    let inRefs = false;
    let current: Record<string, string> | null = null;
    const entries: XrefEntry[] = [];
    const flush = () => {
      if (current && current.uid && current.href) {
        entries.push({
          uid: current.uid,
          href: current.href,
          name: current.name,
        });
      }
      current = null;
    };
    for (const rawLine of lines) {
      // Drop full-line comments and inline trailing comments outside quotes.
      const line = rawLine.replace(/\s+#.*$/, "");
      if (!line.trim() || line.trim().startsWith("#")) continue;
      if (!inRefs) {
        if (/^references\s*:\s*$/.test(line.trim())) inRefs = true;
        continue;
      }
      const itemStart = line.match(/^(\s*)-\s*(.*)$/);
      if (itemStart) {
        flush();
        current = {};
        const rest = itemStart[2]!;
        if (rest) {
          const kv = parseKeyValue(rest);
          if (kv) current[kv.key] = kv.value;
        }
        continue;
      }
      const kv = parseKeyValue(line.trim());
      if (kv && current) current[kv.key] = kv.value;
    }
    flush();
    if (!entries.length) return null;
    return buildIndex(entries);
  } catch {
    return null;
  }
}

function parseKeyValue(s: string): { key: string; value: string } | null {
  const m = s.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
  if (!m) return null;
  let value = m[2]!.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key: m[1]!, value };
}

function buildIndex(refs: XrefEntry[]): XrefMap {
  const byUid: Record<string, XrefEntry> = {};
  for (const r of refs) {
    if (!r.uid || !r.href) continue;
    byUid[r.uid] = r;
  }
  return { byUid };
}
