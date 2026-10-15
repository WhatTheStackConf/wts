import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { z } from "zod";
import { editionIdSchema, idSchema, submissionReceiptSchema } from "../lib/cfp-model.ts";
import { dailySnapshotSchema, mailAddressSchema, mailIdentity, mailPayloadSchema, mailRecipientSchema, reportDateSchema, type DailySnapshot, type MailPayload, type MailStatus, type MailTickResult, type SubmissionMailInput } from "../lib/mail-model.ts";
import { openCfpDatabase } from "./storage.ts";

const DAY = 86_400_000;
const LEASE = 120_000;
const MAX_ATTEMPTS = 5;
const JOBS_PER_TICK = 20;
const REPORTS_PER_EDITION = 7;
const RETRY_DELAYS = [60_000, 300_000, 1_800_000, 7_200_000];
type Recipient = z.infer<typeof mailRecipientSchema>;
interface MailConfiguration {
  mode: "disabled" | "smtp";
  configured: boolean;
  recipients: Recipient[];
  smtp?: { host: string; port: number; secure: boolean; from: string; user: string; password: string; loopbackTest: boolean };
}
const testAddress = /\.(test|invalid|localhost)$/;
function dailyRecipients(): Recipient[] | null {
  const recipients = z.array(mailRecipientSchema).max(100).parse(JSON.parse(process.env.CFP_DAILY_REPORT_RECIPIENTS ?? "[]"));
  const ids = new Set<string>(); const emails = new Set<string>();
  for (const recipient of recipients) {
    if (ids.has(recipient.wtsUserId) || emails.has(recipient.email.toLowerCase())) return null;
    ids.add(recipient.wtsUserId); emails.add(recipient.email.toLowerCase());
  }
  return recipients;
}
function deliverable(smtp: NonNullable<MailConfiguration["smtp"]>, recipients: Recipient[]): boolean {
  if (smtp.loopbackTest) return testAddress.test(smtp.from) && recipients.every((recipient) => testAddress.test(recipient.email));
  return !!smtp.user && !!smtp.password && !/[\x00-\x1f\x7f]/.test(smtp.user);
}
function smtpSettings(): NonNullable<MailConfiguration["smtp"]> {
  const host = z.string().min(1).max(253).regex(/^[a-zA-Z0-9.:-]+$/).parse(process.env.CFP_SMTP_HOST);
  const portText = z.string().regex(/^\d{1,5}$/).parse(process.env.CFP_SMTP_PORT);
  const port = z.number().int().min(1).max(65535).parse(Number(portText));
  const secure = z.enum(["true", "false"]).parse(process.env.CFP_SMTP_SECURE) === "true";
  const from = mailAddressSchema.parse(process.env.CFP_SMTP_FROM);
  const user = process.env.CFP_SMTP_USER ?? ""; const password = process.env.CFP_SMTP_PASSWORD ?? "";
  const loopbackTest = process.env.NODE_ENV === "test" && ["127.0.0.1", "::1", "localhost"].includes(host);
  return { host, port, secure, from, user, password, loopbackTest };
}
function configuration(): MailConfiguration {
  const mode = process.env.CFP_MAIL_MODE === "smtp" ? "smtp" : "disabled";
  const result: MailConfiguration = { mode, configured: false, recipients: [] };
  try {
    const recipients = dailyRecipients();
    if (!recipients) return result;
    result.recipients = recipients;
    if (mode !== "smtp") return result;
    const smtp = smtpSettings();
    if (!deliverable(smtp, recipients)) return result;
    result.smtp = smtp;
    result.configured = true;
  } catch { /* Invalid configuration must not prevent HTTP reads. */ }
  return result;
}
function eligible(db: DatabaseSync, editionId: string, recipientId: string): boolean {
  return !!db.prepare("SELECT 1 FROM edition_staff_grants WHERE edition_id=? AND wts_user_id=? AND role='admin' AND state='active'").get(editionId, recipientId);
}
function insertJob(db: DatabaseSync, logicalKey: string, editionId: string, recipientId: string, payload: MailPayload, createdAt: number, draftId: string | null, reportDate: string | null): void {
  mailPayloadSchema.parse(payload);
  const identity = mailIdentity(logicalKey);
  db.prepare("INSERT INTO cfp_mail_jobs(job_id,logical_key,edition_id,kind,draft_id,report_date,recipient_id,payload_json,message_id,state,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?,?) ON CONFLICT(logical_key) DO NOTHING")
    .run(identity.jobId, logicalKey, editionId, payload.kind, draftId, reportDate, recipientId, JSON.stringify(payload), identity.messageId, createdAt, createdAt, createdAt);
}
export function enqueueSubmissionConfirmation(db: DatabaseSync, input: SubmissionMailInput): void {
  editionIdSchema.parse(input.editionId); idSchema.parse(input.draftId); submissionReceiptSchema.parse(input.receipt);
  const path = `/applications/${input.receipt.applicationId}`;
  let cfpUrl = path;
  try {
    const origin = new URL(process.env.CFP_ORIGIN ?? "");
    if (["http:", "https:"].includes(origin.protocol) && !origin.username && !origin.password) cfpUrl = new URL(path, origin.origin).href;
  } catch { /* Without an origin, retain the exact CFP application path. */ }
  const payload: MailPayload = {
    kind: "submission", editionId: input.editionId, draftId: input.draftId, receipt: input.receipt, title: input.title, cfpUrl,
    to: input.account.email,
    subject: `WTS ${input.editionId} CFP submission ${input.receipt.operation}`,
    text: `Your WTS ${input.editionId} CFP submission was ${input.receipt.operation}.\n\nTitle: ${input.title}\nApplication: ${input.receipt.applicationId}\nCommitted version: ${input.receipt.applicationRevision}\nCommitted at: ${new Date(input.receipt.committedAt).toISOString()}\nCFP: ${cfpUrl}\n`,
  };
  insertJob(db, `submission:${input.editionId}:${input.draftId}`, input.editionId, input.account.wtsUserId, payload, input.receipt.committedAt, input.draftId, null);
}
export function getMailStatus(db: DatabaseSync, editionId: string): MailStatus {
  editionIdSchema.parse(editionId);
  const config = configuration();
  const status: MailStatus = { mode: config.mode, configured: config.configured, queued: 0, failed: 0, suspended: 0, sent: 0, retrying: 0, deliveryUnknown: 0, eligibleDailyRecipientCount: config.recipients.filter((recipient) => eligible(db, editionId, recipient.wtsUserId)).length };
  for (const row of db.prepare("SELECT state, count(*) AS count FROM cfp_mail_jobs WHERE edition_id=? GROUP BY state").all(editionId)) {
    const count = z.number().int().nonnegative().parse(row.count);
    if (row.state === "queued" || row.state === "leased") status.queued += count;
    else if (row.state === "sent") status.sent = count;
    else if (row.state === "failed") status.failed = count;
    else if (row.state === "suspended") status.suspended = count;
    else if (row.state === "retrying") status.retrying = count;
  }
  status.deliveryUnknown = z.number().int().nonnegative().parse(db.prepare("SELECT count(*) AS count FROM cfp_mail_jobs WHERE edition_id=? AND delivery_unknown=1").get(editionId)?.count);
  return status;
}
const submissionCounts = new Map<SQLOutputValue, keyof DailySnapshot["counts"]>([["created", "submissions"], ["updated", "updates"]]);
const decisionCounts = new Map<SQLOutputValue, keyof DailySnapshot["counts"]>([["accepted", "accepted"], ["rejected", "rejected"], ["pending", "reopened"]]);
const inventoryStatuses = new Set<SQLOutputValue>(["pending", "accepted", "rejected"]);
function reportCounts(db: DatabaseSync, editionId: string, periodStart: number, periodEnd: number): DailySnapshot["counts"] {
  const counts = { submissions: 0, updates: 0, reviews: 0, accepted: 0, rejected: 0, reopened: 0 };
  for (const row of db.prepare("SELECT json_extract(receipt_json,'$.operation') AS operation,count(*) AS count FROM submission_receipts WHERE edition_id=? AND json_extract(receipt_json,'$.committedAt')>=? AND json_extract(receipt_json,'$.committedAt')<? GROUP BY operation").all(editionId, periodStart, periodEnd)) {
    const key = submissionCounts.get(row.operation);
    if (key) counts[key] = Number(row.count);
  }
  counts.reviews = Number(db.prepare("SELECT count(*) AS count FROM staff_command_receipts WHERE edition_id=? AND kind='save-review' AND committed_at>=? AND committed_at<?").get(editionId, periodStart, periodEnd)?.count);
  for (const row of db.prepare("SELECT json_extract(decision_json,'$.status') AS status,count(*) AS count FROM proposal_decisions WHERE edition_id=? AND decided_at>=? AND decided_at<? GROUP BY status").all(editionId, periodStart, periodEnd)) {
    const key = decisionCounts.get(row.status);
    if (key) counts[key] = Number(row.count);
  }
  return counts;
}
function reportInventory(db: DatabaseSync, editionId: string): DailySnapshot["inventory"] {
  const inventory = { pending: 0, accepted: 0, rejected: 0 };
  for (const row of db.prepare("SELECT status,count(*) AS count FROM applications WHERE edition_id=? GROUP BY status").all(editionId)) {
    if (inventoryStatuses.has(row.status)) inventory[row.status as keyof typeof inventory] = Number(row.count);
  }
  return inventory;
}
function reportText({ editionId, reportDate, periodStart, periodEnd, generatedAt, counts, inventory }: DailySnapshot): string {
  return `WTS ${editionId} CFP daily report: ${reportDate} UTC\nPeriod: ${new Date(periodStart).toISOString()} to ${new Date(periodEnd).toISOString()} (exclusive)\nSubmissions: ${counts.submissions}\nSubmission updates: ${counts.updates}\nReview saves: ${counts.reviews}\nAccepted decisions: ${counts.accepted}\nRejected decisions: ${counts.rejected}\nReopened decisions: ${counts.reopened}\n\nInventory at ${new Date(generatedAt).toISOString()}:\nPending: ${inventory.pending}\nAccepted: ${inventory.accepted}\nRejected: ${inventory.rejected}\n`;
}
function createReport(db: DatabaseSync, editionId: string, periodStart: number, now: number, config: MailConfiguration): void {
  const reportDate = new Date(periodStart).toISOString().slice(0, 10);
  const periodEnd = periodStart + DAY;
  const counts = reportCounts(db, editionId, periodStart, periodEnd);
  const inventory = reportInventory(db, editionId);
  const snapshot: DailySnapshot = dailySnapshotSchema.parse({ editionId, reportDate, periodStart, periodEnd, generatedAt: now, counts, inventory });
  db.prepare("INSERT INTO daily_cfp_reports VALUES (?,?,?,?)").run(editionId, reportDate, now, JSON.stringify(snapshot));
  const text = reportText(snapshot);
  for (const recipient of config.recipients) {
    if (!eligible(db, editionId, recipient.wtsUserId)) continue;
    insertJob(db, `daily:${editionId}:${reportDate}:${recipient.wtsUserId}`, editionId, recipient.wtsUserId, { kind: "daily", snapshot, to: recipient.email, subject: `WTS ${editionId} CFP daily report ${reportDate} UTC`, text }, now, null, reportDate);
  }
}
function createEditionReports(db: DatabaseSync, policy: Record<string, SQLOutputValue>, now: number, config: MailConfiguration): number {
  let reportsCreated = 0;
  const editionId = editionIdSchema.parse(policy.edition_id);
  const startDate = reportDateSchema.parse(policy.report_start_date);
  const sendTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).parse(policy.report_local_send_time);
  const last = db.prepare("SELECT max(report_date) AS date FROM daily_cfp_reports WHERE edition_id=?").get(editionId)?.date;
  let periodStart = last ? Date.parse(`${reportDateSchema.parse(last)}T00:00:00Z`) + DAY : Date.parse(`${startDate}T00:00:00Z`);
  periodStart = Math.max(periodStart, Date.parse(`${startDate}T00:00:00Z`));
  const [hour, minute] = sendTime.split(":").map(Number);
  for (let index = 0; index < REPORTS_PER_EDITION && periodStart + DAY + hour! * 3_600_000 + minute! * 60_000 <= now; index++, periodStart += DAY) {
    createReport(db, editionId, periodStart, now, config);
    reportsCreated++;
  }
  return reportsCreated;
}
function createReports(db: DatabaseSync, now: number, config: MailConfiguration): number {
  let reportsCreated = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const policy of db.prepare("SELECT edition_id, report_local_send_time, report_start_date FROM edition_review_policy WHERE daily_report_enabled=1").all()) {
      reportsCreated += createEditionReports(db, policy, now, config);
    }
    db.exec("COMMIT");
    return reportsCreated;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
interface ClaimedJob { jobId: string; editionId: string; recipientId: string; messageId: string; payload: MailPayload; token: string; attempts: number }
function claim(db: DatabaseSync, now: number): ClaimedJob | null {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE cfp_mail_jobs SET state=CASE WHEN attempts>=? THEN 'failed' ELSE 'retrying' END, delivery_unknown=1, last_error='lease_expired', lease_token=NULL, lease_until=NULL, next_attempt_at=?, updated_at=? WHERE state='leased' AND lease_until<=?").run(MAX_ATTEMPTS, now, now, now);
    const row = db.prepare("SELECT * FROM cfp_mail_jobs WHERE state IN ('queued','retrying') AND attempts<? AND next_attempt_at<=? ORDER BY next_attempt_at,created_at,job_id LIMIT 1").get(MAX_ATTEMPTS, now);
    if (!row) { db.exec("COMMIT"); return null; }
    const token = randomUUID();
    db.prepare("UPDATE cfp_mail_jobs SET state='leased', attempts=attempts+1, lease_token=?, lease_until=?, updated_at=? WHERE job_id=?").run(token, now + LEASE, now, row.job_id!);
    const job: ClaimedJob = { jobId: String(row.job_id), editionId: String(row.edition_id), recipientId: String(row.recipient_id), messageId: String(row.message_id), payload: mailPayloadSchema.parse(JSON.parse(String(row.payload_json))), token, attempts: Number(row.attempts) + 1 };
    db.exec("COMMIT");
    return job;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
function canDispatch(db: DatabaseSync, job: ClaimedJob, config: MailConfiguration): boolean {
  if (config.smtp?.loopbackTest && !testAddress.test(job.payload.to)) return false;
  if (job.payload.kind === "submission") return true;
  return config.recipients.some((recipient) => recipient.wtsUserId === job.recipientId && recipient.email === job.payload.to) && eligible(db, job.editionId, job.recipientId);
}
type SmtpSettings = NonNullable<MailConfiguration["smtp"]>;
function smtpTransport(smtp: SmtpSettings) {
  const connection: { socket?: Socket } = {};
  const transportOptions: SMTPTransport.Options = {
    host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: !smtp.loopbackTest,
    auth: smtp.user && smtp.password ? { user: smtp.user, pass: smtp.password } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    disableFileAccess: true, disableUrlAccess: true,
    tls: { rejectUnauthorized: true },
    getSocket(_options, callback) {
      const socket = connect({ host: smtp.host, port: smtp.port });
      connection.socket = socket;
      const failed = (error: Error) => { socket.destroy(); callback(error, false); };
      socket.once("error", failed);
      socket.setTimeout(10_000, () => socket.destroy(new Error("The SMTP connection timed out.")));
      socket.once("connect", () => {
        socket.removeListener("error", failed);
        socket.setTimeout(0);
        callback(null, { connection: socket });
      });
    },
  };
  return { connection, transport: nodemailer.createTransport(transportOptions) };
}
function smtpResponseCode(error: unknown): number {
  return typeof error === "object" && error !== null && "responseCode" in error ? Number(error.responseCode) : 0;
}
function recordDeliveryFailure(db: DatabaseSync, job: ClaimedJob, attemptNow: number, error: unknown): number {
  const responseCode = smtpResponseCode(error);
  const permanent = responseCode >= 500 && responseCode < 600;
  const exhausted = job.attempts >= MAX_ATTEMPTS;
  const state = permanent || exhausted ? "failed" : "retrying";
  const reason = permanent ? "smtp_permanent" : exhausted ? "attempts_exhausted" : "smtp_transient";
  const unknown = !responseCode;
  const delay = RETRY_DELAYS[Math.min(job.attempts - 1, RETRY_DELAYS.length - 1)]!;
  return Number(db.prepare("UPDATE cfp_mail_jobs SET state=?,next_attempt_at=?,updated_at=?,lease_token=NULL,lease_until=NULL,last_error=?,delivery_unknown=CASE WHEN ? THEN 1 ELSE delivery_unknown END WHERE job_id=? AND state='leased' AND lease_token=?").run(state, attemptNow + delay, attemptNow, reason, Number(unknown), job.jobId, job.token).changes);
}
async function deliver(db: DatabaseSync, job: ClaimedJob, smtp: SmtpSettings, attemptNow: number): Promise<{ sent: number; failed: number }> {
  const { connection, transport } = smtpTransport(smtp);
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      transport.sendMail({ from: smtp.from, to: job.payload.to, subject: job.payload.subject, text: job.payload.text, messageId: job.messageId, date: new Date(attemptNow), disableFileAccess: true, disableUrlAccess: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { connection.socket?.destroy(); transport.close(); reject(new Error("The SMTP deadline expired.")); }, 45_000); }),
    ]);
    return { sent: Number(db.prepare("UPDATE cfp_mail_jobs SET state='sent', sent_at=?, updated_at=?, lease_token=NULL,lease_until=NULL,last_error=NULL,delivery_unknown=0 WHERE job_id=? AND state='leased' AND lease_token=?").run(attemptNow, attemptNow, job.jobId, job.token).changes), failed: 0 };
  } catch (error) {
    return { sent: 0, failed: recordDeliveryFailure(db, job, attemptNow, error) };
  } finally { clearTimeout(timer); connection.socket?.destroy(); transport.close(); }
}
export async function runMailTick(now = Date.now(), dataDir?: string): Promise<MailTickResult> {
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(now);
  const config = configuration();
  const result: MailTickResult = { reportsCreated: 0, sent: 0, failed: 0, suspended: 0, disabled: config.mode !== "smtp" || !config.configured };
  if (result.disabled || !config.smtp) return result;
  const smtp = config.smtp;
  const db = openCfpDatabase(dataDir);
  const started = performance.now();
  try {
    result.reportsCreated = createReports(db, now, config);
    for (let index = 0; index < JOBS_PER_TICK; index++) {
      const attemptNow = now + Math.floor(performance.now() - started);
      const job = claim(db, attemptNow);
      if (!job) break;
      if (!canDispatch(db, job, config)) {
        result.suspended += Number(db.prepare("UPDATE cfp_mail_jobs SET state='suspended', lease_token=NULL, lease_until=NULL, last_error='recipient_ineligible',updated_at=? WHERE job_id=? AND state='leased' AND lease_token=?").run(attemptNow, job.jobId, job.token).changes);
        continue;
      }
      const delivery = await deliver(db, job, smtp, attemptNow);
      result.sent += delivery.sent;
      result.failed += delivery.failed;
    }
    return result;
  } finally { db.close(); }
}
export function resumeRestoredMail(editionId: string, jobIds: string[], dataDir?: string): number {
  editionIdSchema.parse(editionId);
  const ids = z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(100).parse(jobIds);
  if (new Set(ids).size !== ids.length) throw new Error("Supply each mail job ID once.");
  const config = configuration();
  const db = openCfpDatabase(dataDir);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const rows = ids.map((jobId) => {
        const row = db.prepare("SELECT * FROM cfp_mail_jobs WHERE job_id=? AND edition_id=? AND state='suspended'").get(jobId, editionId);
        if (!row) throw new Error("Select suspended jobs from the named edition.");
        const payload = mailPayloadSchema.parse(JSON.parse(String(row.payload_json)));
        if (payload.kind === "daily" && (!eligible(db, editionId, String(row.recipient_id)) || !config.recipients.some((recipient) => recipient.wtsUserId === row.recipient_id && recipient.email === payload.to))) throw new Error("Reconcile the daily recipient before resuming this job.");
        return row;
      });
      const now = Date.now();
      for (const row of rows) db.prepare("UPDATE cfp_mail_jobs SET state='queued', attempts=0,next_attempt_at=?,updated_at=?,last_error=NULL WHERE job_id=? AND state='suspended'").run(now, now, row.job_id!);
      db.exec("COMMIT");
      return rows.length;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
