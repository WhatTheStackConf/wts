import { createHash, randomUUID } from "node:crypto";
import {
  GAMIFICATION_COLLECTIONS,
  GamificationAccountingService,
  withGamificationLocks,
  type AccountingUser,
  type GamificationAccountingStore,
} from "~/lib/gamification-accounting";
import {
  MISSION_CODE_HASH_VERSION,
  parseMissionCode,
  verifyMissionCodeHash,
} from "~/lib/mission-code-crypto";
import type {
  GamificationAchievementRecord,
  GamificationActivityClaimRecord,
  GamificationActivityRecord,
  GamificationCodeRecord,
  GamificationCodeRedemptionRecord,
  GamificationMissionRecord,
  GamificationUserAchievementRecord,
} from "~/lib/pocketbase-types";
import { PartnerContactConsentService, type PartnerContactConsentSummary } from "~/lib/partner-contact-consent";

const GENERAL_RATE_LIMIT = 12;
const INVALID_RATE_LIMIT = 4;
const INVALID_PREFIX_RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

export type MissionCodeRedemptionStatus =
  | "accepted"
  | "already_redeemed"
  | "invalid"
  | "not_yet_active"
  | "expired"
  | "disabled"
  | "global_limit"
  | "user_limit"
  | "rate_limited"
  | "unavailable";

export interface MissionCodeRedemptionResult {
  status: MissionCodeRedemptionStatus;
  title: string;
  message: string;
  supportMessage?: string;
  supportReference?: string;
  mission?: {
    title: string;
    summary: string;
  };
  badges?: Array<{
    name: string;
    description: string;
    icon?: string;
    category: string;
    rarity: string;
  }>;
  xpAwarded?: number;
  leaderboardXpAwarded?: number;
  profile?: {
    totalXp: number;
    accessLevel: number;
    accessLevelLabel: string;
    repairState?: "current" | "rebuild_pending";
    supportReference?: string;
  };
  partnerFollowUp?: PartnerContactConsentSummary;
}

export interface MissionCodeRateLimiter {
  isLimited(keys: string[], limit: number, windowMs: number, nowMs: number): Promise<boolean>;
  consume(keys: string[], limit: number, windowMs: number, nowMs: number): Promise<boolean>;
}

/** Process-local limiter. Codes still have 130 bits of entropy if deployments use multiple instances. */
export class MemoryMissionCodeRateLimiter implements MissionCodeRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  async isLimited(keys: string[], limit: number, windowMs: number, nowMs: number): Promise<boolean> {
    return keys.some((key) => this.activeAttempts(key, windowMs, nowMs).length >= limit);
  }

  async consume(keys: string[], limit: number, windowMs: number, nowMs: number): Promise<boolean> {
    const uniqueKeys = [...new Set(keys)];
    if (await this.isLimited(uniqueKeys, limit, windowMs, nowMs)) return false;
    for (const key of uniqueKeys) {
      const attempts = this.activeAttempts(key, windowMs, nowMs);
      attempts.push(nowMs);
      this.attempts.set(key, attempts);
    }
    return true;
  }

  private activeAttempts(key: string, windowMs: number, nowMs: number): number[] {
    const attempts = (this.attempts.get(key) || []).filter((attempt) => attempt > nowMs - windowMs);
    this.attempts.set(key, attempts);
    return attempts;
  }
}

interface RateLimitAttemptRecord {
  id: string;
  bucket_hash: string;
  expires_at: string;
}

/** Shared PocketBase-backed limiter for deployments with more than one app instance. */
export class DatabaseMissionCodeRateLimiter implements MissionCodeRateLimiter {
  constructor(private readonly store: GamificationAccountingStore) {}

  async isLimited(keys: string[], limit: number, _windowMs: number, nowMs: number): Promise<boolean> {
    const hashes = [...new Set(keys.map((key) => this.hash(key)))];
    if (hashes.length === 0) return false;
    return withGamificationLocks(this.store, hashes.map((hash) => `rate-limit:${hash}`), async () => {
      const attempts = await this.store.list<RateLimitAttemptRecord>(
        GAMIFICATION_COLLECTIONS.rateLimitAttempts,
        { bucket_hash: hashes },
        { limit: Math.max(100, limit * hashes.length * 2) },
      );
      return hashes.some((hash) => attempts.filter((attempt) =>
        attempt.bucket_hash === hash && Date.parse(attempt.expires_at) > nowMs
      ).length >= limit);
    });
  }

  async consume(keys: string[], limit: number, windowMs: number, nowMs: number): Promise<boolean> {
    const hashes = [...new Set(keys.map((key) => this.hash(key)))];
    if (hashes.length === 0) return true;
    return withGamificationLocks(this.store, hashes.map((hash) => `rate-limit:${hash}`), async () => {
      const attempts = await this.store.list<RateLimitAttemptRecord>(
        GAMIFICATION_COLLECTIONS.rateLimitAttempts,
        { bucket_hash: hashes },
        { limit: Math.max(100, limit * hashes.length * 2) },
      );
      const active = attempts.filter((attempt) => Date.parse(attempt.expires_at) > nowMs);
      if (hashes.some((hash) => active.filter((attempt) => attempt.bucket_hash === hash).length >= limit)) {
        return false;
      }
      const expired = attempts.filter((attempt) => Date.parse(attempt.expires_at) <= nowMs);
      await Promise.all(expired.map((attempt) => this.store.delete?.(GAMIFICATION_COLLECTIONS.rateLimitAttempts, attempt.id)));
      const rows = hashes.map((bucketHash) => ({
        bucket_hash: bucketHash,
        expires_at: new Date(nowMs + windowMs).toISOString(),
      }));
      if (this.store.createManyAtomic) {
        await this.store.createManyAtomic(GAMIFICATION_COLLECTIONS.rateLimitAttempts, rows);
      } else {
        for (const row of rows) await this.store.create(GAMIFICATION_COLLECTIONS.rateLimitAttempts, row);
      }
      return true;
    });
  }

  private hash(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }
}

export interface RedeemMissionCodeInput {
  user: AccountingUser;
  rawCode: unknown;
  sourceHint?: unknown;
  requestFingerprint: string;
}

export interface MissionCodeRedemptionServiceOptions {
  clock?: () => string;
  rateLimiter?: MissionCodeRateLimiter;
}

let redemptionQueue: Promise<unknown> = Promise.resolve();

type ActivityAwardResult = {
  claim: GamificationActivityClaimRecord;
  badge?: { achievement: string };
  xpEvent?: { amount: number; leaderboard_amount: number };
  derivedAwards: Array<{
    badge?: { achievement: string };
    xpEvent?: { amount: number; leaderboard_amount: number };
  }>;
  metaAwards: Array<{
    badge?: { achievement: string };
    xpEvent?: { amount: number; leaderboard_amount: number };
  }>;
};

function now(): string {
  return new Date().toISOString();
}

function timestamp(nowValue: string): number {
  const value = Date.parse(nowValue);
  return Number.isFinite(value) ? value : Date.now();
}

function isBefore(nowValue: string, boundary?: string): boolean {
  return Boolean(boundary && Number.isFinite(Date.parse(boundary)) && Date.parse(nowValue) < Date.parse(boundary));
}

function isAfter(nowValue: string, boundary?: string): boolean {
  return Boolean(boundary && Number.isFinite(Date.parse(boundary)) && Date.parse(nowValue) > Date.parse(boundary));
}

function sourceHint(value: unknown): string {
  return typeof value === "string" && ["qr", "link", "manual", "static_puzzle"].includes(value)
    ? value
    : "unknown";
}

function ruleActivityKeys(rule: Record<string, unknown>): string[] {
  const value = rule.activityKeys || rule.activity_keys;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function acceptedRedemptionIdempotencyKey(userId: string, codeId: string): string {
  return `code-redemption:v1:${userId}:${codeId}`;
}

function attemptRedemptionIdempotencyKey(userId: string, codeId: string): string {
  return `code-redemption-attempt:v1:${userId}:${codeId}:${randomUUID()}`;
}

function publicResult(status: Exclude<MissionCodeRedemptionStatus, "accepted" | "already_redeemed">): MissionCodeRedemptionResult {
  const copy: Record<typeof status, Pick<MissionCodeRedemptionResult, "title" | "message" | "supportMessage">> = {
    invalid: {
      title: "Mission code not verified",
      message: "We could not verify that Mission code. Check it and try again.",
      supportMessage: "If you are at the event and still need help, contact WhatTheStack support from your logged-in profile.",
    },
    not_yet_active: {
      title: "Mission not open yet",
      message: "This Mission opens later. Please try again when the activity is available.",
      supportMessage: "If you believe this is unexpected, contact WhatTheStack event support.",
    },
    expired: {
      title: "Mission window closed",
      message: "This Mission is no longer accepting redemptions.",
      supportMessage: "If you completed the Mission before it closed, contact WhatTheStack event support.",
    },
    disabled: {
      title: "Mission code inactive",
      message: "This Mission code is no longer active.",
      supportMessage: "Contact WhatTheStack event support if you need help with this Mission.",
    },
    global_limit: {
      title: "Mission redemption limit reached",
      message: "This Mission has reached its redemption limit.",
      supportMessage: "Contact WhatTheStack event support if you need help.",
    },
    user_limit: {
      title: "Mission already complete",
      message: "Your completion for this Mission is already recorded.",
      supportMessage: "Check your profile or contact WhatTheStack event support if this seems incorrect.",
    },
    rate_limited: {
      title: "Please wait before trying again",
      message: "There have been too many redemption attempts. Wait a moment, then try again.",
      supportMessage: "If you cannot retry, contact WhatTheStack event support from your logged-in profile.",
    },
    unavailable: {
      title: "Mission recording unavailable",
      message: "We could not finish recording this Mission. Your evidence may already be safe; retry with the same code.",
      supportMessage: "If retrying does not resolve this, contact WhatTheStack event support with the support reference below.",
    },
  };
  return { status, ...copy[status] };
}

/** Server-only Code Redemption service; browser values are limited to raw code and source hint. */
export class MissionCodeRedemptionService {
  private readonly clock: () => string;
  private readonly rateLimiter: MissionCodeRateLimiter;

  constructor(
    private readonly store: GamificationAccountingStore,
    private readonly pepper: string,
    options: MissionCodeRedemptionServiceOptions = {},
  ) {
    this.clock = options.clock || now;
    this.rateLimiter = options.rateLimiter || new MemoryMissionCodeRateLimiter();
  }

  async redeem(input: RedeemMissionCodeInput): Promise<MissionCodeRedemptionResult> {
    const queued = redemptionQueue.catch(() => undefined).then(() => this.redeemNow(input));
    redemptionQueue = queued;
    return queued.catch((error) => {
      const supportReference = `WTS-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
      console.error(JSON.stringify({
        event: "mission_redemption_unavailable",
        supportReference,
        userId: input.user.id,
        errorType: error instanceof Error ? error.name : "UnknownError",
      }));
      return { ...publicResult("unavailable"), supportReference };
    });
  }

  private async redeemNow(input: RedeemMissionCodeInput): Promise<MissionCodeRedemptionResult> {
    const currentTime = this.clock();
    const parsed = parseMissionCode(input.rawCode);
    const rateKeys = this.rateKeys(input.user.id, input.requestFingerprint);
    const invalidRateKeys = this.invalidRateKeys(rateKeys);
    const invalidPrefixKeys = parsed ? [`mission-redemption:prefix:${parsed.lookupPrefix}:invalid`] : [];
    const nowMs = timestamp(currentTime);
    if (
      await this.rateLimiter.isLimited(invalidRateKeys, INVALID_RATE_LIMIT, RATE_LIMIT_WINDOW_MS, nowMs) ||
      await this.rateLimiter.isLimited(invalidPrefixKeys, INVALID_PREFIX_RATE_LIMIT, RATE_LIMIT_WINDOW_MS, nowMs) ||
      !await this.rateLimiter.consume(rateKeys, GENERAL_RATE_LIMIT, RATE_LIMIT_WINDOW_MS, nowMs)
    ) {
      return publicResult("rate_limited");
    }
    if (!parsed) {
      await this.rateLimiter.consume(invalidRateKeys, INVALID_RATE_LIMIT, RATE_LIMIT_WINDOW_MS, nowMs);
      return publicResult("invalid");
    }

    const candidates = await this.store.list<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, {
      lookup_prefix: parsed.lookupPrefix,
      hash_version: MISSION_CODE_HASH_VERSION,
    });
    let code: GamificationCodeRecord | undefined;
    for (const candidate of candidates) {
      // Compare every prefix candidate so a matching hash does not short-circuit lookup work.
      if (verifyMissionCodeHash(parsed.normalizedCode, candidate.code_hash, this.pepper) && !code) code = candidate;
    }
    if (!code) {
      await this.rateLimiter.consume(invalidRateKeys, INVALID_RATE_LIMIT, RATE_LIMIT_WINDOW_MS, nowMs);
      await this.rateLimiter.consume(invalidPrefixKeys, INVALID_PREFIX_RATE_LIMIT, RATE_LIMIT_WINDOW_MS, nowMs);
      return publicResult("invalid");
    }

    return withGamificationLocks(
      this.store,
      [`redemption:code:${code.id}`, `award:activity:${code.activity}`, `award:user:${input.user.id}`],
      () => this.redeemMatchedCode(code, input, currentTime),
    );
  }

  private async redeemMatchedCode(
    code: GamificationCodeRecord,
    input: RedeemMissionCodeInput,
    currentTime: string,
  ): Promise<MissionCodeRedemptionResult> {
    const existing = await this.store.findOne<GamificationCodeRedemptionRecord>(
      GAMIFICATION_COLLECTIONS.codeRedemptions,
      { user: input.user.id, code: code.id, status: "accepted" },
    );
    const activity = await this.store.getById<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, code.activity);
    if (existing) {
      const award = await this.completeAcceptedRedemption(existing, code, activity, input.user, currentTime);
      return this.successResult("already_redeemed", activity, award);
    }

    const rejectedStatus = await this.rejectionStatus(code, activity, input.user.id, currentTime);
    if (rejectedStatus) {
      const attempt = await this.recordRejectedAttempt(code, activity, input, rejectedStatus, currentTime);
      return { ...publicResult(rejectedStatus), supportReference: `WTS-${attempt.id}` };
    }

    const accepted = await this.createAcceptedRedemption(code, activity, input, currentTime);
    if (!accepted.created) {
      const award = await this.completeAcceptedRedemption(accepted.redemption, code, activity, input.user, currentTime);
      return this.successResult("already_redeemed", activity, award);
    }
    const award = await this.completeAcceptedRedemption(accepted.redemption, code, activity, input.user, currentTime);
    const acceptedCount = await this.store.list<GamificationCodeRedemptionRecord>(
      GAMIFICATION_COLLECTIONS.codeRedemptions,
      { code: code.id, status: "accepted" },
      { limit: code.max_redemptions || 10000 },
    );
    await this.store.update<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, code.id, {
      total_redemptions_cached: acceptedCount.length,
    });
    return this.successResult("accepted", activity, award);
  }

  private rateKeys(userId: string, fingerprint: string): string[] {
    return [
      `mission-redemption:user:${userId}`,
      `mission-redemption:fingerprint:${fingerprint || "unavailable"}`,
    ];
  }

  private invalidRateKeys(rateKeys: string[]): string[] {
    return rateKeys.map((key) => `${key}:invalid`);
  }

  private async rejectionStatus(
    code: GamificationCodeRecord,
    activity: GamificationActivityRecord,
    userId: string,
    currentTime: string,
  ): Promise<Exclude<MissionCodeRedemptionStatus, "accepted" | "already_redeemed" | "invalid" | "rate_limited"> | undefined> {
    const mission = activity.mission
      ? await this.store.getById<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, activity.mission).catch(() => undefined)
      : undefined;
    if (!code.enabled || code.status !== "active" || code.invalidated_at || activity.status !== "active" || !activity.enabled) {
      return "disabled";
    }
    if (activity.mission && mission?.status !== "active") return "disabled";
    if (isBefore(currentTime, code.starts_at) || isBefore(currentTime, activity.active_from)) return "not_yet_active";
    if (isAfter(currentTime, code.ends_at) || isAfter(currentTime, activity.active_until)) return "expired";

    const [codeRedemptions, activityClaims, userActivityClaim] = await Promise.all([
      this.store.list<GamificationCodeRedemptionRecord>(GAMIFICATION_COLLECTIONS.codeRedemptions, {
        code: code.id,
        status: "accepted",
      }, { limit: code.max_redemptions || 1000 }),
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, {
        activity: activity.id,
        status: "accepted",
      }, { limit: activity.max_claims || 1000 }),
      this.store.findOne<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, {
        user: userId,
        activity: activity.id,
        status: "accepted",
      }),
    ]);
    if (code.max_redemptions && codeRedemptions.length >= code.max_redemptions) return "global_limit";
    if (activity.max_claims && activityClaims.length >= activity.max_claims) return "global_limit";
    if (userActivityClaim) return "user_limit";
    return undefined;
  }

  private async recordRejectedAttempt(
    code: GamificationCodeRecord,
    activity: GamificationActivityRecord,
    input: RedeemMissionCodeInput,
    status: Exclude<MissionCodeRedemptionStatus, "accepted" | "already_redeemed" | "invalid" | "rate_limited">,
    currentTime: string,
  ): Promise<GamificationCodeRedemptionRecord> {
    return this.store.create<GamificationCodeRedemptionRecord>(GAMIFICATION_COLLECTIONS.codeRedemptions, {
      user: input.user.id,
      code: code.id,
      activity: activity.id,
      status: `rejected_${status}`,
      redeemed_at: currentTime,
      idempotency_key: attemptRedemptionIdempotencyKey(input.user.id, code.id),
      source_hint: sourceHint(input.sourceHint),
      request_fingerprint: input.requestFingerprint,
      lookup_prefix: code.lookup_prefix,
      hash_version: code.hash_version,
      metadata: { evidence_role: code.evidence_role },
    });
  }

  private async createAcceptedRedemption(
    code: GamificationCodeRecord,
    activity: GamificationActivityRecord,
    input: RedeemMissionCodeInput,
    currentTime: string,
  ): Promise<{ redemption: GamificationCodeRedemptionRecord; created: boolean }> {
    const idempotencyKey = acceptedRedemptionIdempotencyKey(input.user.id, code.id);
    try {
      const redemption = await this.store.create<GamificationCodeRedemptionRecord>(GAMIFICATION_COLLECTIONS.codeRedemptions, {
        user: input.user.id,
        code: code.id,
        activity: activity.id,
        status: "accepted",
        redeemed_at: currentTime,
        idempotency_key: idempotencyKey,
        source_hint: sourceHint(input.sourceHint),
        request_fingerprint: input.requestFingerprint,
        lookup_prefix: code.lookup_prefix,
        hash_version: code.hash_version,
        metadata: { evidence_role: code.evidence_role },
      });
      return { redemption, created: true };
    } catch (error) {
      const existing = await this.store.findOne<GamificationCodeRedemptionRecord>(
        GAMIFICATION_COLLECTIONS.codeRedemptions,
        { idempotency_key: idempotencyKey },
      );
      if (existing?.status === "accepted") return { redemption: existing, created: false };
      throw error;
    }
  }

  private async completeAcceptedRedemption(
    redemption: GamificationCodeRedemptionRecord,
    code: GamificationCodeRecord,
    activity: GamificationActivityRecord,
    user: AccountingUser,
    currentTime: string,
  ) {
    const recordedClaim = redemption.activity_claim
      ? await this.store.getById<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, redemption.activity_claim).catch(() => undefined)
      : await this.store.findOne<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, {
        source_collection: GAMIFICATION_COLLECTIONS.codeRedemptions,
        source_record_id: redemption.id,
      });
    if (recordedClaim) {
      const revokedBadge = await this.store.findOne<GamificationUserAchievementRecord>(
        GAMIFICATION_COLLECTIONS.userAchievements,
        { user: user.id, source_claim: recordedClaim.id, status: "revoked" },
      );
      // Corrections remain authoritative, while an ordinary interrupted award is allowed to repair
      // its missing Badge, XP Event, Meta outcomes, or profile cache below.
      if (recordedClaim.status !== "accepted" || revokedBadge) {
        return { claim: recordedClaim, derivedAwards: [], metaAwards: [] } satisfies ActivityAwardResult;
      }
    }
    const accounting = new GamificationAccountingService(this.store, this.clock);
    const staticPuzzle = code.evidence_role === "static_puzzle" || activity.evidence_mode === "static_puzzle_code";
    const award = await accounting.recordActivityAward({
      claim: {
        user: user.id,
        activity: activity.id,
        sourceType: staticPuzzle ? "static_puzzle_code" : "code_redemption",
        sourceCollection: GAMIFICATION_COLLECTIONS.codeRedemptions,
        sourceRecordId: redemption.id,
        outcomeKey: activity.outcome_key,
        occurredAt: redemption.redeemed_at || currentTime,
        evidenceFingerprint: `code-redemption:${code.id}`,
        idempotencyKey: `activity-claim:v1:${user.id}:${activity.key}:${staticPuzzle ? "static_puzzle_code" : "code_redemption"}:${code.id}`,
        metadata: {
          code: code.id,
          evidence_role: code.evidence_role,
          source: "mission_code",
        },
      },
      resolveAchievement: (claim, claimedActivity) => this.eligibleNonMetaAchievement(user.id, claim, claimedActivity, currentTime),
    });
    if (!redemption.activity_claim) {
      await this.store.update<GamificationCodeRedemptionRecord>(GAMIFICATION_COLLECTIONS.codeRedemptions, redemption.id, {
        activity_claim: award.claim.id,
      });
    }
    return award;
  }

  /** Meta outcomes are intentionally handled by accounting's shared evaluator. */
  private async eligibleNonMetaAchievement(
    userId: string,
    claim: GamificationActivityClaimRecord,
    activity: GamificationActivityRecord,
    currentTime: string,
  ): Promise<string | undefined> {
    if (!activity.achievement) return undefined;
    const achievement = await this.store.getById<GamificationAchievementRecord>(
      GAMIFICATION_COLLECTIONS.achievements,
      activity.achievement,
    );
    if (
      achievement.category === "meta" ||
      achievement.status !== "active" ||
      isBefore(currentTime, achievement.active_from) ||
      isAfter(currentTime, achievement.active_until)
    ) {
      return undefined;
    }
    const rule = achievement.unlock_rule || {};
    const kind = typeof rule.kind === "string" ? rule.kind : "activity_claim";
    if (kind === "manual_only") return undefined;
    const claims = await this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, {
      user: userId,
      status: "accepted",
    }, { limit: 10001 });
    if (claims.length > 10000) throw new Error("Badge evaluation exceeds its safe evidence limit.");
    const acceptedClaims = claims.some((existing) => existing.id === claim.id) ? claims : [...claims, claim];
    const activities = await this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, undefined, { limit: 2001 });
    if (activities.length > 2000) throw new Error("Badge evaluation exceeds its safe Activity limit.");
    const activitiesById = new Map(activities.map((candidate) => [candidate.id, candidate]));
    const claimedKeys = new Set(acceptedClaims.flatMap((acceptedClaim) => {
      const claimedActivity = activitiesById.get(acceptedClaim.activity);
      return [acceptedClaim.activity, claimedActivity?.key].filter((value): value is string => Boolean(value));
    }));
    const requiredKeys = ruleActivityKeys(rule);
    if (kind === "activity_claim") {
      return requiredKeys.length === 0 || requiredKeys.some((key) => key === activity.id || key === activity.key)
        ? achievement.id
        : undefined;
    }
    if (kind === "claim_set") {
      return requiredKeys.length > 0 && requiredKeys.every((key) => claimedKeys.has(key)) ? achievement.id : undefined;
    }
    if (kind === "claim_count") {
      const category = typeof rule.category === "string" ? rule.category : undefined;
      const count = typeof rule.count === "number" ? rule.count : 0;
      const qualifyingActivities = new Set(
        acceptedClaims
          .map((acceptedClaim) => activitiesById.get(acceptedClaim.activity))
          .filter((candidate): candidate is GamificationActivityRecord => Boolean(candidate))
          .filter((candidate) =>
            (requiredKeys.length === 0 || requiredKeys.includes(candidate.id) || requiredKeys.includes(candidate.key)) &&
            (!category || candidate.category === category),
          )
          .map((candidate) => candidate.id),
      );
      return count > 0 && qualifyingActivities.size >= count ? achievement.id : undefined;
    }
    return undefined;
  }

  private async successResult(
    status: "accepted" | "already_redeemed",
    activity: GamificationActivityRecord,
    award: ActivityAwardResult,
  ): Promise<MissionCodeRedemptionResult> {
    const accounting = new GamificationAccountingService(this.store, this.clock);
    const badgeIds = [...new Set([
      award.badge?.achievement,
      ...award.derivedAwards.flatMap((derivedAward) => derivedAward.badge?.achievement || []),
      ...award.metaAwards.flatMap((metaAward) => metaAward.badge?.achievement || []),
    ].filter((id): id is string => Boolean(id)))];
    const [mission, profile, badges, partnerFollowUp] = await Promise.all([
      this.safeMission(activity.mission),
      accounting.summaryForUser({ id: award.claim.user }),
      badgeIds.length
        ? this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, { id: badgeIds }, { limit: badgeIds.length })
        : Promise.resolve([]),
      new PartnerContactConsentService(this.store, this.clock).summaryForActivity(award.claim.user, activity.id),
    ]);
    return {
      status,
      title: status === "accepted" ? "Mission recorded" : "Mission already recorded",
      message: status === "accepted"
        ? "Your Mission completion has been recorded."
        : "This Mission completion was already recorded for you.",
      mission,
      badges: badges.length ? badges.map((badge) => ({
        name: badge.badge_name,
        description: badge.badge_description,
        icon: badge.icon || undefined,
        category: badge.category,
        rarity: badge.rarity,
      })) : undefined,
      xpAwarded: status === "already_redeemed" ? 0 : [
        award.xpEvent,
        ...award.derivedAwards.map((derivedAward) => derivedAward.xpEvent),
        ...award.metaAwards.map((metaAward) => metaAward.xpEvent),
      ]
        .reduce((total, event) => total + (event?.amount || 0), 0),
      leaderboardXpAwarded: status === "already_redeemed" ? 0 : [
        award.xpEvent,
        ...award.derivedAwards.map((derivedAward) => derivedAward.xpEvent),
        ...award.metaAwards.map((metaAward) => metaAward.xpEvent),
      ]
        .reduce((total, event) => total + (event?.leaderboard_amount || 0), 0),
      profile: {
        totalXp: profile.totalXp,
        accessLevel: profile.accessLevel,
        accessLevelLabel: profile.accessLevelLabel,
        repairState: profile.repair.state,
        supportReference: profile.repair.supportReference,
      },
      partnerFollowUp,
    };
  }

  private async safeMission(missionId?: string): Promise<MissionCodeRedemptionResult["mission"]> {
    if (!missionId) return undefined;
    try {
      const mission = await this.store.getById<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, missionId);
      return { title: mission.title, summary: mission.summary };
    } catch {
      return undefined;
    }
  }
}
