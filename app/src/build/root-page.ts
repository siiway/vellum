// `/`: picks the reader's locale in the browser and moves on to its landing
// page. Order: the `vellum-locale` cookie (an explicit earlier choice), then
// the browser's languages (exact tag first, then the primary subtag), then
// the default locale. Without JavaScript, a meta refresh goes to the default
// locale and the locales are listed as links.

import type { VellumConfig } from "../shared/types";

export function rootPage(site: VellumConfig): string {
  const { locales } = site.site;
  const fallback = locales.find((l) => l.code === site.site.defaultLocale) ?? locales[0]!;
  const choices = locales.map((l) => ({ c: l.code.toLowerCase(), p: l.prefix }));
  const script = `(function(){var L=${json(choices)},d=${json(fallback.prefix)};function go(p){location.replace("/"+p+location.search+location.hash);}try{var m=document.cookie.match(/(?:^|;\\s*)vellum-locale=([^;]+)/);if(m){var v=decodeURIComponent(m[1]).toLowerCase();for(var i=0;i<L.length;i++)if(L[i].c===v)return go(L[i].p);}var t=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||""]).map(function(x){return String(x).toLowerCase();});for(var a=0;a<t.length;a++)for(var b=0;b<L.length;b++)if(L[b].c===t[a])return go(L[b].p);for(var e=0;e<t.length;e++){var s=t[e].split("-")[0];for(var f=0;f<L.length;f++)if(L[f].c===s)return go(L[f].p);}}catch(_){}go(d);})();`;

  const links = locales
    .map(
      (l) =>
        `<li><a href="/${attr(l.prefix)}" hreflang="${attr(l.code)}">${html(l.label)}</a></li>`,
    )
    .join("");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="robots" content="noindex">
  <title>${html(site.site.title)}</title>
  <script>${script}</script>
  <noscript><meta http-equiv="refresh" content="0; url=/${attr(fallback.prefix)}"></noscript>
</head>
<body>
  <noscript><ul>${links}</ul></noscript>
</body>
</html>
`;
}

function json(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function html(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(s: string): string {
  return html(s).replace(/"/g, "&quot;");
}
