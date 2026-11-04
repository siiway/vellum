---
title: OPS Includes
description: "[!INCLUDE] and [!code-lang] directives — fetched + spliced into the AST."
---

# OPS Includes

## Markdown INCLUDE

The directive `[!INCLUDE [label](../_includes/install.md)]` fetches the referenced
file (via the same source as the parent page), parses it through the full
markdown pipeline, and splices the resulting blocks into the current AST.
Containers / code / xref inside the include all keep working.

Result:

[!INCLUDE [install snippet](../_includes/install.md)]

Back to the main page after the include.

## Code include — full file

`[!code-csharp[label](../_snippets/sample.cs)]` embeds the whole file:

[!code-csharp[Sources](../_snippets/sample.cs)]

## Code include — line range

`[!code-csharp[label](../_snippets/sample.cs?range=12-21)]` slices to lines
12–21 (the `RepoConfig` record):

[!code-csharp[Just the record](../_snippets/sample.cs?range=12-21)]

## Code include — highlighted lines

`?range=25-35&highlight=3` keeps the slice and highlights the third line
within it:

[!code-csharp[ResolveAsync](../_snippets/sample.cs?range=25-35&highlight=3)]

## Code include — by region

DocFX-style `#region <name>` / `#endregion` markers carve out named ranges.
`[!code-csharp[label](../_snippets/sample.cs#repos)]` returns the lines between
`#region repos` and `#endregion`:

[!code-csharp[Repos region](../_snippets/sample.cs#repos)]

And by query parameter (`?region=resolve`):

[!code-csharp[Resolve region](../_snippets/sample.cs?region=resolve)]

## Code include — different language

Python snippet:

[!code-python[FizzBuzz](../_snippets/fizzbuzz.py)]

## Code include — start/end

`?start=4&end=12`:

[!code-python[Range form](../_snippets/fizzbuzz.py?start=4&end=12)]
