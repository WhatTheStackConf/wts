import { describe, expect, it, vi } from "vite-plus/test";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { NOTO_SANS_BOLD_BASE64, NOTO_SANS_REGULAR_BASE64 } from "~/lib/checkin-label-render-font-data";
import { renderNameLabel, validateLabelProfileConfig } from "~/lib/checkin-label-renderer";
import { LABEL_ROW_FONT_LIMITS, SYNTHETIC_LABEL_CONFIG, type LabelRenderInput } from "~/lib/checkin-label-render-contract";

function input(name = "Ѓорѓи Željko", affiliation = "Љубљана • gjpq") : LabelRenderInput {
  const config = structuredClone(SYNTHETIC_LABEL_CONFIG);
  return {
    text: { name, affiliation },
    profile: { id: "profile-test", stationId: "station-test", version: 1, approval: "unapproved", config },
    mode: "preview",
    expected: { profileId: "profile-test", profileVersion: 1, printerRef: config.printerRef, stockRef: config.stockRef, rendererVersion: config.rendererVersion, fontVersion: config.fontVersion },
  };
}

describe("production Name Label rendering boundary", () => {
  it("embeds exactly the licensed pinned font assets for production deployment", () => {
    expect(Buffer.from(NOTO_SANS_REGULAR_BASE64, "base64")).toEqual(readFileSync(new URL("../../public/fonts/checkin-label/NotoSans-Regular.ttf", import.meta.url)));
    expect(Buffer.from(NOTO_SANS_BOLD_BASE64, "base64")).toEqual(readFileSync(new URL("../../public/fonts/checkin-label/NotoSans-Bold.ttf", import.meta.url)));
  });
  it("supports ordinary affiliation punctuation without allowing URL or email payloads", async () => {
    const request = input("Ѓорѓи Ќосев — Željko gjpqy", "Заедница / Société: R&D; [WTS]");
    expect((await renderNameLabel(request)).snapshot.text).toEqual(request.text);
  });
  it.each(["a".repeat(64), "secret", "wts_mcp_test"])("rejects capability-shaped profile identity %#", (printerRef) => {
    expect(() => validateLabelProfileConfig({ ...SYNTHETIC_LABEL_CONFIG, printerRef })).toThrow();
  });
  it("shrinks without shortening before using ellipsis and leaves an absent affiliation entirely blank", async () => {
    const shrunk = await renderNameLabel(input("Alexandra Alexandra", ""));
    expect(shrunk.rows[0].fontSize).toBeLessThan(LABEL_ROW_FONT_LIMITS.name.maximum);
    expect(shrunk.rows[0].fontSize).toBeGreaterThanOrEqual(LABEL_ROW_FONT_LIMITS.name.minimum);
    expect(shrunk.rows[0]).toMatchObject({ text: "Alexandra Alexandra", shortened: false });
    expect(shrunk.rows[1]).toMatchObject({ text: "", shortened: false });
    const pixels = await sharp(Buffer.from(shrunk.pngBase64, "base64")).greyscale().raw().toBuffer();
    expect(pixels.subarray(600 * 180).every((pixel) => pixel === 255)).toBe(true);
  });

  it.each([90, 180, 270] as const)("direction %s rotates every real raster pixel rather than only metadata", async (direction) => {
    const original = await renderNameLabel(input("Ќиро gjpq", "WTS"));
    const request = input("Ќиро gjpq", "WTS");
    request.profile.config.direction = direction;
    const rotated = await renderNameLabel(request);
    const originalPixels = await sharp(Buffer.from(original.pngBase64, "base64")).greyscale().raw().toBuffer();
    const rotatedPixels = await sharp(Buffer.from(rotated.pngBase64, "base64")).greyscale().raw().toBuffer();
    expect(rotated.width).toBe(direction === 180 ? 600 : 360);
    expect(rotated.height).toBe(direction === 180 ? 360 : 600);
    const expected = Buffer.alloc(originalPixels.length);
    for (let y = 0; y < 360; y++) for (let x = 0; x < 600; x++) {
      const targetX = direction === 90 ? 359 - y : direction === 180 ? 599 - x : y;
      const targetY = direction === 90 ? x : direction === 180 ? 359 - y : 599 - x;
      expected[targetY * rotated.width + targetX] = originalPixels[y * 600 + x];
    }
    expect(rotatedPixels.equals(expected)).toBe(true);
    expect(rotated.payloadHash).not.toBe(original.payloadHash);
  });

  it("enforces bounds, margins and offsets on pixels with no third row or clipped descenders/diacritics", async () => {
    const base = await renderNameLabel(input("ЃЌ gjpq ÅÉ", "Џѕ çã"));
    const request = input("ЃЌ gjpq ÅÉ", "Џѕ çã");
    request.profile.config.offset = { x: 5, y: -7 };
    const shifted = await renderNameLabel(request);
    const pixels = await sharp(Buffer.from(base.pngBase64, "base64")).greyscale().raw().toBuffer();
    const moved = await sharp(Buffer.from(shifted.pngBase64, "base64")).greyscale().raw().toBuffer();
    let nameInk = 0;
    let affiliationInk = 0;
    for (let y = 0; y < 360; y++) for (let x = 0; x < 600; x++) if (pixels[y * 600 + x] === 0) {
      expect(x >= 31 && x < 569 && y >= 37 && y < 323).toBe(true);
      expect(y < 176 || y >= 184).toBe(true);
      expect(moved[(y - 7) * 600 + x + 5]).toBe(0);
      if (y < 176) nameInk++; else affiliationInk++;
    }
    expect(nameInk).toBeGreaterThan(100);
    expect(affiliationInk).toBeGreaterThan(100);
    expect(moved.filter((pixel) => pixel === 0).length).toBe(nameInk + affiliationInk);
  });

  it("requires matching identities in preview too; only a separately approved physical profile can render production", async () => {
    const request = input();
    request.mode = "production";
    await expect(renderNameLabel(request)).rejects.toMatchObject({ code: "not_approved" });
    request.profile.approval = "approved";
    await expect(renderNameLabel(request)).rejects.toMatchObject({ code: "not_approved" });
    request.mode = "preview";
    await expect(renderNameLabel(request)).rejects.toMatchObject({ code: "not_approved" });
    request.profile.config.synthetic = false;
    await expect(renderNameLabel(request)).rejects.toMatchObject({ code: "invalid_profile" });
    request.profile.config.printerRef = request.expected.printerRef = "test-device-not-hardware-evidence";
    request.profile.config.stockRef = request.expected.stockRef = "test-stock-not-hardware-evidence";
    request.profile.approval = "unapproved";
    await expect(renderNameLabel(request)).resolves.toMatchObject({ width: 600 });
    request.mode = "production";
    await expect(renderNameLabel(request)).rejects.toMatchObject({ code: "not_approved" });
    request.profile.approval = "approved";
    const production = await renderNameLabel(request);
    request.mode = "preview";
    expect(await renderNameLabel(request)).toEqual(production);
  });

  it.each(["profileId", "printerRef", "stockRef", "rendererVersion", "fontVersion"] as const)("rejects stale expected %s before producing a raster", async (field) => {
    const request = input();
    request.expected[field] = "changed";
    await expect(renderNameLabel(request)).rejects.toMatchObject({ code: "profile_mismatch" });
  });

  it("rejects missing/stale versions, incomplete profiles and unknown profile fields", async () => {
    const request = input();
    request.expected.profileVersion++;
    await expect(renderNameLabel(request)).rejects.toMatchObject({ code: "profile_mismatch" });
    for (const config of [
      { ...SYNTHETIC_LABEL_CONFIG, rendererVersion: "old" },
      { ...SYNTHETIC_LABEL_CONFIG, fontVersion: "old" },
      { ...SYNTHETIC_LABEL_CONFIG, email: "private@example.test" },
      { ...SYNTHETIC_LABEL_CONFIG, media: { widthMm: 40, heightMm: 20, kind: "precut-gap" } },
      {}, null,
    ]) expect(() => validateLabelProfileConfig(config)).toThrow();
    const missing = input();
    Object.assign(missing, { profile: undefined });
    await expect(renderNameLabel(missing)).rejects.toMatchObject({ code: "invalid_input" });
    Object.assign(missing, { profile: input().profile, expected: undefined });
    await expect(renderNameLabel(missing)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it.each([0, -1, 1.5, 2049, Number.NaN, Number.POSITIVE_INFINITY])("fails closed on raster width %s", async (width) => {
    const request = input();
    request.profile.config.raster.width = width;
    await expect(renderNameLabel(request)).rejects.toMatchObject({ code: "invalid_profile" });
  });

  it("rejects clipping, impossible margins, feed and threshold rather than silently repairing the profile", () => {
    for (const change of [
      { printable: { x: 30, y: 12, width: 600, height: 336 } },
      { margins: { top: 160, right: 18, bottom: 160, left: 18 } },
      { margins: { top: 24, right: 300, bottom: 24, left: 300 } },
      { offset: { x: 19, y: 0 } }, { offset: { x: 0, y: -25 } },
      { density: 0 }, { density: 6 }, { threshold: 0 }, { threshold: 255 },
      { direction: 45 }, { feed: { mode: "continuous", gapDots: 0, advanceDots: 0 } },
    ]) expect(() => validateLabelProfileConfig({ ...SYNTHETIC_LABEL_CONFIG, ...change })).toThrow();
    const config = validateLabelProfileConfig(SYNTHETIC_LABEL_CONFIG);
    expect(Object.isFrozen(config.raster)).toBe(true);
    expect(config).not.toBe(SYNTHETIC_LABEL_CONFIG);
  });

  it.each(["email", "qr", "capability", "upstream", "extraRow"])("rejects extra %s payloads rather than copying sensitive fields", async (field) => {
    for (const location of ["text", "profile", "expected", "root"] as const) {
      const request = input();
      Object.assign(location === "root" ? request : request[location], { [field]: "private@example.test" });
      await expect(renderNameLabel(request)).rejects.toMatchObject({ code: "invalid_input" });
    }
  });

  it.each(["person@example.test", "https://secret.test/qr", "Bearer secret", "api-key private", "qr-code private", "abc123".repeat(8), "Line\nTwo", "Tab\tName", "Bidi\u202eName", "Null\u0000Name", "<svg/>", "John 😀", "東京", "x".repeat(513), " Ana", "Ana  Doe"])("rejects sensitive, unsupported or unbounded text case %# without echoing it", async (text) => {
    for (const row of ["name", "affiliation"] as const) {
      const request = input();
      request.text[row] = text;
      let error: unknown;
      try { await renderNameLabel(request); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(text);
    }
  });

  it("does not normalize source text silently and supports punctuation, combining accents and all Macedonian-specific letters", async () => {
    const request = input("Ѓѓ Ќќ Љљ Њњ Џџ Ѕѕ Јј", "E\u0301lodie O’Connor — R&D + .NET (Ž)");
    const result = await renderNameLabel(request);
    expect(result.snapshot.text).toEqual(request.text);
    expect(result.rows[0].shortened).toBe(false);
    expect(result.rows[1].shortened).toBe(false);
    expect(result.pngBase64).not.toEqual((await renderNameLabel(input("Gg Kk Lj Nj Dz Ss Jj", request.text.affiliation))).pngBase64);
    await expect(renderNameLabel(input("", "WTS"))).rejects.toMatchObject({ code: "invalid_input" });
    // A combining mark outside the pinned face must never silently become tofu.
    await expect(renderNameLabel(input("A\u1ac1", "WTS"))).rejects.toMatchObject({ code: "unsupported_text" });
  });

  it("hashes full unshortened text, every profile setting and raster identity, even when PNG pixels do not change", async () => {
    const first = await renderNameLabel(input("Alexandra ".repeat(30) + "A", "WTS"));
    const second = await renderNameLabel(input("Alexandra ".repeat(30) + "B", "WTS"));
    expect(first.pngBase64).toBe(second.pngBase64);
    expect(first.rows).toEqual(second.rows);
    expect(first.payloadHash).not.toBe(second.payloadHash);
    const base = await renderNameLabel(input());
    for (const change of [
      (request: LabelRenderInput) => { request.profile.config.density = 4; },
      (request: LabelRenderInput) => { request.profile.config.feed.gapDots = 25; },
      (request: LabelRenderInput) => { request.profile.config.feed.advanceDots = 1; },
      (request: LabelRenderInput) => { request.profile.stationId = "other-station"; },
      (request: LabelRenderInput) => { request.profile.version = request.expected.profileVersion = 2; },
    ]) {
      const request = input(); change(request);
      const result = await renderNameLabel(request);
      expect(result.pngBase64).toBe(base.pngBase64);
      expect(result.payloadHash).not.toBe(base.payloadHash);
    }
    const metadata = await sharp(Buffer.from(base.pngBase64, "base64")).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.comments).toBeUndefined();
  });

  it.each(["", "corrupt-base64"])("fails closed at the render seam when a bundled font is missing/corrupt: %#", async (fontBytes) => {
    vi.resetModules();
    vi.doMock("~/lib/checkin-label-render-font-data", () => ({ NOTO_SANS_BOLD_BASE64: fontBytes, NOTO_SANS_REGULAR_BASE64: fontBytes }));
    try {
      const isolated = await import("~/lib/checkin-label-renderer");
      await expect(isolated.renderNameLabel(input())).rejects.toMatchObject({ code: "font_unavailable" });
    } finally {
      vi.doUnmock("~/lib/checkin-label-render-font-data");
      vi.resetModules();
    }
  });
  it("shrinks each row independently, preserving a larger name at its minimum before grapheme-safe ellipsis", async () => {
    const baseline = await renderNameLabel(input("Ana", "WTS"));
    const longName = await renderNameLabel(input("Љубомир ".repeat(35).trim(), "WTS"));
    expect(longName.rows[0]).toMatchObject({ shortened: true, fontSize: LABEL_ROW_FONT_LIMITS.name.minimum });
    expect(longName.rows[0].text).toMatch(/…$/);
    expect(longName.rows[1]).toEqual(baseline.rows[1]);
    expect(longName.rows[0].fontSize).toBeGreaterThan(longName.rows[1].fontSize);
    const longAffiliation = await renderNameLabel(input("Ana", "A\u030aнгстром ".repeat(35).trim()));
    expect(longAffiliation.rows[0]).toEqual(baseline.rows[0]);
    expect(longAffiliation.rows[1]).toMatchObject({ shortened: true, fontSize: LABEL_ROW_FONT_LIMITS.affiliation.minimum });
    expect(longAffiliation.rows[1].text).toMatch(/…$/);
    const prefix = longAffiliation.rows[1].text.slice(0, -1);
    expect(prefix).not.toMatch(/A$/);
    expect("A\u030aнгстром ".repeat(35)).toContain(prefix);
  });
  it("produces deterministic real two-row PNGs with Macedonian and Latin glyphs and immutable snapshots", async () => {
    const request = input();
    const first = await renderNameLabel(request);
    const second = await renderNameLabel(input());
    expect(first).toEqual(second);
    expect(first.rows).toHaveLength(2);
    expect(first.rows.map((row) => row.text)).toEqual(["Ѓорѓи Željko", "Љубљана • gjpq"]);
    expect(first.rows[0].fontSize).toBeGreaterThan(first.rows[1].fontSize);
    expect(first.width).toBe(600);
    expect(first.height).toBe(360);
    const png = Buffer.from(first.pngBase64, "base64");
    expect((await sharp(png).metadata()).format).toBe("png");
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(600);
    expect(info.height).toBe(360);
    expect(data.includes(0)).toBe(true);
    expect(data.includes(255)).toBe(true);
    expect([...new Set(data)]).toEqual(expect.arrayContaining([0, 255]));
    expect(first.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    request.text.name = "Changed after rendering";
    request.profile.config.offset.x = 1;
    expect(first.snapshot.text.name).toBe("Ѓорѓи Željko");
    expect(first.snapshot.profile.config.offset.x).toBe(0);
    expect(Object.isFrozen(first.snapshot.profile.config.offset)).toBe(true);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
});
