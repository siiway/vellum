// A React component a docs repo ships (vellum.json#components, see
// src/build/react.ts), rendered in the page's own React tree: the tag's
// attributes are its props and the tag's content its children, and it sees
// the page's theme like any other node. repoComponents.ts loads it.
//
// The build renders it into the page's HTML, and hydrate.tsx loads the
// page's components before it hydrates, so the page hydrates as rendered.

import {
  Children,
  Component,
  Suspense,
  createElement,
  forwardRef,
  useState,
  type ForwardedRef,
  type ReactNode,
} from "react";
import { tokens } from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useVellum } from "../context";
import { loadComponent, type LoadingComponent } from "../repoComponents";
import { format } from "../../shared/i18n";

type Props = Record<string, unknown>;

// With the ref it's given, which the component gets: a Tooltip or Popover
// around the tag positions itself by it.
export const RepoComponent = forwardRef(function RepoComponent(
  {
    name,
    props,
    children,
  }: {
    name: string;
    props: Props;
    children?: ReactNode;
  },
  ref: ForwardedRef<unknown>,
) {
  const { data } = useVellum();
  const files = data.reactComponents?.[name];
  if (!files) return <>{children}</>;
  // Each page gets its own: a component's state doesn't carry over to the
  // next page.
  return (
    <Boundary key={data.route.canonicalUrl} name={name}>
      <Instance component={loadComponent(files)} props={props} innerRef={ref}>
        {children}
      </Instance>
    </Boundary>
  );
});

function Instance({
  component,
  props,
  innerRef,
  children,
}: {
  component: LoadingComponent;
  props: Props;
  innerRef: ForwardedRef<unknown>;
  children?: ReactNode;
}) {
  // Picked once, as switching would remount it: a component that has loaded
  // renders as the build rendered it. One that hasn't, after a client-side
  // navigation, shows the tag's content until it has.
  const [loaded] = useState(() => component.loaded);
  const content = Children.count(children) ? children : undefined;
  const withRef = innerRef ? { ...props, ref: innerRef } : props;
  if (loaded) return createElement(loaded, withRef, content);
  return (
    <Suspense fallback={<>{children}</>}>
      {createElement(component.lazy, withRef, content)}
    </Suspense>
  );
}

// A component that fails to load or throws shows why, in its place, rather
// than taking the page down with it.
class Boundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }

  override render() {
    const { error } = this.state;
    return error ? <Failed name={this.props.name} error={error} /> : this.props.children;
  }
}

const useStyles = makeStyles({
  error: {
    color: tokens.colorPaletteRedForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
});

function Failed({ name, error }: { name: string; error: Error }) {
  const { t } = useVellum();
  const styles = useStyles();
  return (
    <span className={styles.error}>
      {format(t("ui.component.error"), { name, message: error.message })}
    </span>
  );
}
