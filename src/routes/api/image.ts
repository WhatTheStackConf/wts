import sharp from "sharp";
import { getPocketBasePublicBaseUrl } from "~/lib/pocketbase-public-url";

const MAX_DIMENSION = 1280;

function imageDimension(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DIMENSION) {
    return undefined;
  }
  return parsed;
}

function isAllowedPocketBaseUrl(url: URL): boolean {
  const allowedOrigins = new Set([
    new URL(getPocketBasePublicBaseUrl()).origin,
  ]);

  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://127.0.0.1:8090");
    allowedOrigins.add("http://localhost:8090");
  }

  return allowedOrigins.has(url.origin) && url.pathname.startsWith("/api/files/");
}

export async function GET({ request }: { request: Request }) {
  const requestUrl = new URL(request.url);
  const source = requestUrl.searchParams.get("src");
  const width = imageDimension(requestUrl.searchParams.get("width"));
  const height = imageDimension(requestUrl.searchParams.get("height"));

  if (!source || !width) {
    return new Response("A valid source and width are required.", { status: 400 });
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return new Response("Invalid image source.", { status: 400 });
  }

  if (!isAllowedPocketBaseUrl(sourceUrl)) {
    return new Response("Image source is not allowed.", { status: 403 });
  }

  const upstream = await fetch(sourceUrl, {
    headers: { Accept: "image/avif,image/webp,image/*" },
  });
  if (!upstream.ok) {
    return new Response("Image could not be loaded.", { status: 502 });
  }

  const input = Buffer.from(await upstream.arrayBuffer());
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

  return new Response(Uint8Array.from(output), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control":
        "public, max-age=2592000, stale-while-revalidate=604800",
    },
  });
}
