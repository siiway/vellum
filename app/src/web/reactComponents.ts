// Curated registry of React components that can be used directly inside
// markdown documents. Authors write `<Button appearance="primary">...</Button>`
// in their .md files and Vellum mounts the actual FluentUI component.
//
// Components already used by the Vellum chrome (Layout, MarkdownAst) are kept
// in the registry as direct references because they cost nothing — they're
// already in the main bundle. Anything new lives behind `React.lazy` so the
// extra FluentUI surface only loads when a doc actually uses one. The HtmlBlock
// wraps its output in a <Suspense> boundary so this works transparently.
//
// Casing matters - registry keys are PascalCase to match how authors will type
// the tag in markdown. The HTML parser preserves case, so `<Button>` and
// `<button>` route to different things.

import {
  Button,
  Card,
  Divider,
  Image,
  Link,
  Tab,
  TabList,
  Tooltip,
} from "@fluentui/react-components";
import { lazy, type ComponentType } from "react";

// Helper: produce a lazy reference to a single named export of FluentUI.
// All lazy-imports share the "@fluentui/react-components" chunk, so the
// extra-FluentUI cost is paid once per page, not per component.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyFluent<K extends string>(name: K): ComponentType<any> {
  return lazy(async () => {
    const mod = await import("@fluentui/react-components");
    return { default: (mod as unknown as Record<string, ComponentType<unknown>>)[name]! };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const REACT_COMPONENTS: Record<string, ComponentType<any>> = {
  // Already in the main bundle — zero incremental cost.
  Button,
  Card,
  Divider,
  Image,
  Link,
  Tab,
  TabList,
  Tooltip,

  // Lazy — pulled into a separate chunk only when a doc references them.
  Avatar: lazyFluent("Avatar"),
  Badge: lazyFluent("Badge"),
  CardFooter: lazyFluent("CardFooter"),
  CardHeader: lazyFluent("CardHeader"),
  CardPreview: lazyFluent("CardPreview"),
  CounterBadge: lazyFluent("CounterBadge"),
  InfoLabel: lazyFluent("InfoLabel"),
  Input: lazyFluent("Input"),
  PresenceBadge: lazyFluent("PresenceBadge"),
  ProgressBar: lazyFluent("ProgressBar"),
  Spinner: lazyFluent("Spinner"),
  Switch: lazyFluent("Switch"),
  Tag: lazyFluent("Tag"),
  Textarea: lazyFluent("Textarea"),
};

export function isRegisteredReactComponent(tagName: string): boolean {
  return Object.prototype.hasOwnProperty.call(REACT_COMPONENTS, tagName);
}
