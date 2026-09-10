import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";

// Real built server + real PocketBase, exclusively disposable SYNTHETIC records.
// Run pnpm build first. No dotenv files, production credentials, or data are read.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "wts-public-api-"));
const children = [];
const env = Object.fromEntries(["PATH", "HOME", "LANG", "TMPDIR"].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));

// A broken route must fail the smoke test, never leave it hanging indefinitely.
const fetch = (url, options = {}) => globalThis.fetch(url, { signal: AbortSignal.timeout(10_000), ...options });

async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert(address && typeof address !== "string");
  return address.port;
}
function run(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, env, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, `${binary} failed: ${result.stdout}\n${result.stderr}`);
}
function start(binary, args) {
  const child = spawn(binary, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-8000); });
  child.stderr.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-8000); });
  child.on("error", (error) => { logs += error.message; });
  children.push(child);
  return { child, logs: () => logs };
}
async function ready(url, process) {
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(process.child.exitCode, null, process.logs());
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch { /* process is not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Not ready: ${url}\n${process.logs()}`);
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}
let cleaning;
const clean = () => cleaning ??= (async () => {
  await Promise.all(children.map(stop));
  await rm(root, { recursive: true, force: true });
})();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await clean(); process.exit(130); });

try {
  await cp(join(repo, ".output"), join(root, ".output"), { recursive: true });
  await symlink(join(repo, "node_modules"), join(root, "node_modules"));
  const migrationsDir = join(root, "pb_migrations");
  const hooksDir = join(root, "pb_hooks");
  const dataDir = join(root, "pb_data");
  await Promise.all([migrationsDir, hooksDir, dataDir].map((dir) => mkdir(dir)));
  // Unmodified named migrations; legacy ID-specific edits are not fresh-DB safe.
  const migrations = [
    "1735401500_create_cfp_applicants.js", "1735401600_create_cfp_submissions.js",
    "1768850000_roles_and_reviews.js", "1768850001_fix_user_role.js",
    "1776000000_create_speakers_and_sessions.js", "1785000000_create_programme_agenda.js",
    "1786000010_harden_programme_api_rules.js", "1788000003_create_appearance_events.js",
    "1788000004_create_event_programmes.js",
  ];
  for (const name of migrations) await cp(join(repo, "pocketbase/pb_migrations", name), join(migrationsDir, name));
  for (const name of ["programme_public_fields.pb.js", "appearance_event_constraints.pb.js", "agenda_constraints.pb.js"]) {
    await cp(join(repo, "pocketbase/pb_hooks", name), join(hooksDir, name));
  }
  const binary = join(repo, "pocketbase/pocketbase");
  const version = spawnSync(binary, ["--version"], { env, encoding: "utf8" });
  assert.match(version.stdout || "", /0\.30\.4/, "Run pnpm pocketbase:download-test for PocketBase 0.30.4");
  const args = [`--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`, `--hooksDir=${hooksDir}`];
  run(binary, ["migrate", "up", ...args]);
  const email = "public-api-smoke@example.test";
  const password = `Disposable-${randomBytes(24).toString("hex")}!`;
  run(binary, ["superuser", "create", email, password, ...args, "--automigrate=false"]);
  const pbPort = await port();
  const appPort = await port();
  const pbUrl = `http://127.0.0.1:${pbPort}`;
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const pbProcess = start(binary, ["serve", `--http=127.0.0.1:${pbPort}`, ...args, "--automigrate=false", "--hooksWatch=false"]);
  await ready(`${pbUrl}/api/health`, pbProcess);
  const pb = new PocketBase(pbUrl);
  pb.autoCancellation(false);
  await pb.collection("_superusers").authWithPassword(email, password);
  const event = await pb.collection("appearance_events").getOne("wts2026appevent");
  const user = await pb.collection("users").create({ email: "PRIVATE_EMAIL@example.test", password, passwordConfirm: password, role: "user" });
  const ada = await pb.collection("speakers").create({
    slug: "ada", display_name: "Ada Example", affiliation: "Engines", bio: "Public biography",
    social_handles: ["https://example.test/ada"], origin: "invite", user: user.id,
    published: true, appearance_events: [event.id],
  });
  const hidden = await pb.collection("speakers").create({
    slug: "draft-speaker", display_name: "PRIVATE_SPEAKER", origin: "invite", published: false, appearance_events: [event.id],
  });
  const session = await pb.collection("sessions").create({
    slug: "engines", title: "Engines", abstract: "Public abstract", format: "talk",
    speakers: [ada.id, hidden.id], published: false, room: "PRIVATE_LEGACY_ROOM",
  });
  await pb.collection("sessions").create({ slug: "draft-session", title: "PRIVATE_SESSION", abstract: "PRIVATE_ABSTRACT", speakers: [ada.id], published: false });
  const day = await pb.collection("conference_days").create({ key: "main-day", title: "Main day", local_date: "2026-09-19", published: true });
  const programme = await pb.collection("event_programmes").create({ day: day.id, appearance_event: event.id });
  const track = await pb.collection("agenda_tracks").create({ programme: programme.id, key: "stage-1", name: "Stage 1" });
  const slot = await pb.collection("agenda_slots").create({
    programme: programme.id, track: track.id, session: session.id, kind: "session", published: false,
    start_at: "2026-09-19 08:00:00.000Z", end_at: "2026-09-19 08:35:00.000Z",
  });
  await pb.send(`/api/wts/programme/agenda-slots/${slot.id}/publication`, { method: "POST", body: { published: true } });
  assert.equal((await pb.collection("agenda_slots").getOne(slot.id)).published, true);
  assert.equal((await pb.collection("sessions").getOne(session.id)).published, true);

  Object.assign(env, {
    NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(appPort),
    POCKETBASE_URL: pbUrl, PUBLIC_POCKETBASE_URL: pbUrl,
    POCKETBASE_SUPERUSER_EMAIL: email, POCKETBASE_SUPERUSER_PASSWORD: password,
    PUBLIC_SITE_URL: baseUrl, SITE_URL: baseUrl,
  });
  const app = start(process.execPath, [join(root, ".output/server/index.mjs")]);
  const api = `${baseUrl}/api/public/v1`;
  await ready(`${api}/speakers`, app);
  const results = [];
  for (const path of ["speakers", "speakers/ada", "sessions", "sessions/engines", "agenda"]) {
    const response = await fetch(`${api}/${path}`, { headers: { Origin: "https://workshop.example" } });
    assert.equal(response.status, 200, `${path}: ${app.logs()}`);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    const text = await response.text();
    assert(!text.includes("PRIVATE_") && !text.includes(user.id) && !text.includes("draft-speaker") && !text.includes("draft-session"), path);
    assert(!/"(?:origin|user|cfp_applicant|collectionId|collectionName|room|published)":/.test(text), path);
    const body = JSON.parse(text);
    assert.equal(body.meta.apiVersion, "1");
    if (path === "speakers") assert.deepEqual(body.data.map((s) => s.slug), ["ada"]);
    if (path === "sessions") assert.deepEqual(body.data.map((s) => s.slug), ["engines"]);
    if (path === "speakers/ada") assert.equal(body.data.sessions[0].slug, "engines");
    if (path === "sessions/engines") {
      assert.deepEqual(body.data.speakers.map((s) => s.slug), ["ada"]);
      assert.equal(body.data.schedule.startAt, "2026-09-19 08:00:00.000Z");
    }
    if (path === "agenda") assert.equal(body.data.days[0].programmes[0].slots[0].session.slug, "engines");
    const cached = await fetch(`${api}/${path}`, { headers: { "If-None-Match": response.headers.get("etag") } });
    assert.equal(cached.status, 304);
    results.push({ path, status: response.status, revalidation: cached.status });
  }
  for (const path of ["partners", "speakers/draft-speaker", "sessions/draft-session", "speakers/not-found"]) {
    const response = await fetch(`${api}/${path}`);
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).error.code, "not_found");
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await fetch(`${api}/speakers`, { method });
    assert.equal(response.status, 405, method);
    assert.equal((await response.json()).error.code, "method_not_allowed");
  }
  for (const path of ["sessions/%ZZ", "speakers/a%2Fb"]) {
    const response = await fetch(`${api}/${path}`).catch((error) => {
      throw new Error(`Malformed path ${path}: ${error.name}\n${app.logs()}`);
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_slug");
  }
  assert.equal((await fetch(`${api}/agenda`, { method: "HEAD" })).status, 200);
  assert.equal((await fetch(`${api}/agenda`, { method: "OPTIONS" })).status, 204);
  assert.equal((await fetch(`${api}/speakers`)).status, 200, "Server remains alive after malformed requests");
  for (const collection of ["speakers", "sessions", "conference_days", "appearance_events", "event_programmes", "agenda_tracks", "agenda_slots"]) {
    const raw = await fetch(`${pbUrl}/api/collections/${collection}/records`);
    assert.equal(raw.status, 403, `Raw ${collection} must remain private`);
  }
  console.log(JSON.stringify({ result: "passed", fixture: "synthetic", pocketbase: version.stdout.trim(), endpoints: results,
    verified: ["publication filtering", "private fields excluded", "raw PocketBase locked", "CORS", "ETag/304", "HEAD/OPTIONS", "write rejection", "malformed input and liveness"] }, null, 2));
} finally {
  await clean();
}
