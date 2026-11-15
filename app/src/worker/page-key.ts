// Cache key for a page's payload. Its own module so the translation job can
// drop a page's entry without importing the page builder, which imports it.

import type { RouteContext } from "../shared/types";

export type PageKeyRoute = Pick<RouteContext, "repoSlug" | "localeCode" | "pagePath"> & {
  version: { branch: string };
};

// The payload doesn't depend on the host or the theme, so one entry serves
// every host, both themes, HTML and JSON. It does carry the route's canonical
// URL, which these fields decide: the router redirects the URL forms that
// would give a page a second one (unprefixed paths, the homepage repo's slug
// forms). Bump the version when the payload's shape changes.
export function pageCacheKey(route: PageKeyRoute): string {
  return `page1:${route.repoSlug}@${route.version.branch}:${route.localeCode}:${route.pagePath}`;
}
