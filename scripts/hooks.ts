// Installs the prek git hooks from prek.toml (pre-commit and pre-push).
// Runs from `prepare`, so `bun install` sets them up. Skipped in CI and
// outside a git checkout, and never fails the install.

import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

if (!process.env.CI && existsSync(join(root, ".git"))) {
  const result = Bun.spawnSync(["bunx", "prek", "install", "-f"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    console.warn("could not install the git hooks; run `bun scripts/hooks.ts` to retry");
  }
}
