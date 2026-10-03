import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { backup, importLocalBundle, initializeEdition, migrate, openSiteDatabase, restore, setEditionRole, sha256 } from "./storage.ts";
import { mapPublicConference, readPublished } from "./public-content.ts";
import { lookupPublicAsset, readPublicAsset } from "./public-assets.ts";
import { emptyPublicationGraph, publicContentBatchSchema, type PublicContentBatchV1 } from "../lib/publication-schema.ts";

const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>');
const hash = sha256(image);
function fixture(): PublicContentBatchV1 {
  return {
    schemaVersion: 1, editionId: "2027", sourceNamespace: "reviewed-local", revision: 2, expectedRevision: 1,
    assets: [{ id: hash, sha256: hash, mediaType: "image/svg+xml", byteLength: image.byteLength, file: "portrait.svg" }],
    graph: {
      speakers: [
        { id: "guest", slug: "guest", displayName: "Ada", affiliation: "Lab", bio: "Public bio", isMc: false, socialHandles: ["@ada", "github:ada"], photoAssetId: hash },
        { id: "host", slug: "host", displayName: "Zed", affiliation: "", bio: "Host bio", isMc: true, socialHandles: [], photoAssetId: null },
        { id: "mc-only", slug: "mc-only", displayName: "MC", affiliation: "", bio: "MC bio", isMc: true, socialHandles: [], photoAssetId: null },
      ],
      sessions: [{ id: "talk", slug: "talk", title: "Systems", abstract: "Abstract", speakerIds: ["host", "guest"], hostIds: ["host"] }],
      appearanceEvents: [{ id: "main", name: "Main", compactLabel: "", displayOrder: 0 }, { id: "warmup", name: "Warmup", compactLabel: "Warm", displayOrder: 1 }],
      appearances: [{ speakerId: "host", eventId: "main" }, { speakerId: "guest", eventId: "warmup" }, { speakerId: "guest", eventId: "main" }],
      days: [{ id: "empty", key: "empty", localDate: "2027-09-17", title: "Empty day", displayOrder: 0 }, { id: "day", key: "main", localDate: "2027-09-18", title: "Main day", displayOrder: 1 }],
      programmes: [{ id: "empty-programme", dayId: "empty", eventId: "warmup", displayOrder: 0 }, { id: "programme", dayId: "day", eventId: "main", displayOrder: 0 }],
      tracks: [{ id: "track", programmeId: "programme", key: "stage", name: "Stage", locationLabel: "Hall", displayOrder: 0 }],
      slots: [
        { id: "opening", programmeId: "programme", kind: "opening", startAt: "2027-09-18T08:00:00Z", endAt: "2027-09-18T08:10:00Z", displayOrder: 0, title: "Welcome", summary: "Welcome all. Hosted by Zed.", hostIds: ["host"] },
        { id: "slot", programmeId: "programme", trackId: "track", kind: "session", sessionId: "talk", startAt: "2027-09-18T08:10:00.000Z", endAt: "2027-09-18T09:00:00.000Z", displayOrder: 1 },
      ],
      partners: [{ id: "partner", name: "Partner", logoAssetId: hash, logoSurface: "light", type: "sponsor", tier: "gold", url: "https://example.test/" }],
    },
  };
}
function bundle(root: string, value: unknown): string {
  writeFileSync(join(root, "portrait.svg"), image);
  const file = join(root, "bundle.json");
  writeFileSync(file, JSON.stringify(value));
  return file;
}

test("maps timed schedules, empty days, explicit hosts, social strings, MC-only profiles, and partners", () => {
  const result = mapPublicConference(publicContentBatchSchema.parse(fixture()).graph);
  assert.deepEqual(result.agenda.days[0], { key: "empty", localDate: "2027-09-17", title: "Empty day", programmes: [] });
  assert.deepEqual(result.sessions[0], {
    slug: "talk", title: "Systems", abstract: "Abstract", format: undefined,
    schedule: { dayDate: "2027-09-18", dayTitle: "Main day", event: { name: "Main", compactLabel: "Main", destinationUrl: undefined }, startAt: "2027-09-18T08:10:00.000Z", endAt: "2027-09-18T09:00:00.000Z", trackName: "Stage", locationLabel: "Hall" },
    speakers: [
      { slug: "guest", displayName: "Ada", photoUrl: `/media/${hash}`, affiliation: "Lab", isMc: false, sessionCount: 1, appearanceEvents: [{ name: "Main", compactLabel: "Main" }, { name: "Warmup", compactLabel: "Warm" }] },
      { slug: "host", displayName: "Zed", photoUrl: null, affiliation: "", isMc: true, sessionCount: 1, appearanceEvents: [{ name: "Main", compactLabel: "Main" }] },
    ],
    hosts: [{ slug: "host", displayName: "Zed", photoUrl: null, affiliation: "", isMc: true, sessionCount: 1, appearanceEvents: [{ name: "Main", compactLabel: "Main" }] }], relatedSessions: [],
  });
  assert.deepEqual(result.speakers.find((speaker) => speaker.slug === "mc-only"), { slug: "mc-only", displayName: "MC", photoUrl: null, affiliation: "", isMc: true, sessionCount: 0, appearanceEvents: [], bio: "MC bio", socialHandles: [], sessions: [] });
  assert.deepEqual(result.speakers[0]?.socialHandles, ["@ada", "github:ada"]);
  assert.equal(result.agenda.days[1]?.programmes[0]?.slots[0]?.summary, "Welcome all.");
  assert.deepEqual(result.partnerGroups.find((group) => group.id === "gold-sponsors")?.partners, [{ name: "Partner", logoUrl: `/media/${hash}`, logoSurface: "light", url: "https://example.test/", type: "sponsor", tier: "gold" }]);
});

test("requires explicit initialization and preserves the pointer after rejected imports or receipt replays", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-publication-"));
  const data = join(root, "data");
  try {
    assert.throws(() => readPublished("2027", data));
    assert.equal(initializeEdition("2027", "reviewed-local", data).status, "published");
    assert.deepEqual(readPublished("2027", data).agenda, { days: [] });
    const first = fixture();
    assert.equal(importLocalBundle(bundle(root, first), data).status, "published");
    const newer = structuredClone(first); newer.revision = 3; newer.expectedRevision = 2; newer.graph.sessions[0]!.title = "New title";
    assert.equal(importLocalBundle(bundle(root, newer), data).status, "published");
    assert.equal(importLocalBundle(bundle(root, first), data).status, "unchanged");
    assert.equal(readPublished("2027", data).sessions[0]?.title, "New title");
    const conflict = structuredClone(first); conflict.graph.sessions[0]!.title = "Conflict";
    assert.throws(() => importLocalBundle(bundle(root, conflict), data), /different content/);
    const stale = structuredClone(newer); stale.revision = 4; stale.expectedRevision = 2;
    assert.throws(() => importLocalBundle(bundle(root, stale), data), /stale/);
    const privateInput = { ...newer, revision: 4, expectedRevision: 3, privateDrafts: [] };
    assert.throws(() => importLocalBundle(bundle(root, privateInput), data));
    const broken = structuredClone(newer); broken.revision = 4; broken.expectedRevision = 3; broken.graph.sessions[0]!.hostIds = ["mc-only"];
    assert.throws(() => importLocalBundle(bundle(root, broken), data), /participants/);
    const crossTrack = structuredClone(newer); crossTrack.revision = 4; crossTrack.expectedRevision = 3; crossTrack.graph.tracks[0]!.programmeId = "empty-programme";
    assert.throws(() => importLocalBundle(bundle(root, crossTrack), data), /slot programme/);
    assert.equal(readPublished("2027", data).sessions[0]?.title, "New title");
    const replacement = { ...newer, revision: 4, expectedRevision: 3, graph: emptyPublicationGraph(), assets: [] };
    assert.equal(importLocalBundle(bundle(root, replacement), data).status, "published");
    assert.deepEqual(readPublished("2027", data).sessions, []);
    assert.deepEqual(readPublicAsset(hash, data)?.bytes, image);
    assert.equal(lookupPublicAsset("../site.sqlite", data), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects mismatched bytes and bundle traversal before publication", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-assets-"));
  const data = join(root, "data");
  try {
    initializeEdition("2027", "reviewed-local", data);
    const input = fixture();
    const bundleRoot = join(root, "bundle");
    mkdirSync(bundleRoot);
    const file = bundle(bundleRoot, input);
    writeFileSync(join(bundleRoot, "portrait.svg"), "corrupt");
    assert.throws(() => importLocalBundle(file, data), /checksum/);
    input.assets[0]!.file = "../outside.svg";
    writeFileSync(join(root, "outside.svg"), image);
    assert.throws(() => importLocalBundle(bundle(bundleRoot, input), data), /inside/);
    assert.deepEqual(readPublished("2027", data).agenda, { days: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects migration tampering and rolls back unsupported migration state", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-migration-"));
  try {
    initializeEdition("2027", "reviewed-local", root);
    migrate(root);
    const db = openSiteDatabase(root);
    try { db.prepare("UPDATE schema_migrations SET checksum=?").run("bad"); } finally { db.close(); }
    assert.throws(() => openSiteDatabase(root), /checksum/);
    assert.throws(() => migrate(root), /checksum/);
    const raw = new DatabaseSync(join(root, "site.sqlite"));
    try { assert.equal(raw.prepare("SELECT checksum FROM schema_migrations").get()?.checksum, "bad"); assert.equal(raw.prepare("SELECT revision FROM programme_snapshots").get()?.revision, 1); }
    finally { raw.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("backs up immutable records and bytes, restores into a new directory, and invalidates account state", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-recovery-"));
  const data = join(root, "data"); const saved = join(root, "backup"); const restored = join(root, "restored");
  try {
    initializeEdition("2027", "reviewed-local", data);
    importLocalBundle(bundle(root, fixture()), data);
    const db = openSiteDatabase(data);
    try {
      db.prepare("INSERT INTO site_accounts VALUES (?, ?)").run("wts-user", 1000);
      db.prepare("INSERT INTO oidc_bindings VALUES (?, ?, ?, ?)").run("https://issuer.test", "subject", "wts-user", 1000);
      db.prepare("INSERT INTO site_sessions VALUES (?, ?, ?, ?, ?, ?)").run("session", "https://issuer.test", "subject", "ciphertext", 1000, 2000);
      db.prepare("INSERT INTO oidc_flows VALUES (?, ?, ?, ?, ?)").run("flow", "browser", "ciphertext", "/user", 2000);
    } finally { db.close(); }
    setEditionRole("2027", "wts-user", true, data);
    await backup(saved, data);
    const replacement = { ...fixture(), revision: 3, expectedRevision: 2, graph: emptyPublicationGraph(), assets: [] };
    importLocalBundle(bundle(root, replacement), data);
    restore(saved, restored);
    assert.equal(readPublished("2027", restored).sessions[0]?.title, "Systems");
    assert.deepEqual(readPublicAsset(hash, restored)?.bytes, image);
    const recovered = openSiteDatabase(restored);
    try {
      assert.equal(recovered.prepare("SELECT count(*) AS count FROM site_sessions").get()?.count, 0);
      assert.equal(recovered.prepare("SELECT count(*) AS count FROM oidc_flows").get()?.count, 0);
      assert.deepEqual({ ...recovered.prepare("SELECT wts_user_id, role, enabled FROM edition_roles").get() }, { wts_user_id: "wts-user", role: "admin", enabled: 0 });
      assert.equal(recovered.prepare("SELECT wts_user_id FROM oidc_bindings").get()?.wts_user_id, "wts-user");
    } finally { recovered.close(); }
    assert.throws(() => restore(saved, data), /EEXIST/);
    assert.deepEqual(readPublished("2027", data).agenda, { days: [] });
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `import {readPublished} from ${JSON.stringify(new URL("./public-content.ts", import.meta.url).href)}; console.log(readPublished('2027', ${JSON.stringify(restored)}).sessions[0].title)`], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), "Systems");
    chmodSync(join(saved, "assets", hash), 0o600); writeFileSync(join(saved, "assets", hash), "corrupt");
    assert.throws(() => restore(saved, join(root, "bad-restore")), /checksum/);
    assert.equal(existsSync(join(root, "bad-restore")), false);
    assert.equal(readFileSync(join(restored, "assets", hash), "utf8"), image.toString());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("validates live checksums before producing any backup", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-live-validation-"));
  const data = join(root, "data"); const destination = join(root, "backup");
  try {
    initializeEdition("2027", "reviewed-local", data);
    importLocalBundle(bundle(root, fixture()), data);
    const db = openSiteDatabase(data);
    try { db.prepare("UPDATE publication_receipts SET checksum=? WHERE revision=2").run("0".repeat(64)); }
    finally { db.close(); }
    await assert.rejects(backup(destination, data), /receipt/);
    assert.equal(existsSync(destination), false);
    assert.equal(readPublished("2027", data).sessions[0]?.title, "Systems");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
