// Discovers Vue components registered in a repo's VitePress theme entry
// (`.vitepress/theme/index.ts`). The markdown renderer mounts them as Vue
// "islands" inside rendered docs; the build publishes each registered .vue
// file at `/_vellum/vue/{repo}/{Name}.vue` for the client's runtime SFC
// loader.

import type { RepoConfig, VueComponentRef } from "../shared/types";
import { readSourceFile, docsRootPrefix } from "./sources";
import { memo } from "./memo";

// Reads .vitepress/theme/index.ts and pulls out `app.component("Name", X)`
// registrations, resolving the symbol back to its .vue import.
export function loadVueComponents(repo: RepoConfig): Promise<VueComponentRef[]> {
  return memo(`vue:${repo.slug}`, async () => {
    const themeDir = `${docsRootPrefix(repo.docsRoot)}.vitepress/theme/`;
    const text = await readSourceFile(repo, `${themeDir}index.ts`);
    if (!text) return [];

    // Map of imported symbol -> .vue file path relative to theme/index.ts.
    const imports = new Map<string, string>();
    const importRe = /import\s+(\w+)\s+from\s+["']([^"']+\.vue)["']/g;
    let im: RegExpExecArray | null;
    while ((im = importRe.exec(text)) !== null) {
      imports.set(im[1]!, im[2]!);
    }

    const components: VueComponentRef[] = [];
    const seen = new Set<string>();
    const regRe = /app\.component\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g;
    let rm: RegExpExecArray | null;
    while ((rm = regRe.exec(text)) !== null) {
      const name = rm[1]!;
      const sym = rm[2]!;
      if (seen.has(name)) continue;
      const relPath = imports.get(sym);
      if (!relPath) continue;
      // Strip leading "./" if present.
      const cleaned = relPath.startsWith("./") ? relPath.slice(2) : relPath;
      components.push({ name, path: `${themeDir}${cleaned}` });
      seen.add(name);
    }
    return components;
  });
}
