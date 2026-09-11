// Server-only: clients must import checkin-label-render-contract, never this module.
import { createHash } from "node:crypto";
import { create, type Font, type GlyphRun } from "fontkit";
import sharp from "sharp";
import { z } from "zod";
import {
  LABEL_FONT_VERSION, LABEL_RENDERER_VERSION, LABEL_ROW_FONT_LIMITS,
  LABEL_TEXT_MAX_LENGTH, LabelRenderError,
  type LabelProfileConfig, type LabelRenderInput, type LabelRasterResult, type LabelRasterRow,
} from "./checkin-label-render-contract.js";
import { NOTO_SANS_BOLD_BASE64, NOTO_SANS_REGULAR_BASE64 } from "./checkin-label-render-font-data.js";
import { labelAssetReferenceSchema as reference, labelProfileConfigSchema as configSchema } from "./checkin-label-validation.js";

export { LABEL_FONT_VERSION, LABEL_RENDERER_VERSION, SYNTHETIC_LABEL_CONFIG, LabelRenderError } from "./checkin-label-render-contract.js";
export type { LabelProfileConfig, LabelProfile, LabelRenderInput, LabelRasterResult } from "./checkin-label-render-contract.js";


function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Printable and margin coordinates precede rotation; offsets translate the
 * inset text box. The complete raster (including bounds) rotates clockwise,
 * swapping returned width/height at 90/270. No mm-to-dot conversion occurs.
 * Density/feed are explicit downstream device instructions, included in identity.
 */
export function validateLabelProfileConfig(input: unknown): LabelProfileConfig {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    throw new LabelRenderError("invalid_profile", "Use this renderer/font version, 50×30 pre-cut gap media, explicit integer dots (1–2048), density 1–5 and threshold 1–254; remove unknown profile fields.");
  }
  const c = parsed.data;
  const { printable: p, raster: r, margins: m, offset: o } = c;
  if (p.x + p.width > r.width || p.y + p.height > r.height) {
    throw new LabelRenderError("invalid_profile", "Printable bounds must be inside the configured raster.");
  }
  // Reserve a pixel guard around actual glyph outlines; do not silently clip.
  if (p.width - m.left - m.right < 48 || p.height - m.top - m.bottom < 112) {
    throw new LabelRenderError("invalid_profile", "Margins leave too little space for two readable rows; allow at least 48×112 dots.");
  }
  if (m.left + o.x < 0 || m.right - o.x < 0 || m.top + o.y < 0 || m.bottom - o.y < 0) {
    throw new LabelRenderError("invalid_profile", "Offsets move the text box beyond printable bounds; reduce offsets or adjust margins.");
  }
  if (!c.synthetic && (c.printerRef === "synthetic-preview" || c.stockRef === "synthetic-50x30-gap")) {
    throw new LabelRenderError("invalid_profile", "Synthetic printer/stock references cannot identify a physical profile.");
  }
  return freeze(c);
}

const textSchema = z.strictObject({ name: z.string().min(1).max(LABEL_TEXT_MAX_LENGTH), affiliation: z.string().max(LABEL_TEXT_MAX_LENGTH) });
const inputSchema = z.strictObject({
  text: textSchema,
  profile: z.strictObject({ id: reference, stationId: reference, version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), approval: z.enum(["approved", "unapproved"]), config: z.unknown() }),
  mode: z.enum(["preview", "production"]),
  expected: z.strictObject({ profileId: reference, profileVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), printerRef: reference, stockRef: reference, rendererVersion: reference, fontVersion: reference }),
});

function validatedInput(input: unknown): LabelRenderInput {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new LabelRenderError("invalid_input", "Provide only bounded name/affiliation text, an exact profile snapshot, preview/production mode and all expected identities.");
  const value = parsed.data;
  const config = validateLabelProfileConfig(value.profile.config);
  for (const text of [value.text.name, value.text.affiliation]) {
    if (!/^[\p{Script=Latin}\p{Script=Cyrillic}\p{M}\p{N} .,'’‘"“”\-‐‑–—()&+·•…!?/:;[\]]*$/u.test(text)
      || /\b(?:bearer|authorization|capability|access[ -]?token|api[ -]?key|qr[ -]?code|https?)\b/i.test(text)
      || /[A-Za-z0-9]{32,}/.test(text) && /[A-Za-z]/.test(text) && /[0-9]/.test(text)) {
      throw new LabelRenderError("unsupported_text", "Labels accept Latin/Cyrillic names and affiliations, not email, URLs, QR/capability payloads, control characters or other scripts.");
    }
    if (text !== text.trim() || / {2}/.test(text)) throw new LabelRenderError("unsupported_text", "Remove leading/trailing or repeated spaces from label text; labels never wrap.");
  }
  if (!value.text.name.trim()) throw new LabelRenderError("invalid_input", "Name is required; affiliation may be blank.");
  const p = value.profile;
  const e = value.expected;
  if (e.profileId !== p.id || e.profileVersion !== p.version || e.printerRef !== config.printerRef || e.stockRef !== config.stockRef || e.rendererVersion !== config.rendererVersion || e.fontVersion !== config.fontVersion) {
    throw new LabelRenderError("profile_mismatch", "Expected profile, printer, stock or software version changed; reload and explicitly select the current profile.");
  }
  if ((value.mode === "production" && (p.approval !== "approved" || config.synthetic)) || (config.synthetic && p.approval === "approved")) {
    throw new LabelRenderError("not_approved", "Production requires an approved, non-synthetic printer/stock profile. Synthetic profiles cannot be approved.");
  }
  return freeze({ ...value, profile: { ...p, config } });
}

let loadedFonts: { name: Font; affiliation: Font } | undefined;
function fonts() {
  if (loadedFonts) return loadedFonts;
  try {
    const load = (base64: string, hash: string): Font => {
      const bytes = Buffer.from(base64, "base64");
      if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("font integrity");
      const font = create(bytes);
      if (font.type !== "TTF" || !font.hasGlyphForCodePoint(0x2026)) throw new Error("font format");
      const coverage = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzЃѓЌќЉљЊњЏџЅѕЈјЀѐЍѝЖжЧчШшЦцЃорѓиСкопјеÉéŽžÅågjpq…";
      if (Array.from(coverage).some((character) => !font.hasGlyphForCodePoint(character.codePointAt(0)!))) throw new Error("font coverage");
      return font;
    };
    loadedFonts = {
      name: load(NOTO_SANS_BOLD_BASE64, "c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a"),
      affiliation: load(NOTO_SANS_REGULAR_BASE64, "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5"),
    };
    return loadedFonts;
  } catch {
    throw new LabelRenderError("font_unavailable", "Pinned Name Label font bytes are missing, corrupt or incomplete. Restore the bundled font assets and rebuild; no system-font fallback is permitted.");
  }
}

type FittedRow = LabelRasterRow & { run: GlyphRun | null; font: Font };
function shape(font: Font, text: string): GlyphRun {
  if (Array.from(text).some((character) => !font.hasGlyphForCodePoint(character.codePointAt(0)!))) {
    throw new LabelRenderError("unsupported_text", "The pinned font lacks a requested glyph. Correct the label text; fallback fonts are disabled.");
  }
  // Explicit language/direction: Latin and Macedonian share the pinned face.
  const run = font.layout(text, undefined, undefined, "mk", "ltr");
  if (run.glyphs.some((glyph) => glyph.id === 0)) throw new LabelRenderError("unsupported_text", "The pinned font cannot shape this label text.");
  return run;
}

function fit(text: string, font: Font, limits: { maximum: number; minimum: number }, width: number, height: number): FittedRow {
  if (!text) return { text, fontSize: limits.maximum, shortened: false, run: null, font };
  const run = shape(font, text);
  const fits = (candidate: GlyphRun, size: number) => {
    const scale = size / font.unitsPerEm;
    return Math.max(candidate.advanceWidth, candidate.bbox.maxX) * scale - Math.min(0, candidate.bbox.minX) * scale <= width
      && (candidate.bbox.maxY - candidate.bbox.minY) * scale <= height;
  };
  for (let fontSize = limits.maximum; fontSize >= limits.minimum; fontSize--) {
    if (fits(run, fontSize)) return { text, fontSize, shortened: false, run, font };
  }
  const segments = Array.from(new Intl.Segmenter("mk", { granularity: "grapheme" }).segment(text), (segment) => segment.segment);
  // Drop whole graphemes, never a combining mark from its base. Re-shape each
  // prefix: kerning/ligatures mean summing independent character widths is wrong.
  for (let count = segments.length - 1; count >= 0; count--) {
    const shortened = segments.slice(0, count).join("").trimEnd() + "…";
    const candidate = shape(font, shortened);
    if (fits(candidate, limits.minimum)) return { text: shortened, fontSize: limits.minimum, shortened: true, run: candidate, font };
  }
  throw new LabelRenderError("text_does_not_fit", "Even the ellipsis cannot fit at the readable minimum. Enlarge printable bounds or reduce margins.");
}

function paths(row: FittedRow, box: { x: number; y: number; width: number; height: number }): string {
  if (!row.run) return "";
  const { run, fontSize, font } = row;
  const scale = fontSize / font.unitsPerEm;
  const width = (run.bbox.maxX - run.bbox.minX) * scale;
  const height = (run.bbox.maxY - run.bbox.minY) * scale;
  if (!Number.isFinite(width + height) || width > box.width || height > box.height) throw new LabelRenderError("text_does_not_fit", "Glyph outlines exceed the row bounds; no clipped raster was produced.");
  const x = box.x + (box.width - width) / 2 - run.bbox.minX * scale;
  const y = box.y + (box.height - height) / 2 + run.bbox.maxY * scale;
  let penX = 0;
  let penY = 0;
  return run.glyphs.map((glyph: GlyphRun["glyphs"][number], index: number) => {
    const position = run.positions[index];
    const path = glyph.path.toSVG();
    const result = `<path d="${path}" transform="translate(${x + (penX + position.xOffset) * scale} ${y - (penY + position.yOffset) * scale}) scale(${scale} ${-scale})"/>`;
    penX += position.xAdvance;
    penY += position.yAdvance;
    return result;
  }).join("");
}

/** A single font-backed render; no attendee data goes to disk or PNG metadata. */
export async function renderNameLabel(input: LabelRenderInput): Promise<LabelRasterResult> {
  const value = validatedInput(input);
  const font = fonts();
  const c = value.profile.config;
  const p = c.printable;
  const m = c.margins;
  const box = { x: p.x + m.left + c.offset.x + 1, y: p.y + m.top + c.offset.y + 1, width: p.width - m.left - m.right - 2, height: p.height - m.top - m.bottom - 2 };
  const gap = 8;
  const rowHeight = (box.height - gap) / 2;
  const firstBox = { ...box, height: rowHeight };
  const secondBox = { ...firstBox, y: box.y + rowHeight + gap };
  const name = fit(value.text.name, font.name, LABEL_ROW_FONT_LIMITS.name, box.width, rowHeight);
  const affiliation = fit(value.text.affiliation, font.affiliation, LABEL_ROW_FONT_LIMITS.affiliation, box.width, rowHeight);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.raster.width}" height="${c.raster.height}"><rect width="100%" height="100%" fill="white"/><g fill="black">${paths(name, firstBox)}${paths(affiliation, secondBox)}</g></svg>`;
  try {
    const { data: png, info } = await sharp(Buffer.from(svg), { limitInputPixels: 2048 * 2048 })
      .rotate(c.direction, { background: "white" }).flatten({ background: "white" }).greyscale().threshold(c.threshold)
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true })
      .toBuffer({ resolveWithObject: true });
    const rotated = c.direction === 90 || c.direction === 270;
    if (info.width !== (rotated ? c.raster.height : c.raster.width) || info.height !== (rotated ? c.raster.width : c.raster.height)) throw new Error("raster dimensions");
    const snapshot = { text: value.text, profile: value.profile, rendererVersion: LABEL_RENDERER_VERSION, fontVersion: LABEL_FONT_VERSION };
    const rows: [LabelRasterRow, LabelRasterRow] = [name, affiliation].map(({ text, fontSize, shortened }) => ({ text, fontSize, shortened })) as [LabelRasterRow, LabelRasterRow];
    const identity = { snapshot, rows, raster: { format: "png", width: info.width, height: info.height, sha256: createHash("sha256").update(png).digest("hex") } };
    return freeze({ pngBase64: png.toString("base64"), width: info.width, height: info.height, payloadHash: createHash("sha256").update(JSON.stringify(identity)).digest("hex"), snapshot, rows });
  } catch {
    throw new LabelRenderError("raster_failed", "Name Label rasterization failed. Check the pinned renderer runtime and profile; no printable payload was returned.");
  }
}
