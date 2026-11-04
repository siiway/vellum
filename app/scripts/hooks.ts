// Installs the prek git hooks from prek.toml (pre-commit and pre-push).
// Runs from `prepare`, so `bun install` sets them up. Skipped in CI and
// outside a git checkout, and never fails the install.
//
// The config lives in app/, not at the repository root where prek looks, so
// the hooks are installed with its path. They still run from the root, over
// the whole repository.

import { existsSync } from "node:fs";
import { join } from "node:path";

const app = join(import.meta.dir, "..");
const repo = join(app, "..");

if (!process.env.CI && existsSync(join(repo, ".git"))) {
  const result = Bun.spawnSync(["bunx", "prek", "install", "-f", "-c", join(app, "prek.toml")], {
    cwd: repo,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    console.warn("could not install the git hooks; run `bun scripts/hooks.ts` in app/ to retry");
  }
}
