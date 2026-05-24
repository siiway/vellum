// Top-of-page progress bar tied to the SPA navigation lifecycle.
// Mimics NProgress: ramps up while the worker fetches the new payload, then
// completes and fades on success.

import { useEffect, useState } from "react";
import { tokens } from "@fluentui/react-components";
import { makeStyles } from "../css";
import { useVellum } from "../context";

const useStyles = makeStyles({
  bar: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    height: "2px",
    zIndex: 1000,
    pointerEvents: "none",
    transformOrigin: "left center",
    backgroundColor: tokens.colorBrandBackground,
    boxShadow: `0 0 10px ${tokens.colorBrandStroke1}, 0 0 5px ${tokens.colorBrandStroke1}`,
    transition: "transform 200ms ease-out, opacity 250ms ease-out 250ms",
  },
});

export function LoadingBar() {
  const styles = useStyles();
  const { isNavigating } = useVellum();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isNavigating) {
      // Finish: jump to 100, then fade out and reset.
      if (visible) {
        setProgress(1);
        const hide = setTimeout(() => {
          setVisible(false);
          setProgress(0);
        }, 350);
        return () => clearTimeout(hide);
      }
      return;
    }
    // Start: become visible, ramp progress with diminishing increments capped at 0.9.
    setVisible(true);
    setProgress(0.08);
    let p = 0.08;
    const tick = setInterval(() => {
      p = Math.min(0.9, p + (0.9 - p) * 0.12);
      setProgress(p);
    }, 200);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNavigating]);

  return (
    <div
      className={styles.bar}
      style={{
        transform: `scaleX(${progress})`,
        opacity: visible ? 1 : 0,
      }}
      aria-hidden="true"
    />
  );
}
