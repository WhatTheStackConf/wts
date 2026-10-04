import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migration as initial } from "../../migrations/001-initial.ts";
import { migration as staff } from "../../migrations/002-staff.ts";
import type { VerifiedCfpAccount } from "../lib/account-model.ts";
import { getApplication, submitDraft } from "./applicants.ts";
import { bootstrapAdmin, getAdminProposal, getAdminWorkspace } from "./staff.ts";
import { migrate, openCfpDatabase, restore } from "./storage.ts";

const actor: VerifiedCfpAccount = { wtsUserId: "old-applicant", email: "current@example.test", emailVerified: true, accountUrl: "https://identity.example.test/account", profile: { version: 1, wtsUserId: "old-applicant", name: "Old Applicant", avatarUrl: null, preferredLanguage: null, username: "old-applicant", emailVisibility: false, revision: 1 } };
const oldPresentation = { title: "Original submission", abstract: "<p>Original</p>", keyTakeaways: "<p>Original takeaway</p>", technicalRequirements: "", previousPresentation: "", organizerNotes: "Private old note", additionalInfo: "" };
function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function oldDatabase(root: string, version: 1 | 2) {
  mkdirSync(root, { mode: 0o700 }); const db = new DatabaseSync(join(root, "cfp.sqlite"));
  const id = randomUUID(); const firstDraft = randomUUID(); const secondDraft = randomUUID(); const witness = { draft: 2, speaker: 1, settings: 1 };
  const firstReceipt = { applicationId: id, applicationRevision: 1, operation: "created" as const, committedAt: 100 };
  const secondReceipt = { applicationId: id, applicationRevision: 2, operation: "updated" as const, committedAt: 200 };
  const current = { ...oldPresentation, title: "Updated submission" };
  try {
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,installed_at INTEGER NOT NULL) STRICT"); db.exec(initial.sql);
    db.prepare("INSERT INTO schema_migrations VALUES (1,?,?,1)").run(initial.name, hash(initial.sql)); db.exec("PRAGMA user_version=1");
    db.prepare("INSERT INTO editions VALUES ('2027',1,1)").run(); db.prepare("INSERT INTO cfp_accounts VALUES (?,1)").run(actor.wtsUserId);
    db.prepare("INSERT INTO oidc_bindings VALUES ('https://identity.example.test','old-sub',?,1)").run(actor.wtsUserId);
    db.prepare("INSERT INTO speaker_profiles VALUES (?,1,?)").run(actor.wtsUserId, JSON.stringify({ fullName: "Old Applicant", affiliation: "", bio: "Old bio", socialHandles: [], previousTalks: "" }));
    db.prepare("INSERT INTO applicant_settings VALUES (?,1,?)").run(actor.wtsUserId, JSON.stringify({ preferredContactMethod: "Email", companyCoverExpenses: "No" }));
    db.prepare("INSERT INTO applications VALUES (?,?,?,2,'pending',?,100,200)").run(id, "2027", actor.wtsUserId, JSON.stringify(current));
    for (const [draftId, purpose, receipt, presentation] of [[firstDraft, { kind: "new" }, firstReceipt, oldPresentation], [secondDraft, { kind: "edit", targetId: id, targetRevision: 1 }, secondReceipt, current]] as const) {
      db.prepare("INSERT INTO drafts VALUES (?,?,?,?,?,?,3,'committed',?,1,?)").run(draftId, "2027", actor.wtsUserId, randomUUID(), JSON.stringify({ kind: "new" }), JSON.stringify(purpose), JSON.stringify(presentation), receipt.committedAt);
      db.prepare("INSERT INTO submission_receipts VALUES (?,?,?,?,?,?)").run(draftId, "2027", actor.wtsUserId, id, JSON.stringify(witness), JSON.stringify(receipt, null, 2));
    }
    if (version === 2) { db.exec(staff.sql); db.prepare("INSERT INTO schema_migrations VALUES (2,?,?,2)").run(staff.name, hash(staff.sql)); db.exec("PRAGMA user_version=2"); }
  } finally { db.close(); }
  const bytes = readFileSync(join(root, "cfp.sqlite")); writeFileSync(join(root, "manifest.json"), JSON.stringify({ schemaVersion: version, databaseSha256: hash(bytes) }));
  return { id, firstDraft, secondDraft, witness, firstReceipt, secondReceipt, bytes };
}

for (const version of [1, 2] as const) {
  test(`schema-${version} backup restores only into the target and preserves historical receipt replay`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "wts-cfp-old-backup-")); const source = join(root, "backup"); const target = join(root, "restored");
    const prior = { dir: process.env.CFP_DATA_DIR, edition: process.env.CFP_EDITION_ID, origin: process.env.CFP_ORIGIN };
    t.after(() => { if (prior.dir === undefined) delete process.env.CFP_DATA_DIR; else process.env.CFP_DATA_DIR = prior.dir; if (prior.edition === undefined) delete process.env.CFP_EDITION_ID; else process.env.CFP_EDITION_ID = prior.edition; if (prior.origin === undefined) delete process.env.CFP_ORIGIN; else process.env.CFP_ORIGIN = prior.origin; rmSync(root, { recursive: true, force: true }); });
    const old = oldDatabase(source, version); await restore(source, target); assert.deepEqual(readFileSync(join(source, "cfp.sqlite")), old.bytes);
    process.env.CFP_DATA_DIR = target; process.env.CFP_EDITION_ID = "2027"; process.env.CFP_ORIGIN = "https://cfp.acceptance.localhost";
    assert.deepEqual(submitDraft(actor, { draftId: old.firstDraft, expected: old.witness }), old.firstReceipt); assert.deepEqual(submitDraft(actor, { draftId: old.secondDraft, expected: old.witness }), old.secondReceipt);
    assert.equal(getApplication(actor, old.id).application.presentation.title, "Updated submission"); assert.equal(getApplication(actor, old.id).cfpOpen, false);
    bootstrapAdmin("2027", actor.wtsUserId); const proposal = getAdminProposal(actor, old.id);
    assert.equal(proposal.presentationRevision, 2); assert.deepEqual(proposal.applicant.contact, { kind: "unavailable" }); assert.equal(getAdminWorkspace(actor).mail.queued, 0);
    const db = openCfpDatabase(); try {
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 3);
      assert.equal(db.prepare("SELECT receipt_json FROM submission_receipts WHERE draft_id=?").get(old.firstDraft)?.receipt_json, JSON.stringify(old.firstReceipt, null, 2));
      assert.equal(db.prepare("SELECT presentation_json FROM application_presentation_versions WHERE application_id=? AND presentation_revision=1").get(old.id)?.presentation_json, JSON.stringify(oldPresentation));
    } finally { db.close(); }
  });
}

test("migration rejects missing and inconsistent committed sources without upgrading the original schema", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-invalid-backfill-"));
  try {
    for (const fault of ["missing", "mismatch"]) {
      const data = join(root, fault); const old = oldDatabase(data, 1); const db = new DatabaseSync(join(data, "cfp.sqlite"));
      try {
        if (fault === "missing") db.prepare("UPDATE drafts SET state='active' WHERE draft_id=?").run(old.secondDraft);
        else db.prepare("UPDATE applications SET presentation_json=? WHERE application_id=?").run(JSON.stringify({ ...oldPresentation, title: "Uncommitted value" }), old.id);
      } finally { db.close(); }
      assert.throws(() => migrate(data), fault === "missing" ? /draft commit state/ : /current presentation pointer/);
      const after = new DatabaseSync(join(data, "cfp.sqlite")); try { assert.equal(after.prepare("PRAGMA user_version").get()?.user_version, 1); } finally { after.close(); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("restore rejects a manifest/schema mismatch and unknown schema objects before creating a target", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-schema-backup-"));
  try {
    const source = join(root, "backup"); oldDatabase(source, 1); const target = join(root, "target");
    let bytes = readFileSync(join(source, "cfp.sqlite")); writeFileSync(join(source, "manifest.json"), JSON.stringify({ schemaVersion: 2, databaseSha256: hash(bytes) }));
    await assert.rejects(restore(source, target), /migration/); assert.equal(existsSync(target), false);
    const db = new DatabaseSync(join(source, "cfp.sqlite")); try { db.exec("CREATE TABLE unexpected(id TEXT) STRICT"); } finally { db.close(); }
    bytes = readFileSync(join(source, "cfp.sqlite")); writeFileSync(join(source, "manifest.json"), JSON.stringify({ schemaVersion: 1, databaseSha256: hash(bytes) }));
    await assert.rejects(restore(source, target), /unsupported schema/); assert.equal(existsSync(target), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
