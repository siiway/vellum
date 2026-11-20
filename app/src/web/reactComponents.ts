// Curated registry of React components that can be used directly inside
// markdown documents. Authors write `<Button appearance="primary">...</Button>`
// in their .md files and Vellum mounts the actual FluentUI component.
//
// Components already used by the Vellum chrome (Layout, MarkdownAst) are kept
// in the registry as direct references because they cost nothing — they're
// already in the main bundle. Anything new is a `lazyComponent`, in a chunk of
// its own that only loads when a doc actually uses one.
//
// A lazy component is still in the page's HTML: the build loads them all
// before it renders a page, and the client loads the ones a page uses before
// it hydrates it (preloadComponents). One that isn't loaded yet, after a
// client-side navigation, suspends; the HtmlBlock and InlineComponent
// Suspense boundaries show its children until it's in.
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
import { createElement, lazy, useState, type ComponentType } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

// A component in a chunk of its own, which `load` imports.
function lazyComponent(load: () => Promise<AnyComponent>): AnyComponent {
  let loaded: AnyComponent | null = null;
  let loading: Promise<AnyComponent> | null = null;
  const preload = () => (loading ??= load().then((c) => (loaded = c)));
  const Suspending = lazy(() => preload().then((c) => ({ default: c })));
  function LazyComponent(props: object) {
    // Picked once: one that started out suspending keeps the lazy type, as
    // switching types would remount it.
    const [type] = useState(() => loaded ?? Suspending);
    return createElement(type, props);
  }
  return Object.assign(LazyComponent, { preload });
}

// One of the FluentUI components in registryExtras.ts: they share its chunk,
// so a page pays for them once.
function lazyFluent(name: keyof typeof import("./registryExtras")): AnyComponent {
  return lazyComponent(() => import("./registryExtras").then((m) => m[name] as AnyComponent));
}

export const REACT_COMPONENTS: Record<string, AnyComponent> = {
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

// Loads the lazy components among `names`, or all of them.
export async function preloadComponents(names?: Iterable<string>): Promise<void> {
  const list = names
    ? [...names].filter(isRegisteredReactComponent)
    : Object.keys(REACT_COMPONENTS);
  await Promise.all(
    list.map((name) =>
      (REACT_COMPONENTS[name] as { preload?: () => Promise<unknown> }).preload?.(),
    ),
  );
}
