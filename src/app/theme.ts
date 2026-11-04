import { webLightTheme, webDarkTheme, type Theme } from "@fluentui/react-components";

// Custom brand ramp tuned around the Vellum blue (#0078d4 - Microsoft "Communication blue").
const brand = {
  10: "#020305",
  20: "#0b1a2b",
  30: "#102a47",
  40: "#143a64",
  50: "#184b83",
  60: "#1c5ca2",
  70: "#1f6dc1",
  80: "#0078d4",
  90: "#3592e0",
  100: "#5badeb",
  110: "#7fc7f4",
  120: "#a3dffb",
  130: "#c4ecfd",
  140: "#dff4fe",
  150: "#eef9ff",
  160: "#f7fcff",
};

export const vellumLightTheme: Theme = {
  ...webLightTheme,
  colorBrandBackground: brand[80],
  colorBrandBackgroundHover: brand[70],
  colorBrandBackgroundPressed: brand[60],
  colorBrandForeground1: brand[70],
  colorBrandForeground2: brand[60],
  colorBrandForegroundLink: brand[80],
  colorBrandForegroundLinkHover: brand[70],
  colorBrandStroke1: brand[80],
};

export const vellumDarkTheme: Theme = {
  ...webDarkTheme,
  colorBrandBackground: brand[90],
  colorBrandBackgroundHover: brand[100],
  colorBrandBackgroundPressed: brand[80],
  colorBrandForeground1: brand[100],
  colorBrandForeground2: brand[110],
  colorBrandForegroundLink: brand[100],
  colorBrandForegroundLinkHover: brand[110],
  colorBrandStroke1: brand[90],
};
