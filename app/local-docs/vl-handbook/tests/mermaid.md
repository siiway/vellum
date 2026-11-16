---
title: Mermaid Diagrams
description: SSR via Kroki for both palettes; client falls back to mermaid.js if Kroki failed.
---

# Mermaid Diagrams

The build pre-renders each diagram against Kroki in both light and dark themes
and ships both SVGs in the bootstrap payload. Toggling the theme swaps them
instantly. If Kroki was unreachable, the client downloads the ~600KB mermaid
runtime and renders client-side.

## Flowchart

```mermaid
flowchart LR
    A[Build] --> B{Source?}
    B -->|github| C[git clone]
    B -->|local| D[local-docs/]
    C --> E[Render]
    D --> E
    E --> F[Static HTML]
```

## Sequence diagram

```mermaid
sequenceDiagram
    participant Build
    participant GitHub
    participant Cloudflare
    participant Browser
    Build->>GitHub: clone docs repo
    GitHub-->>Build: markdown
    Build->>Build: parse + render HTML
    Build->>Cloudflare: deploy static assets
    Browser->>Cloudflare: GET /en-US/prism/page
    Cloudflare-->>Browser: HTML + bootstrap payload
    Browser->>Browser: hydrate
```

## Class diagram

```mermaid
classDiagram
    class RepoConfig {
      +string slug
      +string source
      +string docsRoot
    }
    class GitHubRepo {
      +string owner
      +string repo
      +string branch
    }
    class LocalRepo {
      +string localPath
    }
    RepoConfig <|-- GitHubRepo
    RepoConfig <|-- LocalRepo
```

## State diagram

```mermaid
stateDiagram-v2
    [*] --> Resolving
    Resolving --> Fetching: route matched
    Resolving --> NotFound: no match
    Fetching --> Rendering: bytes in hand
    Rendering --> Cached
    Cached --> [*]
    NotFound --> [*]
```

## Pie chart

```mermaid
pie title Where the bytes come from
    "GitHub" : 60
    "Local"  : 25
    "Cache"  : 15
```
