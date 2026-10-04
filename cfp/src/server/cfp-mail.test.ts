import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { VerifiedCfpAccount } from "../lib/account-model.ts";
import { mailIdentity, suspendMailForRestore, validateMailDatabase } from "../lib/mail-model.ts";
import { getWorkspace, saveApplicant, saveDraft, startDraft, submitDraft } from "./applicants.ts";
import { getMailStatus, resumeRestoredMail, runMailTick } from "./cfp-mail.ts";
import { initializeEdition, openCfpDatabase, setCfpOpen } from "./storage.ts";
import { bootstrapAdmin, executeStaffCommand, getAdminProposal, getReviewerProposal } from "./staff.ts";

const alice: VerifiedCfpAccount = {
  wtsUserId: "mail-alice", email: "alice@example.test", emailVerified: true, accountUrl: "https://identity.example.test/account",
  profile: { version: 1, wtsUserId: "mail-alice", name: "Alice", avatarUrl: null, preferredLanguage: null, username: "alice", emailVisibility: false, revision: 1 },
};
const day = 86_400_000;
const now = Date.parse("2027-02-05T09:00:00Z");
type SinkMode = "accept" | "transient" | "permanent" | "lost-ack";
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-mail-"));
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const sink: { mode: SinkMode; messages: string[]; connections: number; onDelivery?: () => void } = { mode: "accept", messages, connections: 0 };
  const server = createServer((socket) => {
    sockets.add(socket); sink.connections++;
    socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
    socket.write("220 smtp.example.test ESMTP\r\n");
    let buffer = ""; let data = false; let message = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes("\r\n")) {
        const index = buffer.indexOf("\r\n"); const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (data) {
          if (line !== ".") { message += `${line.replace(/^\.\./, ".")}\r\n`; continue; }
          data = false;
          sink.onDelivery?.();
          if (sink.mode === "transient") socket.write("451 Temporary refusal\r\n");
          else if (sink.mode === "permanent") socket.write("550 Permanent refusal\r\n");
          else { messages.push(message); if (sink.mode === "lost-ack") socket.destroy(); else socket.write("250 Accepted\r\n"); }
          message = "";
        } else if (/^(EHLO|HELO)/i.test(line)) socket.write("250 smtp.example.test\r\n");
        else if (/^(MAIL FROM|RCPT TO)/i.test(line)) socket.write("250 OK\r\n");
        else if (line === "DATA") { data = true; socket.write("354 End with a dot\r\n"); }
        else if (line === "QUIT") socket.end("221 Goodbye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The SMTP test server has no port.");
  const values = { NODE_ENV: "test", CFP_DATA_DIR: root, CFP_EDITION_ID: "2027", CFP_ORIGIN: "https://cfp.example.test", CFP_MAIL_MODE: "smtp", CFP_SMTP_HOST: "127.0.0.1", CFP_SMTP_PORT: String(address.port), CFP_SMTP_SECURE: "false", CFP_SMTP_FROM: "cfp@example.test", CFP_SMTP_USER: "", CFP_SMTP_PASSWORD: "", CFP_DAILY_REPORT_RECIPIENTS: "[]" };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  const clock = { now };
  t.mock.method(Date, "now", () => clock.now);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  initializeEdition("2027", root); setCfpOpen("2027", true, root);
  const workspace = getWorkspace(alice);
  saveApplicant(alice, { speaker: { expectedRevision: workspace.speaker.revision, changes: { bio: "Database engineer" } }, settings: { expectedRevision: workspace.settings.revision, changes: { companyCoverExpenses: "Yes" } } });
  return { root, sink, clock };
}
function submit(title: string, intent: Parameters<typeof startDraft>[1]["intent"] = { kind: "new" }, account = alice) {
  const fresh = startDraft(account, { requestId: randomUUID(), intent });
  const draft = saveDraft(account, { draftId: fresh.draft.id, expectedDraftRevision: fresh.draft.revision, presentation: { title, abstract: "A database talk", keyTakeaways: "Safe transactions" } });
  const command = { draftId: draft.draft.id, expected: { draft: draft.draft.revision, speaker: draft.speaker.revision, settings: draft.settings.revision } };
  return { command, receipt: submitDraft(account, command) };
}
function status(root: string) {
  const db = openCfpDatabase(root);
  try { return getMailStatus(db, "2027"); } finally { db.close(); }
}

test("submission commit and replay preserve frozen confirmation payloads across worker restart", async (t) => {
  const { root, sink } = await fixture(t);
  const first = submit("Original title");
  assert.deepEqual(submitDraft(alice, first.command), first.receipt);
  const changed = { ...alice, email: "changed@example.test" };
  submit("Edited title", { kind: "edit", applicationId: first.receipt.applicationId, expectedRevision: 1 }, changed);
  assert.equal(status(root).queued, 2);
  const result = await runMailTick(now, root);
  assert.equal(result.sent, 2);
  assert.equal(status(root).sent, 2);
  const original = sink.messages.find((message) => message.includes("Original title"));
  const edited = sink.messages.find((message) => message.includes("Edited title"));
  assert.ok(original); assert.ok(edited);
  assert.match(original, /To: alice@example.test/);
  assert.doesNotMatch(original, /Edited title|changed@example.test/);
  assert.ok(original.replace(/=\r\n/g, "").includes(`https://cfp.example.test/applications/${first.receipt.applicationId}`));
  assert.match(edited, /changed@example.test/);
  assert.equal((await runMailTick(now + day, root)).sent, 0);
});

test("verified long addresses can submit while delivery is disabled", async (t) => {
  const { root, sink } = await fixture(t);
  process.env.CFP_MAIL_MODE = "disabled";
  const email = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`;
  const account = { ...alice, email };
  const submission = submit("Long verified address", { kind: "new" }, account);
  assert.equal(getWorkspace(account).applications[0]?.id, submission.receipt.applicationId);
  const db = openCfpDatabase(root);
  try {
    const payload = JSON.parse(String(db.prepare("SELECT payload_json FROM cfp_mail_jobs").get()?.payload_json));
    assert.equal(payload.to, email);
  } finally { db.close(); }
  assert.equal((await runMailTick(now, root)).disabled, true);
  assert.equal(sink.connections, 0);
});

test("temporary SMTP refusal retains the committed submission and retries with bounded backoff", async (t) => {
  const { root, sink } = await fixture(t);
  sink.mode = "transient";
  const submission = submit("Retained application");
  assert.equal((await runMailTick(now, root)).failed, 1);
  assert.equal(status(root).retrying, 1);
  assert.equal(status(root).sent, 0);
  assert.equal(status(root).deliveryUnknown, 0);
  assert.deepEqual(submitDraft(alice, submission.command), submission.receipt);
  assert.equal(getWorkspace(alice).applications[0]?.title, "Retained application");
  assert.equal((await runMailTick(now, root)).sent, 0);
  sink.mode = "accept";
  assert.equal((await runMailTick(now + day, root)).sent, 1);
  assert.equal(status(root).retrying, 0);
  assert.equal(status(root).sent, 1);
});

test("permanent SMTP refusal remains visible and transient failures exhaust a finite retry budget", async (t) => {
  const { root, sink } = await fixture(t);
  sink.mode = "permanent"; submit("Permanent failure");
  assert.equal((await runMailTick(now, root)).failed, 1);
  assert.equal(status(root).failed, 1);
  sink.mode = "transient"; submit("Retry exhaustion");
  let time = now;
  for (const delay of [0, day, day, day, day]) {
    time += delay; assert.equal((await runMailTick(time, root)).failed, 1);
  }
  assert.equal(status(root).failed, 2);
  sink.mode = "accept";
  assert.equal((await runMailTick(time + day, root)).sent, 0);
  assert.equal(sink.messages.length, 0);
});

test("two workers claim separate durable jobs without concurrent logical duplicates", async (t) => {
  const { root, sink } = await fixture(t);
  submit("Worker one"); submit("Worker two");
  const results = await Promise.all([runMailTick(now, root), runMailTick(now, root)]);
  assert.equal(results[0]!.sent + results[1]!.sent, 2);
  assert.equal(status(root).sent, 2);
  const ids = sink.messages.map((message) => message.match(/^Message-ID:\s*(<[^>]+>)/mi)?.[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  assert.ok(sink.messages.some((message) => message.includes("Worker one")));
  assert.ok(sink.messages.some((message) => message.includes("Worker two")));
});

test("SMTP acceptance with a lost acknowledgment exposes uncertainty and reuses Message-ID on retry", async (t) => {
  const { root, sink } = await fixture(t);
  sink.mode = "lost-ack"; submit("Ambiguous delivery");
  assert.equal((await runMailTick(now, root)).failed, 1);
  assert.equal(status(root).deliveryUnknown, 1);
  assert.equal(status(root).sent, 0);
  assert.equal(sink.messages.length, 1);
  sink.mode = "accept";
  assert.equal((await runMailTick(now + day, root)).sent, 1);
  assert.equal(sink.messages.length, 2);
  const ids = sink.messages.map((message) => message.match(/^Message-ID:\s*(<[^>]+>)/mi)?.[1]);
  assert.ok(ids[0]); assert.equal(ids[0], ids[1]);
  assert.equal(status(root).deliveryUnknown, 0);
});

test("disabled and invalid configuration preserve queued work without SMTP and allow applicant reads", async (t) => {
  const { root, sink } = await fixture(t);
  submit("Waiting for configuration");
  process.env.CFP_MAIL_MODE = "disabled";
  assert.equal((await runMailTick(now, root)).disabled, true);
  assert.equal(status(root).queued, 1);
  process.env.CFP_MAIL_MODE = "smtp"; process.env.CFP_SMTP_FROM = "unsafe\r\nBcc: other@example.test";
  assert.equal(status(root).configured, false);
  assert.equal((await runMailTick(now, root)).disabled, true);
  assert.equal(getWorkspace(alice).applications[0]?.title, "Waiting for configuration");
  assert.equal(sink.connections, 0);
  process.env.CFP_SMTP_FROM = "cfp@example.test"; process.env.CFP_DAILY_REPORT_RECIPIENTS = '[{"wtsUserId":"a","email":"a@example.test"},{"wtsUserId":"a","email":"b@example.test"}]';
  assert.equal(status(root).configured, false);
  assert.equal((await runMailTick(now, root)).disabled, true);
  process.env.CFP_DAILY_REPORT_RECIPIENTS = "[]"; process.env.NODE_ENV = "production";
  assert.equal(status(root).configured, false);
  assert.equal((await runMailTick(now, root)).disabled, true);
  assert.equal(sink.connections, 0);
});

test("restored pending and leased jobs stay suspended until explicit named reconciliation", async (t) => {
  const { root, sink } = await fixture(t);
  const first = submit("Resume this job"); const second = submit("Leave suspended");
  const delivered = submit("Keep sent");
  const firstId = mailIdentity(`submission:2027:${first.command.draftId}`).jobId;
  const secondId = mailIdentity(`submission:2027:${second.command.draftId}`).jobId;
  const sentId = mailIdentity(`submission:2027:${delivered.command.draftId}`).jobId;
  let db = openCfpDatabase(root);
  try {
    db.prepare("UPDATE cfp_mail_jobs SET state='leased',attempts=1,lease_token=?,lease_until=? WHERE job_id=?").run(randomUUID(), now + 120_000, firstId);
    db.prepare("UPDATE cfp_mail_jobs SET state='sent',sent_at=? WHERE job_id=?").run(now, sentId);
    db.exec("BEGIN IMMEDIATE"); suspendMailForRestore(db, now); db.exec("COMMIT");
    validateMailDatabase(db);
  } finally { db.close(); }
  assert.equal(status(root).suspended, 2);
  assert.equal(status(root).sent, 1);
  assert.equal(status(root).deliveryUnknown, 1);
  assert.equal((await runMailTick(now + day, root)).sent, 0);
  assert.equal(sink.connections, 0);
  assert.throws(() => resumeRestoredMail("2027", [], root));
  assert.throws(() => resumeRestoredMail("2027", [firstId, sentId], root));
  assert.equal(status(root).suspended, 2);
  assert.equal(resumeRestoredMail("2027", [firstId], root), 1);
  assert.equal((await runMailTick(now, root)).sent, 1);
  assert.equal(status(root).suspended, 1);
  assert.equal(status(root).sent, 2);
  assert.match(sink.messages[0]!, /Resume this job/);
  assert.doesNotMatch(sink.messages[0]!, /Leave suspended/);
  db = openCfpDatabase(root);
  try { validateMailDatabase(db); } finally { db.close(); }
  assert.equal(resumeRestoredMail("2027", [secondId], root), 1);
});

const admin: VerifiedCfpAccount = { ...alice, wtsUserId: "mail-admin", email: "admin@example.test", profile: { ...alice.profile, wtsUserId: "mail-admin", name: "Admin", username: "admin" } };
const reviewer: VerifiedCfpAccount = { ...alice, wtsUserId: "mail-reviewer", email: "reviewer@example.test", profile: { ...alice.profile, wtsUserId: "mail-reviewer", name: "Reviewer", username: "reviewer" } };
function enableDaily(root: string) {
  getWorkspace(admin);
  const db = openCfpDatabase(root);
  try { db.prepare("INSERT INTO oidc_bindings VALUES (?,?,?,?)").run("https://identity.example.test", "mail-admin-subject", admin.wtsUserId, Date.now()); } finally { db.close(); }
  bootstrapAdmin("2027", admin.wtsUserId, root);
  process.env.CFP_DAILY_REPORT_RECIPIENTS = JSON.stringify([{ wtsUserId: admin.wtsUserId, email: admin.email }]);
  executeStaffCommand(admin, { kind: "set-review-policy", requestId: randomUUID(), expectedRevision: 1, reviewOpen: true, dailyReport: { enabled: true, timeZone: "UTC", localSendTime: "08:00" } });
}

test("UTC report snapshots count committed operations, deduplicate replays, and freeze generation inventory", async (t) => {
  const { root, sink, clock } = await fixture(t);
  clock.now = Date.parse("2027-02-04T10:00:00Z");
  enableDaily(root);
  const first = submit("PRIVATE_REPORT_TITLE");
  const edited = submit("PRIVATE_EDITED_TITLE", { kind: "edit", applicationId: first.receipt.applicationId, expectedRevision: 1 });
  assert.deepEqual(submitDraft(alice, edited.command), edited.receipt);
  getWorkspace(reviewer);
  executeStaffCommand(admin, { kind: "set-grant", requestId: randomUUID(), wtsUserId: reviewer.wtsUserId, role: "reviewer", expectedRevision: 0, active: true });
  executeStaffCommand(admin, { kind: "set-assignments", requestId: randomUUID(), changes: [{ applicationId: first.receipt.applicationId, reviewerId: reviewer.wtsUserId, expectedRevision: 0, active: true }] });
  const proposal = getReviewerProposal(reviewer, first.receipt.applicationId);
  const reviewCommand = { kind: "save-review" as const, requestId: randomUUID(), applicationId: proposal.applicationId, expectedAssignmentRevision: proposal.assignmentRevision, expectedPresentationRevision: proposal.presentationRevision, expectedReviewRevision: 0, scores: { relevance: 4 as const, originality: 4 as const, depth: 4 as const, clarity: 4 as const, takeaways: 4 as const, engagement: 4 as const }, notes: "PRIVATE_REVIEW_NOTES", suspectedAi: false };
  executeStaffCommand(reviewer, reviewCommand);
  executeStaffCommand(reviewer, reviewCommand);
  executeStaffCommand(reviewer, { ...reviewCommand, requestId: randomUUID(), expectedReviewRevision: 1, notes: "PRIVATE_UPDATED_NOTES" });
  for (const selectedStatus of ["accepted", "rejected", "pending"] as const) {
    const detail = getAdminProposal(admin, first.receipt.applicationId);
    executeStaffCommand(admin, { kind: "decide-proposals", requestId: randomUUID(), expectedWeightingRevision: detail.weighting.revision, status: selectedStatus, targets: [{ applicationId: detail.application.id, expectedApplicationRevision: detail.application.revision, expectedPresentationRevision: detail.presentationRevision, expectedAssessmentRevision: detail.assessmentRevision }] });
  }
  clock.now = now;
  assert.equal((await runMailTick(Date.parse("2027-02-05T07:59:59Z"), root)).reportsCreated, 0);
  const result = await runMailTick(now, root);
  assert.equal(result.reportsCreated, 1);
  const reports = sink.messages.filter((message) => /Subject: WTS 2027 CFP daily report/.test(message));
  assert.equal(reports.length, 1);
  assert.match(reports[0]!, /2027-02-04 UTC/);
  assert.match(reports[0]!, /Submissions: 1/);
  assert.match(reports[0]!, /Submission updates: 1/);
  assert.match(reports[0]!, /Review saves: 2/);
  assert.match(reports[0]!, /Accepted decisions: 1/);
  assert.match(reports[0]!, /Rejected decisions: 1/);
  assert.match(reports[0]!, /Reopened decisions: 1/);
  assert.match(reports[0]!, /Pending: 1/);
  assert.doesNotMatch(reports[0]!, /PRIVATE_|alice@example.test|ticket|password/i);
  assert.equal((await runMailTick(now, root)).reportsCreated, 0);
  const db = openCfpDatabase(root);
  try { validateMailDatabase(db); } finally { db.close(); }
});

test("UTC catch-up stops at seven complete days per tick and never precedes the enable boundary", async (t) => {
  const { root, sink, clock } = await fixture(t);
  clock.now = Date.parse("2027-01-20T10:00:00Z");
  enableDaily(root);
  clock.now = now;
  const first = await runMailTick(now, root);
  assert.equal(first.reportsCreated, 7);
  assert.equal(first.sent, 7);
  assert.ok(sink.messages.some((message) => message.includes("2027-01-20 UTC")));
  assert.ok(sink.messages.some((message) => message.includes("2027-01-26 UTC")));
  const second = await runMailTick(now, root);
  assert.equal(second.reportsCreated, 7);
  const third = await runMailTick(now, root);
  assert.equal(third.reportsCreated, 2);
  assert.equal((await runMailTick(now, root)).reportsCreated, 0);
  assert.equal(sink.messages.length, 16);
  assert.ok(sink.messages.every((message) => !message.includes("2027-01-19 UTC")));
  assert.equal(new Set(sink.messages.map((message) => message.match(/^Message-ID:\s*(<[^>]+>)/mi)?.[1])).size, 16);
});

test("daily generation and dispatch require a current edition admin and exact configured destination", async (t) => {
  const { root, sink, clock } = await fixture(t);
  clock.now = Date.parse("2027-02-04T10:00:00Z"); enableDaily(root);
  const secondAdmin = { ...admin, wtsUserId: "mail-admin-two", email: "two@example.test", profile: { ...admin.profile, wtsUserId: "mail-admin-two", username: "admin-two" } };
  getWorkspace(secondAdmin);
  executeStaffCommand(admin, { kind: "set-grant", requestId: randomUUID(), wtsUserId: secondAdmin.wtsUserId, role: "admin", expectedRevision: 0, active: true });
  process.env.CFP_DAILY_REPORT_RECIPIENTS = JSON.stringify([{ wtsUserId: admin.wtsUserId, email: admin.email }, { wtsUserId: "not-an-admin", email: "denied@example.test" }]);
  clock.now = now; sink.mode = "transient";
  assert.equal((await runMailTick(now, root)).reportsCreated, 1);
  assert.equal(status(root).retrying, 1);
  assert.equal(status(root).eligibleDailyRecipientCount, 1);
  executeStaffCommand(secondAdmin, { kind: "set-grant", requestId: randomUUID(), wtsUserId: admin.wtsUserId, role: "admin", expectedRevision: 1, active: false });
  sink.mode = "accept";
  assert.equal((await runMailTick(now + 60_000, root)).suspended, 1);
  assert.equal(sink.messages.length, 0);
  assert.equal(status(root).eligibleDailyRecipientCount, 0);
  const id = mailIdentity(`daily:2027:2027-02-04:${admin.wtsUserId}`).jobId;
  assert.throws(() => resumeRestoredMail("2027", [id], root));
  executeStaffCommand(secondAdmin, { kind: "set-grant", requestId: randomUUID(), wtsUserId: admin.wtsUserId, role: "admin", expectedRevision: 2, active: true });
  process.env.CFP_DAILY_REPORT_RECIPIENTS = JSON.stringify([{ wtsUserId: admin.wtsUserId, email: "different@example.test" }]);
  assert.throws(() => resumeRestoredMail("2027", [id], root));
  assert.equal(status(root).suspended, 1);
  process.env.CFP_DAILY_REPORT_RECIPIENTS = JSON.stringify([{ wtsUserId: admin.wtsUserId, email: admin.email }]);
  assert.equal(resumeRestoredMail("2027", [id], root), 1);
  assert.equal((await runMailTick(now, root)).sent, 1);
  assert.match(sink.messages[0]!, /To: admin@example.test/);
});

test("ordinary expired leases recover with stable logical identity rather than restore suspension", async (t) => {
  const { root, sink } = await fixture(t);
  const submission = submit("Recover the expired lease");
  const identity = mailIdentity(`submission:2027:${submission.command.draftId}`);
  const db = openCfpDatabase(root);
  try { db.prepare("UPDATE cfp_mail_jobs SET state='leased',attempts=1,lease_token=?,lease_until=? WHERE job_id=?").run(randomUUID(), now, identity.jobId); } finally { db.close(); }
  assert.equal((await runMailTick(now, root)).sent, 1);
  assert.equal(status(root).sent, 1);
  assert.equal(status(root).suspended, 0);
  assert.match(sink.messages[0]!, new RegExp(identity.jobId));
});

test("SMTP delivery does not hold a SQLite write transaction", async (t) => {
  const { root, sink } = await fixture(t);
  submit("Deliver after commit");
  const db = openCfpDatabase(root);
  let writableDuringDelivery = false;
  sink.onDelivery = () => {
    try { db.exec("PRAGMA busy_timeout=1; BEGIN IMMEDIATE; ROLLBACK"); writableDuringDelivery = true; }
    catch { writableDuringDelivery = false; }
  };
  try {
    assert.equal((await runMailTick(now, root)).sent, 1);
    assert.equal(writableDuringDelivery, true);
  } finally { db.close(); }
});

test("two daily workers create one UTC snapshot and one job per active configured admin", async (t) => {
  const { root, sink, clock } = await fixture(t);
  clock.now = Date.parse("2027-02-04T10:00:00Z"); enableDaily(root);
  const second = { ...admin, wtsUserId: "daily-second", email: "second@example.test", profile: { ...admin.profile, wtsUserId: "daily-second", username: "daily-second" } };
  getWorkspace(second);
  executeStaffCommand(admin, { kind: "set-grant", requestId: randomUUID(), wtsUserId: second.wtsUserId, role: "admin", expectedRevision: 0, active: true });
  process.env.CFP_DAILY_REPORT_RECIPIENTS = JSON.stringify([{ wtsUserId: admin.wtsUserId, email: admin.email }, { wtsUserId: second.wtsUserId, email: second.email }]);
  clock.now = now;
  const results = await Promise.all([runMailTick(now, root), runMailTick(now, root)]);
  assert.equal(results[0]!.reportsCreated + results[1]!.reportsCreated, 1);
  assert.equal(results[0]!.sent + results[1]!.sent, 2);
  assert.equal(sink.messages.filter((message) => /To: admin@example.test/.test(message)).length, 1);
  assert.equal(sink.messages.filter((message) => /To: second@example.test/.test(message)).length, 1);
  assert.equal((await runMailTick(now, root)).reportsCreated, 0);
  assert.equal(status(root).sent, 2);
});

test("daily retry retains its original snapshot after later application inventory changes", async (t) => {
  const { root, sink, clock } = await fixture(t);
  clock.now = Date.parse("2027-02-04T10:00:00Z"); enableDaily(root);
  clock.now = now; sink.mode = "transient";
  assert.equal((await runMailTick(now, root)).reportsCreated, 1);
  assert.equal(status(root).retrying, 1);
  clock.now = now + 1;
  submit("Not in the earlier inventory");
  sink.mode = "accept";
  assert.equal((await runMailTick(now + 300_000, root)).reportsCreated, 0);
  assert.equal(getWorkspace(alice).applications.length, 1);
  const report = sink.messages.find((message) => /Subject: WTS 2027 CFP daily report/.test(message));
  assert.ok(report);
  assert.match(report, /Submissions: 0/);
  assert.match(report, /Pending: 0/);
  assert.doesNotMatch(report, /Not in the earlier inventory/);
  const db = openCfpDatabase(root);
  try { validateMailDatabase(db); } finally { db.close(); }
});
