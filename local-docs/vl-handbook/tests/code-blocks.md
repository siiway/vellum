---
title: Code Blocks
description: Fenced code, Shiki highlighting, filenames, line numbers, highlights, code-group tabs.
---

# Code Blocks

## Plain (no header chrome)

```
echo "no language tag, no filename — minimal card with hover-only copy"
```

## Language-tagged

```ts
export interface RepoConfig {
  slug: string;
  source?: "github" | "local";
  docsRoot: string;
}
```

## With filename and line numbers

```ts:line-numbers [src/worker/sources.ts]
export async function fetchSourceFile(
  env: Env,
  repo: RepoConfig,
  ref: string,
  path: string,
): Promise<string | null> {
  if (repo.source === "local") return fetchLocalFile(env, repo, path);
  return fetchGitHubRaw(env, repo.owner!, repo.repo!, ref, path);
}
```

## With highlight ranges

```python {2,4-6}
def render(theme: str) -> str:
    return f"Hello, {theme}!"

def main():
    print(render("light"))
    print(render("dark"))
```

## Languages: a quick tour

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "Hello from bash"
```

```json
{
  "slug": "handbook",
  "source": "local",
  "docsRoot": ""
}
```

```sql
SELECT slug, source, docs_root
FROM repos
WHERE source = 'local'
ORDER BY slug;
```

```yaml
references:
  - uid: Vellum.Handbook
    href: /handbook/
    name: Vellum Handbook
```

```rust
fn fetch_source<F: Fetcher>(repo: &Repo, path: &str, f: F) -> Result<String> {
    match repo.source {
        Source::Github => f.github(repo, path),
        Source::Local => f.local(repo, path),
    }
}
```

## Code groups (VitePress-style ::: code-group)

::: code-group

```ts [TypeScript]
const greet = (name: string) => `Hello, ${name}!`;
console.log(greet("world"));
```

```py [Python]
def greet(name: str) -> str:
    return f"Hello, {name}!"

print(greet("world"))
```

```go [Go]
package main

import "fmt"

func main() {
    fmt.Println(greet("world"))
}

func greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}
```

:::

## Inline code

Inline `code` inside a paragraph, plus a heavier `getElementById("vellum-root")`
that approaches the line length.
