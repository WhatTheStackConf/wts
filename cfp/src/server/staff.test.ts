import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { VerifiedCfpAccount } from "../lib/account-model.ts";
import { CfpError, type DraftView } from "../lib/cfp-model.ts";
import { StaffError, type CriterionWeights, type ReviewScores, type SaveReviewCommand, type StaffCommand, type StaffErrorCode } from "../lib/staff-model.ts";
import { getApplication, getWorkspace, saveApplicant, saveDraft, startDraft, submitDraft } from "./applicants.ts";
import { bootstrapAdmin, executeStaffCommand, getAdminProposal, getAdminWorkspace, getNextReview, getReviewerProposal, getReviewerWorkspace, getStaffAccess, getStaffDirectory } from "./staff.ts";
import { backup, initializeEdition, openCfpDatabase, restore, setCfpOpen } from "./storage.ts";

function account(id: string): VerifiedCfpAccount {
  return { wtsUserId: id, email: `${id}@example.test`, emailVerified: true, accountUrl: "https://identity.example.test/account", profile: { version: 1, wtsUserId: id, name: id, avatarUrl: null, preferredLanguage: null, username: id, emailVisibility: false, revision: 1 } };
}
const admin = account("admin"); const secondAdmin = account("second-admin"); const alice = account("alice"); const reviewer = account("reviewer"); const otherReviewer = account("other-reviewer");
const presentation = { title: "Transactions", abstract: "<p>Safe SQLite</p>", keyTakeaways: "<p>Atomic writes</p>", technicalRequirements: "HDMI", previousPresentation: "PRIVATE_HISTORY", organizerNotes: "PRIVATE_ORGANIZER", additionalInfo: "PRIVATE_EXTRA" };
const four: ReviewScores = { relevance: 4, originality: 4, depth: 4, clarity: 4, takeaways: 4, engagement: 4 };
function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-staff-"));
  const env = { dir: process.env.CFP_DATA_DIR, edition: process.env.CFP_EDITION_ID, mode: process.env.CFP_MAIL_MODE, origin: process.env.CFP_ORIGIN };
  process.env.CFP_DATA_DIR = root; process.env.CFP_EDITION_ID = "2027"; process.env.CFP_MAIL_MODE = "disabled"; process.env.CFP_ORIGIN = "https://cfp.acceptance.localhost";
  t.mock.method(Date, "now", () => 1_800_000_000_000);
  t.after(() => { for (const [key, value] of [["CFP_DATA_DIR", env.dir], ["CFP_EDITION_ID", env.edition], ["CFP_MAIL_MODE", env.mode], ["CFP_ORIGIN", env.origin]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } rmSync(root, { recursive: true, force: true }); });
  initializeEdition("2027"); setCfpOpen("2027", true);
  for (const actor of [admin, secondAdmin, alice, reviewer, otherReviewer]) getWorkspace(actor);
  const db = openCfpDatabase(); try { db.prepare("INSERT INTO oidc_bindings VALUES (?,?,?,?)").run("https://identity.example.test", "admin-sub", admin.wtsUserId, Date.now()); } finally { db.close(); }
  bootstrapAdmin("2027", admin.wtsUserId);
  return root;
}
function fails(code: StaffErrorCode, action: () => unknown): void { assert.throws(action, (error: unknown) => error instanceof StaffError && error.code === code); }
function submit(view: DraftView) { return submitDraft(alice, { draftId: view.draft.id, expected: { draft: view.draft.revision, speaker: view.speaker.revision, settings: view.settings.revision } }); }
function proposal(title = presentation.title): string {
  const current = getWorkspace(alice);
  saveApplicant(alice, { speaker: { expectedRevision: current.speaker.revision, changes: { bio: "PRIVATE_SPEAKER" } }, settings: { expectedRevision: current.settings.revision, changes: { companyCoverExpenses: "Other", preferredContactMethod: "PRIVATE_CONTACT" } } });
  const draft = startDraft(alice, { requestId: randomUUID(), intent: { kind: "new" } });
  return submit(saveDraft(alice, { draftId: draft.draft.id, expectedDraftRevision: draft.draft.revision, presentation: { ...presentation, title } })).applicationId;
}
function grant(actor: VerifiedCfpAccount, role: "admin" | "reviewer", active = true, expectedRevision = 0) { return executeStaffCommand(admin, { kind: "set-grant", requestId: randomUUID(), wtsUserId: actor.wtsUserId, role, active, expectedRevision }); }
function assign(id: string, actor = reviewer, expectedRevision = 0) { return executeStaffCommand(admin, { kind: "set-assignments", requestId: randomUUID(), changes: [{ applicationId: id, reviewerId: actor.wtsUserId, expectedRevision, active: true }] }); }
function reviewGate(open: boolean) { const policy = getAdminWorkspace(admin).reviewPolicy; return executeStaffCommand(admin, { kind: "set-review-policy", requestId: randomUUID(), expectedRevision: policy.revision, reviewOpen: open, dailyReport: policy.dailyReport }); }
function reviewCommand(id: string, actor = reviewer, scores: ReviewScores = four): SaveReviewCommand {
  const value = getReviewerProposal(actor, id);
  return { kind: "save-review", requestId: randomUUID(), applicationId: id, expectedAssignmentRevision: value.assignmentRevision, expectedPresentationRevision: value.presentationRevision, expectedReviewRevision: value.review.kind === "unreviewed" ? 0 : value.review.value.revision, scores, notes: "OWN_REVIEW", suspectedAi: false };
}
function decision(ids: string[], status: "pending" | "accepted" | "rejected"): Extract<StaffCommand, { kind: "decide-proposals" }> {
  const proposals = ids.map((id) => getAdminProposal(admin, id));
  return { kind: "decide-proposals", requestId: randomUUID(), status, expectedWeightingRevision: getAdminWorkspace(admin).weighting.revision, targets: proposals.map((item) => ({ applicationId: item.application.id, expectedApplicationRevision: item.application.revision, expectedPresentationRevision: item.presentationRevision, expectedAssessmentRevision: item.assessmentRevision })) };
}

test("reviewer resources require active assignments and expose only the allowed committed fields", (t) => {
  fixture(t); const id = proposal(); grant(reviewer, "reviewer"); grant(otherReviewer, "reviewer");
  assert.deepEqual(getReviewerWorkspace(reviewer).queue, []); fails("not_found", () => getReviewerProposal(reviewer, id)); fails("forbidden", () => getReviewerWorkspace(admin));
  assign(id); reviewGate(true); executeStaffCommand(reviewer, reviewCommand(id)); assign(id, otherReviewer);
  executeStaffCommand(otherReviewer, { ...reviewCommand(id, otherReviewer), notes: "OTHER_PRIVATE_REVIEW" });
  const privateDraft = startDraft(alice, { requestId: randomUUID(), intent: { kind: "new" } }); saveDraft(alice, { draftId: privateDraft.draft.id, expectedDraftRevision: 1, presentation: { title: "PRIVATE_DRAFT" } });
  const visible = getReviewerProposal(reviewer, id);
  assert.deepEqual(visible.presentation, { title: "Transactions", abstract: "<p>Safe SQLite</p>", keyTakeaways: "<p>Atomic writes</p>", technicalRequirements: "HDMI" });
  const text = JSON.stringify(visible); for (const sentinel of ["PRIVATE_HISTORY", "PRIVATE_ORGANIZER", "PRIVATE_EXTRA", "PRIVATE_SPEAKER", "PRIVATE_CONTACT", "alice@example.test", "OTHER_PRIVATE_REVIEW", "PRIVATE_DRAFT"]) assert.equal(text.includes(sentinel), false);
  assert.deepEqual(getReviewerWorkspace(reviewer).activity, [{ label: "Reviewer 1", reviewCount: 1 }, { label: "Reviewer 2", reviewCount: 1 }]);
  assert.equal(JSON.stringify(getAdminProposal(admin, id)).includes("PRIVATE_DRAFT"), false);
  grant(alice, "reviewer"); fails("forbidden", () => assign(id, { ...alice, email: "different@example.test" }));
  initializeEdition("2028"); process.env.CFP_EDITION_ID = "2028"; assert.deepEqual(getStaffAccess(reviewer).roles, []); fails("forbidden", () => getReviewerProposal(reviewer, id));
});

test("revocation wins over receipt replay and regrant does not restore assignments", (t) => {
  fixture(t); const id = proposal(); grant(reviewer, "reviewer"); assign(id); reviewGate(true);
  const command = reviewCommand(id); const receipt = executeStaffCommand(reviewer, command);
  assert.deepEqual(executeStaffCommand(reviewer, command), { ...receipt, replayed: true }); fails("conflict", () => executeStaffCommand(reviewer, { ...command, notes: "changed" }));
  const later = executeStaffCommand(reviewer, { ...reviewCommand(id), notes: "LATEST_REVIEW" });
  assert.deepEqual(executeStaffCommand(reviewer, command), { ...receipt, replayed: true });
  const current = getReviewerProposal(reviewer, id).review; if (current.kind === "unreviewed") assert.fail("The current review is missing.");
  assert.equal(current.value.revision, later.result.revision); assert.equal(current.value.notes, "LATEST_REVIEW");
  grant(reviewer, "reviewer", false, 1); fails("forbidden", () => executeStaffCommand(reviewer, command)); fails("forbidden", () => getReviewerWorkspace(reviewer));
  assert.equal(getAdminProposal(admin, id).ranking.totalReviewCount, 1); grant(reviewer, "reviewer", true, 2);
  assert.deepEqual(getReviewerWorkspace(reviewer).queue, []); fails("not_found", () => executeStaffCommand(reviewer, command));
});

test("bootstrap needs an exact existing binding and concurrent-order admin removals retain an admin", (t) => {
  fixture(t); assert.equal(bootstrapAdmin("2027", "admin").revision, 1); fails("not_found", () => bootstrapAdmin("2027", "second-admin"));
  fails("last_admin", () => grant(admin, "admin", false, 1)); grant(secondAdmin, "admin");
  const first = { kind: "set-grant" as const, requestId: randomUUID(), wtsUserId: secondAdmin.wtsUserId, role: "admin" as const, active: false, expectedRevision: 1 };
  const second = { ...first, requestId: randomUUID(), wtsUserId: admin.wtsUserId };
  executeStaffCommand(admin, first); fails("forbidden", () => executeStaffCommand(secondAdmin, second));
  assert.equal(getStaffDirectory(admin).activeAdminCount, 1);
});

test("stale review revisions cannot overwrite and independent reviewers do not share a review witness", (t) => {
  fixture(t); const id = proposal(); grant(reviewer, "reviewer"); grant(otherReviewer, "reviewer"); assign(id); assign(id, otherReviewer); reviewGate(true);
  const first = reviewCommand(id); const competing = { ...first, requestId: randomUUID(), notes: "lost" };
  executeStaffCommand(reviewer, first); fails("conflict", () => executeStaffCommand(reviewer, competing)); executeStaffCommand(otherReviewer, reviewCommand(id, otherReviewer));
  const saved = getReviewerProposal(reviewer, id).review; assert.notEqual(saved.kind, "unreviewed"); if (saved.kind !== "unreviewed") assert.equal(saved.value.notes, "OWN_REVIEW");
  assert.deepEqual(getAdminProposal(admin, id).ranking, { averageWeightedScore: 4, currentReviewCount: 2, staleReviewCount: 0, totalReviewCount: 2 });
});

test("committed edits make reviews stale but preserve the allowed evaluated snapshot", (t) => {
  fixture(t); const id = proposal(); grant(reviewer, "reviewer"); assign(id); reviewGate(true); const old = reviewCommand(id); executeStaffCommand(reviewer, old);
  const edit = startDraft(alice, { requestId: randomUUID(), intent: { kind: "edit", applicationId: id, expectedRevision: 1 } }); submit(saveDraft(alice, { draftId: edit.draft.id, expectedDraftRevision: 1, presentation: { title: "New presentation" } }));
  const stale = getReviewerProposal(reviewer, id); assert.equal(stale.review.kind, "stale"); if (stale.review.kind === "stale") assert.equal(stale.review.evaluatedPresentation.title, "Transactions");
  assert.equal(JSON.stringify(stale).includes("PRIVATE_ORGANIZER"), false); assert.deepEqual(getAdminProposal(admin, id).ranking, { averageWeightedScore: null, currentReviewCount: 0, staleReviewCount: 1, totalReviewCount: 1 });
  fails("conflict", () => executeStaffCommand(reviewer, { ...old, requestId: randomUUID() })); assert.deepEqual(getNextReview(reviewer), { applicationId: id });
  executeStaffCommand(reviewer, reviewCommand(id)); assert.equal(getAdminProposal(admin, id).ranking.averageWeightedScore, 4);
});

test("normalized means preserve score scale and historical votes survive revocation", (t) => {
  fixture(t); const one = proposal("Two reviews"); const two = proposal("One review"); grant(reviewer, "reviewer"); grant(otherReviewer, "reviewer"); assign(one); assign(one, otherReviewer); assign(two); reviewGate(true);
  const five: ReviewScores = { relevance: 5, originality: 5, depth: 5, clarity: 5, takeaways: 5, engagement: 5 }; const three: ReviewScores = { relevance: 3, originality: 3, depth: 3, clarity: 3, takeaways: 3, engagement: 3 };
  executeStaffCommand(reviewer, reviewCommand(one, reviewer, five)); executeStaffCommand(otherReviewer, reviewCommand(one, otherReviewer, three)); executeStaffCommand(reviewer, reviewCommand(two));
  assert.equal(getAdminProposal(admin, one).ranking.averageWeightedScore, 4); assert.equal(getAdminProposal(admin, two).ranking.averageWeightedScore, 4);
  const weights: CriterionWeights = { relevance: 6, originality: 1, depth: 1, clarity: 1, takeaways: 1, engagement: 1 };
  executeStaffCommand(reviewer, { kind: "save-weight-vote", requestId: randomUUID(), expectedRevision: 0, weights });
  executeStaffCommand(reviewer, reviewCommand(two, reviewer, { relevance: 5, originality: 1, depth: 1, clarity: 1, takeaways: 1, engagement: 1 }));
  assert.equal(getAdminProposal(admin, two).ranking.averageWeightedScore, 35 / 11);
  grant(reviewer, "reviewer", false, 1); assert.equal(getAdminWorkspace(admin).weighting.voteCount, 1); assert.equal(getAdminProposal(admin, two).ranking.averageWeightedScore, 35 / 11);
});

test("CFP and review gates are independent and applicant replay keeps its historical receipt", (t) => {
  fixture(t); const id = proposal(); grant(reviewer, "reviewer"); assign(id); reviewGate(true); setCfpOpen("2027", false);
  executeStaffCommand(reviewer, reviewCommand(id)); assert.equal(getAdminWorkspace(admin).reviewPolicy.reviewOpen, true);
  setCfpOpen("2027", true); reviewGate(false); fails("review_closed", () => executeStaffCommand(reviewer, reviewCommand(id)));
  fails("review_closed", () => executeStaffCommand(reviewer, { kind: "save-weight-vote", requestId: randomUUID(), expectedRevision: 0, weights: { relevance: 1, originality: 1, depth: 1, clarity: 1, takeaways: 1, engagement: 1 } }));
  const edit = startDraft(alice, { requestId: randomUUID(), intent: { kind: "edit", applicationId: id, expectedRevision: 1 } }); const saved = saveDraft(alice, { draftId: edit.draft.id, expectedDraftRevision: 1, presentation: { title: "Edited while review closed" } });
  const command = { draftId: saved.draft.id, expected: { draft: saved.draft.revision, speaker: saved.speaker.revision, settings: saved.settings.revision } }; const receipt = submitDraft(alice, command); setCfpOpen("2027", false);
  assert.deepEqual(submitDraft(alice, command), receipt); assert.equal(getAdminWorkspace(admin).mail.queued, 2);
});

test("decision witnesses reject new reviews and votes and bulk changes commit atomically", (t) => {
  fixture(t); const one = proposal("One"); const two = proposal("Two"); grant(reviewer, "reviewer"); assign(two); reviewGate(true);
  const batch = decision([one, two], "accepted"); executeStaffCommand(reviewer, reviewCommand(two)); fails("conflict", () => executeStaffCommand(admin, batch));
  assert.equal(getApplication(alice, one).application.status, "pending"); assert.equal(getAdminProposal(admin, one).decisions.length, 0);
  const staleWeight = decision([one, two], "accepted"); executeStaffCommand(reviewer, { kind: "save-weight-vote", requestId: randomUUID(), expectedRevision: 0, weights: { relevance: 2, originality: 1, depth: 1, clarity: 1, takeaways: 1, engagement: 1 } }); fails("conflict", () => executeStaffCommand(admin, staleWeight));
  const edit = startDraft(alice, { requestId: randomUUID(), intent: { kind: "edit", applicationId: two, expectedRevision: 1 } });
  const selected = executeStaffCommand(admin, decision([one, two], "accepted")); assert.equal(selected.result.length, 2); assert.equal(getAdminProposal(admin, two).presentationRevision, 1); assert.equal(getAdminProposal(admin, two).ranking.currentReviewCount, 1);
  assert.throws(() => submit(edit), (error: unknown) => error instanceof CfpError && error.code === "finalized"); fails("not_found", () => getReviewerProposal(reviewer, two));
  executeStaffCommand(admin, decision([two], "pending")); assert.equal(getReviewerProposal(reviewer, two).presentationRevision, 1); assert.equal(getApplication(alice, two).application.revision, 3);
});

test("strict command validation rejects extra authority, duplicate targets, and invalid score bounds", (t) => {
  fixture(t); const id = proposal(); grant(reviewer, "reviewer"); assign(id); reviewGate(true);
  const command = reviewCommand(id); fails("invalid_fields", () => executeStaffCommand(reviewer, { ...command, actor: "admin" }));
  fails("invalid_fields", () => executeStaffCommand(reviewer, { ...command, scores: { ...four, relevance: 6 } } as unknown as SaveReviewCommand));
  fails("invalid_fields", () => executeStaffCommand(reviewer, { ...command, notes: "x".repeat(10001) }));
  const batch = decision([id], "accepted"); fails("invalid_fields", () => executeStaffCommand(admin, { ...batch, targets: [batch.targets[0]!, batch.targets[0]!] }));
  assert.equal(getAdminProposal(admin, id).application.status, "pending");
});

test("restore disables privilege and delivery while preserving committee evidence and bootstrap reconciliation", async (t) => {
  const root = fixture(t); const id = proposal(); grant(reviewer, "reviewer"); assign(id); reviewGate(true); executeStaffCommand(reviewer, reviewCommand(id));
  executeStaffCommand(reviewer, { kind: "save-weight-vote", requestId: randomUUID(), expectedRevision: 0, weights: { relevance: 2, originality: 1, depth: 1, clarity: 1, takeaways: 1, engagement: 1 } });
  const policy = getAdminWorkspace(admin).reviewPolicy;
  executeStaffCommand(admin, { kind: "set-review-policy", requestId: randomUUID(), expectedRevision: policy.revision, reviewOpen: true, dailyReport: { enabled: true, timeZone: "UTC", localSendTime: "08:00" } });
  executeStaffCommand(admin, decision([id], "accepted")); const before = getAdminProposal(admin, id); const snapshot = join(root, "backup"); const target = join(root, "restored"); await backup(snapshot); await restore(snapshot, target);
  assert.deepEqual(getAdminProposal(admin, id), before); process.env.CFP_DATA_DIR = target;
  assert.deepEqual(getStaffAccess(admin).roles, []); assert.deepEqual(getStaffAccess(reviewer).roles, []); fails("forbidden", () => getAdminProposal(admin, id));
  bootstrapAdmin("2027", "admin"); const recovered = getAdminProposal(admin, id); assert.deepEqual(recovered.reviews, before.reviews); assert.deepEqual(recovered.decisions, before.decisions); assert.deepEqual(recovered.weighting, before.weighting);
  const workspace = getAdminWorkspace(admin); assert.equal(workspace.cfpGate.open, false); assert.equal(workspace.reviewPolicy.reviewOpen, false); assert.equal(workspace.mail.suspended, 1); assert.equal(workspace.mail.queued, 0);
  assert.equal(workspace.reviewPolicy.dailyReport.enabled, false); assert.equal(recovered.assignments[0]?.state, "disabled_restore");
  assert.equal(getStaffDirectory(admin).members.find((member) => member.wtsUserId === reviewer.wtsUserId)?.reviewerGrant?.state, "disabled_restore");
});

test("an active current-edition grant cannot read or decide another edition's resources", (t) => {
  fixture(t); const id = proposal(); initializeEdition("2028"); bootstrapAdmin("2028", admin.wtsUserId); process.env.CFP_EDITION_ID = "2028";
  grant(reviewer, "reviewer"); fails("not_found", () => getAdminProposal(admin, id)); fails("not_found", () => getReviewerProposal(reviewer, id));
  fails("not_found", () => executeStaffCommand(admin, { kind: "decide-proposals", requestId: randomUUID(), status: "accepted", expectedWeightingRevision: 0, targets: [{ applicationId: id, expectedApplicationRevision: 1, expectedPresentationRevision: 1, expectedAssessmentRevision: 0 }] }));
  fails("not_found", () => assign(id)); process.env.CFP_EDITION_ID = "2027"; assert.equal(getApplication(alice, id).application.status, "pending");
});

test("admin context keeps submission contact but reads the current reusable speaker profile", (t) => {
  fixture(t); const id = proposal(); const changedAccount = { ...alice, email: "changed@example.test" };
  const workspace = getWorkspace(changedAccount); saveApplicant(changedAccount, { speaker: { expectedRevision: workspace.speaker.revision, changes: { fullName: "Current speaker" } } });
  const current = getAdminProposal(admin, id); assert.deepEqual(current.applicant.contact, { kind: "submitted", email: "alice@example.test", recordedAt: 1_800_000_000_000 }); assert.equal(current.speaker.value.fullName, "Current speaker");
});

test("a committed edit wins against an old decision witness without changing proposal status", (t) => {
  fixture(t); const id = proposal(); const oldDecision = decision([id], "accepted");
  const edit = startDraft(alice, { requestId: randomUUID(), intent: { kind: "edit", applicationId: id, expectedRevision: 1 } }); submit(saveDraft(alice, { draftId: edit.draft.id, expectedDraftRevision: 1, presentation: { title: "New committed content" } }));
  fails("conflict", () => executeStaffCommand(admin, oldDecision)); const current = getAdminProposal(admin, id); assert.equal(current.application.status, "pending"); assert.equal(current.application.presentation.title, "New committed content"); assert.deepEqual(current.decisions, []);
});

test("admin filters use literal search, expose separate counts, and retain deterministic score ties", (t) => {
  fixture(t); const one = proposal("Literal % title"); const two = proposal("Second title"); const three = proposal("Third title");
  executeStaffCommand(admin, decision([three], "rejected"));
  assert.deepEqual(getAdminWorkspace(admin, { search: "%" }).proposals.map((row) => row.applicationId), [one]);
  assert.equal(getAdminWorkspace(admin, { search: "' OR 1=1 --" }).total, 0);
  const first = getAdminWorkspace(admin, { page: 1, pageSize: 1 }); const second = getAdminWorkspace(admin, { page: 2, pageSize: 1 });
  assert.deepEqual([first.proposals[0]?.applicationId, second.proposals[0]?.applicationId], [one, two].sort()); assert.deepEqual(first.counts, { pending: 2, accepted: 0, rejected: 1 }); assert.equal(first.total, 2);
  assert.deepEqual(getAdminWorkspace(admin, { status: "rejected", expenseCoverage: "Other" }).proposals.map((row) => row.applicationId), [three]);
});

test("gate witnesses conflict after maintenance changes but exact authorized replay returns its historical result", (t) => {
  fixture(t); const before = getAdminWorkspace(admin);
  const close = { kind: "set-cfp-gate" as const, requestId: randomUUID(), expectedRevision: before.cfpGate.revision, open: false };
  const receipt = executeStaffCommand(admin, close); setCfpOpen("2027", true);
  assert.deepEqual(executeStaffCommand(admin, close), { ...receipt, replayed: true }); assert.equal(getAdminWorkspace(admin).cfpGate.open, true);
  fails("conflict", () => executeStaffCommand(admin, { ...close, requestId: randomUUID() }));
  const current = getAdminWorkspace(admin); initializeEdition("2027"); assert.equal(getAdminWorkspace(admin).cfpGate.revision, current.cfpGate.revision);
});

test("report policies validate UTC send times and establish a new boundary after re-enabling", (t) => {
  fixture(t); let now = Date.UTC(2027, 0, 5, 10); t.mock.method(Date, "now", () => now);
  const initial = getAdminWorkspace(admin).reviewPolicy;
  fails("invalid_fields", () => executeStaffCommand(admin, { kind: "set-review-policy", requestId: randomUUID(), expectedRevision: initial.revision, reviewOpen: false, dailyReport: { enabled: true, timeZone: "UTC", localSendTime: "24:00" } }));
  const enabled = executeStaffCommand(admin, { kind: "set-review-policy", requestId: randomUUID(), expectedRevision: initial.revision, reviewOpen: true, dailyReport: { enabled: true, timeZone: "UTC", localSendTime: "09:30" } });
  assert.equal(enabled.result.reportStartDate, "2027-01-05");
  const disabled = executeStaffCommand(admin, { kind: "set-review-policy", requestId: randomUUID(), expectedRevision: enabled.result.revision, reviewOpen: true, dailyReport: { ...enabled.result.dailyReport, enabled: false } });
  now = Date.UTC(2027, 0, 10, 10);
  const resumed = executeStaffCommand(admin, { kind: "set-review-policy", requestId: randomUUID(), expectedRevision: disabled.result.revision, reviewOpen: true, dailyReport: { ...disabled.result.dailyReport, enabled: true } });
  assert.equal(resumed.result.reportStartDate, "2027-01-10");
  initializeEdition("2027"); assert.deepEqual(getAdminWorkspace(admin).reviewPolicy, resumed.result);
});
