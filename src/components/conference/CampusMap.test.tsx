import { readFileSync } from "node:fs";
import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vite-plus/test";
import { CampusMap } from "~/components/conference/CampusMap";

const renderMap = () => renderToString(() => <CampusMap />);

describe("homepage campus map", () => {
  it("links both the image and the text CTA to the local full-size asset", () => {
    const html = renderMap();
    expect(html.match(/href="\/static\/wts-2026-campus-map.png"/g)).toHaveLength(2);
    expect(html).toContain('id="venue-map"');
    expect(html).toContain('aria-label="Open the full-size campus map"');
    expect(html).not.toContain("listmonk");
  });

  it("describes the map and reserves its aspect ratio without eager loading", () => {
    const html = renderMap();
    expect(html).toContain("WTS 2026 campus map showing Stages 1–5");
    expect(html).toContain('width="1258"');
    expect(html).toContain('height="902"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it("ships a PNG with the declared dimensions", () => {
    const image = readFileSync("public/static/wts-2026-campus-map.png");
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(image.readUInt32BE(16)).toBe(1258);
    expect(image.readUInt32BE(20)).toBe(902);
  });
});
