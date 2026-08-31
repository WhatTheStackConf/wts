import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";
import {
  formatPressKitGradient,
  pressKitAllFacts,
  pressKitDescription,
  pressKitFacts,
  pressKitGradients,
  pressKitUsageGuidance,
  pressKitCanonicalUrl,
} from "~/lib/press-kit";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceSvgPath = `${projectRoot}src/assets/images/LogoSolo.svg`;
const assetRoot = `${projectRoot}public/press-kit`;

describe("Press Kit copy payloads", () => {
  it("formats all facts in display order without the description", () => {
    expect(pressKitAllFacts).toBe(pressKitFacts.map((fact) => `${fact.label}: ${fact.value}`).join("\n"));
    expect(pressKitAllFacts).not.toContain(pressKitDescription);
  });

  it("keeps the four approved gradient pairs and seven guidance items", () => {
    expect(pressKitGradients.map(formatPressKitGradient)).toEqual([
      "#91F6FF → #2EC8FE",
      "#FFC03D → #FE7457",
      "#FEA403 → #CD3DD0",
      "#25DBFA → #A240FE",
    ]);
    expect(pressKitUsageGuidance).toHaveLength(7);
  });

  it("canonicalizes the current edition and its future year archive", () => {
    expect(pressKitCanonicalUrl("https://wts.sh")).toBe("https://wts.sh/press-kit");
    expect(pressKitCanonicalUrl("http://localhost:3000")).toBe("https://wts.sh/press-kit");
    expect(pressKitCanonicalUrl("https://2026.wts.sh/")).toBe("https://2026.wts.sh/press-kit");
  });
});

describe("Press Kit download artifacts", () => {
  it("publishes the approved SVG unchanged and a transparent 1024 by 1301 PNG", async () => {
    expect(readFileSync(`${assetRoot}/wts-logo-mark-2026.svg`)).toEqual(readFileSync(sourceSvgPath));

    const metadata = await sharp(`${assetRoot}/wts-logo-mark-2026.png`).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 1024, height: 1301, hasAlpha: true });

    const stats = await sharp(`${assetRoot}/wts-logo-mark-2026.png`).stats();
    expect(stats.channels[3]?.min).toBe(0);
  });

  it("packages only byte-identical copies beneath the edition folder", () => {
    const zipPath = `${assetRoot}/wts-press-kit-2026.zip`;
    const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split("\n");

    expect(entries.sort()).toEqual([
      "wts-press-kit-2026/",
      "wts-press-kit-2026/wts-logo-mark-2026.png",
      "wts-press-kit-2026/wts-logo-mark-2026.svg",
    ]);

    for (const filename of ["wts-logo-mark-2026.svg", "wts-logo-mark-2026.png"]) {
      const archived = execFileSync("unzip", ["-p", zipPath, `wts-press-kit-2026/${filename}`]);
      expect(archived).toEqual(readFileSync(`${assetRoot}/${filename}`));
    }
  });
});
