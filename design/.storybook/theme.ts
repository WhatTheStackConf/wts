import { create } from "storybook/theming/create";

/* The orbit tokens as hex, because the Storybook theme does not read oklch.
 * Source: site/tokens.css. Change them together. */
const paper = "#fbf4e8";
const field = "#fdfaf4";
const ink = "#13212d";
const muted = "#4d5a65";
const rule = "#dacfbf";
const accent = "#005975";

export const wtsTheme = create({
  base: "light",
  brandTitle:
    '<span style="display:inline-flex;align-items:center;gap:10px;font-weight:700;letter-spacing:0">' +
    '<img src="./assets/logo.svg" width="22" height="28" alt="" />WTS 2027 design system</span>',
  brandUrl: "https://2027.wts.sh/",
  brandTarget: "_blank",
  colorPrimary: accent,
  colorSecondary: accent,
  appBg: paper,
  appContentBg: paper,
  appPreviewBg: paper,
  appHoverBg: "#f1e6d6",
  appBorderColor: rule,
  appBorderRadius: 0,
  fontBase: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
  fontCode: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
  textColor: ink,
  textInverseColor: paper,
  textMutedColor: muted,
  barTextColor: muted,
  barHoverColor: accent,
  barSelectedColor: accent,
  barBg: paper,
  buttonBg: field,
  buttonBorder: muted,
  booleanBg: field,
  booleanSelectedBg: accent,
  inputBg: field,
  inputBorder: muted,
  inputTextColor: ink,
  inputBorderRadius: 0,
});
