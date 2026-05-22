---
title: Containers & Alerts
description: "VitePress ::: containers, GitHub Flavored Markdown alerts."
---

# Containers & Alerts

## VitePress containers

::: tip
Tip — green-tinted, with a lightbulb icon. Authors use these for actionable
recommendations.
:::

::: info
Info — neutral blue. Use for context that's useful but not action-oriented.
:::

::: note
Note — close cousin of info; same intent UI but different word for authors who
prefer "note".
:::

::: warning
Warning — yellow. Reader needs to be careful but probably won't lose data if
they ignore it.
:::

::: caution
Caution — also yellow. Same intent as warning, different label.
:::

::: danger
Danger — red. Reader could lose data, break prod, or step on a rake.
:::

::: important
Important — red. Same intent as danger; pick whichever fits your writing voice.
:::

::: details A details/disclosure block
The content inside `::: details` is hidden behind a summary that the reader
expands. Useful for long lists, FAQ-style sections, or anything you want collapsed
by default.

It also supports **inline markdown**, `code`, and even nested code blocks:

```ts
console.log("nested in a details");
```

:::

## With titles

::: tip Heads up
Containers also accept an optional inline title after the kind.
:::

::: warning Don't do this
A warning with a custom title.
:::

## GFM alerts

GitHub Flavored Markdown's `> [!KIND]` syntax is rewritten into the same
callout primitives.

> [!NOTE]
> A GitHub-style note. Same look as `::: info`.

> [!TIP]
> A GitHub-style tip. Same look as `::: tip`.

> [!IMPORTANT]
> A GitHub-style important. Same look as `::: important`.

> [!WARNING]
> A GitHub-style warning. Same look as `::: warning`.

> [!CAUTION]
> A GitHub-style caution. Same look as `::: caution`.

## Nesting

Containers can wrap other containers:

::: details Show nested example
::: warning
Nested warning inside a details.

```bash
echo "code inside the nested warning"
```

:::
:::

## Long-form content inside a callout

::: tip
Callouts handle long-form content too. You can put paragraphs, **bold**,
_italics_, `code`, [links](../), and even small lists:

- First point
- Second point
- Third point

…and the layout still reads cleanly.
:::
