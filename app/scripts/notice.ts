// Writes NOTICE.md at the repository root: every third-party package that
// ships in the build, grouped by license. That's the client bundle the site
// serves, plus the page build (markdown-it, Shiki, MathJax, …), whose output
// every page carries.
//
//   bun run notice            build the client, then write NOTICE.md
//   bun scripts/notice.ts     write NOTICE.md from the last build
//   bun scripts/notice.ts --check
//                             fail if NOTICE.md doesn't match the last build
//
// The client's packages come from the last client build:
// dist/packages/client.json (written by scripts/vite-packages.ts during
// `vite build`). The page build's come from bundling src/build/site.ts in
// memory with esbuild, so only modules it actually reaches count.
// License texts come from each package's LICENSE, COPYING or NOTICE files in
// node_modules.
//
// Each license file is split into the package's own notice (the copyright and
// author lines above the license) and the license text. Packages whose texts
// match, ignoring line wrapping, quotes and titles, are listed together with
// their notices above one copy of the text.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, type Plugin } from "esbuild";
import * as prettier from "prettier";
import { packageDir } from "./vite-packages.ts";

const ROOT = join(import.meta.dir, "..");
const NOTICE = join(ROOT, "..", "NOTICE.md");
const CLIENT_LIST = join(ROOT, "dist", "packages", "client.json");
const check = process.argv.includes("--check");

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/** Notices for packages that ship without a license file, taken from the
 *  license in their source repository. */
const NOTICES: Record<string, string[]> = {
  // https://github.com/microsoft/fluentui-system-icons/blob/main/LICENSE
  "@fluentui/react-icons": ["Copyright (c) 2020 Microsoft Corporation"],
};

interface Package {
  name: string;
  version: string;
  /** The package.json license field. */
  license: string;
  /** License files, relative to the app. */
  files: string[];
}

interface Listed {
  pkg: Package;
  notice: string[];
  /** Set when the package has no license file of its own. */
  noFile?: boolean;
}

interface Variant {
  text: string;
  packages: Listed[];
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

// Where a license text begins, and which license it is. The first match in a
// file wins, so a preamble naming the license counts as the start.
const KNOWN: [RegExp, (text: string) => string][] = [
  [/Permission is hereby granted, free of charge/i, () => "MIT"],
  [/Apache License/i, () => "Apache-2.0"],
  [
    /Redistribution and use in source and binary forms/i,
    (t) =>
      /Neither the name|names of (its|the) contributors/i.test(t) ? "BSD-3-Clause" : "BSD-2-Clause",
  ],
  [
    /Permission to use, copy, modify, and\/?or distribute/i,
    (t) => (/provided that the above copyright notice/i.test(t) ? "ISC" : "0BSD"),
  ],
  [/GNU LESSER GENERAL PUBLIC LICENSE/, () => "LGPL-3.0"],
  [/GNU GENERAL PUBLIC LICENSE/, () => "GPL-3.0"],
  [/Mozilla Public License/i, () => "MPL-2.0"],
];

/** A line that names the license rather than granting it, like "MIT License". */
const TITLE = /^\(?(the )?[\w .-]*licen[cs]e( \(\w+\))?\)?$/i;

function licenseOf(pkg: Record<string, unknown>): string {
  const field = pkg.license ?? pkg.licenses;
  if (typeof field === "string") return field;
  const list = (Array.isArray(field) ? field : [field]) as { type?: string }[];
  const types = list.map((l) => l?.type).filter(Boolean);
  return types.length ? types.join(" OR ") : "UNKNOWN";
}

/** Package directories (relative to the app) in the client and page builds. */
async function bundledDirs(): Promise<Set<string>> {
  if (!existsSync(CLIENT_LIST)) {
    fail("the build output is missing. Run `bun run notice` to build first.");
  }
  const dirs = new Set<string>(JSON.parse(readFileSync(CLIENT_LIST, "utf8")) as string[]);
  for (const dir of await pageBuildDirs()) dirs.add(dir);
  return dirs;
}

/** Optional imports that aren't installed (template engines a dependency
 *  can use, and so on) stay out of the bundle instead of failing it. */
const skipMissing: Plugin = {
  name: "skip-missing",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.pluginData === "skip-missing") return undefined;
      const found = await b.resolve(args.path, {
        kind: args.kind,
        resolveDir: args.resolveDir,
        importer: args.importer,
        pluginData: "skip-missing",
      });
      return found.errors.length ? { path: args.path, external: true } : found;
    });
  },
};

/** Package directories the page build reaches. */
async function pageBuildDirs(): Promise<string[]> {
  const result = await build({
    entryPoints: [join(ROOT, "src", "build", "site.ts")],
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    outdir: "out",
    logLevel: "silent",
    // Browser-only: client components load them from effects, which never
    // run while pages render. The client list has what ships of them.
    external: ["mermaid", "vue", "vue3-sfc-loader"],
    plugins: [skipMissing],
  });
  const dirs = new Set<string>();
  // Only inputs that reached an output, so tree-shaken packages are left out.
  for (const output of Object.values(result.metafile.outputs)) {
    for (const input of Object.keys(output.inputs)) {
      const dir = packageDir(input, ROOT);
      if (dir) dirs.add(dir);
    }
  }
  return [...dirs];
}

async function bundled(): Promise<Package[]> {
  const seen = new Set<string>();
  const out: Package[] = [];
  for (const start of await bundledDirs()) {
    // A module can sit in a nested folder that has its own package.json only
    // for "type": "module"; walk up to the one that names the package.
    let dir = start;
    let pkg: Record<string, unknown> | null = null;
    while (dir.includes("node_modules")) {
      const file = join(ROOT, dir, "package.json");
      if (existsSync(file)) {
        const json = JSON.parse(readFileSync(file, "utf8"));
        if (json.name && json.version) {
          pkg = json;
          break;
        }
      }
      dir = dir.slice(0, dir.lastIndexOf("/"));
    }
    if (!pkg || seen.has(dir)) continue;
    seen.add(dir);
    out.push({
      name: pkg.name as string,
      version: pkg.version as string,
      license: licenseOf(pkg),
      files: readdirSync(join(ROOT, dir))
        .filter((f) => LICENSE_FILE.test(f))
        .sort()
        .map((f) => `${dir}/${f}`),
    });
  }
  return out;
}

/** Split a license file into the package's notice lines and the license. */
function split(raw: string, fallback: string) {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd());
  let start = lines.length;
  let license = fallback;
  for (const [pattern, name] of KNOWN) {
    const at = lines.findIndex((l) => pattern.test(l));
    if (at >= 0 && at < start) {
      start = at;
      license = name(raw);
    }
  }
  if (start === lines.length) start = 0;
  // Only copyright and author lines: some files open with other prose.
  const notice = lines
    .slice(0, start)
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter((l) => /copyright|©|\(c\)|author|all rights reserved/i.test(l));
  let body = lines.slice(start);
  while (body.length && (!body[0]!.trim() || TITLE.test(body[0]!.trim()))) {
    body.shift();
  }
  // Apache's appendix only shows how to apply the license. Some packages
  // fill in its copyright line; keep that as their notice and drop the rest.
  const end = body.findIndex((l) => /END OF TERMS AND CONDITIONS/.test(l));
  if (license === "Apache-2.0" && end >= 0) {
    for (const l of body.slice(end + 1)) {
      if (/^\s*Copyright\b/.test(l) && !l.includes("[yyyy]")) notice.push(l.trim());
    }
    body = body.slice(0, end + 1);
  }
  return { license, notice, text: body.join("\n").trim() };
}

/** Texts that differ only in wrapping, punctuation or case are the same. */
const sameText = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

const packages = [
  ...new Map((await bundled()).map((p) => [`${p.name}@${p.version}`, p])).values(),
].sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));

// license -> text key -> variant
const sections = new Map<string, Map<string, Variant>>();
const add = (license: string, text: string, listed: Listed) => {
  const variants = sections.get(license) ?? new Map<string, Variant>();
  sections.set(license, variants);
  const key = sameText(text);
  const variant = variants.get(key) ?? { text, packages: [] };
  variants.set(key, variant);
  variant.packages.push(listed);
};

const noFile: Package[] = [];
for (const pkg of packages) {
  if (pkg.files.length === 0) {
    noFile.push(pkg);
    continue;
  }
  for (const file of pkg.files) {
    const raw = readFileSync(join(ROOT, file), "utf8");
    const { license, notice, text } = split(raw, pkg.license);
    // Some packages (Fluent UI's) open with their own name.
    add(license, text, { pkg, notice: notice.filter((l) => l !== pkg.name) });
  }
}

// A package without a license file goes with the most common text of the
// first license it names that's already here.
const unmatched: Package[] = [];
for (const pkg of noFile) {
  const names = pkg.license.replace(/[()]/g, "").split(/\s+(?:OR|AND)\s+/);
  const license = names.find((n) => sections.has(n));
  if (!license) {
    unmatched.push(pkg);
    continue;
  }
  const common = [...sections.get(license)!.values()].sort(
    (a, b) => b.packages.length - a.packages.length,
  )[0]!;
  common.packages.push({ pkg, notice: NOTICES[pkg.name] ?? [], noFile: true });
}

const npm = (name: string) => `https://www.npmjs.com/package/${name}`;
const count = (variants: Map<string, Variant>) =>
  new Set([...variants.values()].flatMap((v) => v.packages.map((p) => p.pkg))).size;

function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}text\n${text}\n${ticks}`;
}

function item({ pkg, notice, noFile }: Listed): string {
  const parts = [`[${pkg.name}](${npm(pkg.name)}) ${pkg.version}`];
  // Wrapped lines continue a statement; a new copyright line starts one.
  if (notice.length) {
    parts.push(
      notice
        .map((l, i) => (i > 0 && /^(Copyright|\(c\)|©|Author)/i.test(l) ? `; ${l}` : ` ${l}`))
        .join("")
        .trim(),
    );
  }
  if (noFile) parts.push("(no license file in the package)");
  return `- ${parts.join(": ")}`.replace(/: \(no license/, " (no license");
}

const order = [...sections].sort(
  ([a, x], [b, y]) => count(y) - count(x) || a.localeCompare(b, "en"),
);

const out: string[] = [
  "# Notice",
  "<!-- Generated by app/scripts/notice.ts. Run `bun run notice` in app/ to update it. -->",
  "Vellum is licensed under the GNU General Public License 3.0 (see [LICENSE](./LICENSE)). " +
    `Its build includes ${packages.length} third-party packages, listed below by license: ` +
    order.map(([name, v]) => `${name} (${count(v)})`).join(", ") +
    ". Each list gives the packages' own copyright notices, followed by the license text they share.",
];
for (const [name, variants] of order) {
  out.push(`## ${name}`);
  const list = [...variants.values()].sort((a, b) => b.packages.length - a.packages.length);
  list.forEach((variant, i) => {
    if (i > 0) out.push("These use a different wording:");
    out.push(
      variant.packages
        .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name, "en"))
        .map(item)
        .join("\n"),
      fence(variant.text),
    );
  });
}
if (unmatched.length) {
  out.push(
    "## Other",
    "These packages include no license text. Their package metadata names the license.",
    unmatched.map((p) => `- [${p.name}](${npm(p.name)}) ${p.version}: ${p.license}`).join("\n"),
  );
}

const markdown = await prettier.format(out.join("\n\n") + "\n", {
  ...(await prettier.resolveConfig(join(ROOT, ".prettierrc.json"))),
  filepath: NOTICE,
});

const current = existsSync(NOTICE) ? readFileSync(NOTICE, "utf8") : "";
if (check) {
  if (current.replace(/\r\n/g, "\n") !== markdown) {
    fail("NOTICE.md is out of date. Run `bun run notice` in app/.");
  }
  console.log(`NOTICE.md lists ${packages.length} packages`);
} else {
  writeFileSync(NOTICE, markdown);
  console.log(`NOTICE.md: ${packages.length} packages under ${sections.size} licenses`);
}
