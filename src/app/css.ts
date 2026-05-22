// Thin wrapper around FluentUI's `makeStyles` that loosens the GriffelStyle type.
// The default GriffelStyle disallows CSS shorthand props (border, padding, margin, ...);
// for a docs-renderer where we ship a lot of typography CSS, longhand is too noisy.
// Griffel itself still handles them correctly at runtime - the restriction is purely
// a lint-style type rule, so casting is safe.

import { makeStyles as makeStylesRaw } from "@fluentui/react-components";

type AnyRules = Record<string, any>;
type AnyStyles = Record<string, AnyRules>;

export const makeStyles = makeStylesRaw as unknown as <T extends AnyStyles>(
  styles: T,
) => () => Record<keyof T, string>;
