// Tiny i18n dictionary used by the UI shell (NavBar, Sidebar, Outline, PageFooter,
// SearchDialog, ErrorPage, etc.). Markdown body translations come from the source
// repo - this is for the chrome Vellum controls.

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
  "ui.search.noResultsHint": "Try a different keyword, or remove the repo filter.",
  "ui.search.scope": "Repo filter",
  "ui.search.clear": "Clear",
  "ui.search.navigate": "navigate",
  "ui.search.result": "result",
  "ui.search.results": "results",
  "ui.search.close": "Close",
  "ui.search.escClose": "esc close",
  "ui.search.inRepo": "Search in a repo",
  "ui.search.tips": "Search tips",
  "ui.search.tip.word": "term",
  "ui.search.tip.phraseExample": '"exact text"',
  "ui.search.tip.phrase": "Pages containing the exact phrase",
  "ui.search.tip.exclude": "Leaves out pages containing the word",
  "ui.search.tip.title": "Pages whose title contains the word",
  "ui.search.tip.repo": "Only that repo's pages",

  "ui.nav.primary": "Primary",
  "ui.nav.sidebar": "Documentation navigation",

  "ui.theme.label": "Theme",
  "ui.theme.system": "System",
  "ui.theme.light": "Light",
  "ui.theme.dark": "Dark",
  "ui.locale.label": "Language",
  "ui.locale.allLanguages": "All languages",
  "ui.locale.moreLanguages": "More languages…",
  "ui.fallback": "This page isn't available in {locale} yet. It's shown in {source}.",

  "ui.languages.title": "All languages",
  "ui.languages.subtitle": "Pick a language to view this site in.",
  "ui.languages.empty": "No languages are configured for this site.",
  "ui.languages.current": "Current",
  "ui.languages.source": "Source",
  "ui.languages.continent.AS": "Asia",
  "ui.languages.continent.EU": "Europe",
  "ui.languages.continent.AF": "Africa",
  "ui.languages.continent.NA": "North America",
  "ui.languages.continent.SA": "South America",
  "ui.languages.continent.OC": "Oceania",
  "ui.languages.continent.AN": "Antarctica",
  "ui.languages.continent.OTHER": "Other",

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
  "ui.permalink": "Permalink to this heading",
  "ui.details": "Details",
  "ui.table": "Markdown table",
  "ui.video": "Video",
  "ui.xref.unresolved": "Unresolved xref",
  "ui.moniker.appliesTo": "Applies to: {range}",
  "ui.socialLinks": "Social links",
  "ui.externalLink": "External link",

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

  "ui.mermaid.label": "Mermaid diagram",
  "ui.mermaid.loading": "Mermaid diagram (loading)",
  "ui.mermaid.error": "Mermaid diagram (error)",
  "ui.mermaid.errorMessage": "Mermaid error: {message}",

  "ui.component.error": "Couldn't show <{name} />: {message}",

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
  "ui.search.noResultsHint": "请尝试其他关键词，或移除仓库筛选条件。",
  "ui.search.scope": "仓库筛选",
  "ui.search.clear": "清除",
  "ui.search.navigate": "导航",
  "ui.search.result": "条结果",
  "ui.search.results": "条结果",
  "ui.search.close": "关闭",
  "ui.search.escClose": "esc 关闭",
  "ui.search.inRepo": "在仓库中搜索",
  "ui.search.tips": "搜索技巧",
  "ui.search.tip.word": "词语",
  "ui.search.tip.phraseExample": '"完整短语"',
  "ui.search.tip.phrase": "包含这个完整短语的页面",
  "ui.search.tip.exclude": "排除包含该词的页面",
  "ui.search.tip.title": "标题包含该词的页面",
  "ui.search.tip.repo": "只搜索该仓库的页面",

  "ui.nav.primary": "主导航",
  "ui.nav.sidebar": "文档导航",

  "ui.theme.label": "主题",
  "ui.theme.system": "跟随系统",
  "ui.theme.light": "浅色",
  "ui.theme.dark": "深色",
  "ui.locale.label": "语言",
  "ui.locale.allLanguages": "全部语言",
  "ui.locale.moreLanguages": "更多语言…",
  "ui.fallback": "此页面尚无{locale}版本，以下为 {source} 版本。",

  "ui.languages.title": "全部语言",
  "ui.languages.subtitle": "选择一种语言来查看本站。",
  "ui.languages.empty": "本站未配置任何语言。",
  "ui.languages.current": "当前",
  "ui.languages.source": "源语言",
  "ui.languages.continent.AS": "亚洲",
  "ui.languages.continent.EU": "欧洲",
  "ui.languages.continent.AF": "非洲",
  "ui.languages.continent.NA": "北美洲",
  "ui.languages.continent.SA": "南美洲",
  "ui.languages.continent.OC": "大洋洲",
  "ui.languages.continent.AN": "南极洲",
  "ui.languages.continent.OTHER": "其他",

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
  "ui.permalink": "此标题的永久链接",
  "ui.details": "详细信息",
  "ui.table": "Markdown 表格",
  "ui.video": "视频",
  "ui.xref.unresolved": "未解析的 xref",
  "ui.moniker.appliesTo": "适用于：{range}",
  "ui.socialLinks": "社交链接",
  "ui.externalLink": "外部链接",

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

  "ui.mermaid.label": "Mermaid 图表",
  "ui.mermaid.loading": "Mermaid 图表（加载中）",
  "ui.mermaid.error": "Mermaid 图表（出错）",
  "ui.mermaid.errorMessage": "Mermaid 错误：{message}",

  "ui.component.error": "无法显示 <{name} />：{message}",

  "ui.home.actions.getStarted": "开始使用",
  "ui.home.features": "功能",
  "ui.home.learnMore": "了解更多",
};

const dictionaries: Record<string, MessageMap> = { en, zh };

export type MessageKey = keyof typeof en;

export function t(locale: LocaleCode, key: MessageKey, fallback?: string): string {
  // The locale's dictionary, then English, then the caller's fallback, then
  // the key itself (so a lookup miss shows up clearly during development).
  const curated = dictionaries[locale];
  if (curated && curated[key]) return curated[key];
  return (en as MessageMap)[key] ?? fallback ?? (key as string);
}

// Format helper: t("ui.foo.bar {name}", { name: "x" }).
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}
