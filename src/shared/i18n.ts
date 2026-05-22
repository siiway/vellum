// Tiny i18n dictionary used by the UI shell (NavBar, Sidebar, Outline, PageFooter,
// SearchDialog, ErrorPage, etc.). Markdown body translations come from the source
// repo - this is for the chrome the worker controls.

export type LocaleCode = "en" | "zh" | string;

type MessageMap = Record<string, string>;

const en: MessageMap = {
  "ui.search": "Search",
  "ui.search.placeholder": "Search the docs",
  "ui.search.empty": "No matches for",
  "ui.search.searching": "Searching",
  "ui.search.start": "Start typing to search across the docs.",
  "ui.search.shortcut": "Tip: press / or ⌘K from anywhere.",
  "ui.search.openHint": "Open page",
  "ui.search.recent": "Recent searches",
  "ui.search.allRepos": "All repos",
  "ui.search.seeAllResults": "Search all repos for",
  "ui.search.fullPageSubtitle": "Search across every documentation repo on this site.",
  "ui.search.crossRepoHint": "Results merge content from every repo, ranked together.",
  "ui.search.noResultsHint": "Try a different keyword, or remove the repo filter.",
  "ui.search.scope": "Repo filter",
  "ui.search.clear": "Clear",
  "ui.search.navigate": "navigate",
  "ui.search.result": "result",
  "ui.search.results": "results",
  "ui.search.close": "Close",
  "ui.search.escClose": "esc close",

  "ui.nav.primary": "Primary",
  "ui.nav.sidebar": "Documentation navigation",

  "ui.theme.toggleToLight": "Switch to light theme",
  "ui.theme.toggleToDark": "Switch to dark theme",
  "ui.locale.label": "Language",

  "ui.outline": "On this page",
  "ui.prev": "Previous",
  "ui.next": "Next",
  "ui.edit": "Edit this page on GitHub",
  "ui.pdf": "Download as PDF",
  "ui.lastUpdated": "Last updated",
  "ui.lastUpdatedBy": "by",

  "ui.copy": "Copy",
  "ui.copied": "Copied",
  "ui.copyCode": "Copy code",

  "ui.notFound.title": "We couldn't find that page",
  "ui.notFound.message": "The URL might be misspelled, or the page may have been moved or removed.",
  "ui.notFound.home": "Home",
  "ui.notFound.back": "Go back",
  "ui.notFound.search": "Search docs",
  "ui.notFound.suggestions": "You might have been looking for",

  "ui.loading": "Loading",
  "ui.menu": "Menu",
  "ui.returnToTop": "Return to top",
  "ui.skipToContent": "Skip to content",

  "ui.home.actions.getStarted": "Get started",
  "ui.home.features": "Features",
  "ui.home.learnMore": "Learn more",
};

const zh: MessageMap = {
  "ui.search": "搜索",
  "ui.search.placeholder": "搜索文档",
  "ui.search.empty": "未找到匹配项",
  "ui.search.searching": "搜索中",
  "ui.search.start": "开始输入以在文档中搜索。",
  "ui.search.shortcut": "提示：在任意位置按 / 或 ⌘K。",
  "ui.search.openHint": "打开页面",
  "ui.search.recent": "最近搜索",
  "ui.search.allRepos": "全部仓库",
  "ui.search.seeAllResults": "在全部仓库中搜索",
  "ui.search.fullPageSubtitle": "在站点的所有文档仓库中进行搜索。",
  "ui.search.crossRepoHint": "结果会合并所有仓库的内容并统一排序。",
  "ui.search.noResultsHint": "请尝试其他关键词，或移除仓库筛选条件。",
  "ui.search.scope": "仓库筛选",
  "ui.search.clear": "清除",
  "ui.search.navigate": "导航",
  "ui.search.result": "条结果",
  "ui.search.results": "条结果",
  "ui.search.close": "关闭",
  "ui.search.escClose": "esc 关闭",

  "ui.nav.primary": "主导航",
  "ui.nav.sidebar": "文档导航",

  "ui.theme.toggleToLight": "切换到浅色主题",
  "ui.theme.toggleToDark": "切换到深色主题",
  "ui.locale.label": "语言",

  "ui.outline": "目录",
  "ui.prev": "上一页",
  "ui.next": "下一页",
  "ui.edit": "在 GitHub 上编辑此页",
  "ui.pdf": "下载为 PDF",
  "ui.lastUpdated": "最后更新",
  "ui.lastUpdatedBy": "·作者",

  "ui.copy": "复制",
  "ui.copied": "已复制",
  "ui.copyCode": "复制代码",

  "ui.notFound.title": "找不到该页面",
  "ui.notFound.message": "URL 可能拼写有误，或该页面已被移动或删除。",
  "ui.notFound.home": "主页",
  "ui.notFound.back": "返回",
  "ui.notFound.search": "搜索文档",
  "ui.notFound.suggestions": "你也许在找",

  "ui.loading": "加载中",
  "ui.menu": "菜单",
  "ui.returnToTop": "返回顶部",
  "ui.skipToContent": "跳到内容",

  "ui.home.actions.getStarted": "开始使用",
  "ui.home.features": "功能",
  "ui.home.learnMore": "了解更多",
};

const dictionaries: Record<string, MessageMap> = { en, zh };

export type MessageKey = keyof typeof en;

export function t(locale: LocaleCode, key: MessageKey, fallback?: string): string {
  const dict = dictionaries[locale] ?? en;
  return (dict as MessageMap)[key] ?? (en as MessageMap)[key] ?? fallback ?? (key as string);
}

// Format helper: t("ui.foo.bar {name}", { name: "x" }).
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}
