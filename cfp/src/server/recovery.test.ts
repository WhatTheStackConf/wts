import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { VerifiedCfpAccount } from "../lib/account-model.ts";
import { getApplication, getDraft, getWorkspace, saveApplicant, saveDraft, startDraft, submitDraft } from "./applicants.ts";
import { backup, initializeEdition, openCfpDatabase, restore, setCfpOpen } from "./storage.ts";

const account: VerifiedCfpAccount = {
  wtsUserId: "recovery-user", email: "recovery@example.test", emailVerified: true, accountUrl: "https://identity.example.test/account",
  profile: { version: 1, wtsUserId: "recovery-user", name: "Recovery User", avatarUrl: null, preferredLanguage: null, username: "recovery", emailVisibility: false, revision: 1 },
};

test("online backup and new-directory restore preserve applicant work but clear authentication and close every edition", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-recovery-"));
  const data = join(root, "data"); const saved = join(root, "backup"); const restored = join(root, "restored");
  const oldDir = process.env.CFP_DATA_DIR; const oldEdition = process.env.CFP_EDITION_ID; const oldOrigin = process.env.CFP_ORIGIN;
  process.env.CFP_DATA_DIR = data; process.env.CFP_EDITION_ID = "2027"; process.env.CFP_ORIGIN = "https://cfp.acceptance.localhost";
  t.after(() => {
    if (oldDir === undefined) delete process.env.CFP_DATA_DIR; else process.env.CFP_DATA_DIR = oldDir;
    if (oldEdition === undefined) delete process.env.CFP_EDITION_ID; else process.env.CFP_EDITION_ID = oldEdition;
    if (oldOrigin === undefined) delete process.env.CFP_ORIGIN; else process.env.CFP_ORIGIN = oldOrigin;
    rmSync(root, { recursive: true, force: true });
  });
  initializeEdition("2027"); setCfpOpen("2027", true); initializeEdition("2028"); setCfpOpen("2028", true);
  const initial = getWorkspace(account);
  saveApplicant(account, {
    speaker: { expectedRevision: initial.speaker.revision, changes: { bio: "Recovery bio", previousTalks: "Recovered talk" } },
    settings: { expectedRevision: initial.settings.revision, changes: { companyCoverExpenses: "Yes", preferredContactMethod: "Email" } },
  });
  const draft = startDraft(account, { requestId: randomUUID(), intent: { kind: "new" } });
  const ready = saveDraft(account, { draftId: draft.draft.id, expectedDraftRevision: 1, presentation: { title: "Recovered application", abstract: "<p>Recovery abstract</p>", keyTakeaways: "<p>Recovery takeaway</p>" } });
  const command = { draftId: ready.draft.id, expected: { draft: ready.draft.revision, speaker: ready.speaker.revision, settings: ready.settings.revision } };
  const receipt = submitDraft(account, command);
  const active = startDraft(account, { requestId: randomUUID(), intent: { kind: "edit", applicationId: receipt.applicationId, expectedRevision: 1 } });
  const activeSaved = saveDraft(account, { draftId: active.draft.id, expectedDraftRevision: 1, presentation: { title: "Private recovery edit" } });
  const originalApplication = getApplication(account, receipt.applicationId);
  const source = openCfpDatabase(data);
  try {
    source.prepare("INSERT INTO oidc_bindings VALUES (?, ?, ?, ?)").run("https://identity.example.test", "recovery-subject", account.wtsUserId, 1);
    source.prepare("INSERT INTO cfp_sessions VALUES (?, ?, ?, ?, ?, ?)").run("session", "https://identity.example.test", "recovery-subject", "encrypted-token", 1, 2);
    source.prepare("INSERT INTO oidc_flows VALUES (?, ?, ?, ?, ?)").run("state", "browser", "encrypted-flow", "/applications", 2);
    await backup(saved, data);
    await restore(saved, restored);
    assert.equal(source.prepare("SELECT count(*) AS count FROM cfp_sessions").get()?.count, 1);
    assert.equal(source.prepare("SELECT cfp_open FROM editions WHERE edition_id='2027'").get()?.cfp_open, 1);
  } finally { source.close(); }
  process.env.CFP_DATA_DIR = restored;
  const recovered = getApplication(account, receipt.applicationId);
  assert.deepEqual(recovered, { ...originalApplication, cfpOpen: false });
  assert.deepEqual(getDraft(account, active.draft.id), { ...activeSaved, cfpOpen: false });
  assert.deepEqual(submitDraft(account, command), receipt);
  const db = openCfpDatabase(restored);
  try {
    assert.equal(db.prepare("SELECT count(*) AS count FROM cfp_sessions").get()?.count, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM oidc_flows").get()?.count, 0);
    assert.equal(db.prepare("SELECT wts_user_id FROM oidc_bindings WHERE subject='recovery-subject'").get()?.wts_user_id, "recovery-user");
    assert.deepEqual(db.prepare("SELECT edition_id, cfp_open FROM editions ORDER BY edition_id").all().map((row) => ({ ...row })), [{ edition_id: "2027", cfp_open: 0 }, { edition_id: "2028", cfp_open: 0 }]);
    assert.throws(() => db.exec("UPDATE submission_receipts SET receipt_json='{}'"), /immutable/);
  } finally { db.close(); }
  const before = readFileSync(join(restored, "cfp.sqlite"));
  await assert.rejects(restore(saved, restored), /new directory/);
  assert.deepEqual(readFileSync(join(restored, "cfp.sqlite")), before);
  await assert.rejects(backup(saved, data), /EEXIST/);
  assert.equal(getApplication(account, receipt.applicationId).application.presentation.title, "Recovered application");
});

test("restore rejects incomplete, altered, and sidecar-bearing backups before it creates the target", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-corrupt-recovery-"));
  const data = join(root, "data"); const saved = join(root, "backup"); const target = join(root, "target");
  try {
    initializeEdition("2027", data); await backup(saved, data);
    const manifestPath = join(saved, "manifest.json"); const manifest = readFileSync(manifestPath);
    rmSync(manifestPath);
    await assert.rejects(restore(saved, target), /ENOENT/);
    assert.equal(existsSync(target), false);
    writeFileSync(manifestPath, manifest);
    const dbPath = join(saved, "cfp.sqlite"); const bytes = readFileSync(dbPath);
    writeFileSync(dbPath, "invalid SQLite");
    await assert.rejects(restore(saved, target), /checksum/);
    assert.equal(existsSync(target), false);
    writeFileSync(dbPath, bytes); writeFileSync(`${dbPath}-wal`, "unverified");
    await assert.rejects(restore(saved, target), /sidecar/);
    assert.equal(existsSync(target), false);
    rmSync(`${dbPath}-wal`);
    await restore(saved, target);
    const db = openCfpDatabase(target);
    try { assert.equal(db.prepare("SELECT cfp_open FROM editions WHERE edition_id='2027'").get()?.cfp_open, 0); }
    finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("backup rejects altered migration metadata without creating a backup directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-corrupt-backup-"));
  const data = join(root, "data"); const saved = join(root, "backup");
  try {
    initializeEdition("2027", data); const db = openCfpDatabase(data);
    try { db.prepare("UPDATE schema_migrations SET checksum=? WHERE version=1").run("0".repeat(64)); }
    finally { db.close(); }
    await assert.rejects(backup(saved, data), /migration checksum/);
    assert.equal(existsSync(saved), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
