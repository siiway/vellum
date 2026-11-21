// Orders the rules of Griffel's style sheets for the page they're for.
//
// Griffel merges the classes of the same property: of `padding` from a
// Link's own styles and a `padding` in the className a component gives it,
// mergeClasses keeps the last. Of overlapping properties, a Link's
// `padding: 0` and NavBar's `padding-inline: 10px` say, it keeps both, and
// the one later in the style sheet applies. In the browser that's the
// component's: Griffel adds a component's rules in an insertion effect,
// which React runs after its children's. On the server Griffel adds them as
// it renders, the component's before its children's, so the page showed
// Fluent's `padding: 0` on the nav's links until the client added every
// rule again in its own order. The client no longer does (it reads the
// page's rules, rehydrateRendererCache), so the server orders them: of the
// classes an element has, those later in its class list, a className
// passed to the component, last, have their rules later in the sheet.

import type { GriffelRenderer } from "@fluentui/react-components";

export function orderStyleRules(renderer: GriffelRenderer, html: string): void {
  const lists = [...html.matchAll(/\sclass="([^"]*)"/g)].map((m) => m[1]!.split(/\s+/));
  for (const sheet of Object.values(renderer.stylesheets)) {
    // On the server, the sheet's own list of rules, which renderToStyleElements
    // writes out.
    const rules = sheet?.cssRules();
    if (!rules || rules.length < 2) continue;
    rules.splice(0, rules.length, ...orderRules(rules, lists));
  }
}

// `rules` so that for each list of classes, a class's rules come after those
// of the classes before it in the list that set the same properties, or
// overlapping ones (familyOf), and otherwise in the order they were added.
// Where lists disagree, the order they were added decides.
export function orderRules(rules: string[], lists: string[][]): string[] {
  // A node for each class with rules in the sheet, in the place of its first
  // rule, and one for each rule of no class; with the families of the
  // properties its rules set.
  const nodes: number[][] = [];
  const families: Set<string>[] = [];
  const nodeOf = new Map<string, number>();
  rules.forEach((rule, i) => {
    const name = /^[^{]*?\.(-?[_a-zA-Z][\w-]*)/.exec(rule)?.[1];
    let node = name === undefined ? undefined : nodeOf.get(name);
    if (node === undefined) {
      node = nodes.length;
      if (name !== undefined) nodeOf.set(name, node);
      nodes.push([]);
      families.push(new Set());
    }
    nodes[node]!.push(i);
    for (const m of rule.matchAll(/[{;]\s*(-?[a-z][a-z-]*)\s*:/g))
      families[node]!.add(familyOf(m[1]!));
  });

  const after = nodes.map(() => new Set<number>());
  const before = nodes.map(() => 0);
  for (const list of lists) {
    // By family, the last of the list's classes so far that sets it.
    const last = new Map<string, number>();
    for (const name of list) {
      const node = nodeOf.get(name);
      if (node === undefined) continue;
      for (const family of families[node]!) {
        const previous = last.get(family);
        if (previous !== undefined && previous !== node && !after[previous]!.has(node)) {
          after[previous]!.add(node);
          before[node]!++;
        }
        last.set(family, node);
      }
    }
  }

  // Kahn's algorithm, taking the earliest node that's free; of a cycle, the
  // earliest node left.
  const done = nodes.map(() => false);
  const free = new MinHeap();
  before.forEach((count, node) => count === 0 && free.push(node));
  const order: number[] = [];
  let earliest = 0;
  while (order.length < nodes.length) {
    let next = free.pop();
    while (next !== undefined && done[next]) next = free.pop();
    if (next === undefined) {
      while (done[earliest]) earliest++;
      next = earliest;
    }
    done[next] = true;
    order.push(next);
    for (const node of after[next]!) if (--before[node]! === 0 && !done[node]) free.push(node);
  }
  return order.flatMap((node) => nodes[node]!.map((i) => rules[i]!));
}

// What a CSS property sets part of, or all: `padding-inline` and `padding`
// are both "padding". Properties of one family may overlap; of two, don't.
function familyOf(property: string): string {
  const name = property.replace(/^-[a-z]+-/, "");
  if (/^border(-[a-z]+)*-radius$/.test(name)) return "border-radius";
  if (/^(top|right|bottom|left|inset)(-|$)/.test(name)) return "inset";
  if (/^(row-|column-)?gap$/.test(name)) return "gap";
  if (/^(place|align|justify)-/.test(name)) return "alignment";
  return name.split("-")[0]!;
}

class MinHeap {
  private items: number[] = [];

  push(value: number): void {
    const items = this.items;
    items.push(value);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]! <= value) break;
      items[i] = items[parent]!;
      i = parent;
    }
    items[i] = value;
  }

  pop(): number | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (!items.length || last === undefined) return top;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= items.length) break;
      const right = left + 1;
      const child = right < items.length && items[right]! < items[left]! ? right : left;
      if (items[child]! >= last) break;
      items[i] = items[child]!;
      i = child;
    }
    items[i] = last;
    return top;
  }
}
