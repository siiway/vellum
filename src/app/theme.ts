import { webLightTheme, webDarkTheme, type Theme } from "@fluentui/react-components";

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

const SHARED = {
  shadow2: "none",
  shadow4: "none",
  shadow8: "none",
  shadow16: "none",
  shadow28: "none",
  shadow64: "none",
  shadow2Brand: "none",
  shadow4Brand: "none",
  shadow8Brand: "none",
  shadow16Brand: "none",
  shadow28Brand: "none",
  shadow64Brand: "none",
  borderRadiusLarge: "10px",
  borderRadiusXLarge: "12px",
  borderRadius2XLarge: "14px",
};

const LIGHT = {
  colorNeutralBackground1: "#ffffff",
  colorNeutralBackground2: "#ffffff",
  colorNeutralBackground3: "#f5f5f5",
  colorNeutralBackground1Hover: "#f5f5f5",
  colorNeutralBackground1Pressed: "#e8e8e8",
  colorNeutralBackground1Selected: "#f0f0f0",
  colorNeutralBackground2Hover: "#f5f5f5",
  colorNeutralBackground2Pressed: "#e8e8e8",
  colorNeutralBackground2Selected: "#f0f0f0",
  colorNeutralBackground3Hover: "#ebebeb",
  colorNeutralBackground3Pressed: "#e0e0e0",
  colorNeutralBackground3Selected: "#e8e8e8",
  colorNeutralStroke1: "#000000",
  colorNeutralStroke2: "#d0d0d0",
  colorNeutralStroke3: "#e0e0e0",
  colorSubtleBackgroundHover: "#f5f5f5",
  colorSubtleBackgroundPressed: "#e8e8e8",
  colorSubtleBackgroundSelected: "#f0f0f0",
};

const DARK = {
  colorNeutralBackground1: "#000000",
  colorNeutralBackground2: "#000000",
  colorNeutralBackground3: "#141414",
  colorNeutralBackground1Hover: "#141414",
  colorNeutralBackground1Pressed: "#1f1f1f",
  colorNeutralBackground1Selected: "#1a1a1a",
  colorNeutralBackground2Hover: "#141414",
  colorNeutralBackground2Pressed: "#1f1f1f",
  colorNeutralBackground2Selected: "#1a1a1a",
  colorNeutralBackground3Hover: "#1f1f1f",
  colorNeutralBackground3Pressed: "#2a2a2a",
  colorNeutralBackground3Selected: "#222222",
  colorNeutralStroke1: "#333333",
  colorNeutralStroke2: "#2a2a2a",
  colorNeutralStroke3: "#222222",
  colorSubtleBackgroundHover: "#141414",
  colorSubtleBackgroundPressed: "#1f1f1f",
  colorSubtleBackgroundSelected: "#1a1a1a",
};

function patchTheme(theme: Theme, dark: boolean): Theme {
  return { ...theme, ...SHARED, ...(dark ? DARK : LIGHT) };
}

function createLightTheme(): Theme {
  const base = {
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
  return patchTheme(base, false);
}

function createDarkTheme(): Theme {
  const base = {
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
  return patchTheme(base, true);
}

export const vellumLightTheme: Theme = createLightTheme();
export const vellumDarkTheme: Theme = createDarkTheme();
