// Top-of-page progress bar tied to the SPA navigation lifecycle.
// Mimics NProgress: ramps up while the next page's payload loads, then
// completes and fades on success.

import { useEffect, useRef, useState } from "react";
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
    transition: "transform 200ms ease-out, opacity 250ms ease-out 250ms",
  },
});

export function LoadingBar() {
  const styles = useStyles();
  const { isNavigating } = useVellum();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  // Whether the bar is out. A ref rather than `visible`: when a navigation
  // ends before the render that shows the bar, the effect would still see
  // `visible` as false, skip the finish and leave the bar stuck.
  const shown = useRef(false);

  useEffect(() => {
    if (!isNavigating) {
      if (!shown.current) return;
      // Finish: run to the end and fade out (the fade waits for the bar to
      // complete), then reset once it's invisible.
      shown.current = false;
      setProgress(1);
      setVisible(false);
      const reset = setTimeout(() => setProgress(0), 500);
      return () => clearTimeout(reset);
    }
    // Start: become visible, ramp progress with diminishing increments capped at 0.9.
    shown.current = true;
    setVisible(true);
    setProgress(0.08);
    let p = 0.08;
    const tick = setInterval(() => {
      p = Math.min(0.9, p + (0.9 - p) * 0.12);
      setProgress(p);
    }, 200);
    return () => clearInterval(tick);
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
