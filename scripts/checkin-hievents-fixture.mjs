// SYNTHETIC Hi.Events contract server for disposable browser tests only.
// No real account, attendee, admission, email, camera or printer is involved.
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";

const root = process.env.WTS_SYNTHETIC_UPSTREAM_ROOT;
const base = process.env.HIEVENTS_API_URL;
if (!root || dirname(root) !== tmpdir() || !basename(root).startsWith("wts-checkin-browser-") || !base || new URL(base).hostname !== "127.0.0.1") throw new Error("Refusing non-disposable synthetic upstream");
const token = process.env.HIEVENTS_API_KEY;
const origin = new URL(base).origin;
const events = [
  { id: 501, title: "Synthetic conference" }, { id: 502, title: "Synthetic workshop" },
  { id: 503, title: "Synthetic unconfigured" }, { id: 504, title: "Synthetic disabled" },
];
let mode = "complete";
let forbiddenEffects = 0;
function page(path, rows, current) {
  const perPage = 2;
  const last = Math.max(1, Math.ceil(rows.length / perPage));
  const data = rows.slice((current - 1) * perPage, current * perPage);
  const url = (page) => `${origin}${path}?page=${page}&per_page=${perPage}`;
  return { data, links: { first: url(1), last: url(last), prev: current > 1 ? url(current - 1) : null, next: current < last ? url(current + 1) : null }, meta: { path: `${origin}${path}`, total: rows.length, current_page: current, per_page: perPage, last_page: last, from: rows.length ? (current - 1) * perPage + 1 : null, to: rows.length ? (current - 1) * perPage + data.length : null } };
}
const server = createServer({ key: readFileSync(`${root}/upstream-key.pem`), cert: readFileSync(`${root}/upstream-cert.pem`) }, async (request, response) => {
  const url = new URL(request.url, origin);
  const send = (status, body) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); };
  if (url.pathname === "/health" && request.method === "GET") return send(200, { synthetic: true });
  if (request.headers.authorization !== `Bearer ${token}`) return send(401, { error: "Synthetic authorization required" });
  if (url.pathname === "/__test/control" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) { body += chunk; if (body.length > 1024) return send(413, {}); }
    try {
      const command = JSON.parse(body);
      if (!["complete", "unavailable", "partial", "expired_list"].includes(command.mode)) return send(400, {});
      mode = command.mode; return send(200, { synthetic: true, mode, forbiddenEffects });
    } catch { return send(400, {}); }
  }
  if (url.pathname === "/__test/status" && request.method === "GET") return send(200, { synthetic: true, mode, forbiddenEffects });
  if (request.method !== "GET") { forbiddenEffects++; return send(405, { error: "No admission or upstream mutation exists in this fixture" }); }
  if (mode === "unavailable") return send(503, { error: "Synthetic dependency outage" });
  const current = Number(url.searchParams.get("page") || "1");
  if (url.pathname === "/api/events") {
    const result = page(url.pathname, events, current);
    if (mode === "partial" && current === 2) result.meta.total = 99;
    return send(200, result);
  }
  const match = /^\/api\/events\/(501|502|503|504)\/(check-in-lists|questions|products)$/.exec(url.pathname);
  if (!match) return send(404, { error: "Unknown synthetic endpoint" });
  const eventId = Number(match[1]);
  const product = { id: 601, title: "Synthetic ticket", event_id: eventId };
  if (match[2] === "products") return send(200, page(url.pathname, [product], current));
  if (match[2] === "questions") return send(200, { data: [{ id: 801, event_id: eventId, title: "Synthetic affiliation", type: "SINGLE_LINE_TEXT", belongs_to: "PRODUCT", product_ids: [601] }] });
  return send(200, page(url.pathname, [{ id: 701, name: "Synthetic admission list", short_id: "synthetic-list-capability", is_active: true, is_expired: mode === "expired_list", products: [product] }], current));
});
server.listen(Number(new URL(base).port), "127.0.0.1", () => console.log("Synthetic Hi.Events fixture listening on private loopback"));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close(() => process.exit(0)));
