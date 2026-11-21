// A search input drawn as one field: the icon, a borderless Fluent Input and
// whatever follows it (a spinner, a clear or submit button) share one border
// and one focus ring. The Input's own border and focus underline are hidden,
// so focus shows once, on the field.

import { Input, mergeClasses, tokens, type InputProps } from "@fluentui/react-components";
import { Search20Regular, Search24Regular } from "@fluentui/react-icons";
import { forwardRef, type ReactNode } from "react";
import { makeStyles } from "../css";

const useStyles = makeStyles({
  field: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    boxSizing: "border-box",
    minHeight: "44px",
    paddingLeft: "12px",
    paddingRight: "12px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    transition: "border-color 120ms ease, box-shadow 120ms ease",
    "&:hover": {
      borderTopColor: tokens.colorNeutralStroke1Hover,
      borderRightColor: tokens.colorNeutralStroke1Hover,
      borderBottomColor: tokens.colorNeutralStroke1Hover,
      borderLeftColor: tokens.colorNeutralStroke1Hover,
    },
    // The border turns brand and a 1px shadow thickens it to 2px, so the
    // ring doesn't shift the layout.
    "&:focus-within": {
      borderTopColor: tokens.colorBrandStroke1,
      borderRightColor: tokens.colorBrandStroke1,
      borderBottomColor: tokens.colorBrandStroke1,
      borderLeftColor: tokens.colorBrandStroke1,
      boxShadow: `0 0 0 1px ${tokens.colorBrandStroke1}`,
    },
  },
  large: {
    minHeight: "52px",
    paddingLeft: "16px",
    paddingRight: "16px",
    gap: "12px",
  },
  icon: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  input: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 0,
    paddingRight: 0,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    borderTop: "0 !important" as any,
    borderLeft: "0 !important" as any,
    borderRight: "0 !important" as any,
    borderBottom: "0 !important" as any,
    backgroundColor: "transparent !important" as any,
    /* eslint-enable @typescript-eslint/no-explicit-any */
    "&::after": { display: "none" },
    "& input": { paddingLeft: 0, paddingRight: 0 },
  },
});

export interface SearchFieldProps extends Omit<InputProps, "size" | "appearance" | "children"> {
  size?: "medium" | "large";
  // Shown after the input, inside the field.
  children?: ReactNode;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { size = "medium", className, children, ...input },
  ref,
) {
  const styles = useStyles();
  const Icon = size === "large" ? Search24Regular : Search20Regular;
  return (
    <div className={mergeClasses(styles.field, size === "large" && styles.large, className)}>
      <Icon className={styles.icon} />
      <Input
        ref={ref}
        {...input}
        size={size}
        appearance="filled-lighter"
        className={styles.input}
      />
      {children}
    </div>
  );
});
