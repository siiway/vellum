### Install (shared snippet)

This block is authored once in `_includes/install.md` and pulled in via
`[!INCLUDE]` from any page that needs install instructions.

```bash
# Mac / Linux
curl -fsSL https://example.com/install.sh | bash

# Windows (PowerShell)
iwr https://example.com/install.ps1 | iex
```

::: tip
The included markdown is parsed through the same pipeline as the parent, so
containers, code fences, and other directives nest correctly.
:::
