---
title: OPS Zone & Moniker
description: Pivot zones and version (moniker) ranges.
---

# OPS Zone & Moniker

## Zones (pivot-scoped content)

Zones show only when their `pivot` attribute matches the active pivot. The
client reads the active pivot from `?pivot=` in the URL (falling back to
`localStorage`). With no pivot set, every zone is visible so the page reads
normally.

Try opening this page with `?pivot=dotnet` then `?pivot=python` and watch which
zones show.

:::zone pivot="dotnet":::

### .NET-specific instructions

```csharp
using System;

Console.WriteLine("Hello from .NET");
```

This block only appears when `?pivot=dotnet`.
:::zone-end:::

:::zone pivot="python":::

### Python-specific instructions

```python
print("Hello from Python")
```

This block only appears when `?pivot=python`.
:::zone-end:::

:::zone pivot="dotnet,python":::

### Shared between .NET and Python

Both audiences see this — comma-separated pivots are an OR.
:::zone-end:::

## Monikers (version-scoped content)

Moniker panes always render — the prefix line tells the reader which version
the content applies to. A future pass can wire up a version selector that
hides non-matching panes.

:::moniker range=">=v3.0":::

### What's new in v3

- New `homepageRepo` config field
- Local sources alongside GitHub
- OPS extensions: tabs, image, video, row/column, zone, moniker, INCLUDE, xref
  :::moniker-end:::

:::moniker range="v2.0-v2.5":::

### Legacy v2 behaviour

The `defaultRepo` field controlled both the / redirect and the brand link in v2.
v3 splits this into `homepageRepo` (and keeps `defaultRepo` for back-compat
during migration).
:::moniker-end:::

:::moniker range="<v2.0":::

### Pre-1.0 era

Not documented here — this content existed only to demonstrate the renderer.
:::moniker-end:::
