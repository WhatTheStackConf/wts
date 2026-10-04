import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { VerifiedCfpAccount } from "../lib/account-model.ts";
import { CfpError, type DraftView, type Presentation, type SubmitDraftCommand } from "../lib/cfp-model.ts";
import { getApplication, getCfpStatus, getDraft, getWorkspace, saveApplicant, saveDraft, startDraft, submitDraft } from "./applicants.ts";
import { initializeEdition, openCfpDatabase, setCfpOpen } from "./storage.ts";

const alice: VerifiedCfpAccount = {
  wtsUserId: "alice", email: "alice@example.test", emailVerified: true, accountUrl: "https://identity.example.test/account",
  profile: { version: 1, wtsUserId: "alice", name: "Alice Initial", avatarUrl: null, preferredLanguage: null, username: "alice", emailVisibility: false, revision: 1 },
};
const bob: VerifiedCfpAccount = { ...alice, wtsUserId: "bob", email: "bob@example.test", profile: { ...alice.profile, wtsUserId: "bob", name: "Bob", username: "bob" } };
const blank = { title: "", abstract: "", keyTakeaways: "", technicalRequirements: "", previousPresentation: "", organizerNotes: "", additionalInfo: "" };
const proposal: Presentation = { title: "SQLite under load", abstract: "<p>A practical <strong>database</strong> session.</p>", keyTakeaways: "<ul><li>Design safe transactions.</li></ul>", technicalRequirements: "HDMI", previousPresentation: "Never", organizerNotes: "Private note", additionalInfo: "Workshop" };
function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-domain-"));
  const oldDir = process.env.CFP_DATA_DIR; const oldEdition = process.env.CFP_EDITION_ID; const oldOrigin = process.env.CFP_ORIGIN;
  process.env.CFP_DATA_DIR = root; process.env.CFP_EDITION_ID = "2027"; process.env.CFP_ORIGIN = "https://cfp.acceptance.localhost";
  t.mock.method(Date, "now", () => 1_800_000_000_000);
  t.after(() => {
    if (oldDir === undefined) delete process.env.CFP_DATA_DIR; else process.env.CFP_DATA_DIR = oldDir;
    if (oldEdition === undefined) delete process.env.CFP_EDITION_ID; else process.env.CFP_EDITION_ID = oldEdition;
    if (oldOrigin === undefined) delete process.env.CFP_ORIGIN; else process.env.CFP_ORIGIN = oldOrigin;
    rmSync(root, { recursive: true, force: true });
  });
  initializeEdition("2027"); setCfpOpen("2027", true);
  return root;
}
function completeApplicant(): void {
  const view = getWorkspace(alice);
  saveApplicant(alice, {
    speaker: { expectedRevision: view.speaker.revision, changes: { fullName: "Alice Saved", bio: "Systems engineer", affiliation: "WTS", socialHandles: ["@alice"], previousTalks: "Transactions 2026" } },
    settings: { expectedRevision: view.settings.revision, changes: { preferredContactMethod: "Email", companyCoverExpenses: "Other" } },
  });
}
function ready(title = proposal.title): DraftView {
  const draft = startDraft(alice, { requestId: randomUUID(), intent: { kind: "new" } });
  return saveDraft(alice, { draftId: draft.draft.id, expectedDraftRevision: draft.draft.revision, presentation: { ...proposal, title } });
}
function command(view: DraftView): SubmitDraftCommand {
  return { draftId: view.draft.id, expected: { draft: view.draft.revision, speaker: view.speaker.revision, settings: view.settings.revision } };
}
function fails(code: CfpError["code"], action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof CfpError && error.code === code);
}

test("two applications share saved speaker and settings while each fresh presentation is blank", (t) => {
  fixture(t);
  assert.equal(getWorkspace(alice).speaker.value.fullName, "Alice Initial");
  completeApplicant();
  const first = ready("First session"); const firstReceipt = submitDraft(alice, command(first));
  const changedIdentity = { ...alice, email: "new@example.test", profile: { ...alice.profile, name: "Central Changed" } };
  const fresh = startDraft(changedIdentity, { requestId: randomUUID(), intent: { kind: "new" } });
  assert.deepEqual(fresh.draft.state, { kind: "active", presentation: blank });
  assert.deepEqual(fresh.speaker.value, { fullName: "Alice Saved", bio: "Systems engineer", affiliation: "WTS", socialHandles: ["@alice"], previousTalks: "Transactions 2026" });
  assert.deepEqual(fresh.settings.value, { preferredContactMethod: "Email", companyCoverExpenses: "Other" });
  assert.equal(getDraft(changedIdentity, fresh.draft.id).email, "new@example.test");
  assert.deepEqual(getDraft(alice, first.draft.id).draft.state, { kind: "committed", receipt: firstReceipt });
  const second = saveDraft(alice, { draftId: fresh.draft.id, expectedDraftRevision: 1, presentation: { ...proposal, title: "Second session" } });
  const secondReceipt = submitDraft(alice, command(second));
  saveApplicant(alice, { speaker: { expectedRevision: second.speaker.revision, changes: { fullName: "Alice Updated" } } });
  assert.equal(getApplication(alice, firstReceipt.applicationId).speaker.value.fullName, "Alice Updated");
  assert.equal(getApplication(alice, secondReceipt.applicationId).speaker.value.fullName, "Alice Updated");
  assert.equal(getApplication(alice, firstReceipt.applicationId).application.presentation.title, "First session");
  assert.equal(getApplication(alice, secondReceipt.applicationId).application.presentation.title, "Second session");
  assert.deepEqual(getWorkspace(alice).applications.map((value) => value.title).sort(), ["First session", "Second session"]);
});

test("missing and foreign records fail identically for reads, changes, and replay", (t) => {
  fixture(t); completeApplicant();
  const draft = ready(); const receipt = submitDraft(alice, command(draft));
  for (const actor of [bob, { ...bob, wtsUserId: "unprovisioned" }]) {
    fails("not_found", () => getDraft(actor, draft.draft.id));
    fails("not_found", () => getApplication(actor, receipt.applicationId));
    fails("not_found", () => getDraft(actor, randomUUID()));
    fails("not_found", () => saveDraft(actor, { draftId: draft.draft.id, expectedDraftRevision: 2, presentation: { title: "Stolen" } }));
    fails("not_found", () => submitDraft(actor, command(draft)));
    fails("not_found", () => startDraft(actor, { requestId: randomUUID(), intent: { kind: "edit", applicationId: receipt.applicationId, expectedRevision: 1 } }));
  }
  assert.equal(getApplication(alice, receipt.applicationId).application.presentation.title, "SQLite under load");
  assert.deepEqual(getWorkspace(bob).applications, []);
});

test("submission reports all required fields and preserves incomplete work", (t) => {
  fixture(t);
  const draft = startDraft(alice, { requestId: randomUUID(), intent: { kind: "new" } });
  assert.throws(() => submitDraft(alice, command(draft)), (error: unknown) => {
    if (!(error instanceof CfpError)) return false;
    assert.equal(error.code, "invalid_fields");
    assert.deepEqual(error.issues?.map((issue) => issue.field), ["speaker.bio", "settings.companyCoverExpenses", "presentation.title", "presentation.abstract", "presentation.keyTakeaways"]);
    return true;
  });
  assert.deepEqual(getDraft(alice, draft.draft.id).draft.state, { kind: "active", presentation: blank });
  assert.equal(getWorkspace(alice).drafts[0]?.id, draft.draft.id);
  assert.deepEqual(getWorkspace(alice).applications, []);
});

test("combined saves roll back all changes on stale witnesses and closure", (t) => {
  fixture(t); completeApplicant();
  const draft = ready();
  fails("conflict", () => saveDraft(alice, { draftId: draft.draft.id, expectedDraftRevision: 1, presentation: { title: "Stale change" }, applicant: { speaker: { expectedRevision: draft.speaker.revision, changes: { fullName: "Stale name" } } } }));
  fails("conflict", () => saveDraft(alice, { draftId: draft.draft.id, expectedDraftRevision: draft.draft.revision, presentation: { title: "Not saved" }, applicant: {
    speaker: { expectedRevision: draft.speaker.revision, changes: { fullName: "Not saved" } },
    settings: { expectedRevision: 1, changes: { companyCoverExpenses: "Yes" } },
  } }));
  assert.equal(getDraft(alice, draft.draft.id).draft.revision, 2);
  assert.deepEqual(getDraft(alice, draft.draft.id).draft.state, { kind: "active", presentation: proposal });
  assert.equal(getWorkspace(alice).speaker.value.fullName, "Alice Saved");
  saveApplicant(alice, { speaker: { expectedRevision: draft.speaker.revision, changes: { bio: "Updated bio" } } });
  fails("conflict", () => submitDraft(alice, command(draft)));
  setCfpOpen("2027", false);
  assert.deepEqual(getCfpStatus(), { editionId: "2027", cfpOpen: false });
  fails("cfp_closed", () => startDraft(alice, { requestId: randomUUID(), intent: { kind: "new" } }));
  fails("cfp_closed", () => saveDraft(alice, { draftId: draft.draft.id, expectedDraftRevision: 2, presentation: { title: "Closed change" }, applicant: { settings: { expectedRevision: draft.settings.revision, changes: { companyCoverExpenses: "Yes" } } } }));
  fails("cfp_closed", () => submitDraft(alice, command(getDraft(alice, draft.draft.id))));
  assert.equal(getWorkspace(alice).settings.value.companyCoverExpenses, "Other");
  assert.equal(saveApplicant(alice, { settings: { expectedRevision: draft.settings.revision, changes: { preferredContactMethod: "Signal" } } }).settings.value.preferredContactMethod, "Signal");
});

test("pending edit remains private, guards its target, and finalized reuse remains independent", (t) => {
  fixture(t); completeApplicant();
  const initial = ready(); const receipt = submitDraft(alice, command(initial));
  const intent = { kind: "edit" as const, applicationId: receipt.applicationId, expectedRevision: 1 };
  const first = startDraft(alice, { requestId: randomUUID(), intent });
  const competing = startDraft(alice, { requestId: randomUUID(), intent });
  const saved = saveDraft(alice, { draftId: first.draft.id, expectedDraftRevision: 1, presentation: { title: "Private edit" } });
  assert.equal(getApplication(alice, receipt.applicationId).application.presentation.title, "SQLite under load");
  const edited = submitDraft(alice, command(saved));
  assert.deepEqual(edited, { applicationId: receipt.applicationId, applicationRevision: 2, operation: "updated", committedAt: 1_800_000_000_000 });
  assert.equal(getApplication(alice, receipt.applicationId).application.presentation.title, "Private edit");
  fails("conflict", () => submitDraft(alice, command(competing)));
  const finalEdit = startDraft(alice, { requestId: randomUUID(), intent: { ...intent, expectedRevision: 2 } });
  const db = openCfpDatabase();
  try { db.prepare("UPDATE applications SET status='accepted', revision=revision+1 WHERE application_id=?").run(receipt.applicationId); }
  finally { db.close(); }
  fails("finalized", () => submitDraft(alice, command(finalEdit)));
  fails("finalized", () => saveDraft(alice, { draftId: finalEdit.draft.id, expectedDraftRevision: 1, presentation: { title: "Invalid" } }));
  fails("finalized", () => startDraft(alice, { requestId: randomUUID(), intent: { ...intent, expectedRevision: 3 } }));
  const reused = startDraft(alice, { requestId: randomUUID(), intent: { kind: "reuse", applicationId: receipt.applicationId } });
  assert.equal(reused.draft.state.kind, "active");
  if (reused.draft.state.kind !== "active") assert.fail("Expected an active reuse draft.");
  assert.equal(reused.draft.state.presentation.title, "Private edit");
  const independent = saveDraft(alice, { draftId: reused.draft.id, expectedDraftRevision: 1, presentation: { title: "Reused session" } });
  const reuseReceipt = submitDraft(alice, command(independent));
  assert.notEqual(reuseReceipt.applicationId, receipt.applicationId);
  assert.equal(getApplication(alice, receipt.applicationId).application.presentation.title, "Private edit");
  assert.equal(getApplication(alice, reuseReceipt.applicationId).application.presentation.title, "Reused session");
});

test("start keys bind intent and exact submit replay returns the original durable receipt after closure", (t) => {
  fixture(t); completeApplicant();
  const start = { requestId: randomUUID(), intent: { kind: "new" as const } };
  const draft = startDraft(alice, start);
  assert.equal(startDraft(alice, start).draft.id, draft.draft.id);
  const otherOwner = startDraft(bob, start);
  assert.notEqual(otherOwner.draft.id, draft.draft.id);
  assert.deepEqual(otherOwner.draft.state, { kind: "active", presentation: blank });
  initializeEdition("2028"); setCfpOpen("2028", true);
  process.env.CFP_EDITION_ID = "2028";
  const otherEdition = startDraft(alice, start);
  assert.notEqual(otherEdition.draft.id, draft.draft.id);
  assert.deepEqual(otherEdition.draft.state, { kind: "active", presentation: blank });
  fails("not_found", () => getDraft(alice, draft.draft.id));
  process.env.CFP_EDITION_ID = "2027";
  const saved = saveDraft(alice, { draftId: draft.draft.id, expectedDraftRevision: 1, presentation: proposal });
  const submit = command(saved); const receipt = submitDraft(alice, submit);
  const edit = startDraft(alice, { requestId: randomUUID(), intent: { kind: "edit", applicationId: receipt.applicationId, expectedRevision: 1 } });
  submitDraft(alice, command(saveDraft(alice, { draftId: edit.draft.id, expectedDraftRevision: 1, presentation: { title: "Later update" } })));
  const db = openCfpDatabase();
  try { db.prepare("UPDATE applications SET status='rejected', revision=revision+1 WHERE application_id=?").run(receipt.applicationId); }
  finally { db.close(); }
  saveApplicant(alice, { settings: { expectedRevision: saved.settings.revision, changes: { companyCoverExpenses: "No" } } });
  setCfpOpen("2027", false);
  assert.deepEqual(submitDraft(alice, submit), receipt);
  assert.equal(receipt.applicationRevision, 1);
  assert.equal(getWorkspace(alice).applications.length, 1);
  assert.equal(startDraft(alice, start).draft.id, draft.draft.id);
  fails("conflict", () => startDraft(alice, { ...start, intent: { kind: "reuse", applicationId: receipt.applicationId } }));
  fails("conflict", () => submitDraft(alice, { ...submit, expected: { ...submit.expected, settings: submit.expected.settings + 1 } }));
});

test("server saves safe rich HTML and rejects required fields that sanitize to empty content", (t) => {
  fixture(t); completeApplicant();
  const draft = ready();
  const empty = saveDraft(alice, { draftId: draft.draft.id, expectedDraftRevision: 2, presentation: { abstract: '<script>alert(1)</script><img src=x onerror=alert(1)>', keyTakeaways: "<p>&nbsp;&#8203;</p>" } });
  fails("invalid_fields", () => submitDraft(alice, command(empty)));
  assert.equal(empty.draft.state.kind, "active");
  if (empty.draft.state.kind !== "active") assert.fail("Expected an active draft.");
  assert.equal(empty.draft.state.presentation.abstract, "");
  const safe = saveDraft(alice, { draftId: draft.draft.id, expectedDraftRevision: 3, presentation: { abstract: '<p onclick="bad()">Safe <strong>text</strong><a href="javascript:bad()">link</a></p>', keyTakeaways: '<ul><li style="color:red">Useful</li></ul>' } });
  const receipt = submitDraft(alice, command(safe));
  const presentation = getApplication(alice, receipt.applicationId).application.presentation;
  assert.equal(presentation.abstract, "<p>Safe <strong>text</strong><a>link</a></p>");
  assert.equal(presentation.keyTakeaways, "<ul><li>Useful</li></ul>");
  fails("invalid_fields", () => Reflect.apply(saveApplicant, undefined, [alice, { speaker: { expectedRevision: safe.speaker.revision, changes: {}, owner: "bob" } }]));
  fails("invalid_fields", () => Reflect.apply(saveDraft, undefined, [alice, { draftId: draft.draft.id, expectedDraftRevision: 4, presentation: {}, status: "accepted" }]));
});
