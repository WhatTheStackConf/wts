import { createServer, request } from "node:http";

/** Test-only transport fault injection. Hold real upstream preview responses
 * before Chromium can process their Set-Cookie headers; fabricate no responses. */
export async function delayedPreviewProxy(target: string) {
  const upstreamUrl = new URL(target);
  if (upstreamUrl.hostname !== "127.0.0.1" || upstreamUrl.protocol !== "http:") throw new Error("Proxy requires a disposable loopback target");
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const firstArrived = Promise.withResolvers<void>();
  const secondArrived = Promise.withResolvers<void>();
  let previews = 0;
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const body = Buffer.concat(chunks);
      let preview = false;
      if (incoming.url === "/api/checkin") {
        try { preview = JSON.parse(body.toString()).operation === "preview"; } catch { /* forward unchanged */ }
      }
      // Preserve Host and Origin: this is a normal same-origin reverse proxy,
      // not a bypass of the app's browser mutation protection.
      const upstream = request({
        hostname: upstreamUrl.hostname, port: upstreamUrl.port,
        path: incoming.url ?? "/", method: incoming.method, headers: incoming.headers,
      }, (response) => {
        response.pause();
        let gate = Promise.resolve();
        if (preview) {
          previews++;
          if (previews === 1) { firstArrived.resolve(); gate = first.promise; }
          else { secondArrived.resolve(); gate = second.promise; }
        }
        void gate.then(() => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        });
      });
      upstream.on("error", () => { outgoing.writeHead(502); outgoing.end(); });
      upstream.end(body);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing disposable proxy address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    first, second, firstArrived, secondArrived,
    async close() {
      first.resolve(); second.resolve();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
