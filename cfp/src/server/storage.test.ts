import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initializeEdition, migrate, openCfpDatabase, setCfpOpen } from "./storage.ts";

test("explicit migration and edition initialization preserve a closed gate until an operator opens it", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-storage-"));
  try {
    const data = join(root, "data");
    assert.throws(() => openCfpDatabase(data), /ENOENT/);
    migrate(data); migrate(data); initializeEdition("2027", data);
    let db = openCfpDatabase(data);
    try {
      assert.equal(db.prepare("SELECT cfp_open FROM editions WHERE edition_id='2027'").get()?.cfp_open, 0);
      assert.equal(db.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
      assert.equal(db.prepare("PRAGMA synchronous").get()?.synchronous, 2);
      assert.equal(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
    } finally { db.close(); }
    setCfpOpen("2027", true, data); initializeEdition("2027", data);
    db = openCfpDatabase(data);
    try { assert.equal(db.prepare("SELECT cfp_open FROM editions WHERE edition_id='2027'").get()?.cfp_open, 1); }
    finally { db.close(); }
    setCfpOpen("2027", false, data);
    db = openCfpDatabase(data);
    try { assert.equal(db.prepare("SELECT cfp_open FROM editions WHERE edition_id='2027'").get()?.cfp_open, 0); }
    finally { db.close(); }
    assert.throws(() => setCfpOpen("2028", true, data), /Initialize/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("opening and migrating reject altered checksums, unsupported versions, and removed schema guards", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-schema-"));
  try {
    for (const [name, sql, message] of [
      ["checksum", "UPDATE schema_migrations SET checksum='wrong'", /migration checksum/],
      ["version", "PRAGMA user_version=2", /schema version/],
      ["guard", "DROP TRIGGER receipts_no_update", /unsupported schema/],
    ] as const) {
      const data = join(root, name); migrate(data);
      const db = openCfpDatabase(data);
      try { db.exec(sql); } finally { db.close(); }
      assert.throws(() => openCfpDatabase(data), message);
      assert.throws(() => migrate(data), message);
    }
    const unknownDir = mkdtempSync(join(root, "unrelated-"));
    const db = new DatabaseSync(join(unknownDir, "cfp.sqlite"));
    try { db.exec("CREATE TABLE unrelated(id INTEGER)"); } finally { db.close(); }
    assert.throws(() => migrate(unknownDir), /unsupported schema/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("identity bindings are immutable and session ownership requires a valid account binding", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-binding-"));
  try {
    migrate(root); const db = openCfpDatabase(root);
    try {
      db.prepare("INSERT INTO cfp_accounts VALUES (?, ?)").run("alice", 1);
      db.prepare("INSERT INTO oidc_bindings VALUES (?, ?, ?, ?)").run("https://identity.example.test", "alice-subject", "alice", 1);
      db.prepare("INSERT INTO cfp_sessions VALUES (?, ?, ?, ?, ?, ?)").run("session", "https://identity.example.test", "alice-subject", "encrypted", 1, 2);
      assert.equal(db.prepare("SELECT b.wts_user_id FROM cfp_sessions s JOIN oidc_bindings b ON b.issuer=s.issuer AND b.subject=s.subject WHERE s.session_hash='session'").get()?.wts_user_id, "alice");
      assert.throws(() => db.exec("UPDATE oidc_bindings SET subject='other'"), /immutable/);
      assert.throws(() => db.exec("DELETE FROM oidc_bindings"), /immutable/);
      assert.throws(() => db.prepare("INSERT INTO oidc_bindings VALUES (?, ?, ?, ?)").run("https://identity.example.test", "second-subject", "alice", 1), /UNIQUE/);
      assert.throws(() => db.prepare("INSERT INTO cfp_sessions VALUES (?, ?, ?, ?, ?, ?)").run("foreign", "https://identity.example.test", "missing", "encrypted", 1, 2), /FOREIGN KEY/);
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
