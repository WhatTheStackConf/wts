import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { z } from "zod";
import type { VerifiedCfpAccount } from "../lib/account-model.ts";
import { applicantSettingsSchema, editionIdSchema, idSchema, presentationSchema, speakerProfileSchema, type Application } from "../lib/cfp-model.ts";
import { CRITERIA, StaffError, adminQuerySchema, criterionWeightVoteSchema, editionReviewPolicySchema, editionStaffGrantSchema, nextReviewQuerySchema, ownReviewSchema, proposalAssignmentSchema, proposalDecisionSchema, proposalReviewSchema, reviewerPresentationSchema, staffCommandResultSchemas, staffCommandSchema, wtsUserIdSchema, type AdminProposal, type AdminProposalSummary, type AdminQuery, type AdminWorkspace, type ChangeActor, type CriterionWeightVote, type EditionStaffGrant, type EditionReviewPolicy, type ProposalAssignment, type ProposalDecision, type ProposalReview, type RankingSummary, type ReviewerProposal, type ReviewerWorkspace, type StaffAccess, type StaffCommand, type StaffCommandResults, type StaffDirectory, type StaffMutationReceipt, type StaffRole, type WeightingSummary } from "../lib/staff-model.ts";
import { getMailStatus } from "./cfp-mail.ts";
import { openCfpDatabase } from "./storage.ts";

type Row = Record<string, SQLOutputValue>;
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new StaffError("invalid_fields", "Check the supplied fields.", result.error.issues.map((issue) => ({ field: issue.path.join("."), message: "This field is invalid." })));
  return result.data;
}
function editionId(): string { return editionIdSchema.parse(process.env.CFP_EDITION_ID); }
function n(value: unknown): number { return z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(value); }
function s(value: unknown): string { return z.string().parse(value); }
function json(value: unknown): unknown { return JSON.parse(s(value)); }
function withDatabase<T>(write: boolean, run: (db: DatabaseSync, edition: string) => T): T {
  const edition = editionId(); const db = openCfpDatabase();
  try {
    db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try { const value = run(db, edition); db.exec("COMMIT"); return value; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR" && /locked|busy/i.test(error.message)) throw new StaffError("unavailable", "The staff database is busy. Try again later.");
    throw error;
  } finally { db.close(); }
}
function access(db: DatabaseSync, edition: string, user: string): StaffAccess {
  return { editionId: edition, roles: db.prepare("SELECT role FROM edition_staff_grants WHERE edition_id=? AND wts_user_id=? AND state='active' ORDER BY role").all(edition, user).map((row) => z.enum(["admin", "reviewer"]).parse(row.role)) };
}
function requireRole(db: DatabaseSync, edition: string, user: string, role: StaffRole): void {
  if (!access(db, edition, user).roles.includes(role)) throw new StaffError("forbidden", "This account does not have the required CFP role.");
}
function missing(): never { throw new StaffError("not_found", "The proposal was not found."); }
function conflict(actual: number, expected: number): void { if (actual !== expected) throw new StaffError("conflict", "The saved record changed. Reload it before saving."); }
function policyRow(db: DatabaseSync, edition: string): Row {
  const row = db.prepare("SELECT * FROM edition_review_policy WHERE edition_id=?").get(edition);
  if (!row) throw new StaffError("unavailable", "Initialize the CFP edition before staff access.");
  return row;
}
function policy(row: Row): EditionReviewPolicy {
  return editionReviewPolicySchema.parse({ editionId: row.edition_id, revision: row.revision, reviewOpen: row.review_open === 1, dailyReport: { enabled: row.daily_report_enabled === 1, timeZone: row.report_time_zone, localSendTime: row.report_local_send_time }, reportStartDate: row.report_start_date, changedBy: json(row.changed_by_json), changedAt: row.changed_at });
}
function requireReviewOpen(db: DatabaseSync, edition: string): void { if (!policy(policyRow(db, edition)).reviewOpen) throw new StaffError("review_closed", "The review gate is closed."); }
function grant(row: Row): EditionStaffGrant { return editionStaffGrantSchema.parse({ editionId: row.edition_id, wtsUserId: row.wts_user_id, role: row.role, revision: row.revision, state: row.state, changedBy: json(row.changed_by_json), changedAt: row.changed_at }); }
function assignment(row: Row): ProposalAssignment { return proposalAssignmentSchema.parse({ editionId: row.edition_id, applicationId: row.application_id, reviewerId: row.reviewer_id, revision: row.revision, state: row.state, changedBy: json(row.changed_by_json), changedAt: row.changed_at }); }
function review(row: Row): ProposalReview { return proposalReviewSchema.parse({ editionId: row.edition_id, applicationId: row.application_id, reviewerId: row.reviewer_id, revision: row.revision, presentationRevision: row.presentation_revision, scores: { relevance: row.relevance, originality: row.originality, depth: row.depth, clarity: row.clarity, takeaways: row.takeaways, engagement: row.engagement }, notes: row.notes, suspectedAi: row.suspected_ai === 1, createdAt: row.created_at, updatedAt: row.updated_at }); }
function vote(row: Row): CriterionWeightVote { return criterionWeightVoteSchema.parse({ editionId: row.edition_id, reviewerId: row.reviewer_id, revision: row.revision, weights: { relevance: row.relevance, originality: row.originality, depth: row.depth, clarity: row.clarity, takeaways: row.takeaways, engagement: row.engagement }, updatedAt: row.updated_at }); }
function applicationRow(db: DatabaseSync, edition: string, id: string): Row {
  const row = db.prepare("SELECT a.*, st.current_presentation_revision, st.assessment_revision FROM applications a JOIN proposal_staff_state st ON st.edition_id=a.edition_id AND st.application_id=a.application_id WHERE a.edition_id=? AND a.application_id=?").get(edition, id);
  if (!row) missing(); return row;
}
function application(row: Row): Application { return { id: idSchema.parse(row.application_id), revision: n(row.revision), status: z.enum(["pending", "accepted", "rejected"]).parse(row.status), presentation: presentationSchema.parse(json(row.presentation_json)), submittedAt: n(row.submitted_at), updatedAt: n(row.updated_at) }; }
function version(db: DatabaseSync, edition: string, id: string, revision: number): Row {
  const row = db.prepare("SELECT * FROM application_presentation_versions WHERE edition_id=? AND application_id=? AND presentation_revision=?").get(edition, id, revision);
  if (!row) throw new StaffError("unavailable", "The committed presentation is unavailable."); return row;
}
function reviewerResource(db: DatabaseSync, edition: string, user: string, id: string): { row: Row; assigned: ProposalAssignment } {
  const row = applicationRow(db, edition, id);
  const raw = db.prepare("SELECT * FROM proposal_assignments WHERE edition_id=? AND application_id=? AND reviewer_id=? AND state='active'").get(edition, id, user);
  if (!raw || row.status !== "pending" || row.wts_user_id === user) missing();
  return { row, assigned: assignment(raw) };
}
function weighting(db: DatabaseSync, edition: string): WeightingSummary {
  const votes = db.prepare("SELECT * FROM criterion_weight_votes WHERE edition_id=?").all(edition).map(vote);
  const averages = { relevance: 1, originality: 1, depth: 1, clarity: 1, takeaways: 1, engagement: 1 };
  if (votes.length) for (const criterion of CRITERIA) averages[criterion] = votes.reduce((sum, item) => sum + item.weights[criterion], 0) / votes.length;
  return { revision: n(policyRow(db, edition).weighting_revision), averages, voteCount: votes.length };
}
function ranking(db: DatabaseSync, edition: string, id: string, presentationRevision: number, weights: WeightingSummary): RankingSummary {
  const reviews = db.prepare("SELECT * FROM proposal_reviews WHERE edition_id=? AND application_id=?").all(edition, id).map(review);
  const current = reviews.filter((item) => item.presentationRevision === presentationRevision);
  const denominator = CRITERIA.reduce((sum, criterion) => sum + weights.averages[criterion], 0);
  const averageWeightedScore = current.length ? current.reduce((sum, item) => sum + CRITERIA.reduce((score, criterion) => score + weights.averages[criterion] * item.scores[criterion], 0) / denominator, 0) / current.length : null;
  return { averageWeightedScore: averageWeightedScore === null ? null : Math.min(5, Math.max(1, averageWeightedScore)), currentReviewCount: current.length, staleReviewCount: reviews.length - current.length, totalReviewCount: reviews.length };
}
function permittedPresentation(input: unknown) {
  const value = presentationSchema.parse(input);
  return reviewerPresentationSchema.parse({ title: value.title, abstract: value.abstract, keyTakeaways: value.keyTakeaways, technicalRequirements: value.technicalRequirements });
}
function reviewerProposal(db: DatabaseSync, edition: string, user: string, id: string): ReviewerProposal {
  const { row, assigned } = reviewerResource(db, edition, user, id); const presentationRevision = n(row.current_presentation_revision);
  const raw = db.prepare("SELECT * FROM proposal_reviews WHERE edition_id=? AND application_id=? AND reviewer_id=?").get(edition, id, user);
  let state: ReviewerProposal["review"] = { kind: "unreviewed" };
  if (raw) {
    const saved = review(raw); const value = ownReviewSchema.parse({ revision: saved.revision, presentationRevision: saved.presentationRevision, scores: saved.scores, notes: saved.notes, suspectedAi: saved.suspectedAi, createdAt: saved.createdAt, updatedAt: saved.updatedAt });
    state = saved.presentationRevision === presentationRevision ? { kind: "current", value } : { kind: "stale", value, evaluatedPresentation: permittedPresentation(json(version(db, edition, id, saved.presentationRevision).presentation_json)) };
  }
  return { editionId: edition, applicationId: id, assignmentRevision: assigned.revision, presentationRevision, presentation: permittedPresentation(json(row.presentation_json)), review: state, reviewOpen: policy(policyRow(db, edition)).reviewOpen };
}
function reviewerQueue(db: DatabaseSync, edition: string, user: string): ReviewerWorkspace["queue"] {
  return db.prepare("SELECT a.application_id FROM proposal_assignments p JOIN applications a ON a.edition_id=p.edition_id AND a.application_id=p.application_id WHERE p.edition_id=? AND p.reviewer_id=? AND p.state='active' AND a.status='pending' AND a.wts_user_id<>? ORDER BY a.submitted_at,a.application_id").all(edition, user, user).map((row) => { const item = reviewerProposal(db, edition, user, s(row.application_id)); return { applicationId: item.applicationId, title: item.presentation.title, presentationRevision: item.presentationRevision, reviewState: item.review.kind }; });
}
export function getStaffAccess(account: VerifiedCfpAccount): StaffAccess { return withDatabase(false, (db, edition) => access(db, edition, account.wtsUserId)); }
export function getReviewerWorkspace(account: VerifiedCfpAccount): ReviewerWorkspace {
  return withDatabase(false, (db, edition) => {
    requireRole(db, edition, account.wtsUserId, "reviewer"); const queue = reviewerQueue(db, edition, account.wtsUserId); const counts = { unreviewed: 0, current: 0, stale: 0 }; for (const item of queue) counts[item.reviewState]++;
    const raw = db.prepare("SELECT * FROM criterion_weight_votes WHERE edition_id=? AND reviewer_id=?").get(edition, account.wtsUserId);
    const activity = db.prepare("SELECT reviewer_id,count(*) AS count FROM proposal_reviews WHERE edition_id=? GROUP BY reviewer_id ORDER BY reviewer_id").all(edition).map((row, index) => ({ label: `Reviewer ${index + 1}`, reviewCount: n(row.count) }));
    return { editionId: edition, reviewOpen: policy(policyRow(db, edition)).reviewOpen, queue, counts, ownWeightVote: raw ? vote(raw) : null, activity };
  });
}
export function getReviewerProposal(account: VerifiedCfpAccount, applicationId: string): ReviewerProposal { const id = parse(idSchema, applicationId); return withDatabase(false, (db, edition) => { requireRole(db, edition, account.wtsUserId, "reviewer"); return reviewerProposal(db, edition, account.wtsUserId, id); }); }
export function getNextReview(account: VerifiedCfpAccount, query?: { excludeApplicationId?: string }): { applicationId: string } | null {
  const input = parse(nextReviewQuerySchema, query ?? {});
  return withDatabase(false, (db, edition) => { requireRole(db, edition, account.wtsUserId, "reviewer"); const next = reviewerQueue(db, edition, account.wtsUserId).find((item) => item.applicationId !== input.excludeApplicationId && item.reviewState !== "current"); return next ? { applicationId: next.applicationId } : null; });
}
function profile(db: DatabaseSync, user: string): Pick<AdminProposal, "speaker" | "settings"> {
  const speaker = db.prepare("SELECT * FROM speaker_profiles WHERE wts_user_id=?").get(user); const settings = db.prepare("SELECT * FROM applicant_settings WHERE wts_user_id=?").get(user);
  if (!speaker || !settings) throw new StaffError("unavailable", "The applicant profile is unavailable.");
  return { speaker: { revision: n(speaker.revision), value: speakerProfileSchema.parse(json(speaker.value_json)) }, settings: { revision: n(settings.revision), value: applicantSettingsSchema.parse(json(settings.value_json)) } };
}
function adminProposal(db: DatabaseSync, edition: string, id: string): AdminProposal {
  const row = applicationRow(db, edition, id); const presentationRevision = n(row.current_presentation_revision); const weights = weighting(db, edition); const current = version(db, edition, id, presentationRevision);
  return { editionId: edition, application: application(row), presentationRevision, assessmentRevision: n(row.assessment_revision), applicant: { wtsUserId: s(row.wts_user_id), contact: current.submission_email === null ? { kind: "unavailable" } : { kind: "submitted", email: s(current.submission_email), recordedAt: n(current.submitted_at) } }, ...profile(db, s(row.wts_user_id)), reviews: db.prepare("SELECT * FROM proposal_reviews WHERE edition_id=? AND application_id=? ORDER BY reviewer_id").all(edition, id).map((raw) => { const value = review(raw); return { value, freshness: value.presentationRevision === presentationRevision ? "current" : "stale", evaluatedPresentation: presentationSchema.parse(json(version(db, edition, id, value.presentationRevision).presentation_json)) }; }), assignments: db.prepare("SELECT * FROM proposal_assignments WHERE edition_id=? AND application_id=? ORDER BY reviewer_id").all(edition, id).map(assignment), decisions: db.prepare("SELECT decision_json FROM proposal_decisions WHERE edition_id=? AND application_id=? ORDER BY decided_at,decision_id").all(edition, id).map((raw) => proposalDecisionSchema.parse(json(raw.decision_json))), weighting: weights, ranking: ranking(db, edition, id, presentationRevision, weights) };
}
export function getAdminProposal(account: VerifiedCfpAccount, applicationId: string): AdminProposal { const id = parse(idSchema, applicationId); return withDatabase(false, (db, edition) => { requireRole(db, edition, account.wtsUserId, "admin"); return adminProposal(db, edition, id); }); }
export function getAdminWorkspace(account: VerifiedCfpAccount, query?: AdminQuery): AdminWorkspace {
  const input = parse(adminQuerySchema, query ?? {});
  return withDatabase(false, (db, edition) => {
    requireRole(db, edition, account.wtsUserId, "admin"); const weights = weighting(db, edition); const counts = { pending: 0, accepted: 0, rejected: 0 };
    for (const row of db.prepare("SELECT status,count(*) AS count FROM applications WHERE edition_id=? GROUP BY status").all(edition)) counts[z.enum(["pending", "accepted", "rejected"]).parse(row.status)] = n(row.count);
    const status = input.status ?? "pending"; const search = input.search ?? "";
    const rows: AdminProposalSummary[] = db.prepare(`
      SELECT a.*,st.current_presentation_revision,st.assessment_revision,p.value_json AS speaker_json,s.value_json AS settings_json
      FROM applications a JOIN proposal_staff_state st ON st.edition_id=a.edition_id AND st.application_id=a.application_id
      JOIN speaker_profiles p ON p.wts_user_id=a.wts_user_id JOIN applicant_settings s ON s.wts_user_id=a.wts_user_id
      WHERE a.edition_id=? AND (?='all' OR a.status=?)
      AND (?='' OR instr(lower(json_extract(a.presentation_json,'$.title')),lower(?))>0 OR instr(lower(json_extract(p.value_json,'$.fullName')),lower(?))>0)
      AND (?=0 OR json_extract(s.value_json,'$.companyCoverExpenses') IS ?)
    `).all(edition, status, status, search, search, search, Number(input.expenseCoverage !== undefined), input.expenseCoverage ?? null).map((row) => {
      const item = application(row); const speaker = speakerProfileSchema.parse(json(row.speaker_json)); const settings = applicantSettingsSchema.parse(json(row.settings_json));
      return { applicationId: item.id, title: item.presentation.title, status: item.status, applicantId: s(row.wts_user_id), applicantName: speaker.fullName, expenseCoverage: settings.companyCoverExpenses, submittedAt: item.submittedAt, applicationRevision: item.revision, presentationRevision: n(row.current_presentation_revision), assessmentRevision: n(row.assessment_revision), ranking: ranking(db, edition, item.id, n(row.current_presentation_revision), weights) };
    });
    const filtered = rows.filter((row) => !input.reviewState || input.reviewState === "all" || (input.reviewState === "unreviewed" ? row.ranking.totalReviewCount === 0 : input.reviewState === "current" ? row.ranking.currentReviewCount > 0 : row.ranking.staleReviewCount > 0));
    const sort = input.sort ?? "score";
    filtered.sort((a, b) => {
      let difference = 0;
      if (sort === "score") difference = (b.ranking.averageWeightedScore ?? -1) - (a.ranking.averageWeightedScore ?? -1);
      if (sort === "title") difference = a.title.localeCompare(b.title, "en");
      if (sort === "review-count") difference = b.ranking.currentReviewCount - a.ranking.currentReviewCount;
      return difference || a.submittedAt - b.submittedAt || a.applicationId.localeCompare(b.applicationId);
    });
    const page = input.page ?? 1; const pageSize = input.pageSize ?? 50; const pr = policyRow(db, edition); const gate = db.prepare("SELECT cfp_open FROM editions WHERE edition_id=?").get(edition);
    return { editionId: edition, cfpGate: { open: gate?.cfp_open === 1, revision: n(pr.cfp_gate_revision) }, reviewPolicy: policy(pr), weighting: weights, counts, proposals: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, mail: getMailStatus(db, edition) };
  });
}
export function getStaffDirectory(account: VerifiedCfpAccount): StaffDirectory {
  return withDatabase(false, (db, edition) => {
    requireRole(db, edition, account.wtsUserId, "admin");
    const members = db.prepare("SELECT a.wts_user_id,s.value_json FROM cfp_accounts a LEFT JOIN speaker_profiles s ON s.wts_user_id=a.wts_user_id ORDER BY a.wts_user_id").all().map((row) => {
      const user = s(row.wts_user_id); const grants = db.prepare("SELECT * FROM edition_staff_grants WHERE edition_id=? AND wts_user_id=?").all(edition, user).map(grant);
      return { wtsUserId: user, speakerName: row.value_json === null ? null : speakerProfileSchema.parse(json(row.value_json)).fullName, adminGrant: grants.find((item) => item.role === "admin") ?? null, reviewerGrant: grants.find((item) => item.role === "reviewer") ?? null, activeAssignmentCount: n(db.prepare("SELECT count(*) AS count FROM proposal_assignments WHERE edition_id=? AND reviewer_id=? AND state='active'").get(edition, user)?.count), reviewCount: n(db.prepare("SELECT count(*) AS count FROM proposal_reviews WHERE edition_id=? AND reviewer_id=?").get(edition, user)?.count) };
    });
    return { editionId: edition, members, activeAdminCount: members.filter((item) => item.adminGrant?.state === "active").length };
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function storeGrant(db: DatabaseSync, value: EditionStaffGrant): void {
  const actor = JSON.stringify(value.changedBy);
  db.prepare("INSERT INTO edition_staff_grants VALUES (?,?,?,?,?,?,?) ON CONFLICT(edition_id,wts_user_id,role) DO UPDATE SET revision=excluded.revision,state=excluded.state,changed_by_json=excluded.changed_by_json,changed_at=excluded.changed_at").run(value.editionId, value.wtsUserId, value.role, value.revision, value.state, actor, value.changedAt);
  db.prepare("INSERT INTO staff_grant_changes VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), value.editionId, value.wtsUserId, value.role, value.revision, value.state, actor, value.changedAt);
}
function authorizeCommand(db: DatabaseSync, edition: string, user: string, command: StaffCommand): void {
  if (command.kind === "save-review" || command.kind === "save-weight-vote") {
    requireRole(db, edition, user, "reviewer");
    if (command.kind === "save-review") reviewerResource(db, edition, user, command.applicationId);
    requireReviewOpen(db, edition);
  } else {
    requireRole(db, edition, user, "admin");
    if (command.kind === "decide-proposals") for (const target of command.targets) applicationRow(db, edition, target.applicationId);
    if (command.kind === "set-assignments") for (const target of command.changes) applicationRow(db, edition, target.applicationId);
  }
}
function mutate(db: DatabaseSync, edition: string, user: string, command: StaffCommand, now: number): StaffCommandResults[StaffCommand["kind"]] {
  const actor: ChangeActor = { kind: "staff", wtsUserId: user }; const actorJson = JSON.stringify(actor);
  switch (command.kind) {
    case "save-review": {
      const { row, assigned } = reviewerResource(db, edition, user, command.applicationId); const existing = db.prepare("SELECT * FROM proposal_reviews WHERE edition_id=? AND application_id=? AND reviewer_id=?").get(edition, command.applicationId, user);
      conflict(assigned.revision, command.expectedAssignmentRevision); conflict(n(row.current_presentation_revision), command.expectedPresentationRevision); conflict(existing ? n(existing.revision) : 0, command.expectedReviewRevision);
      const values = CRITERIA.map((criterion) => command.scores[criterion]);
      db.prepare("INSERT INTO proposal_reviews VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(edition_id,application_id,reviewer_id) DO UPDATE SET revision=excluded.revision,presentation_revision=excluded.presentation_revision,relevance=excluded.relevance,originality=excluded.originality,depth=excluded.depth,clarity=excluded.clarity,takeaways=excluded.takeaways,engagement=excluded.engagement,notes=excluded.notes,suspected_ai=excluded.suspected_ai,updated_at=excluded.updated_at").run(edition, command.applicationId, user, command.expectedReviewRevision + 1, command.expectedPresentationRevision, ...values, command.notes, Number(command.suspectedAi), existing ? n(existing.created_at) : now, now);
      db.prepare("UPDATE proposal_staff_state SET assessment_revision=assessment_revision+1 WHERE edition_id=? AND application_id=?").run(edition, command.applicationId);
      const saved = reviewerProposal(db, edition, user, command.applicationId).review; if (saved.kind === "unreviewed") throw new Error("The saved review is missing."); return saved.value;
    }
    case "save-weight-vote": {
      const existing = db.prepare("SELECT revision FROM criterion_weight_votes WHERE edition_id=? AND reviewer_id=?").get(edition, user); conflict(existing ? n(existing.revision) : 0, command.expectedRevision);
      db.prepare("INSERT INTO criterion_weight_votes VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(edition_id,reviewer_id) DO UPDATE SET revision=excluded.revision,relevance=excluded.relevance,originality=excluded.originality,depth=excluded.depth,clarity=excluded.clarity,takeaways=excluded.takeaways,engagement=excluded.engagement,updated_at=excluded.updated_at").run(edition, user, command.expectedRevision + 1, ...CRITERIA.map((criterion) => command.weights[criterion]), now);
      db.prepare("UPDATE edition_review_policy SET weighting_revision=weighting_revision+1 WHERE edition_id=?").run(edition);
      return vote(db.prepare("SELECT * FROM criterion_weight_votes WHERE edition_id=? AND reviewer_id=?").get(edition, user)!);
    }
    case "set-grant": {
      if (!db.prepare("SELECT wts_user_id FROM cfp_accounts WHERE wts_user_id=?").get(command.wtsUserId)) throw new StaffError("not_found", "The local account was not found.");
      const existing = db.prepare("SELECT * FROM edition_staff_grants WHERE edition_id=? AND wts_user_id=? AND role=?").get(edition, command.wtsUserId, command.role); conflict(existing ? n(existing.revision) : 0, command.expectedRevision);
      if (!command.active && command.role === "admin" && existing?.state === "active" && n(db.prepare("SELECT count(*) AS count FROM edition_staff_grants WHERE edition_id=? AND role='admin' AND state='active'").get(edition)?.count) <= 1) throw new StaffError("last_admin", "The edition must retain one active admin.");
      const value: EditionStaffGrant = { editionId: edition, wtsUserId: command.wtsUserId, role: command.role, revision: command.expectedRevision + 1, state: command.active ? "active" : "revoked", changedBy: actor, changedAt: now }; storeGrant(db, value);
      const revokedAssignmentCount = !command.active && command.role === "reviewer" ? Number(db.prepare("UPDATE proposal_assignments SET state='revoked',revision=revision+1,changed_by_json=?,changed_at=? WHERE edition_id=? AND reviewer_id=? AND state='active'").run(actorJson, now, edition, command.wtsUserId).changes) : 0;
      return { grant: value, revokedAssignmentCount };
    }
    case "set-assignments": {
      const result: ProposalAssignment[] = [];
      for (const target of command.changes) {
        const row = applicationRow(db, edition, target.applicationId); const existing = db.prepare("SELECT * FROM proposal_assignments WHERE edition_id=? AND application_id=? AND reviewer_id=?").get(edition, target.applicationId, target.reviewerId); conflict(existing ? n(existing.revision) : 0, target.expectedRevision);
        if (target.active) {
          if (row.status !== "pending") throw new StaffError("finalized", "The proposal is finalized.");
          if (row.wts_user_id === target.reviewerId) throw new StaffError("forbidden", "A reviewer cannot review their own proposal.");
          if (!access(db, edition, target.reviewerId).roles.includes("reviewer")) throw new StaffError("forbidden", "The account needs an active reviewer grant.");
        }
        if (!db.prepare("SELECT wts_user_id FROM cfp_accounts WHERE wts_user_id=?").get(target.reviewerId)) throw new StaffError("not_found", "The local account was not found.");
        const value: ProposalAssignment = { editionId: edition, applicationId: target.applicationId, reviewerId: target.reviewerId, revision: target.expectedRevision + 1, state: target.active ? "active" : "revoked", changedBy: actor, changedAt: now };
        db.prepare("INSERT INTO proposal_assignments VALUES (?,?,?,?,?,?,?) ON CONFLICT(edition_id,application_id,reviewer_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,changed_by_json=excluded.changed_by_json,changed_at=excluded.changed_at").run(edition, target.applicationId, target.reviewerId, value.revision, value.state, actorJson, now); result.push(value);
      }
      return result;
    }
    case "set-review-policy": {
      const row = policyRow(db, edition); conflict(n(row.revision), command.expectedRevision);
      const reportStartDate = command.dailyReport.enabled && row.daily_report_enabled !== 1 ? new Date(now).toISOString().slice(0, 10) : row.report_start_date;
      db.prepare("UPDATE edition_review_policy SET revision=revision+1,review_open=?,daily_report_enabled=?,report_time_zone=?,report_local_send_time=?,report_start_date=?,changed_by_json=?,changed_at=? WHERE edition_id=?").run(Number(command.reviewOpen), Number(command.dailyReport.enabled), command.dailyReport.timeZone, command.dailyReport.localSendTime, reportStartDate, actorJson, now, edition);
      return policy(policyRow(db, edition));
    }
    case "set-cfp-gate": {
      const row = policyRow(db, edition); conflict(n(row.cfp_gate_revision), command.expectedRevision);
      const existing = db.prepare("SELECT cfp_open FROM editions WHERE edition_id=?").get(edition);
      if ((existing?.cfp_open === 1) !== command.open) { db.prepare("UPDATE editions SET cfp_open=? WHERE edition_id=?").run(Number(command.open), edition); db.prepare("UPDATE edition_review_policy SET cfp_gate_revision=cfp_gate_revision+1 WHERE edition_id=?").run(edition); }
      return { editionId: edition, open: command.open, revision: n(policyRow(db, edition).cfp_gate_revision) };
    }
    case "decide-proposals": {
      const weights = weighting(db, edition); conflict(weights.revision, command.expectedWeightingRevision);
      const targets = command.targets.map((target) => { const row = applicationRow(db, edition, target.applicationId); conflict(n(row.revision), target.expectedApplicationRevision); conflict(n(row.current_presentation_revision), target.expectedPresentationRevision); conflict(n(row.assessment_revision), target.expectedAssessmentRevision); return row; });
      const decisions: ProposalDecision[] = [];
      for (const row of targets) {
        if (row.status === command.status) continue;
        const id = s(row.application_id); const decision = proposalDecisionSchema.parse({ decisionId: randomUUID(), requestId: command.requestId, editionId: edition, applicationId: id, previousStatus: row.status, status: command.status, applicationRevisionBefore: n(row.revision), applicationRevisionAfter: n(row.revision) + 1, presentationRevision: n(row.current_presentation_revision), assessmentRevision: n(row.assessment_revision), weighting: weights, ranking: ranking(db, edition, id, n(row.current_presentation_revision), weights), decidedBy: user, decidedAt: now });
        db.prepare("UPDATE applications SET status=?,revision=revision+1,updated_at=? WHERE edition_id=? AND application_id=?").run(command.status, now, edition, id);
        db.prepare("INSERT INTO proposal_decisions VALUES (?,?,?,?,?,?,?)").run(decision.decisionId, edition, id, command.requestId, decision.presentationRevision, JSON.stringify(decision), now); decisions.push(decision);
      }
      return decisions;
    }
  }
}
export function executeStaffCommand<C extends StaffCommand>(account: VerifiedCfpAccount, input: C): StaffMutationReceipt<C["kind"]> {
  const command = parse(staffCommandSchema, input);
  return withDatabase(true, (db, edition) => {
    authorizeCommand(db, edition, account.wtsUserId, command);
    const intent = canonical(command); const fingerprint = createHash("sha256").update(intent).digest("hex");
    const existing = db.prepare("SELECT * FROM staff_command_receipts WHERE edition_id=? AND actor_user_id=? AND request_id=?").get(edition, account.wtsUserId, command.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.intent_json !== intent) throw new StaffError("conflict", "The request ID already has a different command.");
      const result = staffCommandResultSchemas[command.kind].parse(json(existing.result_json));
      return { requestId: command.requestId, kind: command.kind, committedAt: n(existing.committed_at), replayed: true, result } as StaffMutationReceipt<C["kind"]>;
    }
    const now = Date.now(); const result = mutate(db, edition, account.wtsUserId, command, now); staffCommandResultSchemas[command.kind].parse(result);
    db.prepare("INSERT INTO staff_command_receipts VALUES (?,?,?,?,?,?,?,?)").run(edition, account.wtsUserId, command.requestId, command.kind, fingerprint, intent, JSON.stringify(result), now);
    return { requestId: command.requestId, kind: command.kind, committedAt: now, replayed: false, result } as StaffMutationReceipt<C["kind"]>;
  });
}
export function bootstrapAdmin(edition: string, wtsUserId: string, dataDir?: string): EditionStaffGrant {
  editionIdSchema.parse(edition); wtsUserIdSchema.parse(wtsUserId); const db = openCfpDatabase(dataDir);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      policyRow(db, edition);
      if (!db.prepare("SELECT wts_user_id FROM oidc_bindings WHERE wts_user_id=?").get(wtsUserId)) throw new StaffError("not_found", "The exact WTS user ID needs an existing local OIDC binding.");
      const admins = db.prepare("SELECT * FROM edition_staff_grants WHERE edition_id=? AND role='admin' AND state='active'").all(edition);
      if (admins.length) {
        if (admins.length !== 1 || admins[0]?.wts_user_id !== wtsUserId) throw new StaffError("forbidden", "Bootstrap cannot replace an active edition admin.");
        const value = grant(admins[0]); db.exec("COMMIT"); return value;
      }
      const old = db.prepare("SELECT revision FROM edition_staff_grants WHERE edition_id=? AND wts_user_id=? AND role='admin'").get(edition, wtsUserId);
      const value: EditionStaffGrant = { editionId: edition, wtsUserId, role: "admin", revision: old ? n(old.revision) + 1 : 1, state: "active", changedBy: { kind: "maintenance" }, changedAt: Date.now() }; storeGrant(db, value); db.exec("COMMIT"); return value;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
