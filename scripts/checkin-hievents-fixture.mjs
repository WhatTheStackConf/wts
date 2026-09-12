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
let arrivalReads = 0;
let affiliationReads = 0;
// A generous TEST-ONLY rate window keeps browser suites independent of speed.
// Low-budget and Retry-After behavior are exercised by injected transport tests.
let rateResetAt = Date.now() + 60000;
let rateRemaining = 10000;
const attendees = [
  { id: 901, public_id: "A-TEST001", first_name: "Ана", last_name: "O’Neill", status: "ACTIVE" },
  { id: 902, public_id: "A-TEST002", first_name: "Synthetic", last_name: "Missing affiliation", status: "ACTIVE" },
  { id: 903, public_id: "A-TEST003", first_name: "Synthetic", last_name: "Cancelled", status: "CANCELLED" },
  { id: 904, public_id: "A-TEST004", first_name: "Synthetic", last_name: "Payment pending", status: "AWAITING_PAYMENT" },
  { id: 905, public_id: "A-TEST005", first_name: "Synthetic", last_name: "Delayed affiliation", status: "ACTIVE" },
  { id: 906, public_id: "A-TEST006", first_name: "Synthetic", last_name: "Response loss", status: "ACTIVE" },
  { id: 907, public_id: "A-TEST007", first_name: "Synthetic", last_name: "Already checked in", status: "ACTIVE" },
  // Separate fresh lookup cases from previous specs' durable duplicate ledger.
  { id: 911, public_id: "A-LOOK001", first_name: "Ана", last_name: "Lookup only", status: "ACTIVE" },
  { id: 915, public_id: "A-LOOK005", first_name: "Synthetic", last_name: "Lookup affiliation", status: "ACTIVE" },
  { id: 921, public_id: "A-CAM0001", first_name: "Ана", last_name: "O’Neill", status: "ACTIVE" },
  { id: 922, public_id: "A-CAM0002", first_name: "Synthetic", last_name: "Camera missing affiliation", status: "ACTIVE" },
  { id: 925, public_id: "A-CAM0005", first_name: "Synthetic", last_name: "Camera delayed affiliation", status: "ACTIVE" },
  { id: 926, public_id: "A-CAM0006", first_name: "Synthetic", last_name: "Camera response loss", status: "ACTIVE" },
  { id: 931, public_id: "A-UXS0001", first_name: "Јана", last_name: "Scanner UX", status: "ACTIVE" },
  { id: 941, public_id: "A-TOOLS01", first_name: "Јана", last_name: "Tools dashboard", status: "ACTIVE" },
].map((row) => ({ ...row, product_id: 601, product_price_id: 611, order_id: 1001, locale: "en" }));
function page(path, rows, current) {
  // Keep discovery at two rows for its partial-page test. The separate attendee
  // namespaces must still fit the production lookup's bounded page budget.
  const perPage = path.endsWith("/attendees") ? 5 : 2;
  const last = Math.max(1, Math.ceil(rows.length / perPage));
  const data = rows.slice((current - 1) * perPage, current * perPage);
  const url = (page) => `${origin}${path}?page=${page}&per_page=${perPage}`;
  return { data, links: { first: url(1), last: url(last), prev: current > 1 ? url(current - 1) : null, next: current < last ? url(current + 1) : null }, meta: { path: `${origin}${path}`, total: rows.length, current_page: current, per_page: perPage, last_page: last, from: rows.length ? (current - 1) * perPage + 1 : null, to: rows.length ? (current - 1) * perPage + data.length : null } };
}
const server = createServer({ key: readFileSync(`${root}/upstream-key.pem`), cert: readFileSync(`${root}/upstream-cert.pem`) }, async (request, response) => {
  const url = new URL(request.url, origin);
  const send = (status, body) => {
    if (Date.now() >= rateResetAt) { rateResetAt = Date.now() + 60000; rateRemaining = 10000; }
    rateRemaining--;
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "X-RateLimit-Limit": "10000", "X-RateLimit-Remaining": String(rateRemaining), "X-RateLimit-Reset": String(Math.ceil(rateResetAt / 1000)) });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/health" && request.method === "GET") return send(200, { synthetic: true });
  const publicAttendees = url.pathname === "/api/public/check-in-lists/synthetic-list-capability/attendees";
  if (!publicAttendees && request.headers.authorization !== `Bearer ${token}`) return send(401, { error: "Synthetic authorization required" });
  if (url.pathname === "/__test/control" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) { body += chunk; if (body.length > 1024) return send(413, {}); }
    try {
      const command = JSON.parse(body);
      if (!["complete", "unavailable", "partial", "expired_list", "affiliation_failure", "arrival_unavailable"].includes(command.mode)) return send(400, {});
      mode = command.mode; return send(200, { synthetic: true, mode, forbiddenEffects });
    } catch { return send(400, {}); }
  }
  if (url.pathname === "/__test/status" && request.method === "GET") return send(200, { synthetic: true, mode, forbiddenEffects, arrivalReads, affiliationReads });
  if (request.method !== "GET") { forbiddenEffects++; return send(405, { error: "No admission or upstream mutation exists in this fixture" }); }
  if (mode === "unavailable") return send(503, { error: "Synthetic dependency outage" });
  const current = Number(url.searchParams.get("page") || "1");
  if (publicAttendees) {
    arrivalReads++;
    if (mode === "arrival_unavailable") return send(503, { error: "Synthetic arrival outage" });
    const query = url.searchParams.get("query");
    const rows = attendees.filter((row) => query === null || row.public_id === query).map((row) => row.id === 907 ? { ...row, check_in: { id: 1101, short_id: "synthetic-checkin-capability", check_in_list_id: 701, attendee_id: row.id, order_id: row.order_id, checked_in_at: "2026-09-09T08:00:00Z" } } : row);
    const path = `${origin}${url.pathname}`;
    // Pinned Hi.Events list attendees use Laravel simplePaginate, not totals.
    return send(200, { data: rows, links: { first: `${path}?page=1`, last: null, prev: null, next: null }, meta: { path, current_page: 1, per_page: 25, from: rows.length ? 1 : null, to: rows.length || null } });
  }
  if (url.pathname === "/api/events/5/attendees") {
    if (url.searchParams.get("sort_by") !== "id" || url.searchParams.get("sort_direction") !== "asc" || url.searchParams.has("query")) return send(400, {});
    const rows = [15, 15, 16, 17, 999, 15].map((product_id, index) => ({ id: 95000 + index, event_id: 5, product_id, first_name: "Synthetic", last_name: `Roster ${index}`, email: `roster${index}@example.invalid`, status: "ACTIVE", short_id: "never-expose" }));
    return send(200, page(url.pathname, rows, current));
  }
  const attendeeList = /^\/api\/events\/(501|502)\/attendees$/.exec(url.pathname);
  if (attendeeList) {
    if (url.searchParams.has("query")) return send(400, { error: "Private queries must never reach upstream URLs" });
    return send(200, page(url.pathname, attendees.map(row => ({ ...row, event_id: Number(attendeeList[1]), email: "private-arrival@example.test" })), current));
  }
  const detail = /^\/api\/events\/(501|502)\/attendees\/(90[1-7]|911|915|921|922|925|926|931|941)$/.exec(url.pathname);
  if (detail) {
    affiliationReads++;
    if (mode === "affiliation_failure") return send(503, { error: "Synthetic answer fetch failure, never missing data" });
    const attendee = attendees.find((row) => row.id === Number(detail[2]));
    return send(200, { data: { ...attendee, event_id: Number(detail[1]), email: "private-arrival@example.test", question_answers: [902, 922].includes(attendee.id) ? [] : [{ question_id: 801, answer: "Synthetic organisation", text_answer: "Synthetic organisation" }] } });
  }
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
