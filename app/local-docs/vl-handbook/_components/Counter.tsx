// The handbook's own React component, shown in react-in-markdown.md.

import { useState, type ReactNode } from "react";
import { usePage } from "vellum";
import "./Counter.css";

export default function Counter({ start = 0, children }: { start?: number; children?: ReactNode }) {
  const [count, setCount] = useState(start);
  const { lang } = usePage();
  const label = children ?? (lang === "zh" ? "点击次数" : "Clicks");
  return (
    <button type="button" className="vl-counter" onClick={() => setCount((n) => n + 1)}>
      {label}: {count}
    </button>
  );
}
