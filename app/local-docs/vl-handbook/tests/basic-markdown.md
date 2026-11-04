---
title: Basic Markdown
description: Headings, lists, links, tables, blockquotes, inline formatting.
---

# Basic Markdown

## Headings

The hero `<h1>` above came from the title. Lower-level headings below should each
get an anchor mark on hover.

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

## Paragraphs and inline formatting

This is a paragraph with **bold**, _italics_, **_bold-italic_**, ~~strikethrough~~,
`inline code`, and a [link to the index](../). External links like
[Anthropic](https://anthropic.com) get an "open in new tab" icon and the right
rel attributes.

Auto-linked URLs work too: https://example.com.

## Lists

### Unordered

- First item with **bold** inside
- Second item with `code`
- Third item
  - Nested item one
  - Nested item two
    - Deeper still

### Ordered

1. First step
2. Second step, with a [link](./code-blocks)
3. Third step
   1. Sub-step a
   2. Sub-step b

### Task list

- [x] Add OPS triple-colon parser
- [x] Add DocFX tabs
- [ ] Wire up version selector for moniker ranges
- [ ] Add a search-result preview

## Blockquotes

> Quotes are styled with a left border and a subtle background tint.
>
> They can span multiple paragraphs and contain **inline formatting**, `code`,
> and [links](../).

> Nested blockquotes also work:
>
> > Quoting the quoter.

## Horizontal rule

Above is a normal paragraph.

---

Below is another.

## Tables

| Column A    | Column B          | Centered | Right-aligned |
| :---------- | :---------------- | :------: | ------------: |
| short       | longer cell       |   mid    |          1.23 |
| `monospace` | with **emphasis** |    ok    |        42,000 |
| [link](../) | another row       |   yes    |          0.01 |

## Inline images

Inline images render via FluentUI's Image:

![Vellum logo](https://icons.siiway.org/siiway/icon.svg)

## Hardbreak vs soft break

Soft break (newline in source, single space in HTML) keeps a paragraph flowing.
This line should be in the same paragraph as the previous.

Hardbreak (two trailing spaces) creates a `<br>`:  
This line should appear on its own line under the previous.
