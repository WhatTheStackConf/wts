import { readPublicAsset } from "~/server/public-assets";

export function GET({ request }: { request: Request }) {
  const match = /^\/media\/([a-f0-9]{64})\/?$/.exec(new URL(request.url).pathname);
  const result = match ? readPublicAsset(match[1]) : null;
  if (!result) return new Response("Not Found", { status: 404 });
  const etag = `"${result.asset.sha256}"`;
  const headers = {
    "Content-Type": result.asset.mediaType,
    ...(result.asset.mediaType === "image/svg+xml" ? { "Content-Security-Policy": "sandbox" } : {}),
    "Content-Length": String(result.asset.byteLength),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
  };
  const unchanged = request.headers.get("if-none-match")?.split(",")
    .some((value) => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag);
  const body = unchanged || request.method === "HEAD" ? null
    : new Uint8Array(result.bytes.buffer as ArrayBuffer, result.bytes.byteOffset, result.bytes.byteLength);
  return new Response(body, {
    status: unchanged ? 304 : 200,
    headers,
  });
}

export const HEAD = GET;
