// Serves the built Storybook (storybook-static) for design.wts.sh.
import { createReadStream, realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "SAMEORIGIN",
  "x-robots-tag": "noindex, nofollow",
};

/** Maps a URL path to a file inside root, or null when the path leaves root. */
export function filePath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = normalize(decoded).replace(/^([/\\])+/, "");
  const full = resolve(root, relative);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return decoded.endsWith("/") ? join(full, "index.html") : full;
}

function send(response, status, text) {
  response.writeHead(status, { ...HEADERS, "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

/** Request handler for a built Storybook folder. Only GET and HEAD are allowed. */
export function createHandler(root) {
  const base = resolve(root);
  return async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "Method not allowed");
    if (request.url === "/healthz") return send(response, 200, "ok");
    const path = filePath(base, request.url ?? "/");
    if (!path) return send(response, 400, "Bad request");
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return send(response, 404, "Not found");
    const hashed = /[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2)$/.test(path);
    response.writeHead(200, {
      ...HEADERS,
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      "content-length": info.size,
      "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (request.method === "HEAD") return response.end();
    createReadStream(path).pipe(response);
  };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = process.env.STORYBOOK_DIR ?? fileURLToPath(new URL("./storybook-static", import.meta.url));
  const port = Number(process.env.PORT ?? 3000);
  const server = createServer(createHandler(root));
  server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`Storybook on port ${port}`));
  // Node as PID 1 has no default SIGTERM handler, so a container stop would wait for SIGKILL.
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
