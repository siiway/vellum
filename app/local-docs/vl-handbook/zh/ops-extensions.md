---
title: OPS 扩展
description: "Microsoft Learn / DocFX 的 markdown 扩展：tabs、image/video、row/column、zone、moniker、INCLUDE、code-include、xref。"
---

# OPS 扩展

Microsoft 的 **Open Publishing System**（OPS，现已更名为 Microsoft Learn）
在 CommonMark 之上提供了一套 Markdown 扩展。Vellum 实现了完整集，
所以为 Learn 撰写的文档无需修改即可在这里渲染。

| 扩展                  | Vellum 的支持情况                                            |
| --------------------- | ------------------------------------------------------------ |
| 三冒号 image          | ✓ —— 见 [图片与视频](#图片与视频)                            |
| 三冒号 video          | ✓                                                            |
| 行 / 列网格           | ✓ —— 12 列响应式网格，见 [网格布局](#网格布局)                |
| Zone 切换             | ✓ —— 见 [Zones](#zones)                                      |
| Moniker 范围          | ✓ —— 见 [Monikers](#monikers)                                |
| DocFX tabs            | ✓ —— 见 [Tabs](#tabs)                                        |
| `[!INCLUDE]`          | ✓ —— 见 [Includes](#includes)                                |
| `[!code-<lang>]`      | ✓ —— 见 [代码包含](#代码包含)                                |
| `<xref:Uid>`          | ✓ —— 见 [xref](#xref)                                        |

每个扩展在 [功能测试](./tests/) 一节都有可工作的示例——把那些页面
和本参考一起打开对照阅读。

## 图片与视频

```md
:::image source="img/screenshot.png" alt-text="The settings panel" type="content":::

:::image source="img/diagram.svg" alt-text="Architecture" border="true" lightbox="img/diagram-full.svg":::

:::video source="https://www.youtube.com/embed/dQw4w9WgXcQ":::
```

属性：

- `source` —— 图片或视频 URL（必填）
- `alt-text` / `alt` —— 图片的替代文字
- `type` —— `content` | `icon` | `complex`
- `border` —— 设为 `"true"` 时绘制一道 1px 的细边框
- `lightbox` —— 点击图片时打开的 URL（在新标签页打开）
- `title` —— 视频的标题文字

视频渲染器会为托管服务（YouTube、Channel 9）选择 `<iframe>`，
为直接的 `.mp4` / `.webm` / `.ogg` URL 选择 HTML5 `<video controls>`。

## 网格布局

12 列网格用 `:::row::: ... :::row-end:::` 开始，内部用
`:::column span="N":::` 填充。span 总和为 12 时撑满整行；小于 12 时
会留出空白。

```md
:::row:::
:::column span="8":::

### Main column

Wider side — usually the primary content.
:::column-end:::
:::column span="4":::

### Aside

Narrower side panel.
:::column-end:::
:::row-end:::
```

宽度小于 720px 时，列自动堆叠成每行一个。

## Zones

zone 区域只在激活的 pivot 在它的逗号分隔 `pivot=` 列表里时才显示。
作者写法：

```md
:::zone pivot="dotnet,fsharp":::
.NET / F# specific instructions.
:::zone-end:::

:::zone pivot="python":::
Python-specific instructions.
:::zone-end:::
```

读者通过 URL 上的 `?pivot=...` 来选择 pivot。当没有设置 pivot 时，
所有 zone 都会显示，让页面从头到尾读得通——这是一个有意为之的、
SSR 友好的设计选择。

## Monikers

Moniker 范围把内容限定到某个版本。它们总是以 "Applies to: ..." 前缀
渲染，让读者知道自己看的是哪个版本。

```md
:::moniker range=">=v2.0":::
What's new in v2.
:::moniker-end:::
```

未来的 Vellum 版本会接上一个版本选择器，过滤掉不匹配的 moniker 区域；
目前所有区域都带前缀渲染出来。

## Tabs

DocFX 风格的 tabs 来自一组同级标题，它们的链接 href 形如
`#tab/<id>`。组在遇到 `---` 分隔线或没有 `#tab/...` 的标题时结束：

```md
# [Windows](#tab/windows)

Install via winget.

# [macOS](#tab/macos)

Install via Homebrew.

# [Linux](#tab/linux)

Install via apt / dnf.

---
```

Tab 选择会按组在 `localStorage` 里持久化——key 是按确定顺序排好的
tab id 集合，所以不相关的 tab 组互不影响。

## Includes

`[!INCLUDE [label](path)]` 会拉取另一份 Markdown 文件，并把它解析后的
块拼进当前 AST。include 内部的容器 / 代码 / xref 都能继续工作。

```md
[!INCLUDE [install snippet](../_includes/install.md)]
```

路径与图片一样，相对于当前页面的目录解析。为了防止递归失控，
Vellum 在内层调用时会把 include 解析器去掉——所以 include 内部
可以用 mermaid、math、xref 等等，但不能再嵌一个 `[!INCLUDE]`。

当解析器返回 null（文件缺失、网络错误等）时，会显示一个可见的
"Failed to resolve INCLUDE" 提示框，并附上出问题的路径，
让作者一眼能看到坏掉的引用。

## 代码包含

`[!code-<lang>[label](path)]` 从源文件中嵌入一段代码。这条指令支持
多种查询形式：

```md
[!code-csharp[](src/Program.cs)] <!-- whole file -->
[!code-csharp[](src/Program.cs?range=10-20)] <!-- line range -->
[!code-csharp[](src/Program.cs?range=10-20&highlight=2-3)] <!-- + highlights -->
[!code-csharp[](src/Program.cs?start=10&end=20)] <!-- alternate range form -->
[!code-csharp[](src/Program.cs#regionName)] <!-- #regionName shortcut -->
[!code-csharp[](src/Program.cs?region=regionName)] <!-- region query form -->
```

区域标记有三种风格，按顺序匹配：

1. `#region NAME` ... `#endregion`（C# 预处理器；同时支持 F#/VB）
2. `// <NAME>` ... `// </NAME>`（DocFX 片段标记；通用）
3. `// <region name="NAME">` ... `// </region>`（DocFX 显式属性形式）

标记本身会从渲染出的片段里被剥掉，高亮范围是相对于切片（不是
原始文件）的 1-indexed 行号。

## xref

Vellum 同时支持 autolink 和显式两种形式：

```md
The .NET <xref:System.Console.WriteLine> API.

For an example, see [the console docs](xref:System.Console).
```

解析依据来自文档根的 `xrefmap.yml`（或 `.yaml` / `.json`）。
格式遵循 DocFX 标准：

```yaml
references:
  - uid: System.Console
    href: https://learn.microsoft.com/dotnet/api/system.console
    name: Console
```

解析成功的 uid 渲染为外部链接；解析失败的 uid 渲染为虚线等宽框，
让作者一眼就能发现坏掉的引用。

::: tip 性能
xrefmap 在每次页面渲染时与 markdown 拉取并发加载一次，然后和原始
文件一并缓存到 KV / Cache API。一个引用了 50 个 xref 的页面不会
真的产生 50 次往返——所有解析都在内存中的 map 里完成。
:::
