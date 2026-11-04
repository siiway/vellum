import {
  createDarkTheme,
  createLightTheme,
  webDarkTheme,
  webLightTheme,
  type BrandVariants,
  type Theme,
} from "@fluentui/react-components";

// Visual language shared with Prism (siiway/prism): one flat page colour
// (--vellum-canvas, set in the SSR base CSS) shared by header, sidebar and
// content; surfaces that differ from it by a hairline border and at most a
// shade of fill; true neutral greys; shadows only on floating surfaces.
// StrokeAccessible keeps form-control boundaries above 3:1.

export const DEFAULT_ACCENT = "#0078d4";

const LIGHT = {
  colorNeutralBackground1: "#ffffff",
  colorNeutralBackground1Hover: "#f7f7f7",
  colorNeutralBackground1Pressed: "#efefef",
  colorNeutralBackground1Selected: "#f2f2f2",
  colorNeutralBackground2: "#fafafa",
  colorNeutralBackground2Hover: "#f2f2f2",
  colorNeutralBackground2Pressed: "#ebebeb",
  colorNeutralBackground2Selected: "#efefef",
  colorNeutralBackground3: "#f2f2f2",
  colorNeutralBackground3Hover: "#ebebeb",
  colorNeutralBackground3Pressed: "#e3e3e3",
  colorNeutralBackground3Selected: "#ebebeb",
  colorNeutralBackground4: "#ebebeb",
  colorNeutralBackground4Hover: "#e3e3e3",
  colorNeutralBackground4Pressed: "#dbdbdb",
  colorNeutralBackground4Selected: "#e3e3e3",
  colorNeutralBackground5: "#e3e3e3",
  colorNeutralBackground5Hover: "#dbdbdb",
  colorNeutralBackground5Pressed: "#d4d4d4",
  colorNeutralBackground5Selected: "#dbdbdb",
  colorNeutralBackground6: "#dbdbdb",
  colorNeutralForeground1: "#171717",
  colorNeutralForeground1Hover: "#171717",
  colorNeutralForeground1Pressed: "#171717",
  colorNeutralForeground1Selected: "#171717",
  colorNeutralForeground2: "#404040",
  colorNeutralForeground2Hover: "#171717",
  colorNeutralForeground2Pressed: "#171717",
  colorNeutralForeground2Selected: "#171717",
  colorNeutralForeground3: "#6b6b6b",
  colorNeutralForeground3Hover: "#404040",
  colorNeutralForeground3Pressed: "#404040",
  colorNeutralForeground3Selected: "#404040",
  colorNeutralForeground4: "#858585",
  colorNeutralStroke1: "#dedede",
  colorNeutralStroke1Hover: "#c7c7c7",
  colorNeutralStroke1Pressed: "#b3b3b3",
  colorNeutralStroke1Selected: "#bdbdbd",
  colorNeutralStroke2: "#e8e8e8",
  colorNeutralStroke3: "#f0f0f0",
  colorNeutralStrokeAccessible: "#858585",
  colorNeutralStrokeAccessibleHover: "#6b6b6b",
  colorNeutralStrokeAccessiblePressed: "#595959",
  // Loading placeholders: a shade off the card, not a block of grey.
  colorNeutralStencil1: "#ececec",
  colorNeutralStencil2: "#f6f6f6",
  colorNeutralStencil1Alpha: "rgba(0, 0, 0, 0.07)",
  colorNeutralStencil2Alpha: "rgba(0, 0, 0, 0.035)",
};

const DARK = {
  colorNeutralBackground1: "#222222",
  colorNeutralBackground1Hover: "#292929",
  colorNeutralBackground1Pressed: "#303030",
  colorNeutralBackground1Selected: "#2c2c2c",
  colorNeutralBackground2: "#1f1f1f",
  colorNeutralBackground2Hover: "#262626",
  colorNeutralBackground2Pressed: "#2d2d2d",
  colorNeutralBackground2Selected: "#2a2a2a",
  colorNeutralBackground3: "#2b2b2b",
  colorNeutralBackground3Hover: "#323232",
  colorNeutralBackground3Pressed: "#393939",
  colorNeutralBackground3Selected: "#323232",
  colorNeutralBackground4: "#323232",
  colorNeutralBackground4Hover: "#393939",
  colorNeutralBackground4Pressed: "#404040",
  colorNeutralBackground4Selected: "#393939",
  colorNeutralBackground5: "#393939",
  colorNeutralBackground5Hover: "#404040",
  colorNeutralBackground5Pressed: "#474747",
  colorNeutralBackground5Selected: "#404040",
  colorNeutralBackground6: "#404040",
  colorNeutralForeground1: "#f0f0f0",
  colorNeutralForeground1Hover: "#ffffff",
  colorNeutralForeground1Pressed: "#ffffff",
  colorNeutralForeground1Selected: "#ffffff",
  colorNeutralForeground2: "#d0d0d0",
  colorNeutralForeground2Hover: "#f5f5f5",
  colorNeutralForeground2Pressed: "#f5f5f5",
  colorNeutralForeground2Selected: "#f5f5f5",
  colorNeutralForeground3: "#a3a3a3",
  colorNeutralForeground3Hover: "#d0d0d0",
  colorNeutralForeground3Pressed: "#d0d0d0",
  colorNeutralForeground3Selected: "#d0d0d0",
  colorNeutralForeground4: "#858585",
  colorNeutralStroke1: "#3b3b3b",
  colorNeutralStroke1Hover: "#4a4a4a",
  colorNeutralStroke1Pressed: "#575757",
  colorNeutralStroke1Selected: "#4a4a4a",
  colorNeutralStroke2: "#313131",
  colorNeutralStroke3: "#292929",
  colorNeutralStrokeAccessible: "#8f8f8f",
  colorNeutralStrokeAccessibleHover: "#a8a8a8",
  colorNeutralStrokeAccessiblePressed: "#bababa",
  colorNeutralStencil1: "#303030",
  colorNeutralStencil2: "#282828",
  colorNeutralStencil1Alpha: "rgba(255, 255, 255, 0.07)",
  colorNeutralStencil2Alpha: "rgba(255, 255, 255, 0.035)",
};

const RADII = {
  borderRadiusMedium: "6px",
  borderRadiusLarge: "8px",
  borderRadiusXLarge: "10px",
  borderRadius2XLarge: "12px",
};

// Only floating surfaces (menus, popovers, dialogs) use these; page content
// is flat and separated by borders alone.
const LIGHT_SHADOWS = {
  shadow2: "0 1px 2px rgba(0, 0, 0, 0.05)",
  shadow4: "0 1px 3px rgba(0, 0, 0, 0.07), 0 1px 2px rgba(0, 0, 0, 0.04)",
  shadow8: "0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)",
  shadow16: "0 8px 24px rgba(0, 0, 0, 0.10), 0 2px 6px rgba(0, 0, 0, 0.05)",
  shadow28: "0 14px 36px rgba(0, 0, 0, 0.14), 0 3px 8px rgba(0, 0, 0, 0.06)",
  shadow64: "0 24px 64px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08)",
};

const DARK_SHADOWS = {
  shadow2: "0 1px 2px rgba(0, 0, 0, 0.5)",
  shadow4: "0 1px 3px rgba(0, 0, 0, 0.55), 0 1px 2px rgba(0, 0, 0, 0.4)",
  shadow8: "0 4px 12px rgba(0, 0, 0, 0.55), 0 1px 3px rgba(0, 0, 0, 0.4)",
  shadow16: "0 8px 24px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.4)",
  shadow28: "0 14px 36px rgba(0, 0, 0, 0.65), 0 3px 8px rgba(0, 0, 0, 0.4)",
  shadow64: "0 24px 64px rgba(0, 0, 0, 0.7), 0 4px 12px rgba(0, 0, 0, 0.45)",
};

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const hN = h / 360;
  const sN = s / 100;
  const lN = l / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (sN === 0) {
    r = g = b = lN;
  } else {
    const q = lN < 0.5 ? lN * (1 + sN) : lN + sN - lN * sN;
    const p = 2 * lN - q;
    r = hue2rgb(p, q, hN + 1 / 3);
    g = hue2rgb(p, q, hN);
    b = hue2rgb(p, q, hN - 1 / 3);
  }
  const hex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// Fluent ramps run dark → light (brand[10] darkest, brand[160] lightest):
// light themes tint surfaces with the high shades and dark themes lift
// foregrounds with them. The configured accent is anchored at shade 80,
// which the light theme uses for primary buttons, links and focus, so those
// stay exactly the colour the operator picked.
function buildBrandVariants(accentHex: string): BrandVariants {
  const [h, s, l] = hexToHsl(accentHex);
  const shades = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] as const;
  const variants: Record<number, string> = {};
  shades.forEach((shade, i) => {
    const lightness = Math.max(5, Math.min(96, l + (i - 7) * 7));
    variants[shade] = hslToHex(h, s, lightness);
  });
  return variants as BrandVariants;
}

function patchTheme(theme: Theme, dark: boolean): Theme {
  return {
    ...theme,
    ...RADII,
    ...(dark ? DARK_SHADOWS : LIGHT_SHADOWS),
    ...(dark ? DARK : LIGHT),
  };
}

// The config schema accepts #rgb, #rgba, #rrggbb and #rrggbbaa. Alpha has no
// meaning for a brand ramp, so it is dropped.
function normalizeHex(value: string | undefined): string {
  if (!value) return DEFAULT_ACCENT;
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (!m) return DEFAULT_ACCENT;
  const digits = m[1]!;
  if (digits.length <= 4) {
    return `#${digits
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  return `#${digits.slice(0, 6)}`;
}

export function createVellumTheme(dark: boolean, accent?: string): Theme {
  const brand = buildBrandVariants(normalizeHex(accent));
  try {
    return patchTheme(dark ? createDarkTheme(brand) : createLightTheme(brand), dark);
  } catch {
    return patchTheme(dark ? webDarkTheme : webLightTheme, dark);
  }
}
