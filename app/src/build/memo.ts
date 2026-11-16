// Run-scoped memoization. A build is one process, so a plain map is the whole
// cache: every loader that several pages ask for (a repo's sidebar, xrefmap,
// VitePress config, file list, …) runs once per build. Failures are
// remembered too; a build that hit one fails anyway.

const store = new Map<string, Promise<unknown>>();

export function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  let hit = store.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = load();
    store.set(key, hit);
  }
  return hit;
}
