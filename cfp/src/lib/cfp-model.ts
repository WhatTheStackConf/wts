import { z } from "zod";

export const idSchema = z.uuid();
export const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const editionIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const text = z.string().max(50_000);
export const speakerProfileSchema = z.strictObject({
  fullName: z.string().max(200), affiliation: z.string().max(500), bio: text,
  socialHandles: z.array(z.string().max(500)).max(30), previousTalks: text,
});
export const applicantSettingsSchema = z.strictObject({
  preferredContactMethod: z.string().max(500), companyCoverExpenses: z.enum(["Yes", "No", "Other"]).nullable(),
});
export const presentationSchema = z.strictObject({
  title: z.string().max(500), abstract: text, keyTakeaways: text, technicalRequirements: text,
  previousPresentation: text, organizerNotes: text, additionalInfo: text,
});
export type SpeakerProfile = z.infer<typeof speakerProfileSchema>;
export type ApplicantSettings = z.infer<typeof applicantSettingsSchema>;
export type Presentation = z.infer<typeof presentationSchema>;
export type ExpenseCoverage = NonNullable<ApplicantSettings["companyCoverExpenses"]>;
export type Revision = number;
export type DraftId = string;
export type ApplicationId = string;
export type RequestId = string;
export type Timestamp = number;
export interface Versioned<T> { revision: number; value: T }
export const draftPurposeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new") }),
  z.strictObject({ kind: z.literal("reuse"), sourceId: idSchema }),
  z.strictObject({ kind: z.literal("edit"), targetId: idSchema, targetRevision: revisionSchema }),
]);
export type DraftPurpose = z.infer<typeof draftPurposeSchema>;
export const commitWitnessSchema = z.strictObject({ draft: revisionSchema, speaker: revisionSchema, settings: revisionSchema });
export type CommitWitness = z.infer<typeof commitWitnessSchema>;
export const submissionReceiptSchema = z.strictObject({
  applicationId: idSchema, applicationRevision: revisionSchema, operation: z.enum(["created", "updated"]),
  committedAt: z.number().int().nonnegative(),
});
export type SubmissionReceipt = z.infer<typeof submissionReceiptSchema>;
export type DraftState = { kind: "active"; presentation: Presentation } | { kind: "committed"; receipt: SubmissionReceipt };
export interface Draft { id: string; revision: number; purpose: DraftPurpose; state: DraftState; createdAt: number; updatedAt: number }
export type ApplicationStatus = "pending" | "accepted" | "rejected";
export interface Application { id: string; revision: number; status: ApplicationStatus; presentation: Presentation; submittedAt: number; updatedAt: number }
export interface ApplicantView { email: string; speaker: Versioned<SpeakerProfile>; settings: Versioned<ApplicantSettings> }
export interface DraftView extends ApplicantView { draft: Draft; cfpOpen: boolean }
export interface ApplicationView extends ApplicantView { application: Application; cfpOpen: boolean }
export interface DraftSummary { id: string; title: string; purpose: DraftPurpose; updatedAt: number }
export interface ApplicationSummary { id: string; title: string; status: ApplicationStatus; revision: number; submittedAt: number }
export interface Workspace extends ApplicantView { cfpOpen: boolean; drafts: DraftSummary[]; applications: ApplicationSummary[] }

const speakerChanges = speakerProfileSchema.partial().refine((value) => Object.keys(value).length > 0 && Object.values(value).every((item) => item !== undefined), "Supply a nonempty speaker change without undefined values.");
const settingsChanges = applicantSettingsSchema.partial().refine((value) => Object.keys(value).length > 0 && Object.values(value).every((item) => item !== undefined), "Supply a nonempty settings change without undefined values.");
export const applicantChangeSchema = z.strictObject({
  speaker: z.strictObject({ expectedRevision: revisionSchema, changes: speakerChanges }).optional(),
  settings: z.strictObject({ expectedRevision: revisionSchema, changes: settingsChanges }).optional(),
}).refine((value) => !!(value.speaker || value.settings), "Supply an applicant change.");
export const startDraftSchema = z.strictObject({
  requestId: idSchema,
  intent: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("new") }),
    z.strictObject({ kind: z.literal("reuse"), applicationId: idSchema }),
    z.strictObject({ kind: z.literal("edit"), applicationId: idSchema, expectedRevision: revisionSchema }),
  ]),
});
export const saveDraftSchema = z.strictObject({
  draftId: idSchema, expectedDraftRevision: revisionSchema,
  presentation: presentationSchema.partial().refine((value) => Object.keys(value).length > 0 && Object.values(value).every((item) => item !== undefined), "Supply a nonempty presentation change without undefined values.").optional(),
  applicant: applicantChangeSchema.optional(),
}).refine((value) => !!(value.presentation || value.applicant), "Supply a draft change.");
export const submitDraftSchema = z.strictObject({ draftId: idSchema, expected: commitWitnessSchema });
export type ApplicantChange = z.infer<typeof applicantChangeSchema>;
export type StartDraftCommand = z.infer<typeof startDraftSchema>;
export type SaveDraftCommand = z.infer<typeof saveDraftSchema>;
export type SubmitDraftCommand = z.infer<typeof submitDraftSchema>;
export type FieldPath = `speaker.${keyof SpeakerProfile}` | `settings.${keyof ApplicantSettings}` | `presentation.${keyof Presentation}`;
export interface FieldIssue { field: string; message: string }
export type CfpErrorCode = "invalid_fields" | "conflict" | "not_found" | "cfp_closed" | "finalized";
export class CfpError extends Error {
  readonly code: CfpErrorCode;
  readonly issues?: FieldIssue[];
  constructor(code: CfpErrorCode, message: string, issues?: FieldIssue[]) {
    super(message); this.name = "CfpError"; this.code = code; this.issues = issues;
  }
}
function hasHtmlText(value: string): boolean {
  return value.replace(/<[^>]*>/g, "").replace(/&(?:nbsp|ensp|emsp|thinsp|ZeroWidthSpace|zwnj|zwj);/gi, " ")
    .replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_, hex: string | undefined, decimal: string | undefined) => {
      const code = hex ? parseInt(hex, 16) : Number(decimal);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }).replace(/[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "").length > 0;
}
export function submissionIssues(input: { speaker: SpeakerProfile; settings: ApplicantSettings; presentation: Presentation }): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!input.speaker.fullName.trim()) issues.push({ field: "speaker.fullName", message: "Enter your full name." });
  if (!input.speaker.bio.trim()) issues.push({ field: "speaker.bio", message: "Enter a short bio." });
  if (input.settings.companyCoverExpenses === null) issues.push({ field: "settings.companyCoverExpenses", message: "Select an expense choice." });
  if (!input.presentation.title.trim()) issues.push({ field: "presentation.title", message: "Enter a presentation title." });
  if (!hasHtmlText(input.presentation.abstract)) issues.push({ field: "presentation.abstract", message: "Enter an abstract." });
  if (!hasHtmlText(input.presentation.keyTakeaways)) issues.push({ field: "presentation.keyTakeaways", message: "Enter the key takeaways." });
  return issues;
}
export function blankPresentation(): Presentation {
  return { title: "", abstract: "", keyTakeaways: "", technicalRequirements: "", previousPresentation: "", organizerNotes: "", additionalInfo: "" };
}
