---
title: Math & Emoji
description: MathJax inline + display, GitHub emoji shortcodes, footnotes.
---

# Math & Emoji

## Inline math

The Pythagorean theorem is $a^2 + b^2 = c^2$ and the quadratic formula is
$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$. Inline math sits naturally in
running prose.

## Display math

A few set-piece equations:

$$
e^{i\pi} + 1 = 0
$$

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

$$
\frac{\partial}{\partial t} \Psi(x,t) = -\frac{\hbar^2}{2m} \frac{\partial^2}{\partial x^2} \Psi(x,t) + V(x) \Psi(x,t)
$$

A matrix:

$$
A = \begin{pmatrix}
a_{11} & a_{12} & a_{13} \\
a_{21} & a_{22} & a_{23} \\
a_{31} & a_{32} & a_{33}
\end{pmatrix}
$$

## Emoji

The `markdown-it-emoji` plugin maps GitHub shortcodes to unicode glyphs:

- :rocket: launch
- :sparkles: shiny things
- :white_check_mark: success
- :x: failure
- :warning: heads up
- :tada: ship-it
- :memo: notes
- :bug: bug
- :wrench: tools
- :books: docs

## Footnotes

The first footnote[^first] links down to the references section. Multiple
footnotes can co-exist in the same paragraph[^second] [^longer].

[^first]: A short footnote.

[^second]: Footnotes support **bold**, _italics_, `code`, and [links](../).

[^longer]:
    A longer footnote that spans multiple sentences. The numbering is
    automatic so authors don't have to track indices by hand. Use named refs
    like `[^name]` so re-ordering doesn't renumber visible links.

## Mixed: math inside a callout

::: tip
Inline math works inside containers too: the variance of a random variable
$X$ is $\operatorname{Var}(X) = E[X^2] - E[X]^2$.
:::

## Mixed: math inside a code block

Math inside a code fence is intentionally NOT rendered — it stays as raw
source. This is correct behaviour; you want code to look like code:

```
$E = mc^2$ — not rendered as math, displayed as the literal source string.
```
