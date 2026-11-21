---
title: Markdown 中的 React 组件
description: "把 FluentUI 原语或文档仓库自己的组件直接写进 .md 文件，它们会作为真正的 React 组件挂载。"
---

# Markdown 中的 React 组件

Vellum 识别 markdown 中的 PascalCase HTML 标签，并把它们作为真正的
React 组件挂载，而不是通过 `dangerouslySetInnerHTML` 当作惰性 HTML 输出。可识别的标签集合是一个精选注册表，位于
[`src/web/reactComponents.ts`](https://github.com/siiway/vellum/blob/main/app/src/web/reactComponents.ts)，再加上[文档仓库列出的组件](#来自文档仓库的组件)——所以作者可以放心使用，无需担心 XSS。

## 已注册的组件

注册表预装了在文档里好用的 FluentUI v9 原语。markdown 里任何匹配 key 的
PascalCase 标签都会被挂载：

| 组件                                                                                                                                                                       | 说明                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Button`                                                                                                                                                                   | 按钮和行动号召。                                                             |
| `Card`                                                                                                                                                                     | 卡片容器。                                                                   |
| `Divider`                                                                                                                                                                  | 横向 / 纵向分割线。                                                          |
| `Image`                                                                                                                                                                    | 带 `fit` 等属性的 FluentUI 图片。                                            |
| `Link`                                                                                                                                                                     | 主题化链接。                                                                 |
| `Tab` / `TabList`                                                                                                                                                          | tabs（直接声明用；要做内容 tabs 请用 [DocFX tabs](./ops-extensions#tabs)）。 |
| `Tooltip`                                                                                                                                                                  | 工具提示。                                                                   |
| `Avatar`、`Badge`、`CardFooter`、`CardHeader`、`CardPreview`、`CounterBadge`、`InfoLabel`、`Input`、`PresenceBadge`、`ProgressBar`、`Spinner`、`Switch`、`Tag`、`Textarea` | 页面第一次使用时按需懒加载。                                                 |

前面一组在主客户端 bundle 中（Vellum 外壳本来就在用）。懒加载的那一组位于单独的 chunk，所以不使用它们的页面零开销。两组都在页面预渲染的 HTML
中：构建在渲染之前加载懒加载的组件，使用了它们的页面会在 hydrate 之前加载它们的 chunk。

## 行内与块级用法

行内和块级两种形式都可以——Vellum 的解析器会把 PascalCase 的开/闭对折叠成一个结构化的 AST 节点，所以你可以在段落中间写按钮，也可以让它独立成块：

```md
Click <Button appearance="primary">this button</Button> to continue,
or read the <Link href="/vl-handbook/getting-started">getting started</Link>
guide first.

For a bigger call to action:

<Button appearance="primary" size="large">
  Sign me up
</Button>
```

Click <Button appearance="primary">this button</Button> to continue, or read
the <Link href="./getting-started">getting started</Link> guide first.

For a bigger call to action:

<Button appearance="primary" size="large">Sign me up</Button>

## 属性

属性被强制转换为常见的 JS 值：

- `"true"` / `"false"` → boolean
- 全数字字符串 → number
- 其它 → string
- 没有 `=` 的裸属性 → `true`

`class` 被改写为 `className`；`for` 被改写为 `htmlFor`。例如：

```md
<Tag size="medium" appearance="brand">Production-ready</Tag>
<Spinner size="tiny" label="Loading" labelPosition="after" />
```

渲染为：

<Tag size="medium" appearance="brand">Production-ready</Tag>

<Spinner size="tiny" label="Loading" labelPosition="after" />

## 自闭合标签

解析器直接支持 `<Component />` 和 `<Component prop="x" />`：

```md
<Divider />

<Spinner size="medium" />
```

## 未知标签

既不在注册表中、也不是仓库组件的 PascalCase 标签会以纯行内文本形式渲染它的 **children**——属性会被静默丢弃。这样在作者拼错名字（例如 `<Buton>...</Buton>`）时内容仍可读，同时在视觉上明显能看出问题（缺少样式）。

如果你想让未知标签渲染成原始 HTML，使用小写形式（例如 `<button>` 会落到普通 HTML 按钮上）。

## 添加自己的组件

编辑 `src/web/reactComponents.ts`。两种写法：

```ts
// 立即加载：进入主 bundle。组件很小或几乎所有页面都用时合适。
import { MyComponent } from "./MyComponent";

export const REACT_COMPONENTS = {
  ...,
  MyComponent,
};

// 懒加载：位于独立的 chunk，只在使用它的页面上加载。
const HeavyChart = lazyComponent(() => import("./HeavyChart").then((m) => m.HeavyChart));

export const REACT_COMPONENTS = {
  ...,
  HeavyChart,
};
```

::: tip 注意 bundle 体积
立即加载一个重组件意味着每个页面都要为它付出代价。除非组件被外壳全局使用，否则懒加载。
:::

## 来自文档仓库的组件

文档仓库可以自带 React 组件，无需修改 Vellum。在文档根下的 `vellum.json` 中列出它们，每个名字对应一个文件，路径相对于文档根：

```json
{
  "components": {
    "Counter": "_components/Counter.tsx",
    "Feedback": "_components/Feedback.tsx"
  }
}
```

文件的默认导出（或与组件同名的导出）就是组件。本手册的 `Counter`：

```tsx
// _components/Counter.tsx
import { useState, type ReactNode } from "react";
import { usePage } from "vellum";
import "./Counter.css";

export default function Counter({ start = 0, children }: { start?: number; children?: ReactNode }) {
  const [count, setCount] = useState(start);
  const { lang } = usePage();
  const label = children ?? (lang === "zh" ? "点击次数" : "Clicks");
  return (
    <button type="button" className="vl-counter" onClick={() => setCount((n) => n + 1)}>
      {label}: {count}
    </button>
  );
}
```

页面像使用其他标签一样使用它：

```md
<Counter start="3" />
```

<Counter start="3" />

组件在页面自己的 React 树中渲染，所以页面的主题对它生效，FluentUI 的 CSS 变量（`var(--colorNeutralForeground1)` ……）也能在它的样式中使用。

- 名字使用 PascalCase。在仓库的页面上，仓库的组件会取代注册表中的同名组件；如果它的 VitePress 主题也注册了这个名字，则仍是那个 Vue 组件。
- 组件从[引擎](#引擎)导入 React 和 Fluent UI，按相对路径导入仓库中的 `.tsx`、`.ts`、`.jsx`、`.js`、`.json` 和 `.css` 文件，并导入文档根安装的[包](#包)。
- 它导入的样式表作用于整个页面，所以请给其中的类名加上前缀。不支持 CSS Modules。只作用于组件自身的样式，请使用 Fluent 或 Griffel 的 `makeStyles`。
- `vellum` 中的 `usePage()` 返回页面的 `lang`、`isDark`、`accent`（站点的强调色，形如 `#rrggbb`）、`path`、`title`、`description` 和 `frontmatter`，并跟随主题切换。
- 属性按上文的规则变成 props，标签的内容成为它的 children。
- 构建会把组件渲染进页面的 HTML（以浅色主题），所以它在页面脚本加载之前就会显示，没有 JavaScript 也能看到。搜索中是标签的内容。
- 由于构建会运行组件，组件渲染时不能使用 `window` 或 `document`（请在 effect 中使用），并且每次渲染结果都要相同：渲染内容中不要用 `Date.now()` 或 `Math.random()`。
- 无法构建的组件、无法安装的包，或在构建渲染时抛出错误的组件，都会让仓库的构建失败，和无法渲染的页面一样，因此 `bun run update` 会保留该仓库上一次的页面。在读者浏览器中抛出错误的组件会在它的位置显示错误。

### 引擎

React、Griffel 和每个 Fluent UI v9 包都来自 Vellum 的客户端构建，即它的引擎，而不是来自各仓库的 bundle。引擎把每个包做成一个独立的模块，带有它的全部导出；页面已有的代码，引擎就用页面的。因此组件使用的 Fluent 就是页面的 Fluent：它跟随页面的主题，它的工具提示和弹出框在页面的 portal 中打开并带有该主题，它的样式和页面自己的样式合在一起，每条规则只有一份。页面没有的代码是引擎自己的，只在有组件的页面上加载：页面的 bundle 和没有引擎时一样，只多了引擎从中导入的名字。对于页面只用到一部分的模块，如果它不含状态（例如 Fluent 的 tokens 这样的数据、样式 hook、图标），引擎有它自己的一份，页面就不必保留其余部分。组件按通常的名字导入它们，不需要 `package.json`：

- `react`、`react/jsx-runtime`、`react-dom`
- `@fluentui/react-components`、组成它的各个 `@fluentui/react-*` 包、`@griffel/react` 和 `@griffel/core`
- `vellum`

对 `@fluentui/react-components` 的导入会变成对它所重新导出的包的导入，只包括组件用到的那些。Fluent 的图标（`@fluentui/react-icons`）不在引擎中：组件从它的包中打包它用到的那几个。引擎中各包的其他路径（例如 `react-dom/client`）不能导入。

本手册的 `Feedback` 使用 Fluent 的 Button、Tooltip 和 Popover，它的模块只有 1.5 KB：

```tsx
// _components/Feedback.tsx
import { useState } from "react";
import {
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { usePage } from "vellum";

const useStyles = makeStyles({
  surface: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  answers: { display: "flex", gap: tokens.spacingHorizontalS },
});

export default function Feedback() {
  const { lang } = usePage();
  const zh = lang === "zh";
  const styles = useStyles();
  const [answered, setAnswered] = useState(false);
  return (
    <Popover withArrow>
      <PopoverTrigger disableButtonEnhancement>
        <Tooltip
          content={zh ? "告诉我们这一页写得怎么样" : "Tell us how this page did"}
          relationship="description"
        >
          <Button appearance="primary">{zh ? "这一页有帮助吗？" : "Was this page helpful?"}</Button>
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface className={styles.surface}>
        {answered ? (
          zh ? "谢谢！" : "Thanks!"
        ) : (
          <div className={styles.answers}>
            <Button onClick={() => setAnswered(true)}>{zh ? "有帮助" : "Yes"}</Button>
            <Button onClick={() => setAnswered(true)}>{zh ? "没有" : "No"}</Button>
          </div>
        )}
      </PopoverSurface>
    </Popover>
  );
}
```

<Feedback />

引擎中每个包都是 Vellum 的版本。如果仓库的包中有更新的版本，构建会失败，因为针对该版本编写的代码可能会用到引擎版本所没有的东西。请用 `package.json` 中的 `overrides` 把它固定到引擎的版本或更旧的版本；错误信息会给出那个版本。

### 包

其他任何东西，例如组件库或 Fluent 的图标，请在文档根下放置 `package.json` 和它的 `bun.lock`。构建用 `bun install --frozen-lockfile --production --ignore-scripts` 安装它们：只装 dependencies，不装 devDependencies，也不运行任何包的脚本。安装时只复制这两个文件，所以仓库的 `bunfig.toml` 或 `.npmrc` 不起作用。安装结果在构建之间保留，任一文件变化时重新安装。包来自 registry 或 URL；本地路径（`file:`、`link:`、workspace）会让构建失败。

包对引擎中各包的导入（基于 Fluent 的组件库就会有）同样使用引擎的版本。

### 加载方式

构建一次性打包仓库的所有组件，输出到 `/_vellum/react/{repo}/`：每个组件一个模块 `{Name}.js`，它们共享的 chunk `chunk-{hash}.js`，以及它们导入的每个样式表各一个文件。多个组件都用到的代码位于同一个 chunk 中，只加载一次。

使用组件的页面会在 head 中预加载它的模块、它的 chunk 以及它们导入的引擎模块，与页面自己的脚本一起下载；并链接它的样式表，从第一次绘制起就生效。不使用组件的页面不加载这些。模块加载完成后页面才会 hydrate。通过客户端导航进入这样的页面时，它们在那时加载，加载完成之前标签显示的是它的内容。

## Vue 组件

为 VitePress 编写的文档仓库，可以继续使用它在文档根下
`.vitepress/theme/index.ts` 中注册的 Vue 组件：

```ts
// .vitepress/theme/index.ts
import DefaultTheme from "vitepress/theme";
import ScopeBuilder from "./ScopeBuilder.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("ScopeBuilder", ScopeBuilder);
  },
};
```

构建会读取这个文件（不会运行它），找出每个 `app.component("Name", X)`
中 `X` 从 `.vue` 文件导入的组件，并把该文件发布到
`/_vellum/vue/{repo}/{Name}.vue`。页面里的 `<ScopeBuilder />` 会变成一个占位元素，读者的浏览器加载 Vue 和 `vue3-sfc-loader`（只在包含组件的页面上），再把组件挂载进去。

- 只有注册过的组件会加载，组件只能导入 `vue` 和 `vitepress`。
- `vitepress` 只提供 `useData()` 和 `useRoute()`，包含页面的语言、标题、
  frontmatter 和主题；没有其他 API。
- 属性会变成 props（数字和布尔值会被转换）；子内容和插槽会被丢弃。
- 组件只在浏览器中渲染，所以不在预渲染的 HTML 里，也不会被搜索到。

## 安全

注册表是一个封闭集合：标签名只能挂载注册表中列出的组件。但这并不能隔离页面的其余部分。`<script>` 标签会像在 VitePress 中一样被丢弃，但其他原始 HTML（`<sub>`、`<kbd>` ……）会原样保留，而仓库的 Vue 和 React 组件及其使用的包就是它自己的代码，会在读者的浏览器中运行。Vellum 不会对文档内容做清理，所以只发布你信任其作者的仓库。

构建也会运行仓库的 React 组件来渲染它们：它们的代码在构建机器上运行，可以访问构建的环境（其中的 `VELLUM_GITHUB_TOKEN`）和文件。只有在你也放心把这些交给组件作者时，才列出带组件的仓库。

如果你需要一个全新的交互式原语，把它加进注册表或仓库的组件：markdown 中的
`<script>` 不会运行。
