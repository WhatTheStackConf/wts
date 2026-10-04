import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import type { VerifiedCfpAccount } from "../lib/account-model.ts";
import {
  CfpError, applicantChangeSchema, applicantSettingsSchema, blankPresentation, commitWitnessSchema,
  draftPurposeSchema, editionIdSchema, idSchema, presentationSchema, revisionSchema, saveDraftSchema,
  speakerProfileSchema, startDraftSchema, submissionIssues, submissionReceiptSchema, submitDraftSchema,
  type ApplicantChange, type ApplicantView, type Application, type ApplicationView, type Draft,
  type DraftPurpose, type DraftView, type Presentation, type SaveDraftCommand, type StartDraftCommand,
  type SubmissionReceipt, type SubmitDraftCommand, type Workspace,
} from "../lib/cfp-model.ts";
import { openCfpDatabase } from "./storage.ts";
import { enqueueSubmissionConfirmation } from "./cfp-mail.ts";

function parseCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new CfpError("invalid_fields", "Check the supplied fields.", result.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })));
  return result.data;
}
function editionId(): string {
  const value = process.env.CFP_EDITION_ID;
  if (!value) throw new Error("Set CFP_EDITION_ID before opening the applicant workspace.");
  return editionIdSchema.parse(value);
}
function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const value = action(); db.exec("COMMIT"); return value; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
function gate(db: DatabaseSync, edition: string): boolean {
  const row = db.prepare("SELECT cfp_open FROM editions WHERE edition_id=?").get(edition);
  if (!row) throw new Error("Initialize the CFP edition before serving applicant requests.");
  return row.cfp_open === 1;
}
function requireOpen(db: DatabaseSync, edition: string): void {
  if (!gate(db, edition)) throw new CfpError("cfp_closed", "The CFP is closed. Saved records remain available.");
}
function provision(db: DatabaseSync, account: VerifiedCfpAccount): void {
  db.prepare("INSERT INTO cfp_accounts VALUES (?, ?) ON CONFLICT(wts_user_id) DO NOTHING").run(account.wtsUserId, Date.now());
  if (!db.prepare("SELECT wts_user_id FROM speaker_profiles WHERE wts_user_id=?").get(account.wtsUserId)) {
    const speaker = speakerProfileSchema.parse({ fullName: account.profile.name, affiliation: "", bio: "", socialHandles: [], previousTalks: "" });
    db.prepare("INSERT INTO speaker_profiles VALUES (?, 1, ?)").run(account.wtsUserId, JSON.stringify(speaker));
  }
  if (!db.prepare("SELECT wts_user_id FROM applicant_settings WHERE wts_user_id=?").get(account.wtsUserId)) {
    db.prepare("INSERT INTO applicant_settings VALUES (?, 1, ?)").run(account.wtsUserId, JSON.stringify({ preferredContactMethod: "", companyCoverExpenses: null }));
  }
}
const versionRowSchema = z.strictObject({ revision: revisionSchema, value_json: z.string() });
function applicant(db: DatabaseSync, account: VerifiedCfpAccount): ApplicantView {
  const speaker = versionRowSchema.parse(db.prepare("SELECT revision, value_json FROM speaker_profiles WHERE wts_user_id=?").get(account.wtsUserId));
  const settings = versionRowSchema.parse(db.prepare("SELECT revision, value_json FROM applicant_settings WHERE wts_user_id=?").get(account.wtsUserId));
  return { email: account.email, speaker: { revision: speaker.revision, value: speakerProfileSchema.parse(JSON.parse(speaker.value_json)) }, settings: { revision: settings.revision, value: applicantSettingsSchema.parse(JSON.parse(settings.value_json)) } };
}
const applicationRowSchema = z.strictObject({ application_id: idSchema, revision: revisionSchema, status: z.enum(["pending", "accepted", "rejected"]), presentation_json: z.string(), submitted_at: z.number().int(), updated_at: z.number().int() });
function readApplication(db: DatabaseSync, account: VerifiedCfpAccount, edition: string, id: string): Application {
  const raw = db.prepare("SELECT application_id, revision, status, presentation_json, submitted_at, updated_at FROM applications WHERE application_id=? AND edition_id=? AND wts_user_id=?").get(id, edition, account.wtsUserId);
  if (!raw) throw new CfpError("not_found", "The application was not found.");
  const row = applicationRowSchema.parse(raw);
  return { id: row.application_id, revision: row.revision, status: row.status, presentation: presentationSchema.parse(JSON.parse(row.presentation_json)), submittedAt: row.submitted_at, updatedAt: row.updated_at };
}
const draftRowSchema = z.strictObject({ draft_id: idSchema, revision: revisionSchema, purpose_json: z.string(), state: z.enum(["active", "committed"]), presentation_json: z.string(), created_at: z.number().int(), updated_at: z.number().int() });
function readDraft(db: DatabaseSync, account: VerifiedCfpAccount, edition: string, id: string): Draft {
  const raw = db.prepare("SELECT draft_id, revision, purpose_json, state, presentation_json, created_at, updated_at FROM drafts WHERE draft_id=? AND edition_id=? AND wts_user_id=?").get(id, edition, account.wtsUserId);
  if (!raw) throw new CfpError("not_found", "The draft was not found.");
  const row = draftRowSchema.parse(raw);
  let state: Draft["state"];
  if (row.state === "active") state = { kind: "active", presentation: presentationSchema.parse(JSON.parse(row.presentation_json)) };
  else {
    const receipt = db.prepare("SELECT receipt_json FROM submission_receipts WHERE draft_id=? AND edition_id=? AND wts_user_id=?").get(id, edition, account.wtsUserId);
    if (typeof receipt?.receipt_json !== "string") throw new Error("The committed draft has no receipt.");
    state = { kind: "committed", receipt: submissionReceiptSchema.parse(JSON.parse(receipt.receipt_json)) };
  }
  return { id: row.draft_id, revision: row.revision, purpose: draftPurposeSchema.parse(JSON.parse(row.purpose_json)), state, createdAt: row.created_at, updatedAt: row.updated_at };
}
function checkRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new CfpError("conflict", "The saved record changed. Reload it before saving.");
}
function checkEditTarget(db: DatabaseSync, account: VerifiedCfpAccount, edition: string, purpose: DraftPurpose): void {
  if (purpose.kind !== "edit") return;
  const target = readApplication(db, account, edition, purpose.targetId);
  if (target.status !== "pending") throw new CfpError("finalized", "The application is finalized. Use Reuse to create a new draft.");
  checkRevision(target.revision, purpose.targetRevision);
}
const richTextOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "code", "pre", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "a"],
  allowedAttributes: { a: ["href", "title"] }, allowedSchemes: ["http", "https", "mailto"], allowProtocolRelative: false,
};
function cleanPresentation(value: Presentation): Presentation {
  return parseCommand(presentationSchema, { ...value, abstract: sanitizeHtml(value.abstract, richTextOptions), keyTakeaways: sanitizeHtml(value.keyTakeaways, richTextOptions) });
}
function applyApplicantChange(db: DatabaseSync, account: VerifiedCfpAccount, command: ApplicantChange): void {
  const current = applicant(db, account);
  if (command.speaker) checkRevision(current.speaker.revision, command.speaker.expectedRevision);
  if (command.settings) checkRevision(current.settings.revision, command.settings.expectedRevision);
  if (command.speaker) {
    const value = speakerProfileSchema.parse({ ...current.speaker.value, ...command.speaker.changes });
    db.prepare("UPDATE speaker_profiles SET revision=revision+1, value_json=? WHERE wts_user_id=?").run(JSON.stringify(value), account.wtsUserId);
  }
  if (command.settings) {
    const value = applicantSettingsSchema.parse({ ...current.settings.value, ...command.settings.changes });
    db.prepare("UPDATE applicant_settings SET revision=revision+1, value_json=? WHERE wts_user_id=?").run(JSON.stringify(value), account.wtsUserId);
  }
}
export function getCfpStatus(): { editionId: string; cfpOpen: boolean } {
  const edition = editionId(); const db = openCfpDatabase();
  try { return { editionId: edition, cfpOpen: gate(db, edition) }; } finally { db.close(); }
}
export function getWorkspace(account: VerifiedCfpAccount): Workspace {
  const edition = editionId(); const db = openCfpDatabase();
  try {
    return transaction(db, () => {
      const cfpOpen = gate(db, edition); provision(db, account);
      const drafts = db.prepare("SELECT draft_id FROM drafts WHERE edition_id=? AND wts_user_id=? AND state='active' ORDER BY updated_at DESC, draft_id").all(edition, account.wtsUserId).map((row) => {
        const draft = readDraft(db, account, edition, idSchema.parse(row.draft_id));
        if (draft.state.kind !== "active") throw new Error("The active draft state is invalid.");
        return { id: draft.id, title: draft.state.presentation.title, purpose: draft.purpose, updatedAt: draft.updatedAt };
      });
      const applications = db.prepare("SELECT application_id FROM applications WHERE edition_id=? AND wts_user_id=? ORDER BY submitted_at DESC, application_id").all(edition, account.wtsUserId).map((row) => {
        const application = readApplication(db, account, edition, idSchema.parse(row.application_id));
        return { id: application.id, title: application.presentation.title, status: application.status, revision: application.revision, submittedAt: application.submittedAt };
      });
      return { ...applicant(db, account), cfpOpen, drafts, applications };
    });
  } finally { db.close(); }
}
export function getApplication(account: VerifiedCfpAccount, id: string): ApplicationView {
  id = parseCommand(idSchema, id);
  const edition = editionId(); const db = openCfpDatabase();
  try { return transaction(db, () => {
    const application = readApplication(db, account, edition, id);
    return { ...applicant(db, account), application, cfpOpen: gate(db, edition) };
  }); }
  finally { db.close(); }
}
export function getDraft(account: VerifiedCfpAccount, id: string): DraftView {
  id = parseCommand(idSchema, id);
  const edition = editionId(); const db = openCfpDatabase();
  try { return transaction(db, () => {
    const draft = readDraft(db, account, edition, id);
    return { ...applicant(db, account), draft, cfpOpen: gate(db, edition) };
  }); }
  finally { db.close(); }
}
export function startDraft(account: VerifiedCfpAccount, command: StartDraftCommand): DraftView {
  command = parseCommand(startDraftSchema, command);
  const edition = editionId(); const db = openCfpDatabase();
  try {
    return transaction(db, () => {
      const existing = db.prepare("SELECT draft_id, intent_json FROM drafts WHERE edition_id=? AND wts_user_id=? AND request_id=?").get(edition, account.wtsUserId, command.requestId);
      if (existing) {
        if (existing.intent_json !== JSON.stringify(command.intent)) throw new CfpError("conflict", "The draft request already has a different intent.");
        return { ...applicant(db, account), draft: readDraft(db, account, edition, idSchema.parse(existing.draft_id)), cfpOpen: gate(db, edition) };
      }
      requireOpen(db, edition);
      let purpose: DraftPurpose = { kind: "new" };
      let presentation = blankPresentation();
      if (command.intent.kind !== "new") {
        const source = readApplication(db, account, edition, command.intent.applicationId);
        if (command.intent.kind === "edit") {
          if (source.status !== "pending") throw new CfpError("finalized", "The application is finalized. Use Reuse to create a new draft.");
          checkRevision(source.revision, command.intent.expectedRevision);
          purpose = { kind: "edit", targetId: source.id, targetRevision: source.revision };
        } else {
          if (source.status === "pending") throw new CfpError("conflict", "Use Edit for a pending application.");
          purpose = { kind: "reuse", sourceId: source.id };
        }
        presentation = source.presentation;
      }
      provision(db, account);
      const id = randomUUID(); const now = Date.now();
      db.prepare("INSERT INTO drafts VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)").run(id, edition, account.wtsUserId, command.requestId, JSON.stringify(command.intent), JSON.stringify(purpose), JSON.stringify(presentation), now, now);
      return { ...applicant(db, account), draft: readDraft(db, account, edition, id), cfpOpen: true };
    });
  } finally { db.close(); }
}
export function saveApplicant(account: VerifiedCfpAccount, command: ApplicantChange): ApplicantView {
  command = parseCommand(applicantChangeSchema, command);
  const edition = editionId(); const db = openCfpDatabase();
  try { return transaction(db, () => { gate(db, edition); provision(db, account); applyApplicantChange(db, account, command); return applicant(db, account); }); }
  finally { db.close(); }
}
export function saveDraft(account: VerifiedCfpAccount, command: SaveDraftCommand): DraftView {
  command = parseCommand(saveDraftSchema, command);
  const edition = editionId(); const db = openCfpDatabase();
  try {
    return transaction(db, () => {
      const draft = readDraft(db, account, edition, command.draftId);
      if (draft.state.kind !== "active") throw new CfpError("conflict", "The draft already has a submission receipt.");
      requireOpen(db, edition); checkRevision(draft.revision, command.expectedDraftRevision); checkEditTarget(db, account, edition, draft.purpose);
      const presentation = cleanPresentation(presentationSchema.parse({ ...draft.state.presentation, ...command.presentation }));
      if (command.applicant) applyApplicantChange(db, account, command.applicant);
      db.prepare("UPDATE drafts SET revision=revision+1, presentation_json=?, updated_at=? WHERE draft_id=? AND edition_id=? AND wts_user_id=?").run(JSON.stringify(presentation), Date.now(), draft.id, edition, account.wtsUserId);
      return { ...applicant(db, account), draft: readDraft(db, account, edition, draft.id), cfpOpen: true };
    });
  } finally { db.close(); }
}
export function submitDraft(account: VerifiedCfpAccount, command: SubmitDraftCommand): SubmissionReceipt {
  command = parseCommand(submitDraftSchema, command);
  const edition = editionId(); const db = openCfpDatabase();
  try {
    return transaction(db, () => {
      const draft = readDraft(db, account, edition, command.draftId);
      if (draft.state.kind === "committed") {
        const stored = db.prepare("SELECT witness_json FROM submission_receipts WHERE draft_id=? AND edition_id=? AND wts_user_id=?").get(draft.id, edition, account.wtsUserId);
        if (typeof stored?.witness_json !== "string") throw new Error("The submission witness is missing.");
        const witness = commitWitnessSchema.parse(JSON.parse(stored.witness_json));
        if (witness.draft !== command.expected.draft || witness.speaker !== command.expected.speaker || witness.settings !== command.expected.settings) throw new CfpError("conflict", "The draft committed with a different confirmation.");
        return draft.state.receipt;
      }
      requireOpen(db, edition);
      const current = applicant(db, account);
      checkRevision(draft.revision, command.expected.draft); checkRevision(current.speaker.revision, command.expected.speaker); checkRevision(current.settings.revision, command.expected.settings);
      checkEditTarget(db, account, edition, draft.purpose);
      const presentation = cleanPresentation(draft.state.presentation);
      const issues = submissionIssues({ speaker: current.speaker.value, settings: current.settings.value, presentation });
      if (issues.length) throw new CfpError("invalid_fields", "Complete the required fields before submission.", issues);
      const now = Date.now();
      let receipt: SubmissionReceipt;
      if (draft.purpose.kind === "edit") {
        const applicationRevision = draft.purpose.targetRevision + 1;
        db.prepare("UPDATE applications SET revision=?, presentation_json=?, updated_at=? WHERE application_id=? AND edition_id=? AND wts_user_id=? AND status='pending' AND revision=?").run(applicationRevision, JSON.stringify(presentation), now, draft.purpose.targetId, edition, account.wtsUserId, draft.purpose.targetRevision);
        receipt = { applicationId: draft.purpose.targetId, applicationRevision, operation: "updated", committedAt: now };
      } else {
        const applicationId = randomUUID();
        db.prepare("INSERT INTO applications VALUES (?, ?, ?, 1, 'pending', ?, ?, ?)").run(applicationId, edition, account.wtsUserId, JSON.stringify(presentation), now, now);
        receipt = { applicationId, applicationRevision: 1, operation: "created", committedAt: now };
      }
      db.prepare("INSERT INTO submission_receipts VALUES (?, ?, ?, ?, ?, ?)").run(draft.id, edition, account.wtsUserId, receipt.applicationId, JSON.stringify(command.expected), JSON.stringify(receipt));
      db.prepare("UPDATE drafts SET state='committed', revision=revision+1, presentation_json=?, updated_at=? WHERE draft_id=? AND edition_id=? AND wts_user_id=?").run(JSON.stringify(presentation), now, draft.id, edition, account.wtsUserId);
      db.prepare("INSERT INTO application_presentation_versions VALUES (?,?,?,?,?,?,?)").run(edition, receipt.applicationId, receipt.applicationRevision, JSON.stringify(presentation), draft.id, now, account.email);
      db.prepare("INSERT INTO proposal_staff_state VALUES (?,?,?,0) ON CONFLICT(edition_id,application_id) DO UPDATE SET current_presentation_revision=excluded.current_presentation_revision").run(edition, receipt.applicationId, receipt.applicationRevision);
      enqueueSubmissionConfirmation(db, { editionId: edition, draftId: draft.id, account, receipt, title: presentation.title });
      return receipt;
    });
  } finally { db.close(); }
}
