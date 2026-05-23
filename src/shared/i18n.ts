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
  "ui.locale.allLanguages": "All languages",
  "ui.locale.moreLanguages": "More languages…",

  "ui.translated.banner": "Translating, you can view this page in",
  "ui.translated.notice":
    "This page has been machine-translated from the source language. Translations may be imperfect.",
  "ui.translated.viewOriginal": "View original",
  "ui.translated.unavailableBanner": "Translation not ready yet",
  "ui.translated.unavailableNotice":
    "We're showing the original source while the translation is prepared. Try again in a moment, or pick a different language.",
  "ui.translated.byModel": "Translated by {model}",

  "ui.languages.title": "All languages",
  "ui.languages.subtitle": "Pick a language to view this site in.",
  "ui.languages.machineTranslated": "Machine-translated",
  "ui.languages.empty": "No languages are configured for this site.",
  "ui.languages.current": "Current",
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

  "ui.aiSummary.button": "AI Summary",
  "ui.aiSummary.title": "Summary by AI",
  "ui.aiSummary.loading": "Reading the page…",
  "ui.aiSummary.regenerate": "Regenerate",
  "ui.aiSummary.close": "Close summary",
  "ui.aiSummary.cached": "cached",
  "ui.aiSummary.disclaimer":
    "AI-generated content may be incorrect. Verify important details against the page.",
  "ui.ai.tryingProvider": "Trying {id} ({attempt}/{total})…",
  "ui.ai.providerFailed": "{id} failed, falling over…",

  "ui.askAi.button": "Ask AI",
  "ui.askAi.title": "Ask AI about this docs",
  "ui.askAi.close": "Close chat",
  "ui.askAi.scope": "Scope",
  "ui.askAi.scope.currentRepo": "This repo",
  "ui.askAi.scope.site": "Whole site",
  "ui.askAi.empty.title": "Ask anything about these docs.",
  "ui.askAi.empty.body": "The AI can search and read the docs to answer.",
  "ui.askAi.placeholder": "Ask a question…",
  "ui.askAi.send": "Send",
  "ui.askAi.disclaimer":
    "AI answers may be incorrect. Verify important details against the linked pages.",
  "ui.askAi.newChat": "New chat",
  "ui.askAi.stop": "Stop generating",
  "ui.askAi.history": "History",
  "ui.askAi.clearHistory": "Clear all history",
  "ui.askAi.clearHistory.confirm": "Clear every saved chat session? This can't be undone.",
  "ui.askAi.cancel": "Cancel",
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
  "ui.locale.allLanguages": "全部语言",
  "ui.locale.moreLanguages": "更多语言…",

  "ui.translated.banner": "正在翻译，你也可以用其他语言查看本页",
  "ui.translated.notice": "本页由机器翻译自源语言，翻译可能不完全准确。",
  "ui.translated.viewOriginal": "查看原文",
  "ui.translated.unavailableBanner": "翻译暂未就绪",
  "ui.translated.unavailableNotice":
    "当前展示的是原文，翻译稍后会准备好。稍等片刻再试，或切换到其他语言。",
  "ui.translated.byModel": "由 {model} 翻译",

  "ui.languages.title": "全部语言",
  "ui.languages.subtitle": "选择一种语言来查看本站。",
  "ui.languages.machineTranslated": "机器翻译",
  "ui.languages.empty": "本站未配置任何语言。",
  "ui.languages.current": "当前",
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

  "ui.aiSummary.button": "AI 摘要",
  "ui.aiSummary.title": "AI 摘要",
  "ui.aiSummary.loading": "正在阅读页面…",
  "ui.aiSummary.regenerate": "重新生成",
  "ui.aiSummary.close": "关闭摘要",
  "ui.aiSummary.cached": "缓存",
  "ui.aiSummary.disclaimer": "AI 生成的内容可能不准确，请以原文为准。",
  "ui.ai.tryingProvider": "尝试 {id}（{attempt}/{total}）…",
  "ui.ai.providerFailed": "{id} 失败，正在切换…",

  "ui.askAi.button": "问问 AI",
  "ui.askAi.title": "向 AI 提问关于这份文档",
  "ui.askAi.close": "关闭对话",
  "ui.askAi.scope": "范围",
  "ui.askAi.scope.currentRepo": "当前仓库",
  "ui.askAi.scope.site": "整个站点",
  "ui.askAi.empty.title": "可以就这份文档提任何问题。",
  "ui.askAi.empty.body": "AI 会自动搜索和阅读相关页面来回答。",
  "ui.askAi.placeholder": "输入问题…",
  "ui.askAi.send": "发送",
  "ui.askAi.disclaimer": "AI 的回答可能有误，请以引用的页面为准。",
  "ui.askAi.newChat": "新对话",
  "ui.askAi.stop": "停止生成",
  "ui.askAi.history": "历史会话",
  "ui.askAi.clearHistory": "清除全部历史",
  "ui.askAi.clearHistory.confirm": "确定要清除所有保存的对话吗？此操作无法撤销。",
  "ui.askAi.cancel": "取消",
};

const dictionaries: Record<string, MessageMap> = { en, zh };

export type MessageKey = keyof typeof en;

// Runtime-injected dictionaries. Populated server-side from
// BootstrapPayload.uiStrings (which the worker fills via the translate
// service) so MT-target locales render with translated chrome without a
// code change. Wins over the bundled `dictionaries` map but loses to
// hand-curated locales in that map — so adding "es" to translate.targets
// gets you Spanish chrome immediately, and shipping a hand-curated
// dictionaries.es later quietly takes priority.
const runtimeDictionaries: Record<string, MessageMap> = {};

export function registerUiStrings(locale: string, strings: Record<string, string>): void {
  runtimeDictionaries[locale] = strings;
}

// The English baseline. Exported so the worker can read the full keyset
// when batching the dictionary through the translation service.
export const baseUiStrings: MessageMap = en;

export function t(locale: LocaleCode, key: MessageKey, fallback?: string): string {
  // Resolution order:
  //   1. Hand-curated dictionary for this locale (en / zh / future hand
  //      translations) — author content always wins.
  //   2. Runtime-injected dictionary (from the worker's translate service).
  //   3. English baseline.
  //   4. Caller-supplied fallback.
  //   5. The key itself (for unbundled locales with no runtime entry, this
  //      surfaces the lookup miss clearly during development).
  const curated = dictionaries[locale];
  if (curated && curated[key]) return curated[key];
  const runtime = runtimeDictionaries[locale];
  if (runtime && runtime[key]) return runtime[key];
  return (en as MessageMap)[key] ?? fallback ?? (key as string);
}

// Format helper: t("ui.foo.bar {name}", { name: "x" }).
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}
