// Where the build publishes the files the client reads at runtime. The build
// writes them and the client fetches them, so both use these.

// A page's bootstrap payload, used for client-side navigation. `pathname` is
// the page URL's path; trailing slashes don't matter.
export function payloadPath(pathname: string): string {
  const page = pathname.replace(/^\/+|\/+$/g, "") || "index";
  return `/_vellum/pages/${page}.json`;
}

// The search index of one repo in one locale.
export function searchIndexPath(localeCode: string, repoSlug: string): string {
  return `/_vellum/search/${encodeURIComponent(localeCode)}/${encodeURIComponent(repoSlug)}.json`;
}

// The source of a registered Vue component.
export function vueComponentPath(repoSlug: string, name: string): string {
  return `/_vellum/vue/${encodeURIComponent(repoSlug)}/${encodeURIComponent(name)}.vue`;
}
