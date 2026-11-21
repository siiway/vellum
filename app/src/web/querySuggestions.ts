// Completions for the search syntax (src/shared/search.ts), offered as the
// reader types: the qualifier a word starts to spell (`tit` → `title:`), and
// after `repo:` the repos whose slug starts with what follows. They complete
// the word the caret ends, so editing the middle of a query works too.

export interface Qualifier {
  key: string;
  detail: string;
}

export interface QuerySuggestion {
  // The completed word.
  label: string;
  // What it does, or the repo's name.
  detail: string;
  // The query with the word completed, and where the caret goes in it.
  query: string;
  caret: number;
}

const MAX = 8;

export function suggestQuery(
  q: string,
  caret: number,
  qualifiers: Qualifier[],
  repos: { slug: string; displayName: string }[],
): QuerySuggestion[] {
  const before = q.slice(0, caret);
  const after = q.slice(caret);
  // Only at the end of a word, and not inside a "phrase".
  if (after && !/^\s/.test(after)) return [];
  if ((before.match(/"/g)?.length ?? 0) % 2 === 1) return [];
  const word = /\S*$/.exec(before)![0];
  // A -term excludes; it takes no qualifier.
  if (!word || word.startsWith("-")) return [];
  const head = before.slice(0, before.length - word.length);
  const make = (label: string, detail: string, space: boolean): QuerySuggestion => {
    const text = space && !after ? `${label} ` : label;
    return { label, detail, query: head + text + after, caret: head.length + text.length };
  };

  const lower = word.toLowerCase();
  const colon = lower.indexOf(":");
  if (colon < 0) {
    // One letter would match too many words on their way to being typed,
    // and a whole key (`repo`) may be the word the reader means.
    if (lower.length < 2) return [];
    return qualifiers
      .filter((k) => k.key.startsWith(lower) && k.key !== lower)
      .map((k) => make(`${k.key}:`, k.detail, false));
  }
  if (lower.slice(0, colon) !== "repo" || !qualifiers.some((k) => k.key === "repo")) return [];
  const value = lower.slice(colon + 1);
  const matches = repos.filter((r) => r.slug.toLowerCase().startsWith(value));
  // A finished slug needs nothing, unless longer slugs start with it: then
  // it comes first, so Tab keeps it.
  const exact = matches.findIndex((r) => r.slug.toLowerCase() === value);
  if (exact >= 0 && matches.length === 1) return [];
  if (exact > 0) matches.unshift(...matches.splice(exact, 1));
  return matches.slice(0, MAX).map((r) => make(`repo:${r.slug}`, r.displayName, true));
}

// Whether the query ends in a qualifier with nothing after it yet (`repo:`).
// The search ignores it (src/shared/search.ts): the reader is mid-word.
export function endsInBareQualifier(q: string): boolean {
  const last = /\S*$/.exec(q.trimEnd())![0].toLowerCase();
  return last === "title:" || last === "repo:";
}
