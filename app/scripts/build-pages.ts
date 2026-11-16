// Renders the site into dist/site (see src/build/site.ts).
//
//   bun run build:pages            full build: clone or update every GitHub
//                                  repo, then render every page
//   bun run build:pages --no-fetch full build from the existing clones
//   bun run update                 incremental: re-render only the repos whose
//                                  commit changed since the last build. Falls
//                                  back to a full build (client included) when
//                                  the last build is missing or stale (another
//                                  commit of this repo, another client build).
//
// A full build needs the client build (`bun run build:client`) first.
// With GITHUB_OUTPUT set (GitHub Actions), writes `changed=true|false` there.

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

// React's production build, as the client gets. Set before React loads.
process.env.NODE_ENV = "production";
const { buildSite, updateSite } = await import("../src/build/site");

const args = process.argv.slice(2);

if (args.includes("--incremental")) {
  const changed = await updateSite();
  if (changed) {
    console.log(
      changed.length ? `[vellum] updated: ${changed.join(", ")}` : "[vellum] nothing changed",
    );
    report(changed.length > 0);
  } else {
    console.log("[vellum] no up-to-date last build to update, building everything");
    const client = spawnSync(process.execPath, ["run", "build:client"], {
      cwd: join(import.meta.dir, ".."),
      stdio: "inherit",
    });
    if (client.status !== 0) process.exit(client.status ?? 1);
    await buildSite({ fetch: true });
    report(true);
  }
} else {
  await buildSite({ fetch: !args.includes("--no-fetch") });
}

function report(changed: boolean) {
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `changed=${changed}\n`);
}
