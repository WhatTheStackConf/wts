import sharp from "sharp";
import { publicAssetId } from "~/lib/public-media";
import { readPublicAsset } from "~/server/public-assets";

const MAX_DIMENSION = 1280;

function imageDimension(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DIMENSION) {
    return undefined;
  }
  return parsed;
}

export async function GET({ request }: { request: Request }) {
  const requestUrl = new URL(request.url);
  const source = requestUrl.searchParams.get("src");
  const width = imageDimension(requestUrl.searchParams.get("width"));
  const height = imageDimension(requestUrl.searchParams.get("height"));

  if (!source || !width) {
    return new Response("A valid source and width are required.", { status: 400 });
  }

  const assetId = publicAssetId(source, request.url);
  if (!assetId) {
    return new Response("Image source is not allowed.", { status: 403 });
  }
  const result = readPublicAsset(assetId);
  if (!result) {
    return new Response("Image not found.", { status: 404 });
  }
  if (!result.asset.mediaType.startsWith("image/")) {
    return new Response("Image source is not an image.", { status: 400 });
  }
  const input = result.bytes;
  const fit =
    requestUrl.searchParams.get("fit") === "contain" ? "contain" : "cover";
  const image = sharp(input, { limitInputPixels: 40_000_000 }).rotate().resize({
    width,
    height,
    fit,
    withoutEnlargement: true,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  const output = await image
    .webp({ quality: 78, alphaQuality: 82, effort: 4 })
    .toBuffer();

  return new Response(new Uint8Array(output.buffer, output.byteOffset, output.byteLength), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control":
        "public, max-age=2592000, stale-while-revalidate=604800",
    },
  });
}
