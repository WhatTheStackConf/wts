import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { VerifiedCfpAccount } from "./account-model.ts";
import { editionIdSchema, idSchema, submissionReceiptSchema, type SubmissionReceipt } from "./cfp-model.ts";

export interface SubmissionMailInput {
  editionId: string;
  draftId: string;
  account: VerifiedCfpAccount;
  receipt: SubmissionReceipt;
  title: string;
}
export interface MailStatus {
  mode: "disabled" | "smtp";
  configured: boolean;
  queued: number;
  failed: number;
  suspended: number;
  sent: number;
  retrying: number;
  deliveryUnknown: number;
  eligibleDailyRecipientCount: number;
}
export interface MailTickResult {
  reportsCreated: number;
  sent: number;
  failed: number;
  suspended: number;
  disabled: boolean;
}
export const mailAddressSchema = z.email().max(320).refine((value) => /^[\x21-\x7e]+$/.test(value) && !/[<>\r\n]/.test(value));
export const mailRecipientSchema = z.strictObject({ wtsUserId: z.string().min(1).max(200).refine((value) => !/[\x00-\x1f\x7f]/.test(value)), email: mailAddressSchema });
export const reportDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
});
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = count;
export const dailySnapshotSchema = z.strictObject({
  editionId: editionIdSchema,
  reportDate: reportDateSchema,
  periodStart: timestamp,
  periodEnd: timestamp,
  generatedAt: timestamp,
  counts: z.strictObject({ submissions: count, updates: count, reviews: count, accepted: count, rejected: count, reopened: count }),
  inventory: z.strictObject({ pending: count, accepted: count, rejected: count }),
});
export type DailySnapshot = z.infer<typeof dailySnapshotSchema>;
const delivery = {
  to: mailAddressSchema,
  subject: z.string().min(1).max(200).refine((value) => !/[\x00-\x1f\x7f]/.test(value)),
  text: z.string().min(1).max(100_000),
};
export const mailPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...delivery, kind: z.literal("submission"), editionId: editionIdSchema, draftId: idSchema, title: z.string().max(50_000), receipt: submissionReceiptSchema, cfpUrl: z.string().max(2000).refine((value) => /^\/applications\/[0-9a-f-]+$/.test(value) || z.url().safeParse(value).success) }),
  z.strictObject({ ...delivery, kind: z.literal("daily"), snapshot: dailySnapshotSchema }),
]);
export type MailPayload = z.infer<typeof mailPayloadSchema>;
export function mailIdentity(logicalKey: string): { jobId: string; messageId: string } {
  const jobId = createHash("sha256").update(logicalKey).digest("hex");
  return { jobId, messageId: `<${jobId}@cfp.wts.local>` };
}
export function suspendMailForRestore(db: DatabaseSync, now: number): void {
  timestamp.parse(now);
  db.prepare("UPDATE cfp_mail_jobs SET state='suspended', lease_token=NULL, lease_until=NULL, delivery_unknown=CASE WHEN state='leased' THEN 1 ELSE delivery_unknown END, last_error='restored', updated_at=? WHERE state<>'sent'").run(now);
}
export function validateMailDatabase(db: DatabaseSync): void {
  for (const row of db.prepare("SELECT * FROM daily_cfp_reports").all()) {
    const snapshot = dailySnapshotSchema.parse(JSON.parse(String(row.snapshot_json)));
    const start = Date.parse(`${snapshot.reportDate}T00:00:00.000Z`);
    if (snapshot.editionId !== row.edition_id || snapshot.reportDate !== row.report_date || snapshot.generatedAt !== row.generated_at || snapshot.periodStart !== start || snapshot.periodEnd !== start + 86_400_000 || snapshot.generatedAt < snapshot.periodEnd) throw new Error("The daily report snapshot is inconsistent.");
  }
  for (const row of db.prepare("SELECT * FROM cfp_mail_jobs").all()) {
    const payload = mailPayloadSchema.parse(JSON.parse(String(row.payload_json)));
    const identity = mailIdentity(String(row.logical_key));
    if (row.job_id !== identity.jobId || row.message_id !== identity.messageId || row.kind !== payload.kind) throw new Error("The mail job identity is inconsistent.");
    const createdAt = timestamp.parse(row.created_at); const updatedAt = timestamp.parse(row.updated_at); timestamp.parse(row.next_attempt_at);
    z.number().int().min(0).max(5).parse(row.attempts);
    if (updatedAt < createdAt) throw new Error("The mail job timestamps are inconsistent.");
    if (row.state === "leased") {
      z.uuid().parse(row.lease_token); timestamp.parse(row.lease_until);
      if (!row.attempts) throw new Error("The mail lease has no delivery attempt.");
    }
    if (row.state === "sent") timestamp.parse(row.sent_at);
    if (payload.kind === "submission") {
      if (row.logical_key !== `submission:${payload.editionId}:${payload.draftId}` || row.edition_id !== payload.editionId || row.draft_id !== payload.draftId || row.report_date !== null) throw new Error("The confirmation source is inconsistent.");
      const receipt = db.prepare("SELECT receipt_json, edition_id, wts_user_id FROM submission_receipts WHERE draft_id=?").get(payload.draftId);
      if (!receipt || receipt.edition_id !== payload.editionId || receipt.wts_user_id !== row.recipient_id || JSON.stringify(submissionReceiptSchema.parse(JSON.parse(String(receipt.receipt_json)))) !== JSON.stringify(payload.receipt)) throw new Error("The confirmation receipt is inconsistent.");
    } else {
      const snapshot = payload.snapshot;
      if (row.logical_key !== `daily:${snapshot.editionId}:${snapshot.reportDate}:${row.recipient_id}` || row.edition_id !== snapshot.editionId || row.report_date !== snapshot.reportDate || row.draft_id !== null) throw new Error("The report delivery source is inconsistent.");
      const report = db.prepare("SELECT snapshot_json FROM daily_cfp_reports WHERE edition_id=? AND report_date=?").get(snapshot.editionId, snapshot.reportDate);
      if (!report || JSON.stringify(dailySnapshotSchema.parse(JSON.parse(String(report.snapshot_json)))) !== JSON.stringify(snapshot)) throw new Error("The report delivery snapshot is inconsistent.");
    }
  }
}
