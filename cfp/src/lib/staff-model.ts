import { z } from "zod";
import { applicantSettingsSchema, editionIdSchema, idSchema, presentationSchema, revisionSchema, type Application, type ApplicationStatus, type ApplicantSettings, type FieldIssue, type Presentation, type SpeakerProfile, type Versioned } from "./cfp-model.ts";
import type { MailStatus } from "./mail-model.ts";

export const CRITERIA = ["relevance", "originality", "depth", "clarity", "takeaways", "engagement"] as const;
export const CRITERION_LABELS = { relevance: "Relevance", originality: "Originality", depth: "Depth", clarity: "Clarity", takeaways: "Takeaways", engagement: "Engagement" } as const;
export type Criterion = typeof CRITERIA[number];
export type CriterionValues<T> = { [K in Criterion]: T };
export type Score = 1 | 2 | 3 | 4 | 5;
export type Weight = 1 | 2 | 3 | 4 | 5 | 6;
export type ReviewScores = CriterionValues<Score>;
export type CriterionWeights = CriterionValues<Weight>;
export type AverageWeights = CriterionValues<number>;
export type EditionId = string;
export type WtsUserId = string;
export type RequestId = string;
export type PresentationRevision = number;
export type AssessmentRevision = number;
export type WeightingRevision = number;
export type AbsentOrRevision = number;
export const wtsUserIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
export const counterSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = counterSchema;
export const staffRoleSchema = z.enum(["admin", "reviewer"]);
export type StaffRole = z.infer<typeof staffRoleSchema>;
const statusSchema = z.enum(["pending", "accepted", "rejected"]);
const stateSchema = z.enum(["active", "revoked", "disabled_restore"]);
export const changeActorSchema = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("staff"), wtsUserId: wtsUserIdSchema }), z.strictObject({ kind: z.literal("maintenance") })]);
export type ChangeActor = z.infer<typeof changeActorSchema>;
const score = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const weight = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);
export const reviewScoresSchema = z.strictObject({ relevance: score, originality: score, depth: score, clarity: score, takeaways: score, engagement: score });
export const criterionWeightsSchema = z.strictObject({ relevance: weight, originality: weight, depth: weight, clarity: weight, takeaways: weight, engagement: weight });
const averagesSchema = z.strictObject({ relevance: z.number().min(1).max(6), originality: z.number().min(1).max(6), depth: z.number().min(1).max(6), clarity: z.number().min(1).max(6), takeaways: z.number().min(1).max(6), engagement: z.number().min(1).max(6) });
export const editionStaffGrantSchema = z.strictObject({ editionId: editionIdSchema, wtsUserId: wtsUserIdSchema, role: staffRoleSchema, revision: revisionSchema, state: stateSchema, changedBy: changeActorSchema, changedAt: timestamp });
export type EditionStaffGrant = z.infer<typeof editionStaffGrantSchema>;
export const proposalAssignmentSchema = z.strictObject({ editionId: editionIdSchema, applicationId: idSchema, reviewerId: wtsUserIdSchema, revision: revisionSchema, state: stateSchema, changedBy: changeActorSchema, changedAt: timestamp });
export type ProposalAssignment = z.infer<typeof proposalAssignmentSchema>;
export const proposalReviewSchema = z.strictObject({ editionId: editionIdSchema, applicationId: idSchema, reviewerId: wtsUserIdSchema, revision: revisionSchema, presentationRevision: revisionSchema, scores: reviewScoresSchema, notes: z.string().max(10000), suspectedAi: z.boolean(), createdAt: timestamp, updatedAt: timestamp });
export type ProposalReview = z.infer<typeof proposalReviewSchema>;
export const ownReviewSchema = proposalReviewSchema.omit({ editionId: true, applicationId: true, reviewerId: true });
export type OwnReview = z.infer<typeof ownReviewSchema>;
export const criterionWeightVoteSchema = z.strictObject({ editionId: editionIdSchema, reviewerId: wtsUserIdSchema, revision: revisionSchema, weights: criterionWeightsSchema, updatedAt: timestamp });
export type CriterionWeightVote = z.infer<typeof criterionWeightVoteSchema>;
export const dailyReportPolicySchema = z.strictObject({ enabled: z.boolean(), timeZone: z.literal("UTC"), localSendTime: z.string().length(5).regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) });
export type DailyReportPolicy = z.infer<typeof dailyReportPolicySchema>;
export const editionReviewPolicySchema = z.strictObject({ editionId: editionIdSchema, revision: revisionSchema, reviewOpen: z.boolean(), dailyReport: dailyReportPolicySchema, reportStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), changedBy: changeActorSchema, changedAt: timestamp });
export type EditionReviewPolicy = z.infer<typeof editionReviewPolicySchema>;
export const weightingSummarySchema = z.strictObject({ revision: counterSchema, averages: averagesSchema, voteCount: counterSchema });
export type WeightingSummary = z.infer<typeof weightingSummarySchema>;
export const rankingSummarySchema = z.strictObject({ averageWeightedScore: z.number().min(1).max(5).nullable(), currentReviewCount: counterSchema, staleReviewCount: counterSchema, totalReviewCount: counterSchema });
export type RankingSummary = z.infer<typeof rankingSummarySchema>;
export const proposalDecisionSchema = z.strictObject({ decisionId: idSchema, requestId: idSchema, editionId: editionIdSchema, applicationId: idSchema, previousStatus: statusSchema, status: statusSchema, applicationRevisionBefore: revisionSchema, applicationRevisionAfter: revisionSchema, presentationRevision: revisionSchema, assessmentRevision: counterSchema, weighting: weightingSummarySchema, ranking: rankingSummarySchema, decidedBy: wtsUserIdSchema, decidedAt: timestamp });
export type ProposalDecision = z.infer<typeof proposalDecisionSchema>;
export const reviewerPresentationSchema = presentationSchema.pick({ title: true, abstract: true, keyTakeaways: true, technicalRequirements: true });
export type ReviewerPresentation = z.infer<typeof reviewerPresentationSchema>;
export type ReviewerReviewState = { kind: "unreviewed" } | { kind: "current"; value: OwnReview } | { kind: "stale"; value: OwnReview; evaluatedPresentation: ReviewerPresentation };
export interface ReviewerProposal { editionId: string; applicationId: string; presentationRevision: number; assignmentRevision: number; presentation: ReviewerPresentation; review: ReviewerReviewState; reviewOpen: boolean }
export interface ReviewerQueueItem { applicationId: string; title: string; presentationRevision: number; reviewState: "unreviewed" | "current" | "stale" }
export interface ReviewerWorkspace { editionId: string; reviewOpen: boolean; queue: ReviewerQueueItem[]; counts: { unreviewed: number; current: number; stale: number }; ownWeightVote: CriterionWeightVote | null; activity: Array<{ label: string; reviewCount: number }> }
export interface StaffAccess { editionId: string; roles: StaffRole[] }
export type RecordedContact = { kind: "unavailable" } | { kind: "submitted"; email: string; recordedAt: number };
export interface AdminProposalSummary { applicationId: string; title: string; status: ApplicationStatus; applicantId: string; applicantName: string; expenseCoverage: ApplicantSettings["companyCoverExpenses"]; submittedAt: number; applicationRevision: number; presentationRevision: number; assessmentRevision: number; ranking: RankingSummary }
export interface AdminProposal { editionId: string; application: Application; presentationRevision: number; assessmentRevision: number; applicant: { wtsUserId: string; contact: RecordedContact }; speaker: Versioned<SpeakerProfile>; settings: Versioned<ApplicantSettings>; reviews: Array<{ value: ProposalReview; freshness: "current" | "stale"; evaluatedPresentation: Presentation }>; assignments: ProposalAssignment[]; decisions: ProposalDecision[]; weighting: WeightingSummary; ranking: RankingSummary }
export const adminQuerySchema = z.strictObject({ status: z.union([statusSchema, z.literal("all")]).optional(), search: z.string().max(500).optional(), expenseCoverage: applicantSettingsSchema.shape.companyCoverExpenses.optional(), reviewState: z.enum(["all", "unreviewed", "current", "stale"]).optional(), sort: z.enum(["score", "submitted", "title", "review-count"]).optional(), page: revisionSchema.optional(), pageSize: z.number().int().min(1).max(100).optional() });
export type AdminQuery = z.infer<typeof adminQuerySchema>;
export interface AdminWorkspace { editionId: string; cfpGate: { open: boolean; revision: number }; reviewPolicy: EditionReviewPolicy; weighting: WeightingSummary; counts: Record<ApplicationStatus, number>; proposals: AdminProposalSummary[]; total: number; page: number; pageSize: number; mail: MailStatus }
export interface StaffDirectoryEntry { wtsUserId: string; speakerName: string | null; adminGrant: EditionStaffGrant | null; reviewerGrant: EditionStaffGrant | null; activeAssignmentCount: number; reviewCount: number }
export interface StaffDirectory { editionId: string; members: StaffDirectoryEntry[]; activeAdminCount: number }
const assignmentChangeSchema = z.strictObject({ applicationId: idSchema, reviewerId: wtsUserIdSchema, expectedRevision: counterSchema, active: z.boolean() });
const targetSchema = z.strictObject({ applicationId: idSchema, expectedApplicationRevision: revisionSchema, expectedPresentationRevision: revisionSchema, expectedAssessmentRevision: counterSchema });
export const staffCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("save-review"), requestId: idSchema, applicationId: idSchema, expectedAssignmentRevision: revisionSchema, expectedPresentationRevision: revisionSchema, expectedReviewRevision: counterSchema, scores: reviewScoresSchema, notes: z.string().max(10000), suspectedAi: z.boolean() }),
  z.strictObject({ kind: z.literal("save-weight-vote"), requestId: idSchema, expectedRevision: counterSchema, weights: criterionWeightsSchema }),
  z.strictObject({ kind: z.literal("set-grant"), requestId: idSchema, wtsUserId: wtsUserIdSchema, role: staffRoleSchema, expectedRevision: counterSchema, active: z.boolean() }),
  z.strictObject({ kind: z.literal("set-assignments"), requestId: idSchema, changes: z.array(assignmentChangeSchema).min(1).max(100).refine((rows) => new Set(rows.map((r) => `${r.applicationId}:${r.reviewerId}`)).size === rows.length, "Duplicate assignment targets are invalid.") }),
  z.strictObject({ kind: z.literal("set-review-policy"), requestId: idSchema, expectedRevision: revisionSchema, reviewOpen: z.boolean(), dailyReport: dailyReportPolicySchema }),
  z.strictObject({ kind: z.literal("set-cfp-gate"), requestId: idSchema, expectedRevision: revisionSchema, open: z.boolean() }),
  z.strictObject({ kind: z.literal("decide-proposals"), requestId: idSchema, expectedWeightingRevision: counterSchema, status: statusSchema, targets: z.array(targetSchema).min(1).max(100).refine((rows) => new Set(rows.map((r) => r.applicationId)).size === rows.length, "Duplicate decision targets are invalid.") }),
]);
export type StaffCommand = z.infer<typeof staffCommandSchema>;
export type SaveReviewCommand = Extract<StaffCommand, { kind: "save-review" }>;
export type SaveWeightVoteCommand = Extract<StaffCommand, { kind: "save-weight-vote" }>;
export type SetGrantCommand = Extract<StaffCommand, { kind: "set-grant" }>;
export type SetAssignmentsCommand = Extract<StaffCommand, { kind: "set-assignments" }>;
export type AssignmentChange = z.infer<typeof assignmentChangeSchema>;
export type SetReviewPolicyCommand = Extract<StaffCommand, { kind: "set-review-policy" }>;
export type SetCfpGateCommand = Extract<StaffCommand, { kind: "set-cfp-gate" }>;
export type DecideProposalsCommand = Extract<StaffCommand, { kind: "decide-proposals" }>;
export type DecisionTarget = z.infer<typeof targetSchema>;
export const staffCommandResultSchemas = {
  "save-review": ownReviewSchema,
  "save-weight-vote": criterionWeightVoteSchema,
  "set-grant": z.strictObject({ grant: editionStaffGrantSchema, revokedAssignmentCount: counterSchema }),
  "set-assignments": z.array(proposalAssignmentSchema).max(100),
  "set-review-policy": editionReviewPolicySchema,
  "set-cfp-gate": z.strictObject({ editionId: editionIdSchema, open: z.boolean(), revision: revisionSchema }),
  "decide-proposals": z.array(proposalDecisionSchema).max(100),
};
export interface StaffCommandResults { "save-review": OwnReview; "save-weight-vote": CriterionWeightVote; "set-grant": { grant: EditionStaffGrant; revokedAssignmentCount: number }; "set-assignments": ProposalAssignment[]; "set-review-policy": EditionReviewPolicy; "set-cfp-gate": { editionId: string; open: boolean; revision: number }; "decide-proposals": ProposalDecision[] }
export interface StaffMutationReceipt<K extends StaffCommand["kind"]> { requestId: string; kind: K; committedAt: number; replayed: boolean; result: StaffCommandResults[K] }
export const nextReviewQuerySchema = z.strictObject({ excludeApplicationId: idSchema.optional() });
export type StaffErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid_fields" | "conflict" | "cfp_closed" | "review_closed" | "finalized" | "last_admin" | "policy_locked" | "unavailable";
export class StaffError extends Error {
  readonly code: StaffErrorCode;
  readonly issues?: FieldIssue[];
  constructor(code: StaffErrorCode, message: string, issues?: FieldIssue[]) {
    super(message); this.name = "StaffError"; this.code = code; this.issues = issues;
  }
}
