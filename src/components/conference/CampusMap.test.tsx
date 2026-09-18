import { readFileSync } from "node:fs";
import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vite-plus/test";
import { CampusMap } from "~/components/conference/CampusMap";
import { CampusMapDialog } from "~/components/conference/CampusMapDialog";

const renderMap = () => renderToString(() => <CampusMap />);

describe("homepage campus map", () => {
  it("opens the image directly and includes the interactive map button", () => {
    const html = renderMap();
    expect(html.match(/href="\/static\/wts-2026-campus-map.png\?v=2026-09-18"/g)).toHaveLength(1);
    expect(html).toContain('id="venue-map"');
    expect(html).toContain('aria-label="Open the full-size campus map"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Campus map");
    expect(html).not.toContain("listmonk");
  });

  it("describes the map and reserves its aspect ratio without eager loading", () => {
    const html = renderMap();
    expect(html).toContain("WTS 2026 campus map showing Stages 1–5");
    expect(html).toContain('width="2005"');
    expect(html).toContain('height="1418"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it("ships a PNG with the declared dimensions", () => {
    const image = readFileSync("public/static/wts-2026-campus-map.png");
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(image.readUInt32BE(16)).toBe(2005);
    expect(image.readUInt32BE(20)).toBe(1418);
  });
});

describe("agenda campus map lightbox", () => {
  it("renders an accessible map trigger and dependency-free dialog controls", () => {
    const html = renderToString(() => <CampusMapDialog />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Campus map");
    expect(html).toContain('aria-labelledby="campus-map-dialog-title"');
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Zoom out"');
    expect(html).toContain('aria-label="Reset map zoom"');
    expect(html).toContain('aria-label="Close campus map"');
    expect(html).toContain('src="/static/wts-2026-campus-map.png?v=2026-09-18"');
  });
});
