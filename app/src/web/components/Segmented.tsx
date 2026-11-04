// Compact segmented radio group: a hairline track with one highlighted
// segment. Same control as Prism's theme/language switches.

import { mergeClasses, tokens } from "@fluentui/react-components";
import type { ReactNode } from "react";
import { makeStyles } from "../css";

const useStyles = makeStyles({
  root: {
    display: "inline-flex",
    padding: "2px",
    gap: "2px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxSizing: "border-box",
  },
  segment: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "26px",
    height: "24px",
    padding: "0 6px",
    border: "none",
    borderRadius: tokens.borderRadiusSmall,
    background: "transparent",
    color: tokens.colorNeutralForeground3,
    fontFamily: "inherit",
    fontSize: "12px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    "& svg": { fontSize: "14px" },
    ":hover": { color: tokens.colorNeutralForeground1 },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  active: {
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
});

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Rendered instead of the label, e.g. an icon; the label becomes its name. */
  content?: ReactNode;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const styles = useStyles();
  return (
    <div role="radiogroup" aria-label={label} className={mergeClasses(styles.root, className)}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.content ? o.label : undefined}
            title={o.content ? o.label : undefined}
            className={mergeClasses(styles.segment, selected && styles.active)}
            onClick={() => {
              if (!selected) onChange(o.value);
            }}
          >
            {o.content ?? o.label}
          </button>
        );
      })}
    </div>
  );
}
