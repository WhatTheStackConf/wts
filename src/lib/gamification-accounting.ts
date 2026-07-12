import { createHash } from "node:crypto";
import {
  buildGamificationPublicOpsBoardRows,
  defaultGamificationDisplayName,
  rebuildGamificationProfile,
  validateGamificationDisplayName,
  type GamificationPublicOpsBoardRow,
  type GamificationPublicOpsBoardPage,
  type GamificationProfileSummary,
  buildGamificationProfileSummary,
} from "~/lib/gamification";
import {
  evaluateMetaAchievements,
  metaRuleDiversity,
  type MetaAchievementCandidate,
} from "~/lib/gamification-meta-achievements";
import {
  configuredEventReference,
  evaluateConfiguredEventCompletions,
  isConfiguredEventActivityKind,
  type ConfiguredEventCompletionCandidate,
} from "~/lib/gamification-event-missions";
import { evaluateCommunityPartnerCompletions } from "~/lib/gamification-community-partners";
import { containsMissionCode } from "~/lib/mission-code-crypto";
import type {
  GamificationAchievementRecord,
  GamificationActivityRecord,
  GamificationActivityClaimRecord,
  GamificationAdminActionRecord,
  GamificationCategory,
  GamificationMissionRecord,
  GamificationProfileRecord,
  GamificationScoreScheduleCapRecord,
  GamificationScoreSchedulePolicyRecord,
  GamificationScoreScheduleRecord,
  GamificationUserAchievementRecord,
  GamificationXpEventRecord,
} from "~/lib/pocketbase-types";

export const GAMIFICATION_COLLECTIONS = {
  achievements: "gamification_achievements",
  missions: "gamification_missions",
  activities: "gamification_activities",
  codes: "gamification_codes",
  codeRedemptions: "gamification_code_redemptions",
  activityClaims: "gamification_activity_claims",
  userAchievements: "gamification_user_achievements",
  xpEvents: "gamification_xp_events",
  profiles: "gamification_profiles",
  hiEventsSyncRuns: "gamification_hievents_sync_runs",
  scoreSchedules: "gamification_score_schedules",
  scoreSchedulePolicies: "gamification_score_schedule_policies",
  scoreScheduleCaps: "gamification_score_schedule_caps",
  adminActions: "gamification_admin_actions",
  partnerContactConsents: "partner_contact_consents",
  partnerContactDisclosures: "partner_contact_disclosures",
  rateLimitAttempts: "gamification_rate_limit_attempts",
} as const;

export interface GamificationAccountingStore {
  findOne<T>(collection: string, match: Record<string, unknown>): Promise<T | undefined>;
  list<T>(
    collection: string,
    match?: Record<string, unknown>,
    options?: { sort?: string; limit?: number; offset?: number; fields?: string },
  ): Promise<T[]>;
  getById<T>(collection: string, id: string): Promise<T>;
  create<T>(collection: string, data: Record<string, unknown>): Promise<T>;
  createManyAtomic?<T>(collection: string, rows: Record<string, unknown>[]): Promise<T[]>;
  update<T>(collection: string, id: string, data: Record<string, unknown>): Promise<T>;
  delete?(collection: string, id: string): Promise<void>;
  withLocks?<T>(keys: string[], operation: () => Promise<T>): Promise<T>;
}

export function withGamificationLocks<T>(
  store: GamificationAccountingStore,
  keys: string[],
  operation: () => Promise<T>,
): Promise<T> {
  return store.withLocks ? store.withLocks(keys, operation) : operation();
}

export interface AccountingUser {
  id: string;
  name?: string;
  email?: string;
}

export interface GamificationVisibilitySettingsInput {
  opsBoardVisible: boolean;
  opsBoardDisplayName: string;
  publicBadgesVisible: boolean;
}

export interface ActivityClaimInput {
  user: string;
  activity: string;
  sourceType: GamificationActivityClaimRecord["source_type"];
  sourceCollection?: string;
  sourceRecordId?: string;
  outcomeKey: string;
  occurredAt: string;
  evidenceFingerprint: string;
  idempotencyKey: string;
  capOutcome?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface DirectActivityXpInput {
  amount: number;
  leaderboardAmount: number;
  category: GamificationCategory;
  reason: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityAwardInput {
  claim: ActivityClaimInput;
  publicBadgeVisible?: boolean;
  /** Existing non-Meta compound Activity outcomes resolve after their source claim exists. */
  resolveAchievement?: (
    claim: GamificationActivityClaimRecord,
    activity: GamificationActivityRecord,
  ) => Promise<string | undefined>;
}

export interface DerivedActivityAward {
  claim: GamificationActivityClaimRecord;
  badge?: GamificationUserAchievementRecord;
  xpEvent?: GamificationXpEventRecord;
}

export interface ActivityAwardResult extends DerivedActivityAward {
  derivedAwards: DerivedActivityAward[];
  metaAwards: DerivedActivityAward[];
}

export interface AuditOperationInput {
  actor: string;
  actorRole: "user" | "reviewer" | "admin";
  targetUser: string;
  reason: string;
  operationId: string;
}

export interface AdminManualAwardInput {
  achievementId: string;
  activityId: string;
  mode: "badge_only" | "missed_evidence";
  occurredAt?: string;
  supportReference?: string;
  rankingError?: "automation" | "source_sync" | "prior_accounting";
  highImpactConfirmed?: boolean;
}

export interface AdminXpCorrectionInput {
  amount: number;
  leaderboardAmount: number;
  activityId?: string;
  originalXpEventId?: string;
  supportReference?: string;
  rankingError?: "automation" | "source_sync" | "prior_accounting";
  highImpactConfirmed?: boolean;
}

export interface AdminManualAwardResult {
  actionId: string;
  claimId: string;
  badgeId: string;
  xpEventId?: string;
  totalXp: number;
  leaderboardXp: number;
}

const profileRebuilds = new Map<string, Promise<unknown>>();
let awardQueue: Promise<unknown> = Promise.resolve();

function now(): string {
  return new Date().toISOString();
}

function adminActionIdempotencyKey(action: string, operationId: string): string {
  return `admin-action:v1:${action}:${operationId}`;
}

function manualActivityClaimIdempotencyKey(userId: string, activityId: string, operationId: string): string {
  return `admin-manual-claim:v1:${userId}:${activityId}:${operationId}`;
}

function adminCorrectionXpEventIdempotencyKey(userId: string, operationId: string): string {
  return `admin-correction:v1:${userId}:${operationId}`;
}

function safeAdminText(value: string, field: string, required = true): string {
  const text = value.trim();
  if (!text && required) throw new Error(`${field} is required.`);
  if (text.length > 500) throw new Error(`${field} must be 500 characters or fewer.`);
  if (containsMissionCode(text)) {
    throw new Error(`${field} must not include raw Mission codes.`);
  }
  if (/\b[a-f0-9]{64}\b/i.test(text) || /\b(?:api[_ -]?key|authorization|bearer|token)\s*[:=]/i.test(text)) {
    throw new Error(`${field} must not include hashes or credentials.`);
  }
  if (/https?:\/\//i.test(text) || /\b(?:payment(?:\s+details|\s+data)?|card\s+number|ticket\s+url)\b/i.test(text)) {
    throw new Error(`${field} must not include URLs or payment data.`);
  }
  return text;
}

function safeOptionalAdminReference(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return safeAdminText(value, "Source or support reference");
}

function numericCapOutcome(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const candidate = Number(value?.[key]);
  return Number.isFinite(candidate) ? candidate : undefined;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function activityClaimIdempotencyKey(
  userId: string,
  activityKey: string,
  sourceType: string,
  evidenceFingerprint: string,
): string {
  return `activity-claim:v1:${userId}:${activityKey}:${sourceType}:${evidenceFingerprint}`;
}

export function userAchievementIdempotencyKey(userId: string, achievementKey: string): string {
  return `user-achievement:v1:${userId}:${achievementKey}`;
}

export function directActivityXpEventIdempotencyKey(userId: string, claimId: string): string {
  return `xp-event:v1:${userId}:gamification_activity_claims:${claimId}:direct-activity-policy`;
}

function metaClaimFingerprint(achievementId: string, sourceClaimIds: string[]): string {
  return createHash("sha256")
    .update(`${achievementId}:${[...sourceClaimIds].sort().join(":")}`)
    .digest("hex");
}

/**
 * Server-only service that writes the accounting records. Its caller owns authentication;
 * user-facing flows derive the User before constructing any input for this service.
 */
export class GamificationAccountingService {
  constructor(
    private readonly store: GamificationAccountingStore,
    private readonly clock: () => string = now,
  ) {}

  async ensureProfile(user: AccountingUser): Promise<GamificationProfileRecord> {
    const existing = await this.store.findOne<GamificationProfileRecord>(
      GAMIFICATION_COLLECTIONS.profiles,
      { user: user.id },
    );
    if (existing) return existing;

    const timestamp = this.clock();
    try {
      return await this.store.create<GamificationProfileRecord>(GAMIFICATION_COLLECTIONS.profiles, {
        user: user.id,
        total_xp: 0,
        leaderboard_xp: 0,
        access_level: 1,
        access_level_schedule: "",
        access_level_threshold: 0,
        next_level_threshold: 0,
        xp_into_level: 0,
        xp_to_next_level: 0,
        unlocked_badge_count: 0,
        // September is opt-out: new profiles appear on the ops board unless the User changes it.
        ops_board_visible: true,
        ops_board_display_name: defaultGamificationDisplayName(user),
        public_badges_visible: true,
        totals_version: 1,
        totals_recalculated_at: timestamp,
        rebuild_pending: false,
        rebuild_support_reference: "",
      });
    } catch (error) {
      // The unique user index is the authority when simultaneous first requests race.
      const racedProfile = await this.store.findOne<GamificationProfileRecord>(
        GAMIFICATION_COLLECTIONS.profiles,
        { user: user.id },
      );
      if (racedProfile) return racedProfile;
      throw error;
    }
  }

  async recordActivityClaim(input: ActivityClaimInput): Promise<GamificationActivityClaimRecord> {
    const matchesInput = (claim: GamificationActivityClaimRecord) =>
      claim.user === input.user &&
      claim.activity === input.activity &&
      claim.source_type === input.sourceType &&
      (claim.source_collection || "") === (input.sourceCollection || "") &&
      (claim.source_record_id || "") === (input.sourceRecordId || "") &&
      claim.outcome_key === input.outcomeKey;
    const existing = await this.store.findOne<GamificationActivityClaimRecord>(
      GAMIFICATION_COLLECTIONS.activityClaims,
      { idempotency_key: input.idempotencyKey },
    );
    if (existing) {
      if (!matchesInput(existing)) throw new Error("This evidence operation ID belongs to a different Activity Claim.");
      if (existing.status === "accepted") return existing;
      throw new Error("This evidence was voided and cannot be recorded again.");
    }

    const priorActivityClaim = await this.store.findOne<GamificationActivityClaimRecord>(
      GAMIFICATION_COLLECTIONS.activityClaims,
      { user: input.user, activity: input.activity, status: "accepted" },
    );
    if (priorActivityClaim) return priorActivityClaim;

    const activity = await this.store.getById<GamificationActivityRecord>(
      GAMIFICATION_COLLECTIONS.activities,
      input.activity,
    );
    if (
      activity.kind === "booth" &&
      activity.partner_kind === "sponsor" &&
      activity.evidence_channel &&
      !["code_redemption", "admin_manual"].includes(input.sourceType)
    ) {
      throw new Error("Booth Activities accept only WTS Mission code evidence or audited admin support.");
    }
    if (activity.kind === "booth" && activity.partner_kind === "sponsor" && activity.evidence_channel) {
      await this.assertSponsorBoothEvidence(activity, input);
    }
    if (
      activity.kind === "community_partner" &&
      activity.partner_kind === "community_partner" &&
      (Boolean(activity.evidence_channel) || activity.evidence_mode === "derived_claim_set")
    ) {
      await this.assertCommunityPartnerEvidence(activity, input);
    }
    if (this.isConfiguredSessionAttendanceActivity(activity)) {
      await this.assertSessionAttendanceEvidence(activity, input);
    }
    if (isConfiguredEventActivityKind(activity.kind) && configuredEventReference(activity.event_ref)) {
      await this.assertConfiguredEventEvidence(activity, input);
    }
    if (activity.kind === "easter_egg" || activity.category === "easter_egg" || activity.evidence_mode === "static_puzzle_code") {
      await this.assertEasterEggEvidence(activity, input);
    }
    if (activity.status !== "active" || !activity.enabled) {
      throw new Error("This Activity is not accepting evidence.");
    }
    if (activity.per_user_claim_limit !== 1) {
      throw new Error("September Activities support one accepted claim per User.");
    }
    const occurredAt = Date.parse(input.occurredAt);
    if (
      !Number.isFinite(occurredAt) ||
      (activity.active_from && occurredAt < Date.parse(activity.active_from)) ||
      (activity.active_until && occurredAt > Date.parse(activity.active_until))
    ) {
      throw new Error("This Activity is outside its active window.");
    }
    if (activity.max_claims) {
      const acceptedClaims = await this.store.list<GamificationActivityClaimRecord>(
        GAMIFICATION_COLLECTIONS.activityClaims,
        { activity: input.activity, status: "accepted" },
        { limit: activity.max_claims },
      );
      if (acceptedClaims.length >= activity.max_claims) {
        throw new Error("This Activity has reached its configured claim limit.");
      }
    }

    try {
      const timestamp = this.clock();
      return await this.store.create<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, {
        user: input.user,
        activity: input.activity,
        source_type: input.sourceType,
        source_collection: input.sourceCollection || "",
        source_record_id: input.sourceRecordId || "",
        outcome_key: input.outcomeKey,
        status: "accepted",
        occurred_at: input.occurredAt,
        claimed_at: timestamp,
        evidence_fingerprint: input.evidenceFingerprint,
        idempotency_key: input.idempotencyKey,
        cap_outcome: input.capOutcome || {},
        metadata: input.metadata || {},
      });
    } catch (error) {
      const racedClaim = await this.store.findOne<GamificationActivityClaimRecord>(
        GAMIFICATION_COLLECTIONS.activityClaims,
        { idempotency_key: input.idempotencyKey },
      );
      if (racedClaim) {
        if (!matchesInput(racedClaim)) throw new Error("This evidence operation ID belongs to a different Activity Claim.");
        return racedClaim;
      }
      throw error;
    }
  }

  async unlockBadge(
    userId: string,
    achievementId: string,
    sourceClaimId?: string,
    publicVisible = true,
    allowAuditedRestore = false,
  ): Promise<GamificationUserAchievementRecord | undefined> {
    const existing = await this.store.findOne<GamificationUserAchievementRecord>(
      GAMIFICATION_COLLECTIONS.userAchievements,
      { user: userId, achievement: achievementId, status: "unlocked" },
    );
    if (existing) return existing;
    const revoked = await this.store.findOne<GamificationUserAchievementRecord>(
      GAMIFICATION_COLLECTIONS.userAchievements,
      { user: userId, achievement: achievementId, status: "revoked" },
    );
    if (revoked && !allowAuditedRestore) return undefined;

    const achievement = await this.store.getById<GamificationAchievementRecord>(
      GAMIFICATION_COLLECTIONS.achievements,
      achievementId,
    );
    const idempotencyKey = sourceClaimId
      ? `${userAchievementIdempotencyKey(userId, achievement.key)}:${sourceClaimId}`
      : userAchievementIdempotencyKey(userId, achievement.key);
    try {
      return await this.store.create<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, {
        user: userId,
        achievement: achievementId,
        status: "unlocked",
        unlocked_at: this.clock(),
        source_claim: sourceClaimId || "",
        idempotency_key: idempotencyKey,
        public_visible: publicVisible,
      });
    } catch (error) {
      const racedBadge = await this.store.findOne<GamificationUserAchievementRecord>(
        GAMIFICATION_COLLECTIONS.userAchievements,
        { user: userId, achievement: achievementId, status: "unlocked" },
      );
      if (racedBadge) return racedBadge;
      throw error;
    }
  }

  async recordDirectActivityXp(
    userId: string,
    claimId: string,
    input: DirectActivityXpInput,
  ): Promise<GamificationXpEventRecord | undefined> {
    if (input.amount === 0 && input.leaderboardAmount === 0) return undefined;
    const idempotencyKey = directActivityXpEventIdempotencyKey(userId, claimId);
    const existing = await this.store.findOne<GamificationXpEventRecord>(
      GAMIFICATION_COLLECTIONS.xpEvents,
      { idempotency_key: idempotencyKey },
    );
    if (existing) return existing;
    try {
      return await this.store.create<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, {
        user: userId,
        amount: input.amount,
        leaderboard_amount: input.leaderboardAmount,
        category: input.category,
        reason: input.reason,
        source_type: "activity_claim",
        source_claim: claimId,
        source_id: claimId,
        idempotency_key: idempotencyKey,
        occurred_at: input.occurredAt,
        voided: false,
        metadata: input.metadata || {},
      });
    } catch (error) {
      const racedEvent = await this.store.findOne<GamificationXpEventRecord>(
        GAMIFICATION_COLLECTIONS.xpEvents,
        { idempotency_key: idempotencyKey },
      );
      if (racedEvent) return racedEvent;
      throw error;
    }
  }

  /**
   * The shared entry point for every accepted source claim. It records direct
   * accounting first, then evaluates all configured Meta Achievements.
   */
  async recordActivityAward(input: ActivityAwardInput): Promise<ActivityAwardResult> {
    const queued = awardQueue.catch(() => undefined).then(() => withGamificationLocks(
      this.store,
      [`award:user:${input.claim.user}`, `award:activity:${input.claim.activity}`],
      () => this.recordActivityAwardNow(input),
    ));
    awardQueue = queued;
    return queued;
  }

  /** Returns the configured face value before caps so capped evidence remains valid. */
  async previewActivityScore(input: ActivityClaimInput): Promise<{ totalXp: number; leaderboardXp: number }> {
    const schedules = await this.store.list<GamificationScoreScheduleRecord>(GAMIFICATION_COLLECTIONS.scoreSchedules);
    const schedule = schedules
      .filter((candidate) =>
        (candidate.status === "active" || candidate.status === "superseded") &&
        Date.parse(candidate.effective_at) <= Date.parse(input.occurredAt)
      )
      .sort((left, right) => Date.parse(right.effective_at) - Date.parse(left.effective_at))[0];
    if (!schedule) return { totalXp: 0, leaderboardXp: 0 };
    const policies = await this.store.list<GamificationScoreSchedulePolicyRecord>(
      GAMIFICATION_COLLECTIONS.scoreSchedulePolicies,
      { schedule: schedule.id },
    );
    const policy = policies.find((candidate) => candidate.activity === input.activity && candidate.active);
    return policy
      ? { totalXp: Math.max(0, policy.total_xp), leaderboardXp: Math.max(0, policy.leaderboard_xp) }
      : { totalXp: 0, leaderboardXp: 0 };
  }

  private async recordActivityAwardNow(input: ActivityAwardInput): Promise<ActivityAwardResult> {
    const activity = await this.store.getById<GamificationActivityRecord>(
      GAMIFICATION_COLLECTIONS.activities,
      input.claim.activity,
    );
    const calculatedScore = await this.directScoreForActivity(input.claim);
    const claim = await this.recordActivityClaim({ ...input.claim, capOutcome: calculatedScore.capOutcome });
    const recordedTotalXp = numericCapOutcome(claim.cap_outcome, "awarded_total_xp");
    const recordedLeaderboardXp = numericCapOutcome(claim.cap_outcome, "awarded_leaderboard_xp");
    // Replays retain the first accepted claim's cap outcome, including a valid 0/0 result.
    const score = recordedTotalXp !== undefined && recordedLeaderboardXp !== undefined
      ? this.recordedClaimScore(activity, claim)
      : calculatedScore;
    const achievementId = activity.kind === "meta"
      ? undefined
      : input.resolveAchievement
      ? await input.resolveAchievement(claim, activity)
      : activity.achievement;
    const badge = achievementId
      ? await this.unlockBadge(input.claim.user, achievementId, claim.id, input.publicBadgeVisible)
      : undefined;
    // A Badge is presentation/state. The direct Activity policy is the only direct XP writer.
    const xpEvent = await this.recordDirectActivityXp(input.claim.user, claim.id, score);
    const derivedAwards = claim.source_type === "system_derived"
      ? []
      : await this.evaluateConfiguredEventCompletionsNow(input.claim.user);
    const metaAwards = claim.source_type === "system_meta" || activity.kind === "meta"
      ? []
      : await this.evaluateMetaAchievementsNow(input.claim.user);
    await this.rebuildProfileAfterAuthoritativeWrite({ id: input.claim.user }, claim.id);
    return { claim, badge, xpEvent, derivedAwards, metaAwards };
  }

  private async evaluateConfiguredEventCompletionsNow(userId: string): Promise<DerivedActivityAward[]> {
    const [achievements, activities, claims] = await Promise.all([
      this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, undefined, { limit: 2001 }),
      this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, undefined, { limit: 2001 }),
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, { user: userId, status: "accepted" }, { limit: 10001 }),
    ]);
    this.assertEvaluatorBounds(achievements, activities, claims);
    const candidates = [
      ...evaluateConfiguredEventCompletions({ achievements, activities, claims }),
      ...evaluateCommunityPartnerCompletions({ achievements, activities, claims }),
    ];
    const [existingBadges, existingXpEvents] = await Promise.all([
      this.store.list<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, { user: userId }),
      this.store.list<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, { user: userId }),
    ]);
    const awards: DerivedActivityAward[] = [];
    for (const candidate of candidates) {
      const existing = claims.find((claim) =>
        claim.activity === candidate.activity.id && claim.status === "accepted"
      );
      if (!existing) {
        const recorded = await this.recordConfiguredEventCompletion(userId, candidate);
        claims.push(recorded.claim);
        if (recorded.badge) existingBadges.push(recorded.badge);
        if (recorded.xpEvent) existingXpEvents.push(recorded.xpEvent);
        awards.push(recorded);
        continue;
      }
      const existingBadge = existingBadges.find((badge) =>
        badge.achievement === candidate.achievement.id && badge.status === "unlocked"
      );
      const existingXpEvent = existingXpEvents.find((event) => event.source_claim === existing.id);
      const recordedScore = this.recordedClaimScore(candidate.activity, existing);
      const expectsXp = recordedScore.amount > 0 || recordedScore.leaderboardAmount > 0;
      if (existingBadge && (!expectsXp || existingXpEvent)) continue;
      const repaired = await this.completeConfiguredEventAward(userId, candidate, existing, recordedScore);
      if (repaired.badge) existingBadges.push(repaired.badge);
      if (repaired.xpEvent) existingXpEvents.push(repaired.xpEvent);
      awards.push({
        claim: existing,
        badge: existingBadge ? undefined : repaired.badge,
        xpEvent: existingXpEvent ? undefined : repaired.xpEvent,
      });
    }
    return awards;
  }

  private async recordConfiguredEventCompletion(
    userId: string,
    candidate: ConfiguredEventCompletionCandidate,
  ): Promise<DerivedActivityAward> {
    return withGamificationLocks(this.store, [`award:activity:${candidate.activity.id}`], () =>
      this.recordConfiguredEventCompletionNow(userId, candidate)
    );
  }

  private async recordConfiguredEventCompletionNow(
    userId: string,
    candidate: ConfiguredEventCompletionCandidate,
  ): Promise<DerivedActivityAward> {
    const sourceClaimIds = candidate.sourceClaims.map((claim) => claim.id).sort();
    const fingerprint = createHash("sha256")
      .update(`${candidate.activity.id}:${sourceClaimIds.join(":")}`)
      .digest("hex");
    const claimInput: ActivityClaimInput = {
      user: userId,
      activity: candidate.activity.id,
      sourceType: "system_derived",
      sourceCollection: GAMIFICATION_COLLECTIONS.activityClaims,
      sourceRecordId: sourceClaimIds[0],
      outcomeKey: "completion",
      occurredAt: candidate.occurredAt,
      evidenceFingerprint: fingerprint,
      idempotencyKey: `derived-event-claim:v1:${userId}:${candidate.activity.id}:${fingerprint}`,
      metadata: { derived_claim_set: { source_claim_ids: sourceClaimIds } },
    };
    const score = await this.directScoreForActivity(claimInput);
    const claim = await this.recordActivityClaim({ ...claimInput, capOutcome: score.capOutcome });
    return this.completeConfiguredEventAward(userId, candidate, claim, score);
  }

  private async completeConfiguredEventAward(
    userId: string,
    candidate: ConfiguredEventCompletionCandidate,
    claim: GamificationActivityClaimRecord,
    score: DirectActivityXpInput,
  ): Promise<DerivedActivityAward> {
    const badge = await this.unlockBadge(userId, candidate.achievement.id, claim.id);
    const xpEvent = await this.recordDirectActivityXp(userId, claim.id, score);
    return { claim, badge, xpEvent };
  }

  /** Rechecks configured Meta Achievements without requiring a new source claim. */
  async evaluateMetaAchievementsForUser(user: AccountingUser): Promise<DerivedActivityAward[]> {
    const queued = awardQueue.catch(() => undefined).then(async () => {
      const awards = await this.evaluateMetaAchievementsNow(user.id);
      await this.rebuildProfile(user);
      return awards;
    });
    awardQueue = queued;
    return queued;
  }

  private async evaluateMetaAchievementsNow(userId: string): Promise<DerivedActivityAward[]> {
    const [achievements, activities, claims] = await Promise.all([
      this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, undefined, { limit: 2001 }),
      this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, undefined, { limit: 2001 }),
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, { user: userId, status: "accepted" }, { limit: 10001 }),
    ]);
    this.assertEvaluatorBounds(achievements, activities, claims);
    const candidates = evaluateMetaAchievements({
      achievements,
      activities,
      claims,
      evaluatedAt: this.clock(),
    });
    const [existingBadges, existingXpEvents] = await Promise.all([
      this.store.list<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, { user: userId }),
      this.store.list<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, { user: userId }),
    ]);
    const awards: DerivedActivityAward[] = [];
    for (const candidate of candidates) {
      const existing = claims.find((claim) =>
        claim.activity === candidate.activity.id && claim.status === "accepted"
      );
      if (!existing) {
        const recorded = await this.recordMetaAward(userId, candidate);
        claims.push(recorded.claim);
        if (recorded.badge) existingBadges.push(recorded.badge);
        if (recorded.xpEvent) existingXpEvents.push(recorded.xpEvent);
        awards.push(recorded);
        continue;
      }
      const existingBadge = existingBadges.find((badge) =>
        badge.achievement === candidate.achievement.id && badge.status === "unlocked"
      );
      const existingXpEvent = existingXpEvents.find((event) => event.source_claim === existing.id);
      const recordedScore = this.recordedClaimScore(candidate.activity, existing);
      const expectsXp = recordedScore.amount > 0 || recordedScore.leaderboardAmount > 0;
      if (existingBadge && (!expectsXp || existingXpEvent)) continue;
      const repaired = await this.completeMetaAward(userId, candidate, existing, recordedScore);
      if (repaired.badge) existingBadges.push(repaired.badge);
      if (repaired.xpEvent) existingXpEvents.push(repaired.xpEvent);
      awards.push({
        claim: existing,
        badge: existingBadge ? undefined : repaired.badge,
        xpEvent: existingXpEvent ? undefined : repaired.xpEvent,
      });
    }
    return awards;
  }

  private async recordMetaAward(userId: string, candidate: MetaAchievementCandidate): Promise<DerivedActivityAward> {
    return withGamificationLocks(this.store, [`award:activity:${candidate.activity.id}`], () =>
      this.recordMetaAwardNow(userId, candidate)
    );
  }

  private async recordMetaAwardNow(userId: string, candidate: MetaAchievementCandidate): Promise<DerivedActivityAward> {
    const sourceClaimIds = candidate.sourceClaims.map((claim) => claim.id).sort();
    const fingerprint = metaClaimFingerprint(candidate.achievement.id, sourceClaimIds);
    const occurredAt = this.clock();
    const score = await this.directScoreForActivity({
      user: userId,
      activity: candidate.activity.id,
      sourceType: "system_meta",
      sourceCollection: GAMIFICATION_COLLECTIONS.achievements,
      sourceRecordId: candidate.achievement.id,
      outcomeKey: "meta",
      occurredAt,
      evidenceFingerprint: fingerprint,
      idempotencyKey: `meta-claim:v1:${userId}:${candidate.activity.id}:${fingerprint}`,
    });
    const claim = await this.recordActivityClaim({
      user: userId,
      activity: candidate.activity.id,
      sourceType: "system_meta",
      sourceCollection: GAMIFICATION_COLLECTIONS.achievements,
      sourceRecordId: candidate.achievement.id,
      outcomeKey: "meta",
      occurredAt,
      evidenceFingerprint: fingerprint,
      idempotencyKey: `meta-claim:v1:${userId}:${candidate.activity.id}:${fingerprint}`,
      capOutcome: score.capOutcome,
      // Source composition is server-only evidence for current-user/admin diagnostics.
      metadata: {
        meta_rule: {
          kind: candidate.rule.kind,
          diversity: metaRuleDiversity(candidate.rule),
          source_claim_ids: sourceClaimIds,
        },
      },
    });
    return this.completeMetaAward(userId, candidate, claim, score);
  }

  private async completeMetaAward(
    userId: string,
    candidate: MetaAchievementCandidate,
    claim: GamificationActivityClaimRecord,
    score: DirectActivityXpInput,
  ): Promise<DerivedActivityAward> {
    const badge = await this.unlockBadge(userId, candidate.achievement.id, claim.id);
    const xpEvent = await this.recordDirectActivityXp(userId, claim.id, score);
    return { claim, badge, xpEvent };
  }

  private assertEvaluatorBounds(
    achievements: GamificationAchievementRecord[],
    activities: GamificationActivityRecord[],
    claims: GamificationActivityClaimRecord[],
  ): void {
    if (achievements.length > 2000 || activities.length > 2000 || claims.length > 10000) {
      throw new Error("Gamification evaluation exceeds its safe configured limit. Escalate before recording more awards.");
    }
  }

  private recordedClaimScore(
    activity: GamificationActivityRecord,
    claim: GamificationActivityClaimRecord,
  ): DirectActivityXpInput {
    return {
      amount: numericCapOutcome(claim.cap_outcome, "awarded_total_xp") || 0,
      leaderboardAmount: numericCapOutcome(claim.cap_outcome, "awarded_leaderboard_xp") || 0,
      category: activity.category,
      reason: "Mission activity recorded",
      occurredAt: claim.occurred_at,
    };
  }

  /**
   * Records the exceptional support path without changing the configured Activity
   * policy. Ranking impact is opt-in and can only reproduce that policy outcome.
   */
  async recordManualAward(input: AdminManualAwardInput, auditInput: AuditOperationInput): Promise<AdminManualAwardResult> {
    const activity = await this.store.getById<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, input.activityId);
    const achievement = await this.store.getById<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, input.achievementId);
    const occurredAt = input.occurredAt || this.clock();
    if (!Number.isFinite(Date.parse(occurredAt))) throw new Error("A valid evidence time is required.");
    if (input.mode !== "badge_only" && input.mode !== "missed_evidence") {
      throw new Error("Choose either a Badge-only award or missed-evidence remediation.");
    }
    if (activity.achievement !== achievement.id) {
      throw new Error("The selected Activity and Achievement must be configured together.");
    }
    const supportReference = safeOptionalAdminReference(input.supportReference);
    const claimKey = manualActivityClaimIdempotencyKey(auditInput.targetUser, activity.id, auditInput.operationId);
    const policyScore = input.mode === "missed_evidence"
      ? await this.directScoreForActivity({
        user: auditInput.targetUser,
        activity: activity.id,
        sourceType: "admin_manual",
        outcomeKey: activity.outcome_key,
        occurredAt,
        evidenceFingerprint: claimKey,
        idempotencyKey: claimKey,
      })
      : this.zeroScore(activity, occurredAt, "Badge-only manual award.");
    const rankingRequested = policyScore.leaderboardAmount > 0 && Boolean(input.rankingError || input.highImpactConfirmed);
    if (rankingRequested) {
      this.assertPermittedRankingAdjustment(input, policyScore, supportReference);
    }
    let score = {
      ...policyScore,
      leaderboardAmount: rankingRequested ? policyScore.leaderboardAmount : 0,
      capOutcome: {
        ...policyScore.capOutcome,
        awarded_total_xp: policyScore.amount,
        awarded_leaderboard_xp: rankingRequested ? policyScore.leaderboardAmount : 0,
        policy_leaderboard_xp: policyScore.leaderboardAmount,
      },
    };
    const priorAction = await this.store.findOne<GamificationAdminActionRecord>(
      GAMIFICATION_COLLECTIONS.adminActions,
      { idempotency_key: adminActionIdempotencyKey("manual_award", safeAdminText(auditInput.operationId, "Operation ID")) },
    );
    const priorTotalXp = priorAction && numericCapOutcome(priorAction.after_summary, "totalXpDelta");
    const priorLeaderboardXp = priorAction && numericCapOutcome(priorAction.after_summary, "leaderboardXpDelta");
    if (priorTotalXp !== undefined && priorLeaderboardXp !== undefined) {
      score = {
        ...score,
        amount: priorTotalXp,
        leaderboardAmount: priorLeaderboardXp,
        capOutcome: {
          ...score.capOutcome,
          awarded_total_xp: priorTotalXp,
          awarded_leaderboard_xp: priorLeaderboardXp,
        },
      };
    }
    const action = await this.recordAdminAction(
      "manual_award",
      GAMIFICATION_COLLECTIONS.activities,
      activity.id,
      auditInput,
      {
        after: {
          achievementId: achievement.id,
          activityId: activity.id,
          mode: input.mode,
          occurredAt,
          totalXpDelta: score.amount,
          leaderboardXpDelta: score.leaderboardAmount,
          supportReference,
          rankingError: rankingRequested ? input.rankingError : undefined,
        },
      },
    );
    if (action.status === "applied") return this.manualAwardResult(action, auditInput.targetUser, activity.id, achievement.id, claimKey);
    const recordedTotalXp = numericCapOutcome(action.after_summary, "totalXpDelta");
    const recordedLeaderboardXp = numericCapOutcome(action.after_summary, "leaderboardXpDelta");
    if (recordedTotalXp !== undefined && recordedLeaderboardXp !== undefined) {
      // A cache-repair retry must retain the first authoritative policy result.
      score = {
        ...score,
        amount: recordedTotalXp,
        leaderboardAmount: recordedLeaderboardXp,
        capOutcome: {
          ...score.capOutcome,
          awarded_total_xp: recordedTotalXp,
          awarded_leaderboard_xp: recordedLeaderboardXp,
        },
      };
    }

    const existingClaim = await this.store.findOne<GamificationActivityClaimRecord>(
      GAMIFICATION_COLLECTIONS.activityClaims,
      { user: auditInput.targetUser, activity: activity.id },
    );
    if (existingClaim && existingClaim.idempotency_key !== claimKey) {
      await this.failAdminAction(action);
      throw new Error("This User already has accepted evidence for the selected Activity.");
    }

    let claim: GamificationActivityClaimRecord;
    let badge: GamificationUserAchievementRecord;
    let xpEvent: GamificationXpEventRecord | undefined;
    try {
      claim = await this.recordActivityClaim({
        user: auditInput.targetUser,
        activity: activity.id,
        sourceType: "admin_manual",
        sourceCollection: GAMIFICATION_COLLECTIONS.adminActions,
        sourceRecordId: action.id,
        outcomeKey: activity.outcome_key,
        occurredAt,
        evidenceFingerprint: claimKey,
        idempotencyKey: claimKey,
        capOutcome: score.capOutcome,
        metadata: supportReference ? { support_reference: supportReference } : {},
      });
      const awardedBadge = await this.unlockBadge(auditInput.targetUser, achievement.id, claim.id, true, true);
      if (!awardedBadge) throw new Error("The audited Badge restoration could not be recorded.");
      badge = awardedBadge;
      xpEvent = await this.recordDirectActivityXp(auditInput.targetUser, claim.id, {
        amount: score.amount,
        leaderboardAmount: score.leaderboardAmount,
        category: activity.category,
        reason: "Admin manual award",
        occurredAt,
        metadata: { admin_action: action.id },
      });
      if (activity.kind !== "meta") {
        await this.evaluateConfiguredEventCompletionsNow(auditInput.targetUser);
        await this.evaluateMetaAchievementsNow(auditInput.targetUser);
      }
    } catch (error) {
      await this.failAdminAction(action);
      throw error;
    }

    // Authoritative accounting remains intact when this cache-only step fails.
    await this.rebuildProfile({ id: auditInput.targetUser });
    await this.completeAdminAction(action);
    return {
      actionId: action.id,
      claimId: claim.id,
      badgeId: badge.id,
      xpEventId: xpEvent?.id,
      totalXp: score.amount,
      leaderboardXp: score.leaderboardAmount,
    };
  }

  async recordXpCorrection(input: AdminXpCorrectionInput, auditInput: AuditOperationInput): Promise<GamificationXpEventRecord> {
    if (!Number.isFinite(input.amount) || !Number.isFinite(input.leaderboardAmount)) {
      throw new Error("Correction amounts must be finite numbers.");
    }
    if (input.amount === 0 && input.leaderboardAmount === 0) {
      throw new Error("A correction must change total XP or Leaderboard XP.");
    }
    const supportReference = safeOptionalAdminReference(input.supportReference);
    const isHighImpact = input.amount < 0 || input.leaderboardAmount !== 0;
    let activity: GamificationActivityRecord | undefined;
    if (input.activityId) {
      activity = await this.store.getById<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, input.activityId);
    }
    if (input.leaderboardAmount !== 0) {
      if (!activity) throw new Error("A ranking correction must identify the original Activity.");
      const expected = await this.originalPolicyOutcome(input, auditInput.targetUser, activity);
      this.assertPermittedRankingAdjustment(input, expected, supportReference);
      const sign = Math.sign(input.amount || input.leaderboardAmount);
      if (
        input.amount !== sign * expected.amount ||
        input.leaderboardAmount !== sign * expected.leaderboardAmount
      ) {
        throw new Error("A ranking correction must match the original Activity policy and cap outcome.");
      }
    }
    if (isHighImpact && !input.highImpactConfirmed) {
      throw new Error("Negative corrections and ranking changes require high-impact confirmation.");
    }
    const action = await this.recordAdminAction(
      "admin_correction",
      GAMIFICATION_COLLECTIONS.xpEvents,
      auditInput.operationId,
      auditInput,
      {
        after: {
          activityId: activity?.id,
          originalXpEventId: input.originalXpEventId,
          totalXpDelta: input.amount,
          leaderboardXpDelta: input.leaderboardAmount,
          supportReference,
          rankingError: input.leaderboardAmount !== 0 ? input.rankingError : undefined,
        },
      },
    );
    const idempotencyKey = adminCorrectionXpEventIdempotencyKey(auditInput.targetUser, auditInput.operationId);
    const existing = await this.store.findOne<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, { idempotency_key: idempotencyKey });
    let event = existing;
    try {
      if (!event) {
        event = await this.store.create<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, {
          user: auditInput.targetUser,
          amount: input.amount,
          leaderboard_amount: input.leaderboardAmount,
          category: activity?.category || "admin_manual",
          reason: "Admin XP correction",
          source_type: "admin_correction",
          source_id: action.id,
          idempotency_key: idempotencyKey,
          occurred_at: this.clock(),
          voided: false,
          metadata: {
            activity_id: activity?.id,
            original_xp_event_id: input.originalXpEventId,
            support_reference: supportReference,
          },
        });
      }
    } catch (error) {
      await this.failAdminAction(action);
      throw error;
    }
    await this.rebuildProfile({ id: auditInput.targetUser });
    await this.completeAdminAction(action);
    return event;
  }

  async rebuildProfile(user: AccountingUser): Promise<GamificationProfileRecord> {
    const previous = profileRebuilds.get(user.id) || Promise.resolve();
    const rebuilding = previous.catch(() => undefined).then(() => this.rebuildProfileNow(user));
    profileRebuilds.set(user.id, rebuilding);
    try {
      return await rebuilding;
    } finally {
      if (profileRebuilds.get(user.id) === rebuilding) profileRebuilds.delete(user.id);
    }
  }

  private async rebuildProfileAfterAuthoritativeWrite(user: AccountingUser, sourceRecordId: string): Promise<void> {
    try {
      await this.rebuildProfile(user);
    } catch (error) {
      const supportReference = `GAM-${createHash("sha256")
        .update(`${user.id}:${sourceRecordId}`)
        .digest("hex")
        .slice(0, 12)
        .toUpperCase()}`;
      const profile = await this.store.findOne<GamificationProfileRecord>(
        GAMIFICATION_COLLECTIONS.profiles,
        { user: user.id },
      ).catch(() => undefined);
      if (profile) {
        await this.store.update<GamificationProfileRecord>(GAMIFICATION_COLLECTIONS.profiles, profile.id, {
          rebuild_pending: true,
          rebuild_support_reference: supportReference,
        }).catch(() => undefined);
      }
      console.error(JSON.stringify({
        event: "gamification_profile_rebuild_pending",
        supportReference,
        userId: user.id,
        sourceRecordId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      }));
    }
  }

  /** Updates public presentation preferences without letting a browser target another User. */
  async updateVisibilitySettings(
    user: AccountingUser,
    input: GamificationVisibilitySettingsInput,
  ): Promise<GamificationProfileSummary> {
    if (typeof input?.opsBoardVisible !== "boolean" || typeof input?.publicBadgesVisible !== "boolean") {
      throw new Error("Ops-board visibility settings are invalid.");
    }
    const profile = await this.ensureProfile(user);
    await this.store.update<GamificationProfileRecord>(GAMIFICATION_COLLECTIONS.profiles, profile.id, {
      ops_board_visible: input.opsBoardVisible,
      ops_board_display_name: validateGamificationDisplayName(input.opsBoardDisplayName),
      public_badges_visible: input.publicBadgesVisible,
    });
    // Rebuilding makes the cached row returned by the next board read reflect this write.
    await this.rebuildProfile(user);
    return this.summaryForUser(user);
  }

  /** Changes only the current User's unlocked Badge presentation preference. */
  async updateBadgeVisibility(
    user: AccountingUser,
    badgeId: string,
    publicVisible: boolean,
  ): Promise<GamificationProfileSummary> {
    if (typeof badgeId !== "string" || !badgeId || typeof publicVisible !== "boolean") {
      throw new Error("Badge visibility settings are invalid.");
    }
    const badge = await this.store.getById<GamificationUserAchievementRecord>(
      GAMIFICATION_COLLECTIONS.userAchievements,
      badgeId,
    );
    if (badge.user !== user.id || badge.status !== "unlocked") {
      throw new Error("You can only change visibility for your unlocked Badges.");
    }
    await this.store.update<GamificationUserAchievementRecord>(
      GAMIFICATION_COLLECTIONS.userAchievements,
      badge.id,
      { public_visible: publicVisible },
    );
    await this.rebuildProfile(user);
    return this.summaryForUser(user);
  }

  private async rebuildProfileNow(user: AccountingUser): Promise<GamificationProfileRecord> {
    const profile = await this.ensureProfile(user);
    const [xpEvents, userAchievements, schedules] = await Promise.all([
      this.store.list<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, { user: user.id }),
      this.store.list<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, { user: user.id }),
      this.store.list<GamificationScoreScheduleRecord>(GAMIFICATION_COLLECTIONS.scoreSchedules),
    ]);
    const lockedSchedule = profile.access_level_schedule
      ? schedules.find((schedule) => schedule.id === profile.access_level_schedule)
      : undefined;
    const scheduleCutoff = Math.max(
      Date.now(),
      ...xpEvents.filter((event) => !event.voided).map((event) => Date.parse(event.occurred_at)),
    );
    const firstConferenceSchedule = schedules
      .filter(
        (schedule) =>
          (schedule.status === "active" || schedule.status === "superseded") &&
          schedule.total_xp_ceiling > 0 &&
          Date.parse(schedule.effective_at) <= scheduleCutoff,
      )
      .sort((a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at))[0];
    const accessLevelSchedule = lockedSchedule || firstConferenceSchedule;
    const rebuilt = rebuildGamificationProfile(
      profile,
      xpEvents,
      userAchievements,
      accessLevelSchedule?.access_level_thresholds || {},
    );
    return this.store.update<GamificationProfileRecord>(GAMIFICATION_COLLECTIONS.profiles, profile.id, {
      total_xp: rebuilt.totalXp,
      leaderboard_xp: rebuilt.leaderboardXp,
      access_level: rebuilt.accessLevel,
      access_level_schedule: accessLevelSchedule?.id || "",
      access_level_threshold: rebuilt.accessLevelThreshold,
      next_level_threshold: rebuilt.nextLevelThreshold,
      xp_into_level: rebuilt.xpIntoLevel,
      xp_to_next_level: rebuilt.xpToNextLevel,
      unlocked_badge_count: rebuilt.unlockedBadgeCount,
      totals_version: Number(profile.totals_version || 0) + 1,
      totals_recalculated_at: this.clock(),
      rebuild_pending: false,
      rebuild_support_reference: "",
    });
  }

  async rebuildProfileWithAudit(user: AccountingUser, input: AuditOperationInput): Promise<GamificationProfileRecord> {
    const profile = await this.ensureProfile(user);
    const action = await this.recordAdminAction(
      "rebuild_profile_cache",
      GAMIFICATION_COLLECTIONS.profiles,
      profile.id,
      input,
      { before: { profileId: profile.id, totalsVersion: profile.totals_version } },
    );
    try {
      const rebuilt = await this.rebuildProfile(user);
      await this.resolvePendingRebuilds(input.targetUser, action.id);
      await this.completeAdminAction(action);
      return rebuilt;
    } catch (error) {
      await this.failAdminAction(action);
      throw error;
    }
  }

  async voidXpEvent(eventId: string, input: AuditOperationInput): Promise<GamificationXpEventRecord> {
    const event = await this.store.getById<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, eventId);
    if (event.user !== input.targetUser) throw new Error("XP Event does not belong to the selected User.");
    const action = await this.recordAdminAction("void_xp_event", GAMIFICATION_COLLECTIONS.xpEvents, eventId, input, {
      before: { voided: event.voided, totalXpDelta: event.amount, leaderboardXpDelta: event.leaderboard_amount },
      after: { voided: true, totalXpDelta: 0, leaderboardXpDelta: 0 },
    });
    let voidedEvent: GamificationXpEventRecord;
    try {
      if (event.voided) {
        voidedEvent = event;
      } else {
        voidedEvent = await this.store.update<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, event.id, {
          voided: true,
          voided_at: this.clock(),
          voided_by: input.actor,
          void_reason: input.reason,
          void_admin_action: action.id,
        });
      }
    } catch (error) {
      await this.failAdminAction(action);
      throw error;
    }
    // The authoritative void is durable. A cache failure remains rebuild_pending for retry.
    await this.rebuildProfile({ id: input.targetUser });
    await this.completeAdminAction(action);
    return voidedEvent;
  }

  /**
   * Voids source evidence and reconciles only the automated outcomes that relied
   * on it. XP-only voids deliberately use `voidXpEvent` instead and do not affect
   * Meta eligibility.
   */
  async voidActivityClaim(claimId: string, input: AuditOperationInput): Promise<GamificationActivityClaimRecord> {
    const claim = await this.store.getById<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, claimId);
    if (claim.user !== input.targetUser) throw new Error("Activity Claim does not belong to the selected User.");
    if (claim.source_type === "system_meta" || claim.source_type === "system_derived") {
      throw new Error("Derived claims are reconciled from their source evidence.");
    }
    const action = await this.recordAdminAction("void_activity_claim", GAMIFICATION_COLLECTIONS.activityClaims, claimId, input, {
      before: { status: claim.status, activityId: claim.activity },
      after: { status: "voided", activityId: claim.activity },
    });
    let voidedClaim: GamificationActivityClaimRecord;
    try {
      voidedClaim = claim.status === "voided"
        ? claim
        : await this.store.update<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, claim.id, {
          status: "voided",
          voided_at: this.clock(),
          voided_by: input.actor,
          void_reason: input.reason,
          void_admin_action: action.id,
        });
      await this.voidXpEventsForClaim(claim.user, claim.id, action.id, input);
      await this.revokeAutomatedBadgesForClaim(claim.user, claim.id, action.id, input);
      await this.reconcileConfiguredEventAfterSourceVoid(claim.user, action.id, input);
      await this.reconcileMetaAfterSourceVoid(claim.user, action.id, input);
    } catch (error) {
      await this.failAdminAction(action);
      throw error;
    }
    await this.rebuildProfile({ id: input.targetUser });
    await this.completeAdminAction(action);
    return voidedClaim;
  }

  async revokeBadge(badgeId: string, input: AuditOperationInput): Promise<GamificationUserAchievementRecord> {
    const badge = await this.store.getById<GamificationUserAchievementRecord>(
      GAMIFICATION_COLLECTIONS.userAchievements,
      badgeId,
    );
    if (badge.user !== input.targetUser) throw new Error("Badge does not belong to the selected User.");
    const action = await this.recordAdminAction(
      "revoke_user_achievement",
      GAMIFICATION_COLLECTIONS.userAchievements,
      badgeId,
      input,
      {
        before: { status: badge.status, achievementId: badge.achievement },
        after: { status: "revoked", achievementId: badge.achievement },
      },
    );
    let revokedBadge: GamificationUserAchievementRecord;
    try {
      if (badge.status === "revoked") {
        revokedBadge = badge;
      } else {
        revokedBadge = await this.store.update<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, badge.id, {
          status: "revoked",
          revoked_at: this.clock(),
          revoked_by: input.actor,
          revoked_reason: input.reason,
          source_admin_action: action.id,
        });
      }
    } catch (error) {
      await this.failAdminAction(action);
      throw error;
    }
    // The authoritative revocation is durable. A cache failure remains rebuild_pending for retry.
    await this.rebuildProfile({ id: input.targetUser });
    await this.completeAdminAction(action);
    return revokedBadge;
  }

  private async voidXpEventsForClaim(
    userId: string,
    claimId: string,
    actionId: string,
    input: AuditOperationInput,
  ): Promise<void> {
    const events = await this.store.list<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, {
      user: userId,
      source_claim: claimId,
    });
    await Promise.all(events
      .filter((event) => !event.voided)
      .map((event) => this.store.update(GAMIFICATION_COLLECTIONS.xpEvents, event.id, {
        voided: true,
        voided_at: this.clock(),
        voided_by: input.actor,
        void_reason: input.reason,
        void_admin_action: actionId,
      })));
  }

  private async revokeAutomatedBadgesForClaim(
    userId: string,
    claimId: string,
    actionId: string,
    input: AuditOperationInput,
  ): Promise<void> {
    const badges = await this.store.list<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, {
      user: userId,
      source_claim: claimId,
      status: "unlocked",
    });
    const [claims, activities] = await Promise.all([
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, { user: userId }),
      this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities),
    ]);
    const activityById = new Map(activities.map((activity) => [activity.id, activity]));
    await Promise.all(badges.map(async (badge) => {
      const stillSupported = claims.some((candidate) =>
        candidate.id !== claimId &&
        candidate.status === "accepted" &&
        activityById.get(candidate.activity)?.achievement === badge.achievement,
      );
      if (stillSupported) return;
      await this.store.update(GAMIFICATION_COLLECTIONS.userAchievements, badge.id, {
        status: "revoked",
        revoked_at: this.clock(),
        revoked_by: input.actor,
        revoked_reason: input.reason,
        source_admin_action: actionId,
      });
    }));
  }

  private async reconcileMetaAfterSourceVoid(
    userId: string,
    actionId: string,
    input: AuditOperationInput,
  ): Promise<void> {
    const [achievements, activities, claims] = await Promise.all([
      this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements),
      this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities),
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, { user: userId }),
    ]);
    const supportedActivityIds = new Set(evaluateMetaAchievements({
      achievements,
      activities,
      claims,
      evaluatedAt: this.clock(),
      includeInactiveMeta: true,
    }).map((candidate) => candidate.activity.id));
    const metaActivityIds = new Set(activities
      .filter((activity) => {
        const achievement = achievements.find((candidate) => candidate.id === activity.achievement);
        return activity.kind === "meta" && activity.evidence_mode === "meta_rule" &&
          achievement?.category === "meta";
      })
      .map((activity) => activity.id));
    const unsupportedClaims = claims.filter((claim) =>
      claim.source_type === "system_meta" &&
      claim.status === "accepted" &&
      metaActivityIds.has(claim.activity) &&
      !supportedActivityIds.has(claim.activity),
    );
    for (const claim of unsupportedClaims) {
      await this.store.update(GAMIFICATION_COLLECTIONS.activityClaims, claim.id, {
        status: "voided",
        voided_at: this.clock(),
        voided_by: input.actor,
        void_reason: `Source evidence voided: ${input.reason}`,
        void_admin_action: actionId,
      });
      await this.voidXpEventsForClaim(userId, claim.id, actionId, input);
      // Manual awards have a different source claim and are therefore never selected here.
      await this.revokeAutomatedBadgesForClaim(userId, claim.id, actionId, input);
    }
  }

  private async reconcileConfiguredEventAfterSourceVoid(
    userId: string,
    actionId: string,
    input: AuditOperationInput,
  ): Promise<void> {
    const [achievements, activities, claims] = await Promise.all([
      this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements),
      this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities),
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, { user: userId }),
    ]);
    const supportedActivityIds = new Set([
      ...evaluateConfiguredEventCompletions({ achievements, activities, claims, includeInactive: true }),
      ...evaluateCommunityPartnerCompletions({ achievements, activities, claims, includeInactive: true }),
    ].map((candidate) => candidate.activity.id));
    const unsupportedClaims = claims.filter((claim) =>
      claim.source_type === "system_derived" &&
      claim.status === "accepted" &&
      !supportedActivityIds.has(claim.activity),
    );
    for (const claim of unsupportedClaims) {
      await this.store.update(GAMIFICATION_COLLECTIONS.activityClaims, claim.id, {
        status: "voided",
        voided_at: this.clock(),
        voided_by: input.actor,
        void_reason: `Source evidence voided: ${input.reason}`,
        void_admin_action: actionId,
      });
      await this.voidXpEventsForClaim(userId, claim.id, actionId, input);
      await this.revokeAutomatedBadgesForClaim(userId, claim.id, actionId, input);
    }
  }

  async summaryForUser(user: AccountingUser): Promise<GamificationProfileSummary> {
    const profile = await this.ensureProfile(user);
    const [userAchievements, achievements, missions] = await Promise.all([
      this.store.list<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, { user: user.id }),
      this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, undefined, { sort: "sort_order,key", limit: 500 }),
      this.store.list<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, { status: "active", visibility: "public", suggested: true }, { sort: "sort_order,key", limit: 20 }),
    ]);
    return buildGamificationProfileSummary(profile, userAchievements, achievements, missions);
  }

  /** Reads only profile-cache rows and configuration needed to allowlist public Badge presentation. */
  async publicOpsBoard(): Promise<GamificationPublicOpsBoardRow[]> {
    return (await this.publicOpsBoardPage(1, 100)).items;
  }

  async publicOpsBoardPage(pageInput = 1, perPageInput = 50): Promise<GamificationPublicOpsBoardPage> {
    const page = Math.max(1, Math.floor(Number(pageInput) || 1));
    const perPage = Math.min(100, Math.max(1, Math.floor(Number(perPageInput) || 50)));
    const maximumRows = 500;
    const profiles = await this.store.list<GamificationProfileRecord>(
      GAMIFICATION_COLLECTIONS.profiles,
      { ops_board_visible: true },
      { sort: "-leaderboard_xp,id", limit: maximumRows },
    );
    const boundedProfiles = profiles.slice(0, maximumRows);
    const userIds = boundedProfiles.map((profile) => profile.user);
    const [userAchievements, achievements, activities] = await Promise.all([
      userIds.length
        ? Promise.all(chunks(userIds, 100).map((ids) =>
          this.store.list<GamificationUserAchievementRecord>(
            GAMIFICATION_COLLECTIONS.userAchievements,
            { user: ids, status: "unlocked", public_visible: true },
            { sort: "-unlocked_at,id", limit: ids.length * 20 },
          )
        )).then((rows) => rows.flat())
        : Promise.resolve([]),
      this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, undefined, { limit: 500 }),
      this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, undefined, { limit: 1000 }),
    ]);
    const allRows = buildGamificationPublicOpsBoardRows(boundedProfiles, userAchievements, achievements, activities);
    const totalPages = Math.max(1, Math.ceil(allRows.length / perPage));
    const effectivePage = Math.min(page, totalPages);
    const offset = (effectivePage - 1) * perPage;
    return {
      items: allRows.slice(offset, offset + perPage),
      page: effectivePage,
      perPage,
      totalItems: allRows.length,
      totalPages,
      resultLimitReached: profiles.length === maximumRows,
    };
  }

  private async manualAwardResult(
    action: GamificationAdminActionRecord,
    userId: string,
    activityId: string,
    achievementId: string,
    claimKey: string,
  ): Promise<AdminManualAwardResult> {
    const [claim, badge] = await Promise.all([
      this.store.findOne<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, { idempotency_key: claimKey }),
      this.store.findOne<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, { user: userId, achievement: achievementId }),
    ]);
    if (!claim || claim.activity !== activityId || !badge) {
      throw new Error("The prior manual award is incomplete. Retry with the same operation ID to repair it.");
    }
    const xpEvent = await this.store.findOne<GamificationXpEventRecord>(
      GAMIFICATION_COLLECTIONS.xpEvents,
      { idempotency_key: directActivityXpEventIdempotencyKey(userId, claim.id) },
    );
    return {
      actionId: action.id,
      claimId: claim.id,
      badgeId: badge.id,
      xpEventId: xpEvent?.id,
      totalXp: numericCapOutcome(claim.cap_outcome, "awarded_total_xp") || 0,
      leaderboardXp: numericCapOutcome(claim.cap_outcome, "awarded_leaderboard_xp") || 0,
    };
  }

  private assertPermittedRankingAdjustment(
    input: Pick<AdminManualAwardInput | AdminXpCorrectionInput, "rankingError" | "highImpactConfirmed">,
    expected: Pick<DirectActivityXpInput, "amount" | "leaderboardAmount">,
    supportReference: string | undefined,
  ): void {
    if (!input.highImpactConfirmed) throw new Error("A ranking change requires separate high-impact confirmation.");
    if (!input.rankingError || !["automation", "source_sync", "prior_accounting"].includes(input.rankingError)) {
      throw new Error("A ranking change must identify an automation, source-sync, or prior-accounting error.");
    }
    if (!supportReference) throw new Error("A ranking change requires a source or support reference.");
    if (expected.amount <= 0 || expected.leaderboardAmount <= 0) {
      throw new Error("The original Activity policy does not permit a ranking adjustment.");
    }
  }

  private async originalPolicyOutcome(
    input: AdminXpCorrectionInput,
    userId: string,
    activity: GamificationActivityRecord,
  ): Promise<DirectActivityXpInput & { capOutcome: Record<string, unknown> }> {
    if (input.originalXpEventId) {
      const event = await this.store.getById<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, input.originalXpEventId);
      if (event.user !== userId || !event.source_claim) {
        throw new Error("The original XP Event must belong to the selected User and Activity Claim.");
      }
      const claim = await this.store.getById<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, event.source_claim);
      if (claim.activity !== activity.id) throw new Error("The original XP Event does not belong to the selected Activity.");
      const amount = numericCapOutcome(claim.cap_outcome, "awarded_total_xp");
      const leaderboardAmount = numericCapOutcome(claim.cap_outcome, "awarded_leaderboard_xp");
      if (amount === undefined || leaderboardAmount === undefined) {
        throw new Error("The original Activity Claim is missing its policy and cap outcome.");
      }
      return {
        amount,
        leaderboardAmount,
        category: activity.category,
        reason: "Original Activity policy outcome",
        occurredAt: claim.occurred_at,
        capOutcome: claim.cap_outcome || {},
      };
    }
    const occurredAt = this.clock();
    return this.directScoreForActivity({
      user: userId,
      activity: activity.id,
      sourceType: "admin_manual",
      outcomeKey: activity.outcome_key,
      occurredAt,
      evidenceFingerprint: `admin-correction-preview:${userId}:${activity.id}`,
      idempotencyKey: `admin-correction-preview:${userId}:${activity.id}`,
    });
  }

  private async directScoreForActivity(input: ActivityClaimInput): Promise<DirectActivityXpInput & {
    capOutcome: Record<string, unknown>;
  }> {
    const activity = await this.store.getById<GamificationActivityRecord>(
      GAMIFICATION_COLLECTIONS.activities,
      input.activity,
    );
    const schedules = await this.store.list<GamificationScoreScheduleRecord>(
      GAMIFICATION_COLLECTIONS.scoreSchedules,
    );
    const schedule = schedules
      // Superseded schedules remain authoritative for claims that happened before a later version became effective.
      .filter(
        (candidate) =>
          (candidate.status === "active" || candidate.status === "superseded") &&
          Date.parse(candidate.effective_at) <= Date.parse(input.occurredAt),
      )
      .sort((a, b) => Date.parse(b.effective_at) - Date.parse(a.effective_at))[0];
    if (!schedule) {
      return this.zeroScore(activity, input.occurredAt, "No active score policy applies to this Activity.");
    }
    const policies = await this.store.list<GamificationScoreSchedulePolicyRecord>(
      GAMIFICATION_COLLECTIONS.scoreSchedulePolicies,
      { schedule: schedule.id },
    );
    const policy = policies.find((candidate) => candidate.activity === activity.id && candidate.active);
    if (!policy) return this.zeroScore(activity, input.occurredAt, "This Activity has no direct score policy.");

    const [caps, existingEvents, claims] = await Promise.all([
      this.store.list<GamificationScoreScheduleCapRecord>(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, { schedule: schedule.id }),
      this.store.list<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, { user: input.user }),
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, { user: input.user }),
    ]);
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    const policyByActivity = new Map(policies.map((candidate) => [candidate.activity, candidate]));
    let amount = Math.max(0, policy.total_xp);
    let leaderboardAmount = Math.max(0, policy.leaderboard_xp);
    const appliedCaps: Array<{ key: string; totalXpRemaining: number; leaderboardXpRemaining: number }> = [];
    for (const cap of caps) {
      if (!cap.member_policy_keys.includes(policy.policy_key)) continue;
      const used = existingEvents.filter((event) => {
        if (event.voided || !event.source_claim) return false;
        const claim = claimById.get(event.source_claim);
        const priorPolicy = claim ? policyByActivity.get(claim.activity) : undefined;
        return Boolean(priorPolicy && cap.member_policy_keys.includes(priorPolicy.policy_key));
      });
      const totalXpRemaining = Math.max(0, cap.total_xp_ceiling - used.reduce((total, event) => total + event.amount, 0));
      const leaderboardXpRemaining = Math.max(
        0,
        cap.leaderboard_xp_ceiling - used.reduce((total, event) => total + event.leaderboard_amount, 0),
      );
      amount = Math.min(amount, totalXpRemaining);
      leaderboardAmount = Math.min(leaderboardAmount, leaderboardXpRemaining);
      appliedCaps.push({ key: `${cap.dimension}:${cap.cap_key}`, totalXpRemaining, leaderboardXpRemaining });
    }
    return {
      amount,
      leaderboardAmount,
      category: activity.category,
      reason: "Mission activity recorded",
      occurredAt: input.occurredAt,
      capOutcome: {
        schedule: schedule.id,
        policy: policy.policy_key,
        awarded_total_xp: amount,
        awarded_leaderboard_xp: leaderboardAmount,
        applied_caps: appliedCaps,
      },
    };
  }

  private zeroScore(activity: GamificationActivityRecord, occurredAt: string, policyState: string): DirectActivityXpInput & {
    capOutcome: Record<string, unknown>;
  } {
    return {
      amount: 0,
      leaderboardAmount: 0,
      category: activity.category,
      reason: "Mission activity recorded",
      occurredAt,
      capOutcome: { awarded_total_xp: 0, awarded_leaderboard_xp: 0, policy_state: policyState },
    };
  }

  private async assertSponsorBoothEvidence(
    activity: GamificationActivityRecord,
    input: ActivityClaimInput,
  ): Promise<void> {
    if (input.outcomeKey !== activity.outcome_key) {
      throw new Error("Booth evidence must match its configured outcome Activity.");
    }
    if (input.sourceType === "code_redemption") {
      const redemption = input.sourceCollection === GAMIFICATION_COLLECTIONS.codeRedemptions && input.sourceRecordId
        ? await this.store.findOne<{ user: string; activity: string; status: string }>(
          GAMIFICATION_COLLECTIONS.codeRedemptions,
          { id: input.sourceRecordId },
        )
        : undefined;
      if (!redemption || redemption.status !== "accepted" || redemption.user !== input.user || redemption.activity !== activity.id) {
        throw new Error("Booth Activities require a verified WTS Mission code redemption for this User and outcome.");
      }
      return;
    }
    if (input.sourceType === "admin_manual") {
      const action = input.sourceCollection === GAMIFICATION_COLLECTIONS.adminActions && input.sourceRecordId
        ? await this.store.findOne<{
          action: string;
          status: string;
          target_user?: string;
          related_collection?: string;
          related_record_id?: string;
        }>(GAMIFICATION_COLLECTIONS.adminActions, { id: input.sourceRecordId })
        : undefined;
      if (
        !action ||
        action.action !== "manual_award" ||
        action.status === "failed" ||
        action.target_user !== input.user ||
        action.related_collection !== GAMIFICATION_COLLECTIONS.activities ||
        action.related_record_id !== activity.id
      ) {
        throw new Error("Booth Activities require an audited admin support award for this User and outcome.");
      }
    }
  }

  private async assertCommunityPartnerEvidence(
    activity: GamificationActivityRecord,
    input: ActivityClaimInput,
  ): Promise<void> {
    if (
      activity.category !== "community" ||
      activity.partner_kind !== "community_partner" ||
      input.outcomeKey !== activity.outcome_key
    ) {
      throw new Error("Community Partner evidence must match its configured community Activity.");
    }
    if (input.sourceType === "admin_manual") {
      const action = input.sourceCollection === GAMIFICATION_COLLECTIONS.adminActions && input.sourceRecordId
        ? await this.store.findOne<{
          action: string;
          status: string;
          target_user?: string;
          related_collection?: string;
          related_record_id?: string;
        }>(GAMIFICATION_COLLECTIONS.adminActions, { id: input.sourceRecordId })
        : undefined;
      if (
        !action ||
        action.action !== "manual_award" ||
        action.status === "failed" ||
        action.target_user !== input.user ||
        action.related_collection !== GAMIFICATION_COLLECTIONS.activities ||
        action.related_record_id !== activity.id
      ) {
        throw new Error("Community Partner Activities require audited admin support for manual exceptions.");
      }
      return;
    }
    if (activity.evidence_mode === "derived_claim_set") {
      const sourceClaimIds = input.metadata && typeof input.metadata.derived_claim_set === "object"
        ? (input.metadata.derived_claim_set as { source_claim_ids?: unknown }).source_claim_ids
        : undefined;
      if (input.sourceType !== "system_derived" || !Array.isArray(sourceClaimIds) || sourceClaimIds.length !== 2) {
        throw new Error("Community Partner completion requires both accepted WTS start and finish claims.");
      }
      const [achievements, activities, claims] = await Promise.all([
        this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements),
        this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities),
        this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, { user: input.user }),
      ]);
      const supported = evaluateCommunityPartnerCompletions({ achievements, activities, claims })
        .find((candidate) => candidate.activity.id === activity.id);
      const supportedIds = supported?.sourceClaims.map((claim) => claim.id).sort();
      if (!supportedIds || JSON.stringify(supportedIds) !== JSON.stringify([...sourceClaimIds].sort())) {
        throw new Error("Community Partner completion requires both accepted WTS start and finish claims.");
      }
      return;
    }
    if (input.sourceType !== "code_redemption") {
      throw new Error("Community Partner Activities accept only WTS Mission code evidence or audited admin support.");
    }
    const redemption = input.sourceCollection === GAMIFICATION_COLLECTIONS.codeRedemptions && input.sourceRecordId
      ? await this.store.findOne<{ user: string; activity: string; status: string; code: string }>(
        GAMIFICATION_COLLECTIONS.codeRedemptions,
        { id: input.sourceRecordId },
      )
      : undefined;
    if (!redemption || redemption.status !== "accepted" || redemption.user !== input.user || redemption.activity !== activity.id) {
      throw new Error("Community Partner Activities require a verified WTS Mission code redemption.");
    }
    const expectedRole = activity.evidence_mode === "single_code"
      ? "single"
      : activity.evidence_mode === "two_code_start" ? "start" : activity.evidence_mode === "two_code_finish" ? "finish" : undefined;
    const code = await this.store.getById<{ activity: string; evidence_role: string }>(GAMIFICATION_COLLECTIONS.codes, redemption.code);
    if (!expectedRole || code.activity !== activity.id || code.evidence_role !== expectedRole) {
      throw new Error("Community Partner Activities require a matching WTS Mission code artifact.");
    }
  }

  /** Canonical Session Missions accept only the WTS code redemption they created. */
  private isConfiguredSessionAttendanceActivity(activity: GamificationActivityRecord): boolean {
    return activity.kind === "session" &&
      activity.outcome_key === "attendance" &&
      activity.evidence_mode === "single_code" &&
      Boolean(activity.session_key) &&
      Boolean(activity.session_display_snapshot);
  }

  private async assertSessionAttendanceEvidence(
    activity: GamificationActivityRecord,
    input: ActivityClaimInput,
  ): Promise<void> {
    if (input.sourceType !== "code_redemption" || input.outcomeKey !== activity.outcome_key) {
      throw new Error("Session attendance requires verified WTS Mission code redemption evidence.");
    }
    const redemption = input.sourceCollection === GAMIFICATION_COLLECTIONS.codeRedemptions && input.sourceRecordId
      ? await this.store.findOne<{ user: string; activity: string; status: string; code: string }>(
        GAMIFICATION_COLLECTIONS.codeRedemptions,
        { id: input.sourceRecordId },
      )
      : undefined;
    if (!redemption || redemption.status !== "accepted" || redemption.user !== input.user || redemption.activity !== activity.id) {
      throw new Error("Session attendance requires verified WTS Mission code redemption evidence.");
    }
    const code = await this.store.getById<{ activity: string; evidence_role: string }>(GAMIFICATION_COLLECTIONS.codes, redemption.code);
    if (code.activity !== activity.id || code.evidence_role !== "single") {
      throw new Error("Session attendance requires a matching WTS single-code artifact.");
    }
  }

  private async assertConfiguredEventEvidence(
    activity: GamificationActivityRecord,
    input: ActivityClaimInput,
  ): Promise<void> {
    if (input.outcomeKey !== activity.outcome_key) {
      throw new Error("Configured event evidence must match its Activity outcome.");
    }
    if (input.sourceType === "admin_manual") {
      const action = input.sourceCollection === GAMIFICATION_COLLECTIONS.adminActions && input.sourceRecordId
        ? await this.store.findOne<{
          action: string;
          status: string;
          target_user?: string;
          related_collection?: string;
          related_record_id?: string;
        }>(GAMIFICATION_COLLECTIONS.adminActions, { id: input.sourceRecordId })
        : undefined;
      if (
        !action ||
        action.action !== "manual_award" ||
        action.status === "failed" ||
        action.target_user !== input.user ||
        action.related_collection !== GAMIFICATION_COLLECTIONS.activities ||
        action.related_record_id !== activity.id
      ) {
        throw new Error("Configured event Activities require audited admin support for manual exceptions.");
      }
      return;
    }
    if (activity.evidence_mode === "derived_claim_set") {
      if (input.sourceType !== "system_derived") {
        throw new Error("Configured event completion requires both accepted start and finish claims.");
      }
      const sourceClaimIds = input.metadata && typeof input.metadata.derived_claim_set === "object"
        ? (input.metadata.derived_claim_set as { source_claim_ids?: unknown }).source_claim_ids
        : undefined;
      if (!Array.isArray(sourceClaimIds) || sourceClaimIds.length !== 2) {
        throw new Error("Configured event completion requires both accepted start and finish claims.");
      }
      const [achievements, activities, claims] = await Promise.all([
        this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements),
        this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities),
        this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, { user: input.user }),
      ]);
      const supported = evaluateConfiguredEventCompletions({ achievements, activities, claims })
        .find((candidate) => candidate.activity.id === activity.id);
      const supportedIds = supported?.sourceClaims.map((claim) => claim.id).sort();
      if (!supportedIds || JSON.stringify(supportedIds) !== JSON.stringify([...sourceClaimIds].sort())) {
        throw new Error("Configured event completion requires both accepted start and finish claims.");
      }
      return;
    }
    if (input.sourceType !== "code_redemption") {
      throw new Error("Configured event attendance requires verified WTS Mission code redemption evidence.");
    }
    const redemption = input.sourceCollection === GAMIFICATION_COLLECTIONS.codeRedemptions && input.sourceRecordId
      ? await this.store.findOne<{ user: string; activity: string; status: string; code: string }>(
        GAMIFICATION_COLLECTIONS.codeRedemptions,
        { id: input.sourceRecordId },
      )
      : undefined;
    if (!redemption || redemption.status !== "accepted" || redemption.user !== input.user || redemption.activity !== activity.id) {
      throw new Error("Configured event attendance requires verified WTS Mission code redemption evidence.");
    }
    const expectedRole = activity.evidence_mode === "single_code"
      ? "single"
      : activity.evidence_mode === "two_code_start" ? "start" : activity.evidence_mode === "two_code_finish" ? "finish" : undefined;
    const code = await this.store.getById<{ activity: string; evidence_role: string }>(GAMIFICATION_COLLECTIONS.codes, redemption.code);
    if (!expectedRole || code.activity !== activity.id || code.evidence_role !== expectedRole) {
      throw new Error("Configured event attendance requires a matching WTS Mission code artifact.");
    }
  }

  private async assertEasterEggEvidence(
    activity: GamificationActivityRecord,
    input: ActivityClaimInput,
  ): Promise<void> {
    if (
      activity.kind !== "easter_egg" ||
      activity.category !== "easter_egg" ||
      activity.outcome_key !== "static_discovery" ||
      activity.evidence_mode !== "static_puzzle_code" ||
      input.sourceType !== "static_puzzle_code" ||
      input.outcomeKey !== "static_discovery"
    ) {
      throw new Error("Easter egg discovery requires verified WTS static-code redemption evidence.");
    }
    const redemption = input.sourceCollection === GAMIFICATION_COLLECTIONS.codeRedemptions && input.sourceRecordId
      ? await this.store.findOne<{ user: string; activity: string; status: string; code: string }>(
        GAMIFICATION_COLLECTIONS.codeRedemptions,
        { id: input.sourceRecordId },
      )
      : undefined;
    if (!redemption || redemption.status !== "accepted" || redemption.user !== input.user || redemption.activity !== activity.id) {
      throw new Error("Easter egg discovery requires verified WTS static-code redemption evidence.");
    }
    const code = await this.store.getById<{ activity: string; evidence_role: string }>(GAMIFICATION_COLLECTIONS.codes, redemption.code);
    if (code.activity !== activity.id || code.evidence_role !== "static_puzzle") {
      throw new Error("Easter egg discovery requires a matching WTS static-code artifact.");
    }
  }

  private async recordAdminAction(
    action: GamificationAdminActionRecord["action"],
    relatedCollection: string,
    relatedRecordId: string,
    input: AuditOperationInput,
    summary: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {},
  ): Promise<GamificationAdminActionRecord> {
    const operationId = safeAdminText(input.operationId, "Operation ID");
    const reason = safeAdminText(input.reason, "Reason");
    const idempotencyKey = adminActionIdempotencyKey(action, operationId);
    const beforeSummary = summary.before || {};
    const afterSummary = summary.after || {};
    const reuseExisting = async (existing: GamificationAdminActionRecord): Promise<GamificationAdminActionRecord> => {
      if (
        existing.actor !== input.actor ||
        existing.actor_role !== input.actorRole ||
        existing.reason !== reason ||
        existing.target_user !== input.targetUser ||
        existing.related_collection !== relatedCollection ||
        existing.related_record_id !== relatedRecordId ||
        JSON.stringify(existing.after_summary || {}) !== JSON.stringify(afterSummary)
      ) {
        throw new Error("This admin operation ID belongs to another accounting action.");
      }
      if (existing.status === "failed") {
        return this.store.update<GamificationAdminActionRecord>(GAMIFICATION_COLLECTIONS.adminActions, existing.id, {
          status: "rebuild_pending",
        });
      }
      return existing;
    };
    const existing = await this.store.findOne<GamificationAdminActionRecord>(
      GAMIFICATION_COLLECTIONS.adminActions,
      { idempotency_key: idempotencyKey },
    );
    if (existing) {
      return reuseExisting(existing);
    }
    try {
      return await this.store.create<GamificationAdminActionRecord>(GAMIFICATION_COLLECTIONS.adminActions, {
        actor: input.actor,
        actor_role: input.actorRole,
        target_user: input.targetUser,
        action,
        status: "rebuild_pending",
        reason,
        correlation_id: operationId,
        idempotency_key: idempotencyKey,
        related_collection: relatedCollection,
        related_record_id: relatedRecordId,
        before_summary: beforeSummary,
        after_summary: afterSummary,
      });
    } catch (error) {
      // A unique idempotency collision is a successful concurrent submission,
      // not a reason to create a second accounting action.
      const raced = await this.store.findOne<GamificationAdminActionRecord>(
        GAMIFICATION_COLLECTIONS.adminActions,
        { idempotency_key: idempotencyKey },
      );
      if (raced) return reuseExisting(raced);
      throw error;
    }
  }

  private async completeAdminAction(action: GamificationAdminActionRecord): Promise<void> {
    if (action.status === "applied") return;
    await this.store.update<GamificationAdminActionRecord>(GAMIFICATION_COLLECTIONS.adminActions, action.id, {
      status: "applied",
    });
  }

  private async failAdminAction(action: GamificationAdminActionRecord): Promise<void> {
    if (action.status === "applied" || action.status === "failed") return;
    try {
      await this.store.update<GamificationAdminActionRecord>(GAMIFICATION_COLLECTIONS.adminActions, action.id, {
        status: "failed",
      });
    } catch {
      // Preserve the original accounting error even if recording the failure also fails.
    }
  }

  private async resolvePendingRebuilds(targetUserId: string, currentActionId: string): Promise<void> {
    const pending = await this.store.list<GamificationAdminActionRecord>(GAMIFICATION_COLLECTIONS.adminActions, {
      target_user: targetUserId,
      status: "rebuild_pending",
    });
    const resolved = await Promise.all(pending
      .filter((action) => action.id !== currentActionId)
      .map(async (action) => ({ action, ready: await this.hasAuthoritativeWrites(action) })));
    await Promise.all(resolved
      .filter(({ ready }) => ready)
      .map(({ action }) => this.completeAdminAction(action)));
  }

  private async hasAuthoritativeWrites(action: GamificationAdminActionRecord): Promise<boolean> {
    if (action.action === "rebuild_profile_cache") return true;
    if (action.action === "manual_award") {
      const claim = await this.store.findOne<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, {
        source_collection: GAMIFICATION_COLLECTIONS.adminActions,
        source_record_id: action.id,
      });
      if (!claim) return false;
      const achievementId = typeof action.after_summary?.achievementId === "string" ? action.after_summary.achievementId : "";
      const badge = await this.store.findOne<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, {
        user: action.target_user,
        achievement: achievementId,
        source_claim: claim.id,
      }) || await this.store.findOne<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, {
        user: action.target_user,
        achievement: achievementId,
        status: "unlocked",
      });
      if (!badge) return false;
      const totalXp = numericCapOutcome(action.after_summary, "totalXpDelta") || 0;
      if (totalXp === 0) return true;
      return Boolean(await this.store.findOne<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, { source_claim: claim.id }));
    }
    if (action.action === "admin_correction") {
      return Boolean(await this.store.findOne<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, { source_id: action.id }));
    }
    if (action.action === "void_xp_event") {
      const event = await this.store.getById<GamificationXpEventRecord>(GAMIFICATION_COLLECTIONS.xpEvents, action.related_record_id || "").catch(() => undefined);
      return Boolean(event?.voided && event.void_admin_action === action.id);
    }
    if (action.action === "void_activity_claim") {
      const claim = await this.store.getById<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, action.related_record_id || "").catch(() => undefined);
      return Boolean(claim?.status === "voided" && claim.void_admin_action === action.id);
    }
    if (action.action === "revoke_user_achievement") {
      const badge = await this.store.getById<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, action.related_record_id || "").catch(() => undefined);
      return Boolean(badge?.status === "revoked" && badge.source_admin_action === action.id);
    }
    return false;
  }
}
