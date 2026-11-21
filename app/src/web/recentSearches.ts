// The reader's recent searches, shared by the search dialog and the search
// page. They live in localStorage, which can be missing or blocked (a private
// window, cleared site data), so every access is guarded and falls back to
// none. Each change reads the stored list first, so the dialog and the page
// don't overwrite each other's entries.

const KEY = "vellum.search.recent";
const MAX = 8;

export function loadRecent(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function save(list: string[]): string[] {
  try {
    if (list.length > 0) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {}
  return list;
}

// Puts `query` first. Returns the new list.
export function addRecent(query: string): string[] {
  const q = query.trim();
  const list = loadRecent();
  if (!q) return list;
  return save([q, ...list.filter((r) => r !== q)].slice(0, MAX));
}

export function removeRecent(query: string): string[] {
  return save(loadRecent().filter((r) => r !== query));
}

export function clearRecent(): string[] {
  return save([]);
}
