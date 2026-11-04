// Reads a VitePress config (`.vitepress/config.{mts,ts,mjs,js}`) without
// running it. A Worker can't import or eval a fetched file, so the source is
// parsed with @babel/parser and the default export is evaluated statically:
// literals, objects, arrays, template strings, references to top-level
// bindings and calls to functions declared in the same file. Anything else
// (imports, method calls, conditionals) is left out instead of guessed at.
//
// Calls to functions that aren't declared in the file, like `defineConfig()`
// or a plugin's `withMermaid()`, are treated as wrappers: their first
// argument is the value.

import { parse } from "@babel/parser";
import type * as t from "@babel/types";

/** A value that can't be worked out without running the code. */
const UNKNOWN = Symbol("unknown");

type Scope = Map<string, unknown>;

type FunctionNode = t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;

class Closure {
  constructor(
    readonly node: FunctionNode,
    readonly scope: Scope,
  ) {}
}

// Deep enough for helpers that call helpers; stops runaway recursion.
const MAX_CALL_DEPTH = 32;

class Evaluator {
  private readonly values = new Map<string, unknown>();
  private readonly pending = new Set<string>();
  private depth = 0;

  constructor(private readonly bindings: Map<string, t.Node>) {}

  /** A top-level binding, evaluated on first use. */
  private binding(name: string): unknown {
    if (this.values.has(name)) return this.values.get(name);
    const node = this.bindings.get(name);
    if (!node || this.pending.has(name)) return UNKNOWN;
    this.pending.add(name);
    const value = this.eval(node, new Map());
    this.pending.delete(name);
    this.values.set(name, value);
    return value;
  }

  eval(node: t.Node, scope: Scope): unknown {
    switch (node.type) {
      case "StringLiteral":
      case "NumericLiteral":
      case "BooleanLiteral":
        return node.value;
      case "NullLiteral":
        return null;
      case "Identifier":
        if (scope.has(node.name)) return scope.get(node.name);
        if (node.name === "undefined") return undefined;
        return this.binding(node.name);
      case "TemplateLiteral": {
        let out = node.quasis[0]?.value.cooked ?? "";
        for (let i = 0; i < node.expressions.length; i++) {
          const v = this.eval(node.expressions[i]!, scope);
          if (typeof v !== "string" && typeof v !== "number") return UNKNOWN;
          out += String(v) + (node.quasis[i + 1]?.value.cooked ?? "");
        }
        return out;
      }
      case "ArrayExpression": {
        const out: unknown[] = [];
        for (const el of node.elements) {
          if (!el) continue;
          if (el.type === "SpreadElement") {
            const v = this.eval(el.argument, scope);
            if (Array.isArray(v)) out.push(...v);
            continue;
          }
          const v = this.eval(el, scope);
          if (v !== UNKNOWN) out.push(v);
        }
        return out;
      }
      case "ObjectExpression": {
        const out: Record<string, unknown> = {};
        for (const prop of node.properties) {
          if (prop.type === "SpreadElement") {
            const v = this.eval(prop.argument, scope);
            if (isRecord(v)) Object.assign(out, v);
            continue;
          }
          if (prop.type !== "ObjectProperty") continue;
          const key = this.key(prop, scope);
          if (key === UNKNOWN) continue;
          const v = this.eval(prop.value, scope);
          if (v !== UNKNOWN) out[key] = v;
        }
        return out;
      }
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const object = this.eval(node.object, scope);
        const key = node.computed
          ? this.eval(node.property, scope)
          : node.property.type === "Identifier"
            ? node.property.name
            : UNKNOWN;
        if ((typeof key !== "string" && typeof key !== "number") || object === null) return UNKNOWN;
        if (!isRecord(object) && !Array.isArray(object)) return UNKNOWN;
        return Object.hasOwn(object, key) ? (object as Record<string, unknown>)[key] : undefined;
      }
      case "BinaryExpression": {
        if (node.operator !== "+") return UNKNOWN;
        const l = this.eval(node.left, scope);
        const r = this.eval(node.right, scope);
        if (typeof l === "string" || typeof r === "string") {
          if (!isPrimitive(l) || !isPrimitive(r)) return UNKNOWN;
          return String(l) + String(r);
        }
        return typeof l === "number" && typeof r === "number" ? l + r : UNKNOWN;
      }
      case "CallExpression":
        return this.call(node, scope);
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration":
        return new Closure(node, scope);
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
      case "ParenthesizedExpression":
        return this.eval(node.expression, scope);
      default:
        return UNKNOWN;
    }
  }

  private key(prop: t.ObjectProperty, scope: Scope): string | typeof UNKNOWN {
    if (prop.computed) {
      const k = this.eval(prop.key, scope);
      return typeof k === "string" || typeof k === "number" ? String(k) : UNKNOWN;
    }
    switch (prop.key.type) {
      case "Identifier":
        return prop.key.name;
      case "StringLiteral":
      case "NumericLiteral":
        return String(prop.key.value);
      default:
        return UNKNOWN;
    }
  }

  private call(node: t.CallExpression, scope: Scope): unknown {
    if (node.callee.type !== "Identifier") return UNKNOWN;
    const callee = this.eval(node.callee, scope);
    if (!(callee instanceof Closure)) {
      // Not declared in this file: a wrapper like defineConfig().
      const first = node.arguments[0];
      return first && first.type !== "SpreadElement" && first.type !== "ArgumentPlaceholder"
        ? this.eval(first, scope)
        : UNKNOWN;
    }
    if (callee.node.async || callee.node.generator || this.depth >= MAX_CALL_DEPTH) {
      return UNKNOWN;
    }

    const args = node.arguments.map((a) =>
      a.type === "SpreadElement" || a.type === "ArgumentPlaceholder"
        ? UNKNOWN
        : this.eval(a, scope),
    );
    const local: Scope = new Map(callee.scope);
    for (const [i, param] of callee.node.params.entries()) {
      if (param.type === "Identifier") {
        local.set(param.name, args[i]);
      } else if (param.type === "AssignmentPattern" && param.left.type === "Identifier") {
        const arg = args[i];
        local.set(param.left.name, arg === undefined ? this.eval(param.right, local) : arg);
      } else {
        // Destructured and rest parameters aren't followed.
        return UNKNOWN;
      }
    }

    this.depth++;
    try {
      return this.body(callee.node.body, local);
    } finally {
      this.depth--;
    }
  }

  /** A function body: an expression, or `const` declarations and a return. */
  private body(body: t.BlockStatement | t.Expression, scope: Scope): unknown {
    if (body.type !== "BlockStatement") return this.eval(body, scope);
    for (const stmt of body.body) {
      if (stmt.type === "ReturnStatement") {
        return stmt.argument ? this.eval(stmt.argument, scope) : undefined;
      }
      if (stmt.type !== "VariableDeclaration") return UNKNOWN;
      for (const decl of stmt.declarations) {
        if (decl.id.type !== "Identifier") return UNKNOWN;
        scope.set(decl.id.name, decl.init ? this.eval(decl.init, scope) : undefined);
      }
    }
    return undefined;
  }
}

/** Top-level `const`/`let`/`var` and function declarations, by name. */
function collectBindings(program: t.Program): Map<string, t.Node> {
  const bindings = new Map<string, t.Node>();
  for (const stmt of program.body) {
    const decl =
      stmt.type === "ExportNamedDeclaration" && stmt.declaration ? stmt.declaration : stmt;
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (d.id.type === "Identifier" && d.init) bindings.set(d.id.name, d.init);
      }
    } else if (decl.type === "FunctionDeclaration" && decl.id) {
      bindings.set(decl.id.name, decl);
    }
  }
  return bindings;
}

/** The exported config: `export default ...` or `module.exports = ...`. */
function exported(program: t.Program): t.Node | null {
  for (const stmt of program.body) {
    if (stmt.type === "ExportDefaultDeclaration") return stmt.declaration;
    if (
      stmt.type === "ExpressionStatement" &&
      stmt.expression.type === "AssignmentExpression" &&
      stmt.expression.left.type === "MemberExpression" &&
      stmt.expression.left.object.type === "Identifier" &&
      stmt.expression.left.object.name === "module" &&
      stmt.expression.left.property.type === "Identifier" &&
      stmt.expression.left.property.name === "exports"
    ) {
      return stmt.expression.right;
    }
  }
  return null;
}

/** The statically known part of a VitePress config, or null when the file
 *  doesn't parse or has no object export. */
export function readVitePressConfig(source: string): Record<string, unknown> | null {
  let program: t.Program;
  try {
    program = parse(source, { sourceType: "module", plugins: ["typescript"] }).program;
  } catch {
    return null;
  }
  const node = exported(program);
  if (!node) return null;
  const value = new Evaluator(collectBindings(program)).eval(node, new Map());
  return isRecord(value) ? value : null;
}

/**
 * A `themeConfig` field for one locale. VitePress merges each locale's
 * `themeConfig` over the top-level one, so the locale's value wins. The
 * default locale is keyed `root`; others by their directory, like `zh`.
 */
export function themeConfigField(
  config: Record<string, unknown>,
  localeKey: string,
  field: string,
): unknown {
  const locales = config.locales;
  const locale = isRecord(locales) ? locales[localeKey] : undefined;
  const localized = isRecord(locale) ? locale.themeConfig : undefined;
  if (isRecord(localized) && localized[field] !== undefined) return localized[field];
  const shared = config.themeConfig;
  return isRecord(shared) ? shared[field] : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}
