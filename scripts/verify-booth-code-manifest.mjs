// Organizer-only verification/export. Does not register or redeem anything.
// node --experimental-strip-types scripts/verify-booth-code-manifest.mjs <original-manifest.json> [<private-output.json>]
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import jsQR from "jsqr";
import { WTS_2026_BOOTH_ACHIEVEMENTS, boothAchievementKey, boothQuestionnaire } from "../src/lib/wts-2026-booth-achievements.ts";
import { parseMissionCode } from "../src/lib/mission-code-format.ts";

const [source, output] = process.argv.slice(2);
if (!source || process.argv.length > 4) throw new Error("Supply the original QR manifest and optionally a new private JSON output path.");
const sourcePath = resolve(source);
const manifest = JSON.parse(await readFile(sourcePath, "utf8"));
if (!Array.isArray(manifest.entries) || manifest.count !== manifest.entries.length) throw new Error("Original manifest entry count does not match.");
const seen = new Set();
const entries = [];
for (const booth of WTS_2026_BOOTH_ACHIEVEMENTS) {
  const matches = manifest.entries.filter(entry => entry.lookupPrefix === booth.lookupPrefix);
  if (matches.length !== 1 || seen.has(booth.lookupPrefix)) throw new Error(`Expected one original entry for ${booth.booth}.`);
  seen.add(booth.lookupPrefix);
  const original = matches[0];
  const parsed = parseMissionCode(original.code);
  if (!parsed || parsed.lookupPrefix !== booth.lookupPrefix) throw new Error(`Invalid original code for ${booth.booth}; do not repair or regenerate it.`);
  if (original.url !== `https://wts.sh/missions/redeem#code=${original.code}`) throw new Error(`Original URL mismatch for ${booth.booth}.`);
  const svgPath = resolve(dirname(sourcePath), original.filename);
  const local = relative(dirname(sourcePath), svgPath);
  if (local.startsWith("..") || isAbsolute(local)) throw new Error("SVG must belong to the original manifest directory.");
  const svg = await readFile(svgPath);
  if (createHash("sha256").update(svg).digest("hex") !== original.svgSha256) throw new Error(`Original SVG checksum mismatch for ${booth.booth}.`);
  const pixels = await sharp(svg).resize(1024, 1024, { fit: "contain", background: "white" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height);
  if (decoded?.data !== original.url) throw new Error(`Original SVG does not decode to the exact URL for ${booth.booth}.`);
  entries.push({ key: boothAchievementKey(booth), booth: booth.booth, printedLabel: booth.printedLabel, name: booth.name, lookupPrefix: booth.lookupPrefix, originalNumber: original.number, rawCode: original.code, url: original.url, questionnaire: boothQuestionnaire(booth), status: "verified_original_not_registered_by_this_export" });
}
if (entries.length !== 12 || seen.size !== 12) throw new Error("Expected exactly 12 unique booth mappings.");
if (output) await writeFile(resolve(output), JSON.stringify({ schemaVersion: 1, count: entries.length, status: "private_organizer_export_not_live_registration", entries }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ verified: entries.length, exactSvgDecodes: entries.length, exported: Boolean(output), productionWrites: 0 }));
