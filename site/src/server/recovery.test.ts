import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, closeSync, existsSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { backup, importLocalBundle, initializeEdition, openSiteDatabase, restore, sha256 } from "./storage.ts";
import { readPublished } from "./public-content.ts";
import { readPublicAsset } from "./public-assets.ts";
import { emptyPublicationGraph } from "../lib/publication-schema.ts";

test("rejects missing, corrupt, and altered backup files without touching the destination", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-corrupt-backup-"));
  const data = join(root, "data"); const saved = join(root, "backup"); const target = join(root, "restored");
  try {
    initializeEdition("2027", "reviewed-local", data);
    await backup(saved, data);
    const original = readFileSync(join(saved, "manifest.json"));
    rmSync(join(saved, "manifest.json"));
    assert.throws(() => restore(saved, target), /ENOENT/);
    assert.equal(existsSync(target), false);
    writeFileSync(join(saved, "manifest.json"), original);
    const bytes = readFileSync(join(saved, "site.sqlite"));
    writeFileSync(join(saved, "site.sqlite"), "not SQLite");
    assert.throws(() => restore(saved, target), /checksum/);
    assert.equal(existsSync(target), false);
    writeFileSync(join(saved, "site.sqlite"), bytes);
    writeFileSync(join(saved, "site.sqlite-wal"), "unverified sidecar");
    assert.throws(() => restore(saved, target), /sidecar/);
    rmSync(join(saved, "site.sqlite-wal"));
    restore(saved, target);
    assert.deepEqual(readPublished("2027", target).agenda, { days: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("checks live asset bytes before creating a backup and rejects corrupt assets during reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-corrupt-live-"));
  const data = join(root, "data"); const saved = join(root, "backup");
  try {
    initializeEdition("2027", "reviewed-local", data);
    const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
    const id = sha256(image);
    writeFileSync(join(root, "logo.svg"), image);
    const graph = emptyPublicationGraph();
    graph.partners.push({ id: "partner", name: "Reviewed", logoAssetId: id, logoSurface: "dark", type: "organizer" });
    writeFileSync(join(root, "bundle.json"), JSON.stringify({ schemaVersion: 1, editionId: "2027", sourceNamespace: "reviewed-local", revision: 2, expectedRevision: 1, graph, assets: [{ id, sha256: id, mediaType: "image/svg+xml", byteLength: image.byteLength, file: "logo.svg" }] }));
    importLocalBundle(join(root, "bundle.json"), data);
    assert.equal(readPublished("2027", data).partnerGroups[0]?.partners[0]?.name, "Reviewed");
    chmodSync(join(data, "assets", id), 0o600);
    writeFileSync(join(data, "assets", id), "corrupt");
    assert.throws(() => readPublicAsset(id, data), /checksum/);
    await assert.rejects(backup(saved, data), /checksum/);
    assert.equal(existsSync(saved), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects a tampered installed migration in live backup validation", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-corrupt-live-schema-"));
  const data = join(root, "data"); const saved = join(root, "backup");
  try {
    initializeEdition("2027", "reviewed-local", data);
    const db = openSiteDatabase(data);
    try { db.prepare("UPDATE schema_migrations SET checksum=? WHERE version=1").run("0".repeat(64)); }
    finally { db.close(); }
    await assert.rejects(backup(saved, data), /migration checksum/);
    assert.equal(existsSync(saved), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects an oversized local bundle before parsing it or changing the active publication", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-oversized-bundle-"));
  const data = join(root, "data");
  const file = join(root, "oversized.json");
  try {
    initializeEdition("2027", "reviewed-local", data);
    const before = readPublished("2027", data);
    const fd = openSync(file, "wx");
    try { ftruncateSync(fd, 16 * 1024 * 1024 + 1); } finally { closeSync(fd); }
    assert.throws(() => importLocalBundle(file, data), /within 16 MiB/);
    assert.deepEqual(readPublished("2027", data), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
