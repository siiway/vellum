// Flat ESLint config (ESLint 9 / 10). Three environment slices share a base
// JS+TS ruleset; React rules + browser globals only apply to the client app,
// worker code gets a Workers/web-API global set, and scripts get Node globals.
//
// Type-aware lint rules (the ones backed by tsc) are intentionally NOT
// enabled — they triple lint time and would flag a lot of intentional `any`
// in markdown-it plugin shims. Re-enable via tseslint.configs.recommendedTypeChecked
// if/when we want that signal.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    // Mirror .prettierignore — build output, vendored docs, generated files.
    ignores: [
      "dist/**",
      ".wrangler/**",
      "node_modules/**",
      "local-docs/**",
      "src/shared/site-schema.json",
    ],
  },

  // Base JS recommended.
  js.configs.recommended,

  // TS recommended (non-type-checked — fast).
  ...tseslint.configs.recommended,

  // Project-wide rule tweaks for all TS/TSX.
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Allow `_`-prefixed unused args/vars — useful for callbacks where you
      // need the signature but not the value.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // We hit this in YAML/JSON shape coercion and dynamic markdown-it
      // plugin extension. Warn instead of error so it shows up but doesn't
      // block CI.
      "@typescript-eslint/no-explicit-any": "warn",
      // Triple-slash refs are fine for the Workers types entry.
      "@typescript-eslint/triple-slash-reference": "off",
      // Empty catch blocks are deliberate in parsers (parseYaml etc).
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },

  // Client app: browser globals + React rules.
  {
    files: ["src/app/**/*.{ts,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    settings: { react: { version: "18" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // react-hooks v7 added this rule and it's too aggressive. It flags
      // canonical patterns we rely on: post-mount SSR sync (URL → state in
      // SearchPage), prop reactions (LoadingBar reacting to isNavigating),
      // IntersectionObserver handlers (Outline activeId). None of these
      // create the cascading-render loops the rule is meant to catch
      // (they're all gated by conditions or external triggers). Disable
      // wholesale — the cure is worse than the disease here.
      "react-hooks/set-state-in-effect": "off",
      // React 17+ JSX transform — no need to import React in scope.
      "react/react-in-jsx-scope": "off",
      // We pass children via dangerouslySetInnerHTML on a child <span>
      // workaround for FluentUI; the rule's heuristic flags the wrapper.
      "react/no-danger": "off",
      // PropTypes is dead — we have TS for that.
      "react/prop-types": "off",
      // Allow unescaped quotes inside JSX text (we have a lot of curly-quote prose).
      "react/no-unescaped-entities": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // Worker: Cloudflare/Workers + web standard globals (Response, Request,
  // crypto, URL, etc).
  {
    files: ["src/worker/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.worker,
        ExecutionContext: "readonly",
        KVNamespace: "readonly",
        ExecutionContextEvent: "readonly",
      },
    },
  },

  // Scripts: Node globals.
  {
    files: ["scripts/**/*.{ts,js}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Disable rules that conflict with prettier formatting — keep this LAST.
  prettier,
);
