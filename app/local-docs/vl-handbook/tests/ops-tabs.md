---
title: OPS Tabs
description: DocFX heading-based tab groups.
---

# OPS Tabs

DocFX tabs come from a run of same-level headings whose links are `#tab/<id>`.
The group ends at a `---` divider or a different heading.

## Platform-specific instructions

# [Windows](#tab/windows)

On Windows, install via the Microsoft Store or the official installer:

```powershell
winget install YourPackage
```

Verify the install:

```powershell
your-cli --version
```

# [macOS](#tab/macos)

On macOS, use Homebrew:

```bash
brew install your-package
```

Or the universal installer:

```bash
curl -fsSL https://example.com/install.sh | bash
```

# [Linux](#tab/linux)

On Linux, the package is available through several channels:

::: tip
For most distros, use your native package manager. The static binary is a
fallback for systems without a curated package.
:::

```bash
# Debian / Ubuntu
sudo apt install your-package

# Fedora
sudo dnf install your-package

# Static binary
curl -fsSL https://example.com/your-cli > /usr/local/bin/your-cli
chmod +x /usr/local/bin/your-cli
```

---

## Language preference

# [TypeScript](#tab/typescript)

```ts
const greet = (name: string) => `Hello, ${name}!`;
console.log(greet("world"));
```

# [Python](#tab/python)

```py
def greet(name: str) -> str:
    return f"Hello, {name}!"

print(greet("world"))
```

# [Rust](#tab/rust)

```rust
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

fn main() {
    println!("{}", greet("world"));
}
```

---

## Tab state is sticky per group

Pick a tab above, then reload — the selection is persisted in `localStorage`,
keyed by the (sorted) set of tab ids in the group. The two tab groups on this
page have independent selections.
