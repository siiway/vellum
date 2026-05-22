---
title: OPS Row & Column
description: "12-column grid via :::row::: :::column:::."
---

# OPS Row & Column

`:::row:::` opens a 12-column CSS grid. Each `:::column span="N":::` claims `N`
columns. Sum to 12 for a full row; sub-12 leaves empty space at the right.

## 50/50 split

:::row:::
:::column span="6":::

### Left half

The left column gets six columns out of twelve. Markdown inside columns is
rendered normally — paragraphs, **bold**, `code`, lists, images, the works.

- One
- Two
- Three
  :::column-end:::
  :::column span="6":::

### Right half

```ts
function symmetric() {
  return "the right column mirrors the left";
}
```

Code fences, callouts, and other block-level elements all work inside columns:

::: tip
Try it on a narrow viewport — columns collapse to one-per-row under 720px.
:::
:::column-end:::
:::row-end:::

## 8/4 sidebar layout

:::row:::
:::column span="8":::

### Main column

This is the wider side, useful when you want a primary content area with a
narrower aside.

```bash
echo "main content"
```

It can hold longer prose — full paragraphs, lists, code, etc.
:::column-end:::
:::column span="4":::

### Aside

A narrower side panel. Often used for tips, related links, or metadata.

> Quote in a sidebar.
> :::column-end:::
> :::row-end:::

## Three equal columns

:::row:::
:::column span="4":::
**Column 1.** Short.
:::column-end:::
:::column span="4":::
**Column 2.** A bit longer, with some `code` and a [link](../).
:::column-end:::
:::column span="4":::
**Column 3.** Equal width — same span value as the others.
:::column-end:::
:::row-end:::

## Asymmetric: 3 / 6 / 3

:::row:::
:::column span="3":::
Left rail
:::column-end:::
:::column span="6":::
Center stage — the widest column.
:::column-end:::
:::column span="3":::
Right rail
:::column-end:::
:::row-end:::
