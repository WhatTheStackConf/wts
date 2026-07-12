import {
  GAMIFICATION_COLLECTIONS,
  GamificationAccountingService,
  type AdminManualAwardInput,
  type AdminManualAwardResult,
  type AdminXpCorrectionInput,
  type AuditOperationInput,
  type GamificationAccountingStore,
} from "~/lib/gamification-accounting";
import type {
  GamificationAchievementRecord,
  GamificationActivityClaimRecord,
  GamificationActivityRecord,
  GamificationAdminActionRecord,
  GamificationCodeRecord,
  GamificationCodeRedemptionRecord,
  GamificationHiEventsSyncRunRecord,
  GamificationMissionRecord,
  GamificationProfileRecord,
  GamificationUserAchievementRecord,
  GamificationXpEventRecord,
  HiEventsEvidenceState,
  PartnerContactConsentRecord,
  PartnerContactDisclosureRecord,
  PartnerRecord,
  UserRecord,
} from "~/lib/pocketbase-types";
import { containsMissionCode } from "~/lib/mission-code-crypto";

export interface AdminGamificationCaseSearchDto {
  cases: AdminGamificationCaseDto[];
  historyPage: number;
  historyPerPage: number;
  hasMoreHistory: boolean;
}

export interface AdminGamificationCaseDto {
  user: { id: string; email: string; displayName: string };
  profile: {
    state: "empty" | "current" | "rebuild_pending";
    totalXp?: number;
    leaderboardXp?: number;
    accessLevel?: number;
    opsBoardVisible?: boolean;
    opsBoardDisplayName?: string;
    publicBadgesVisible?: boolean;
    lastRecalculatedAt?: string;
  };
  status: {
    codeCount: number;
    activityCount: number;
    lastAttemptAt?: string;
    lastSuccessAt?: string;
    hiEvents: {
      reconciliationState: HiEventsEvidenceState;
      lastSyncAt?: string;
      lastSuccessfulSyncAt?: string;
      lastEvidenceAt?: string;
      sources: Array<{ type: "ticket" | "checkin"; stableSourceId: string; status: string; occurredAt: string }>;
    };
  };
  activities: Array<{
    id: string;
    key: string;
    missionKey?: string;
    achievementKey?: string;
    acceptedClaims: number;
    voidedClaims: number;
    acceptedRedemptions: number;
    rejectedRedemptions: number;
    lastAttemptAt?: string;
    lastSuccessAt?: string;
  }>;
  codes: Array<{
    id: string;
    label: string;
    lookupPrefix: string;
    activityKey?: string;
    status: "active" | "disabled";
    acceptedRedemptions: number;
    rejectedRedemptions: number;
    lastAttemptAt?: string;
    lastSuccessAt?: string;
  }>;
  claims: Array<{
    id: string;
    activityId: string;
    activityKey?: string;
    missionKey?: string;
    sourceType: GamificationActivityClaimRecord["source_type"];
    sourceReference?: string;
    outcomeKey: string;
    status: "accepted" | "voided";
    occurredAt: string;
    claimedAt: string;
    policyOutcome?: {
      schedule?: string;
      policy?: string;
      totalXp: number;
      leaderboardXp: number;
      appliedCaps?: Array<{ key: string; totalXpRemaining: number; leaderboardXpRemaining: number }>;
    };
    metaRule?: { kind: "claim_set" | "claim_count"; diversity?: "session" | "booth" | "community"; sourceClaimIds: string[] };
  }>;
  badges: Array<{
    id: string;
    achievementId: string;
    achievementKey?: string;
    name?: string;
    status: "unlocked" | "revoked";
    unlockedAt: string;
    publicVisible: boolean;
    sourceClaimId?: string;
  }>;
  xpEvents: Array<{
    id: string;
    amount: number;
    leaderboardAmount: number;
    category: string;
    sourceType: "activity_claim" | "admin_correction";
    sourceClaimId?: string;
    occurredAt: string;
    voided: boolean;
  }>;
  partnerContactConsents: Array<{
    id: string;
    partnerName: string;
    activityKey?: string;
    purpose: "partner_follow_up";
    noticeVersion: string;
    fields: Array<"name" | "email">;
    state: "granted" | "withdrawn";
    grantedAt: string;
    withdrawnAt?: string;
    handoffState: "not_handed_off" | "handed_off";
    handedOffAt?: string;
  }>;
  audit: Array<{
    id: string;
    action: string;
    status: "applied" | "rebuild_pending" | "failed";
    actorId: string;
    reason: string;
    correlationId?: string;
    occurredAt: string;
    related?: { collection: string; recordId: string };
    summary: {
      totalXpDelta?: number;
      leaderboardXpDelta?: number;
      beforeStatus?: string;
      afterStatus?: string;
      activityId?: string;
      achievementId?: string;
    };
    affected: {
      claimIds: string[];
      badgeIds: string[];
      xpEventIds: string[];
      profileId?: string;
    };
  }>;
}

interface SupportContext {
  users: UserRecord[];
  achievements: GamificationAchievementRecord[];
  missions: GamificationMissionRecord[];
  activities: GamificationActivityRecord[];
  codes: GamificationCodeRecord[];
  redemptions: GamificationCodeRedemptionRecord[];
  claims: GamificationActivityClaimRecord[];
  badges: GamificationUserAchievementRecord[];
  xpEvents: GamificationXpEventRecord[];
  profiles: GamificationProfileRecord[];
  audit: GamificationAdminActionRecord[];
  hiEventsRuns: GamificationHiEventsSyncRunRecord[];
  partnerContactConsents: PartnerContactConsentRecord[];
  partnerContactDisclosures: PartnerContactDisclosureRecord[];
  partners: PartnerRecord[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function exact(value: unknown, query: string): boolean {
  return text(value).toLocaleLowerCase() === query.toLocaleLowerCase();
}

function latest(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => value !== undefined && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function latestRun(runs: GamificationHiEventsSyncRunRecord[]): GamificationHiEventsSyncRunRecord | undefined {
  return runs.reduce<GamificationHiEventsSyncRunRecord | undefined>((current, candidate) =>
    !current || Date.parse(candidate.fetched_at) >= Date.parse(current.fetched_at) ? candidate : current,
  undefined);
}

function numberValue(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function contactFields(value: unknown): Array<"name" | "email"> {
  return Array.isArray(value)
    ? value.filter((field): field is "name" | "email" => field === "name" || field === "email")
    : [];
}

function metadataReference(value: Record<string, unknown> | undefined): string | undefined {
  const reference = text(value?.support_reference);
  return reference && safeReference(reference) ? reference : undefined;
}

function hiEventsStableId(claim: GamificationActivityClaimRecord): string | undefined {
  const source = claim.metadata?.hievents;
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  const stableId = text((source as Record<string, unknown>).attendeeStableId);
  return stableId && safeReference(stableId) ? stableId : undefined;
}

function safeReference(value: string | undefined): value is string {
  if (!value) return false;
  return value.length <= 160 &&
    !containsMissionCode(value) &&
    !/\b[a-f0-9]{64}\b/i.test(value) &&
    !/https?:\/\//i.test(value) &&
    !/\b(?:api[_ -]?key|authorization|bearer|token|payment|card\s+number|ticket\s+url)\b/i.test(value);
}

function redact(value: string | undefined): string {
  const candidate = text(value);
  if (!candidate) return "Administrative action.";
  if (!safeReference(candidate) || /\b(?:payment|card\s+number|ticket\s+url)\b/i.test(candidate)) {
    return "Sensitive support detail redacted.";
  }
  return candidate;
}

function policyOutcome(claim: GamificationActivityClaimRecord): AdminGamificationCaseDto["claims"][number]["policyOutcome"] {
  const outcome = claim.cap_outcome;
  const totalXp = numberValue(outcome?.awarded_total_xp);
  const leaderboardXp = numberValue(outcome?.awarded_leaderboard_xp);
  if (totalXp === undefined || leaderboardXp === undefined) return undefined;
  const appliedCaps = Array.isArray(outcome?.applied_caps)
    ? outcome.applied_caps
      .filter((cap): cap is Record<string, unknown> => Boolean(cap && typeof cap === "object" && !Array.isArray(cap)))
      .map((cap) => ({
        key: text(cap.key),
        totalXpRemaining: numberValue(cap.totalXpRemaining) ?? 0,
        leaderboardXpRemaining: numberValue(cap.leaderboardXpRemaining) ?? 0,
      }))
      .filter((cap) => Boolean(cap.key))
    : [];
  return {
    schedule: text(outcome?.schedule) || undefined,
    policy: text(outcome?.policy) || undefined,
    totalXp,
    leaderboardXp,
    appliedCaps: appliedCaps.length ? appliedCaps : undefined,
  };
}

function metaRuleEvidence(claim: GamificationActivityClaimRecord): AdminGamificationCaseDto["claims"][number]["metaRule"] {
  const rule = claim.metadata?.meta_rule;
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return undefined;
  const value = rule as Record<string, unknown>;
  const kind = text(value.kind);
  if (kind !== "claim_set" && kind !== "claim_count") return undefined;
  const diversity = text(value.diversity);
  return {
    kind,
    diversity: diversity === "session" || diversity === "booth" || diversity === "community" ? diversity : undefined,
    sourceClaimIds: Array.isArray(value.source_claim_ids)
      ? value.source_claim_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
  };
}

function safeAuditSummary(record: GamificationAdminActionRecord): AdminGamificationCaseDto["audit"][number]["summary"] {
  const before = record.before_summary || {};
  const after = record.after_summary || {};
  return {
    totalXpDelta: numberValue(after.totalXpDelta),
    leaderboardXpDelta: numberValue(after.leaderboardXpDelta),
    beforeStatus: text(before.status) || undefined,
    afterStatus: text(after.status) || undefined,
    activityId: text(after.activityId) || undefined,
    achievementId: text(after.achievementId) || undefined,
  };
}

/**
 * Limits admin support reads to exact, case-relevant records. Raw PocketBase
 * records remain server-only even though the underlying query may join evidence.
 */
export class GamificationAdminSupportService {
  private readonly accounting: GamificationAccountingService;

  constructor(private readonly store: GamificationAccountingStore) {
    this.accounting = new GamificationAccountingService(store);
  }

  async search(
    queryInput: string,
    historyPageInput = 1,
    historyPerPageInput = 50,
  ): Promise<AdminGamificationCaseSearchDto> {
    const query = text(queryInput);
    if (!query) throw new Error("Enter an exact User, evidence, or support reference.");
    if (containsMissionCode(query)) {
      throw new Error("Raw Mission codes cannot be searched in User history.");
    }
    const historyPage = Math.max(1, Math.floor(Number(historyPageInput) || 1));
    const historyPerPage = Math.min(100, Math.max(1, Math.floor(Number(historyPerPageInput) || 50)));
    const context = await this.context();
    const matchingActivityIds = new Set(
      context.activities.filter((activity) => exact(activity.id, query) || exact(activity.key, query)).map((activity) => activity.id),
    );
    const matchingMissionIds = new Set(
      context.missions.filter((mission) => exact(mission.id, query) || exact(mission.key, query)).map((mission) => mission.id),
    );
    for (const activity of context.activities) {
      if (activity.mission && matchingMissionIds.has(activity.mission)) matchingActivityIds.add(activity.id);
    }
    const matchingAchievementIds = new Set(
      context.achievements.filter((achievement) => exact(achievement.id, query) || exact(achievement.key, query)).map((achievement) => achievement.id),
    );
    for (const activity of context.activities) {
      if (activity.achievement && matchingAchievementIds.has(activity.achievement)) matchingActivityIds.add(activity.id);
    }
    const matchingCodeIds = new Set(
      context.codes
        .filter((code) => exact(code.id, query) || exact(code.label, query) || exact(code.lookup_prefix, query))
        .map((code) => code.id),
    );
    const userIds = new Set(
      context.users
        .filter((user) => exact(user.id, query) || exact(user.email, query) || exact(user.name, query))
        .map((user) => user.id),
    );
    for (const badge of context.badges) {
      if (matchingAchievementIds.has(badge.achievement)) userIds.add(badge.user);
    }
    for (const claim of context.claims) {
      if (
        matchingActivityIds.has(claim.activity) ||
        exact(claim.id, query) ||
        exact(claim.source_record_id, query) ||
        exact(hiEventsStableId(claim), query) ||
        exact(metadataReference(claim.metadata), query)
      ) {
        userIds.add(claim.user);
      }
    }
    for (const run of context.hiEventsRuns) {
      if (exact(run.source_stable_id, query) && run.user) userIds.add(run.user);
    }
    for (const redemption of context.redemptions) {
      if (matchingCodeIds.has(redemption.code) || matchingActivityIds.has(redemption.activity) || exact(redemption.id, query)) {
        userIds.add(redemption.user);
      }
    }
    for (const event of context.xpEvents) {
      if (exact(event.id, query) || exact(event.source_id, query) || exact(metadataReference(event.metadata), query)) {
        userIds.add(event.user);
      }
    }
    for (const action of context.audit) {
      if (exact(action.correlation_id, query) || exact(metadataReference(action.metadata), query)) {
        if (action.target_user) userIds.add(action.target_user);
      }
    }
    const users = context.users.filter((user) => userIds.has(user.id)).sort((left, right) => left.id.localeCompare(right.id));
    if (users.length > 20) throw new Error("This exact reference matches too many Users. Refine the support case.");
    const fullCases = users.map((user) => this.caseForUser(user, context));
    const offset = (historyPage - 1) * historyPerPage;
    const hasMoreHistory = fullCases.some((supportCase) => [
      supportCase.claims,
      supportCase.badges,
      supportCase.xpEvents,
      supportCase.audit,
      supportCase.partnerContactConsents,
    ].some((history) => history.length > offset + historyPerPage));
    const cases = fullCases.map((supportCase) => ({
      ...supportCase,
      claims: supportCase.claims.slice(offset, offset + historyPerPage),
      badges: supportCase.badges.slice(offset, offset + historyPerPage),
      xpEvents: supportCase.xpEvents.slice(offset, offset + historyPerPage),
      audit: supportCase.audit.slice(offset, offset + historyPerPage),
      partnerContactConsents: supportCase.partnerContactConsents.slice(offset, offset + historyPerPage),
    }));
    return { cases, historyPage, historyPerPage, hasMoreHistory };
  }

  async manualAward(input: AdminManualAwardInput, audit: AuditOperationInput): Promise<AdminManualAwardResult> {
    await this.store.getById<UserRecord>("users", audit.targetUser);
    return this.accounting.recordManualAward(input, audit);
  }

  async revokeBadge(badgeId: string, audit: AuditOperationInput): Promise<GamificationUserAchievementRecord> {
    await this.store.getById<UserRecord>("users", audit.targetUser);
    return this.accounting.revokeBadge(badgeId, audit);
  }

  async voidXpEvent(eventId: string, audit: AuditOperationInput): Promise<GamificationXpEventRecord> {
    await this.store.getById<UserRecord>("users", audit.targetUser);
    return this.accounting.voidXpEvent(eventId, audit);
  }

  async voidActivityClaim(claimId: string, audit: AuditOperationInput): Promise<GamificationActivityClaimRecord> {
    await this.store.getById<UserRecord>("users", audit.targetUser);
    return this.accounting.voidActivityClaim(claimId, audit);
  }

  async correctXp(input: AdminXpCorrectionInput, audit: AuditOperationInput): Promise<GamificationXpEventRecord> {
    await this.store.getById<UserRecord>("users", audit.targetUser);
    return this.accounting.recordXpCorrection(input, audit);
  }

  async rebuildProfile(targetUserId: string, audit: AuditOperationInput): Promise<GamificationProfileRecord> {
    const user = await this.store.getById<UserRecord>("users", targetUserId);
    return this.accounting.rebuildProfileWithAudit({ id: user.id, name: user.name, email: user.email }, audit);
  }

  private caseForUser(user: UserRecord, context: SupportContext): AdminGamificationCaseDto {
    const activitiesById = new Map(context.activities.map((activity) => [activity.id, activity]));
    const missionsById = new Map(context.missions.map((mission) => [mission.id, mission]));
    const achievementsById = new Map(context.achievements.map((achievement) => [achievement.id, achievement]));
    const claims = context.claims.filter((claim) => claim.user === user.id);
    const redemptions = context.redemptions.filter((redemption) => redemption.user === user.id);
    const badges = context.badges.filter((badge) => badge.user === user.id);
    const xpEvents = context.xpEvents.filter((event) => event.user === user.id);
    const hiEventsRuns = context.hiEventsRuns.filter((run) => run.user === user.id);
    const hiEventsAuditIds = new Set(hiEventsRuns.flatMap((run) => run.admin_action ? [run.admin_action] : []));
    const audit = context.audit.filter((action) => action.target_user === user.id || hiEventsAuditIds.has(action.id));
    const profile = context.profiles.find((candidate) => candidate.user === user.id);
    const partnersById = new Map(context.partners.map((partner) => [partner.id, partner]));
    const partnerContactConsents = context.partnerContactConsents.filter((consent) => consent.user === user.id);
    const partnerContactDisclosures = context.partnerContactDisclosures.filter((disclosure) => disclosure.user === user.id);
    const latestHiEventsRun = latestRun(hiEventsRuns);
    const latestSuccessfulHiEventsRun = latestRun(hiEventsRuns.filter((run) => run.result_state === "success"));
    const hiEventsSources = latestHiEventsRun?.source_stable_id && safeReference(latestHiEventsRun.source_stable_id)
      ? [{
        type: latestHiEventsRun.checkin_id ? "checkin" as const : "ticket" as const,
        stableSourceId: latestHiEventsRun.source_stable_id,
        status: latestHiEventsRun.user_status || latestHiEventsRun.result_state,
        occurredAt: latestHiEventsRun.checked_in_at || latestHiEventsRun.fetched_at,
      }]
      : claims
        .filter((claim) => claim.source_type === "hievents_ticket" || claim.source_type === "hievents_checkin")
        .filter((claim) => safeReference(claim.source_record_id))
        .map((claim) => ({
          type: claim.source_type === "hievents_ticket" ? "ticket" as const : "checkin" as const,
          stableSourceId: claim.source_record_id!,
          status: claim.status,
          occurredAt: claim.occurred_at,
        }));
    const touchedActivityIds = new Set([...claims.map((claim) => claim.activity), ...redemptions.map((redemption) => redemption.activity)]);
    const touchedCodeIds = new Set(redemptions.map((redemption) => redemption.code));
    const pending = Boolean(profile?.rebuild_pending) || audit.some((action) => action.status === "rebuild_pending");

    return {
      user: { id: user.id, email: user.email, displayName: user.name || "Unnamed User" },
      profile: {
        state: pending ? "rebuild_pending" : profile ? "current" : "empty",
        totalXp: profile?.total_xp,
        leaderboardXp: profile?.leaderboard_xp,
        accessLevel: profile?.access_level,
        opsBoardVisible: profile?.ops_board_visible,
        opsBoardDisplayName: profile?.ops_board_display_name,
        publicBadgesVisible: profile?.public_badges_visible,
        lastRecalculatedAt: profile?.totals_recalculated_at,
      },
      status: {
        codeCount: touchedCodeIds.size,
        activityCount: touchedActivityIds.size,
        lastAttemptAt: latest(redemptions.map((redemption) => redemption.redeemed_at)),
        lastSuccessAt: latest([
          ...redemptions.filter((redemption) => redemption.status === "accepted").map((redemption) => redemption.redeemed_at),
          ...claims.filter((claim) => claim.status === "accepted").map((claim) => claim.claimed_at || claim.occurred_at),
        ]),
        hiEvents: {
          reconciliationState: latestHiEventsRun?.result_state === "success"
            ? latestHiEventsRun.user_status || "stale"
            : latestHiEventsRun ? "unavailable" : "stale",
          lastSyncAt: latestHiEventsRun?.fetched_at,
          lastSuccessfulSyncAt: latestSuccessfulHiEventsRun?.last_success_at || latestSuccessfulHiEventsRun?.fetched_at,
          lastEvidenceAt: latest(claims.filter((claim) => claim.source_type.startsWith("hievents_")).map((claim) => claim.claimed_at)),
          sources: hiEventsSources,
        },
      },
      activities: [...touchedActivityIds]
        .map((activityId) => activitiesById.get(activityId))
        .filter((activity): activity is GamificationActivityRecord => Boolean(activity))
        .map((activity) => {
          const activityClaims = claims.filter((claim) => claim.activity === activity.id);
          const activityRedemptions = redemptions.filter((redemption) => redemption.activity === activity.id);
          const mission = activity.mission ? missionsById.get(activity.mission) : undefined;
          const achievement = activity.achievement ? achievementsById.get(activity.achievement) : undefined;
          return {
            id: activity.id,
            key: activity.key,
            missionKey: mission?.key,
            achievementKey: achievement?.key,
            acceptedClaims: activityClaims.filter((claim) => claim.status === "accepted").length,
            voidedClaims: activityClaims.filter((claim) => claim.status === "voided").length,
            acceptedRedemptions: activityRedemptions.filter((redemption) => redemption.status === "accepted").length,
            rejectedRedemptions: activityRedemptions.filter((redemption) => redemption.status !== "accepted").length,
            lastAttemptAt: latest(activityRedemptions.map((redemption) => redemption.redeemed_at)),
            lastSuccessAt: latest([
              ...activityRedemptions.filter((redemption) => redemption.status === "accepted").map((redemption) => redemption.redeemed_at),
              ...activityClaims.filter((claim) => claim.status === "accepted").map((claim) => claim.claimed_at),
            ]),
          };
        })
        .sort((left, right) => left.key.localeCompare(right.key)),
      codes: context.codes
        .filter((code) => touchedCodeIds.has(code.id))
        .map((code) => {
          const codeRedemptions = redemptions.filter((redemption) => redemption.code === code.id);
          return {
            id: code.id,
            label: code.label,
            lookupPrefix: code.lookup_prefix,
            activityKey: activitiesById.get(code.activity)?.key,
            status: code.status,
            acceptedRedemptions: codeRedemptions.filter((redemption) => redemption.status === "accepted").length,
            rejectedRedemptions: codeRedemptions.filter((redemption) => redemption.status !== "accepted").length,
            lastAttemptAt: latest(codeRedemptions.map((redemption) => redemption.redeemed_at)),
            lastSuccessAt: latest(codeRedemptions.filter((redemption) => redemption.status === "accepted").map((redemption) => redemption.redeemed_at)),
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)),
      claims: claims.map((claim) => {
        const activity = activitiesById.get(claim.activity);
        const mission = activity?.mission ? missionsById.get(activity.mission) : undefined;
        return {
          id: claim.id,
          activityId: claim.activity,
          activityKey: activity?.key,
          missionKey: mission?.key,
          sourceType: claim.source_type,
          sourceReference: claim.source_type.startsWith("hievents_") && safeReference(claim.source_record_id)
            ? claim.source_record_id
            : metadataReference(claim.metadata),
          outcomeKey: claim.outcome_key,
          status: claim.status,
          occurredAt: claim.occurred_at,
          claimedAt: claim.claimed_at,
          policyOutcome: policyOutcome(claim),
          metaRule: metaRuleEvidence(claim),
        };
      }).sort((left, right) => Date.parse(right.claimedAt) - Date.parse(left.claimedAt)),
      badges: badges.map((badge) => ({
        id: badge.id,
        achievementId: badge.achievement,
        achievementKey: achievementsById.get(badge.achievement)?.key,
        name: achievementsById.get(badge.achievement)?.badge_name,
        status: badge.status,
        unlockedAt: badge.unlocked_at,
        publicVisible: Boolean(badge.public_visible),
        sourceClaimId: badge.source_claim || undefined,
      })).sort((left, right) => Date.parse(right.unlockedAt) - Date.parse(left.unlockedAt)),
      xpEvents: xpEvents.map((event) => ({
        id: event.id,
        amount: event.amount,
        leaderboardAmount: event.leaderboard_amount,
        category: event.category,
        sourceType: event.source_type,
        sourceClaimId: event.source_claim || undefined,
        occurredAt: event.occurred_at,
        voided: Boolean(event.voided),
      })).sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)),
      partnerContactConsents: partnerContactConsents.map((consent) => {
        const disclosure = partnerContactDisclosures.find((candidate) => candidate.consent === consent.id);
        return {
          id: consent.id,
          partnerName: partnersById.get(consent.partner)?.name || consent.partner,
          activityKey: activitiesById.get(consent.activity)?.key,
          purpose: "partner_follow_up" as const,
          noticeVersion: consent.notice_version,
          fields: contactFields(consent.approved_fields),
          state: consent.state,
          grantedAt: consent.granted_at,
          withdrawnAt: consent.withdrawn_at || undefined,
          handoffState: disclosure ? "handed_off" as const : "not_handed_off" as const,
          handedOffAt: disclosure?.disclosed_at,
        };
      }).sort((left, right) => Date.parse(right.grantedAt) - Date.parse(left.grantedAt)),
      audit: audit.map((action) => {
        const claimIds = claims
          .filter((claim) =>
            (claim.source_collection === GAMIFICATION_COLLECTIONS.adminActions && claim.source_record_id === action.id) ||
            claim.void_admin_action === action.id,
          )
          .map((claim) => claim.id);
        const badgeIds = badges
          .filter((badge) => claimIds.includes(badge.source_claim || "") ||
            (action.action === "revoke_user_achievement" && badge.id === action.related_record_id))
          .map((badge) => badge.id);
        const xpEventIds = xpEvents
          .filter((event) => claimIds.includes(event.source_claim || "") || event.source_id === action.id ||
            (action.action === "void_xp_event" && event.id === action.related_record_id))
          .map((event) => event.id);
        return {
          id: action.id,
          action: action.action,
          status: action.status,
          actorId: action.actor,
          reason: redact(action.reason),
          correlationId: safeReference(action.correlation_id) ? action.correlation_id : undefined,
          occurredAt: action.created,
          related: text(action.related_collection) && text(action.related_record_id)
            ? { collection: action.related_collection!, recordId: action.related_record_id! }
            : undefined,
          summary: safeAuditSummary(action),
          affected: {
            claimIds,
            badgeIds,
            xpEventIds,
            profileId: action.action === "rebuild_profile_cache" ? profile?.id : undefined,
          },
        };
      }).sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)),
    };
  }

  private async context(): Promise<SupportContext> {
    const [users, achievements, missions, activities, codes, redemptions, claims, badges, xpEvents, profiles, audit, hiEventsRuns, partnerContactConsents, partnerContactDisclosures, partners] = await Promise.all([
      this.store.list<UserRecord>("users", undefined, { sort: "id", limit: 5000 }),
      this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, undefined, { sort: "key", limit: 1000 }),
      this.store.list<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, undefined, { sort: "key", limit: 1000 }),
      this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, undefined, { sort: "key", limit: 2000 }),
      this.store.list<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, undefined, { sort: "-created,id", limit: 5000 }),
      this.store.list<GamificationCodeRedemptionRecord>(GAMIFICATION_COLLECTIONS.codeRedemptions, undefined, { sort: "-redeemed_at,id", limit: 5000 }),
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, undefined, { sort: "-claimed_at,id", limit: 5000 }),
      this.store.list<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, undefined, { sort: "-unlocked_at,id", limit: 5000 }),
      this.store.list<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, undefined, { sort: "-occurred_at,id", limit: 5000 }),
      this.store.list<GamificationProfileRecord>(GAMIFICATION_COLLECTIONS.profiles, undefined, { limit: 5000 }),
      this.store.list<GamificationAdminActionRecord>(GAMIFICATION_COLLECTIONS.adminActions, undefined, { sort: "-created,id", limit: 5000 }),
      this.store.list<GamificationHiEventsSyncRunRecord>(GAMIFICATION_COLLECTIONS.hiEventsSyncRuns, undefined, { sort: "-fetched_at,id", limit: 5000 }),
      this.store.list<PartnerContactConsentRecord>(GAMIFICATION_COLLECTIONS.partnerContactConsents, undefined, { sort: "-granted_at,id", limit: 5000 }),
      this.store.list<PartnerContactDisclosureRecord>(GAMIFICATION_COLLECTIONS.partnerContactDisclosures, undefined, { sort: "-disclosed_at,id", limit: 5000 }),
      this.store.list<PartnerRecord>("partners", undefined, { sort: "name,id", limit: 1000 }),
    ]);
    return { users, achievements, missions, activities, codes, redemptions, claims, badges, xpEvents, profiles, audit, hiEventsRuns, partnerContactConsents, partnerContactDisclosures, partners };
  }
}
