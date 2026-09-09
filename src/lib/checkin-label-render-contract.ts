/** Browser-safe Name Label wire contract. All geometry is explicit device dots.
 * Renderer constants are software identities, not physical calibration evidence.
 */
export const LABEL_RENDERER_VERSION = "wts-name-label-v1";
export const LABEL_FONT_VERSION = "noto-sans-2.008-latin-cyrillic-v1";

export type LabelProfileConfig = {
  rendererVersion: string;
  fontVersion: string;
  printerRef: string;
  stockRef: string;
  synthetic: boolean;
  media: { widthMm: 50; heightMm: 30; kind: "precut-gap" };
  raster: { width: number; height: number };
  printable: { x: number; y: number; width: number; height: number };
  margins: { top: number; right: number; bottom: number; left: number };
  offset: { x: number; y: number };
  direction: 0 | 90 | 180 | 270;
  feed: { mode: "gap"; gapDots: number; advanceDots: number };
  density: number;
  threshold: number;
};

export type LabelProfile = {
  id: string;
  stationId: string;
  version: number;
  approval: "unapproved" | "approved";
  config: LabelProfileConfig;
};

export type LabelText = { name: string; affiliation: string };
export type LabelRenderInput = {
  text: LabelText;
  profile: LabelProfile;
  mode: "preview" | "production";
  expected: {
    profileId: string;
    profileVersion: number;
    printerRef: string;
    stockRef: string;
    rendererVersion: string;
    fontVersion: string;
  };
};
export type LabelRasterRow = { text: string; fontSize: number; shortened: boolean };
export type LabelRasterResult = {
  pngBase64: string;
  width: number;
  height: number;
  payloadHash: string;
  snapshot: {
    text: LabelText;
    profile: LabelProfile;
    rendererVersion: string;
    fontVersion: string;
  };
  rows: [LabelRasterRow, LabelRasterRow];
};

export class LabelRenderError extends Error {
  constructor(
    public readonly code: "invalid_input" | "invalid_profile" | "profile_mismatch" | "not_approved" | "font_unavailable" | "unsupported_text" | "text_does_not_fit" | "raster_failed",
    message: string,
  ) {
    super(message);
    this.name = "LabelRenderError";
  }
}

/** Preview only: these dot dimensions do not infer a printer's DPI. */
export const SYNTHETIC_LABEL_CONFIG: LabelProfileConfig = Object.freeze({
  rendererVersion: LABEL_RENDERER_VERSION,
  fontVersion: LABEL_FONT_VERSION,
  printerRef: "synthetic-preview",
  stockRef: "synthetic-50x30-gap",
  synthetic: true,
  media: Object.freeze({ widthMm: 50, heightMm: 30, kind: "precut-gap" as const }),
  raster: Object.freeze({ width: 600, height: 360 }),
  printable: Object.freeze({ x: 12, y: 12, width: 576, height: 336 }),
  margins: Object.freeze({ top: 24, right: 18, bottom: 24, left: 18 }),
  offset: Object.freeze({ x: 0, y: 0 }),
  direction: 0,
  feed: Object.freeze({ mode: "gap" as const, gapDots: 24, advanceDots: 0 }),
  density: 3,
  threshold: 160,
});

/** Dot-size limits, not a claim about physically readable calibrated type. */
export const LABEL_ROW_FONT_LIMITS = Object.freeze({
  name: Object.freeze({ maximum: 64, minimum: 32 }),
  affiliation: Object.freeze({ maximum: 28, minimum: 20 }),
});
export const LABEL_TEXT_MAX_LENGTH = 512;
