import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { emptyPublicationGraph, type PublicContentBatchV1 } from "~/lib/publication-schema";
import { publicAssetId } from "~/lib/public-media";
import { initializeEdition, importLocalBundle, sha256 } from "~/server/storage";
import { GET as media, HEAD as mediaHead } from "~/routes/media/[assetId]";
import { GET as imageTransform } from "~/routes/api/image";
import { GET as openGraph } from "~/routes/api/og";

const sourceBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="red"/></svg>');
const assetId = sha256(sourceBytes);
const origin = "https://wts.sh";
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "wts-owned-media-"));
  const dataDir = join(directory, "data");
  initializeEdition("2027", "owned-media-fixture", dataDir);
  const graph = emptyPublicationGraph();
  graph.speakers.push({ id: "speaker", slug: "speaker", displayName: "Speaker", affiliation: "", bio: "", isMc: false, socialHandles: [], photoAssetId: assetId });
  const batch: PublicContentBatchV1 = {
    schemaVersion: 1, editionId: "2027", sourceNamespace: "owned-media-fixture", revision: 2, expectedRevision: 1, graph,
    assets: [{ id: assetId, sha256: assetId, mediaType: "image/svg+xml", byteLength: sourceBytes.byteLength, file: "portrait.svg" }],
  };
  writeFileSync(join(directory, "portrait.svg"), sourceBytes);
  writeFileSync(join(directory, "bundle.json"), JSON.stringify(batch));
  importLocalBundle(join(directory, "bundle.json"), dataDir);
  vi.stubEnv("SITE_DATA_DIR", dataDir);
  vi.stubEnv("SITE_PUBLIC_DIR", fileURLToPath(new URL("../../public", import.meta.url)));
  vi.stubGlobal("fetch", async () => { throw new Error("Network access is not permitted for owned image operations."); });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

describe("registered local image consumers", () => {
  it("accepts same-origin registered paths and rejects remote, malformed, and private file sources", () => {
    expect(publicAssetId(`/media/${assetId}`, origin)).toBe(assetId);
    expect(publicAssetId(`${origin}/media/${assetId}`, origin)).toBe(assetId);
    for (const source of [
      `https://other.example/media/${assetId}`, `http://wts.sh/media/${assetId}`,
      `file:///media/${assetId}`, "data:image/png;base64,AAAA", "/api/files/speakers/private/photo.png",
      `/media/${assetId}?private=1`, `/media/${assetId}#fragment`, "/media/../site.sqlite", "/media/%ZZ",
    ]) expect(publicAssetId(source, origin)).toBeNull();
  });

  it("serves exact owned bytes, sandboxed SVG, immutable ETags, conditional requests, and HEAD", async () => {
    const request = new Request(`${origin}/media/${assetId}`);
    const result = media({ request });
    expect(result.status).toBe(200);
    expect(Buffer.from(await result.arrayBuffer())).toEqual(sourceBytes);
    expect(result.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(result.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(result.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const conditional = media({ request: new Request(request.url, { headers: { "If-None-Match": result.headers.get("ETag")! } }) });
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    const head = mediaHead({ request: new Request(request.url, { method: "HEAD" }) });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe(String(sourceBytes.byteLength));
    expect(await head.text()).toBe("");
    expect(media({ request: new Request(`${origin}/media/${"0".repeat(64)}`) }).status).toBe(404);
    expect(media({ request: new Request(`${origin}/media/%ZZ`) }).status).toBe(404);
  });

  it("transforms registered local bytes into WebP without a URL fetch and rejects remote image sources", async () => {
    const url = new URL("/api/image", origin);
    url.searchParams.set("src", `/media/${assetId}`);
    url.searchParams.set("width", "6");
    const transformed = await imageTransform({ request: new Request(url) });
    expect(transformed.status).toBe(200);
    expect(transformed.headers.get("Content-Type")).toBe("image/webp");
    const metadata = await sharp(Buffer.from(await transformed.arrayBuffer())).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 6, height: 4 });
    url.searchParams.set("src", `https://remote.example/media/${assetId}`);
    expect((await imageTransform({ request: new Request(url) })).status).toBe(403);
    url.searchParams.set("src", `/media/${"0".repeat(64)}`);
    expect((await imageTransform({ request: new Request(url) })).status).toBe(404);
    url.searchParams.set("src", `/media/${assetId}`);
    url.searchParams.set("width", "1281");
    expect((await imageTransform({ request: new Request(url) })).status).toBe(400);
  });

  it("renders the public Open Graph image with packaged fonts and logo even when the request origin cannot serve assets", async () => {
    const result = await openGraph({ request: new Request("https://unreachable.invalid/api/og?title=Local%20assets&subtitle=Packaged%20font%20and%20logo") });
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("image/png");
    const metadata = await sharp(Buffer.from(await result.arrayBuffer())).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 1200, height: 630 });
  });
});
