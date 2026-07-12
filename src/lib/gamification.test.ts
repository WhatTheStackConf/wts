import { readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import {
  GAMIFICATION_COLLECTIONS,
  GamificationAccountingService,
  type AdminManualAwardInput,
  type GamificationAccountingStore,
} from "~/lib/gamification-accounting";
import { GamificationAdminSupportService } from "~/lib/gamification-admin-support";
import { GamificationHiEventsEvidenceService } from "~/lib/gamification-hievents-evidence";
import { runAuthenticatedGamificationOperation } from "~/lib/gamification-authorization";
import { GamificationOperationsService } from "~/lib/gamification-operations";
import { PartnerContactConsentService } from "~/lib/partner-contact-consent";
import {
  accessLevelForTotalXp,
  buildGamificationPublicOpsBoardRows,
  buildGamificationProfileSummary,
  calculateSeptemberScoreSchedule,
  rebuildGamificationProfile,
} from "~/lib/gamification";
import { metaScoreBandForRule, selectedMetaSourceActivities } from "~/lib/gamification-meta-achievements";
import { buildCommunityPartnerMissionPresentations } from "~/lib/gamification-community-partners";
import {
  containsMissionCode,
  createMissionCodeGeneration,
  parseMissionCode,
  verifyMissionCodeHash,
} from "~/lib/mission-code-crypto";
import { fetchHiEventsAttendeeSnapshot, type HiEventsSourceAttendee } from "~/lib/hievents";
import {
  MemoryMissionCodeRateLimiter,
  MissionCodeRedemptionService,
} from "~/lib/mission-code-redemption";
import {
  PENDING_MISSION_CODE_STORAGE_KEY,
  clearPendingMissionCode,
  missionCodeFromFragment,
  readPendingMissionCode,
  savePendingMissionCode,
  setMissionCodeLoginResume,
} from "~/lib/mission-code-resume";

const timestamp = "2026-09-01T12:00:00.000Z";

class MemoryGamificationStore implements GamificationAccountingStore {
  private readonly rows = new Map<string, Array<Record<string, unknown>>>();
  private readonly updateFailures = new Map<string, number>();
  private sequence = 0;
  private readonly lockTails = new Map<string, Promise<void>>();
  private readonly heldLocks = new AsyncLocalStorage<Set<string>>();

  seed(collection: string, row: Record<string, unknown>): void {
    const rows = this.rows.get(collection) || [];
    rows.push(row);
    this.rows.set(collection, rows);
  }

  failNextUpdate(collection: string): void {
    this.updateFailures.set(collection, (this.updateFailures.get(collection) || 0) + 1);
  }

  async findOne<T>(collection: string, match: Record<string, unknown>): Promise<T | undefined> {
    return this.rowsFor(collection).find((row) => this.matches(row, match)) as T | undefined;
  }

  async list<T>(
    collection: string,
    match?: Record<string, unknown>,
    options?: { sort?: string; limit?: number; offset?: number; fields?: string },
  ): Promise<T[]> {
    const rows = this.rowsFor(collection).filter((row) => !match || this.matches(row, match));
    const offset = options?.offset || 0;
    return rows.slice(offset, options?.limit ? offset + options.limit : undefined) as T[];
  }

  async getById<T>(collection: string, id: string): Promise<T> {
    const row = this.rowsFor(collection).find((candidate) => candidate.id === id);
    if (!row) throw new Error(`Missing ${collection}:${id}`);
    return row as T;
  }

  async create<T>(collection: string, data: Record<string, unknown>): Promise<T> {
    const row = {
      id: `${collection}-${++this.sequence}`,
      created: timestamp,
      updated: timestamp,
      ...data,
    };
    this.seed(collection, row);
    return row as T;
  }

  async createManyAtomic<T>(collection: string, rows: Record<string, unknown>[]): Promise<T[]> {
    const existing = [...this.rowsFor(collection)];
    try {
      const created: T[] = [];
      for (const row of rows) created.push(await this.create<T>(collection, row));
      return created;
    } catch (error) {
      this.rows.set(collection, existing);
      throw error;
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    this.rows.set(collection, this.rowsFor(collection).filter((row) => row.id !== id));
  }

  async withLocks<T>(keys: string[], operation: () => Promise<T>): Promise<T> {
    const inherited = this.heldLocks.getStore() || new Set<string>();
    const required = [...new Set(keys)].filter((key) => !inherited.has(key)).sort();
    if (required.length === 0) return operation();
    const releases: Array<() => void> = [];
    for (const key of required) {
      const previous = this.lockTails.get(key) || Promise.resolve();
      let release: () => void = () => {};
      const next = new Promise<void>((resolve) => { release = resolve; });
      this.lockTails.set(key, previous.then(() => next));
      await previous;
      releases.push(release);
    }
    try {
      return await this.heldLocks.run(new Set([...inherited, ...required]), operation);
    } finally {
      releases.reverse().forEach((release) => release());
    }
  }

  async update<T>(collection: string, id: string, data: Record<string, unknown>): Promise<T> {
    const failures = this.updateFailures.get(collection) || 0;
    if (failures > 0) {
      this.updateFailures.set(collection, failures - 1);
      throw new Error(`Simulated ${collection} update failure`);
    }
    const row = this.rowsFor(collection).find((candidate) => candidate.id === id);
    if (!row) throw new Error(`Missing ${collection}:${id}`);
    Object.assign(row, data, { updated: timestamp });
    return row as T;
  }

  private rowsFor(collection: string): Array<Record<string, unknown>> {
    const rows = this.rows.get(collection) || [];
    this.rows.set(collection, rows);
    return rows;
  }

  private matches(row: Record<string, unknown>, match: Record<string, unknown>): boolean {
    return Object.entries(match).every(([key, value]) =>
      Array.isArray(value) ? value.includes(row[key]) : row[key] === value
    );
  }
}

function service(store: MemoryGamificationStore): GamificationAccountingService {
  return new GamificationAccountingService(store, () => timestamp);
}

function seedAchievement(store: MemoryGamificationStore, id = "achievement-1"): void {
  store.seed(GAMIFICATION_COLLECTIONS.achievements, {
    id,
    key: "attendance-check-in",
    badge_name: "Checked In",
    badge_description: "You arrived at WhatTheStack.",
    category: "attendance",
    rarity: "common",
    visibility: "public",
    status: "active",
    unlock_rule: { kind: "activity_claim" },
    sort_order: 1,
    metadata: { privateRule: "never expose" },
    created: timestamp,
    updated: timestamp,
  });
}

function seedActivity(store: MemoryGamificationStore): void {
  store.seed(GAMIFICATION_COLLECTIONS.activities, {
    id: "activity-checked-in",
    key: "conference-main-checked-in",
    kind: "hievents",
    category: "attendance",
    outcome_key: "checked_in",
    evidence_mode: "hievents_checkin",
    achievement: "achievement-1",
    per_user_claim_limit: 1,
    status: "active",
    enabled: true,
    created: timestamp,
    updated: timestamp,
  });
}

function seedUser(store: MemoryGamificationStore, id = "user-1", overrides: Record<string, unknown> = {}): void {
  store.seed("users", {
    id,
    email: `${id}@example.com`,
    name: id === "user-1" ? "Ada Admin" : "Other User",
    role: "user",
    created: timestamp,
    updated: timestamp,
    ...overrides,
  });
}

function seedSchedule(store: MemoryGamificationStore): void {
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
    id: "schedule-1",
    key: "wts-2026-september",
    status: "active",
    effective_at: timestamp,
    total_xp_ceiling: 100,
    leaderboard_xp_ceiling: 80,
    access_level_thresholds: { "1": 0, "2": 5, "3": 15, "4": 30, "5": 50, "6": 75, "7": 100 },
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
    id: "policy-checked-in",
    schedule: "schedule-1",
    activity: "activity-checked-in",
    policy_key: "conference-main-checked-in",
    active: true,
    total_xp: 20,
    leaderboard_xp: 10,
    cap_membership: [{ dimension: "activity", key: "activity-checked-in" }],
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
    id: "cap-checked-in",
    schedule: "schedule-1",
    dimension: "activity",
    cap_key: "activity-checked-in",
    member_policy_keys: ["conference-main-checked-in"],
    total_xp_ceiling: 20,
    leaderboard_xp_ceiling: 10,
    created: timestamp,
    updated: timestamp,
  });
}

function seedMetaSourceActivity(
  store: MemoryGamificationStore,
  id: string,
  key: string,
  overrides: Record<string, unknown> = {},
): void {
  store.seed(GAMIFICATION_COLLECTIONS.activities, {
    id,
    key,
    kind: "booth",
    category: "booth",
    outcome_key: "visit",
    evidence_mode: "single_code",
    per_user_claim_limit: 1,
    status: "active",
    enabled: true,
    created: timestamp,
    updated: timestamp,
    ...overrides,
  });
}

function seedMetaConfiguration(
  store: MemoryGamificationStore,
  rule: Record<string, unknown>,
  overrides: {
    achievementId?: string;
    achievementKey?: string;
    activityId?: string;
    totalXp?: number;
    leaderboardXp?: number;
    caps?: Array<Record<string, unknown>>;
  } = {},
): { achievementId: string; activityId: string } {
  const achievementId = overrides.achievementId || "meta-achievement";
  const activityId = overrides.activityId || "meta-activity";
  const achievementKey = overrides.achievementKey || "meta-explorer";
  store.seed(GAMIFICATION_COLLECTIONS.achievements, {
    id: achievementId,
    key: achievementKey,
    badge_name: "Meta Explorer",
    badge_description: "You completed a configured circuit.",
    category: "meta",
    rarity: "rare",
    visibility: "public",
    status: "active",
    unlock_rule: rule,
    sort_order: 1,
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.activities, {
    id: activityId,
    key: `meta.${achievementKey}`,
    kind: "meta",
    category: "meta",
    outcome_key: "meta",
    evidence_mode: "meta_rule",
    achievement: achievementId,
    per_user_claim_limit: 1,
    status: "active",
    enabled: true,
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
    id: `meta-schedule-${activityId}`,
    key: `meta-schedule-${activityId}`,
    status: "active",
    effective_at: timestamp,
    total_xp_ceiling: 100,
    leaderboard_xp_ceiling: 100,
    access_level_thresholds: { "1": 0 },
    created: timestamp,
    updated: timestamp,
  });
  const expectedBand = metaScoreBandForRule(rule as any) || { totalXp: 20, leaderboardXp: 15 };
  const policyKey = `meta-policy-${activityId}`;
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
    id: `meta-policy-record-${activityId}`,
    schedule: `meta-schedule-${activityId}`,
    activity: activityId,
    policy_key: policyKey,
    active: true,
    total_xp: overrides.totalXp ?? expectedBand.totalXp,
    leaderboard_xp: overrides.leaderboardXp ?? expectedBand.leaderboardXp,
    cap_membership: [{ dimension: "activity", key: activityId }],
    created: timestamp,
    updated: timestamp,
  });
  const caps = overrides.caps || [{
    id: `meta-cap-${activityId}`,
    dimension: "activity",
    cap_key: activityId,
    member_policy_keys: [policyKey],
    total_xp_ceiling: overrides.totalXp ?? expectedBand.totalXp,
    leaderboard_xp_ceiling: overrides.leaderboardXp ?? expectedBand.leaderboardXp,
  }];
  for (const cap of caps) {
    store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
      schedule: `meta-schedule-${activityId}`,
      ...cap,
      created: timestamp,
      updated: timestamp,
    });
  }
  return { achievementId, activityId };
}

function metaSourceAwardInput(activity: string, fingerprint: string) {
  return {
    claim: {
      user: "user-1",
      activity,
      sourceType: "code_redemption" as const,
      outcomeKey: "visit",
      occurredAt: timestamp,
      evidenceFingerprint: fingerprint,
      idempotencyKey: `source-claim:${activity}:${fingerprint}`,
    },
  };
}

function awardInput() {
  return {
    claim: {
      user: "user-1",
      activity: "activity-checked-in",
      sourceType: "hievents_checkin" as const,
      outcomeKey: "checked_in",
      occurredAt: timestamp,
      evidenceFingerprint: "event-1-attendee-1",
      idempotencyKey: "activity-claim:v1:user-1:checked-in:hievents_checkin:event-1-attendee-1",
    },
  };
}

const missionCodePepper = "test-only-mission-code-pepper";

function seedCodeRedemptionActivity(store: MemoryGamificationStore, overrides: Record<string, unknown> = {}): void {
  store.seed(GAMIFICATION_COLLECTIONS.activities, {
    id: "activity-code",
    key: "mission-code-activity",
    kind: "booth",
    category: "booth",
    outcome_key: "completion",
    evidence_mode: "single_code",
    achievement: "achievement-1",
    per_user_claim_limit: 1,
    status: "active",
    enabled: true,
    created: timestamp,
    updated: timestamp,
    ...overrides,
  });
}

function seedCodeRedemptionSchedule(store: MemoryGamificationStore, cap = 20): void {
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
    id: "schedule-code",
    key: "wts-2026-code-redemption",
    status: "active",
    effective_at: timestamp,
    total_xp_ceiling: cap,
    leaderboard_xp_ceiling: cap,
    access_level_thresholds: { "1": 0, "2": 5, "3": 10, "4": 15, "5": 20, "6": 25, "7": 30 },
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
    id: "policy-code",
    schedule: "schedule-code",
    activity: "activity-code",
    policy_key: "mission-code-activity",
    active: true,
    total_xp: 20,
    leaderboard_xp: 10,
    cap_membership: [{ dimension: "activity", key: "activity-code" }],
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
    id: "cap-code",
    schedule: "schedule-code",
    dimension: "activity",
    cap_key: "activity-code",
    member_policy_keys: ["mission-code-activity"],
    total_xp_ceiling: cap,
    leaderboard_xp_ceiling: cap,
    created: timestamp,
    updated: timestamp,
  });
}

function seedMissionCode(store: MemoryGamificationStore, overrides: Record<string, unknown> = {}) {
  const generated = createMissionCodeGeneration(missionCodePepper);
  store.seed(GAMIFICATION_COLLECTIONS.codes, {
    id: "code-1",
    key: "mission-code-1",
    label: "Private partner code label",
    activity: "activity-code",
    lookup_prefix: generated.definition.lookupPrefix,
    code_hash: generated.definition.codeHash,
    hash_version: generated.definition.hashVersion,
    evidence_role: "single",
    status: "active",
    enabled: true,
    per_user_limit: 1,
    total_redemptions_cached: 0,
    created_by: "admin-1",
    metadata: { privatePartnerMetadata: "never expose" },
    created: timestamp,
    updated: timestamp,
    ...overrides,
  });
  return generated;
}

function redemptionService(
  store: MemoryGamificationStore,
  rateLimiter = new MemoryMissionCodeRateLimiter(),
): MissionCodeRedemptionService {
  return new MissionCodeRedemptionService(store, missionCodePepper, {
    clock: () => timestamp,
    rateLimiter,
  });
}

function redemptionInput(rawCode: string, userId = "user-1") {
  return {
    user: { id: userId, name: "Ada" },
    rawCode,
    sourceHint: "qr",
    requestFingerprint: "private-request-fingerprint",
  };
}

const configuredEventRef = {
  eventKey: "platform-lab",
  kind: "workshop",
  title: "Platform Lab",
  startsAt: "2026-09-01T11:00:00.000Z",
  endsAt: "2026-09-01T13:00:00.000Z",
  visibility: "public",
  locationLabel: "Workshop room A",
};

function seedConfiguredEventCode(
  store: MemoryGamificationStore,
  id: string,
  activity: string,
  evidenceRole: "single" | "start" | "finish",
) {
  const generated = createMissionCodeGeneration(missionCodePepper);
  store.seed(GAMIFICATION_COLLECTIONS.codes, {
    id,
    key: id,
    label: `Private ${evidenceRole} deployment`,
    activity,
    lookup_prefix: generated.definition.lookupPrefix,
    code_hash: generated.definition.codeHash,
    hash_version: generated.definition.hashVersion,
    evidence_role: evidenceRole,
    status: "active",
    enabled: true,
    starts_at: configuredEventRef.startsAt,
    ends_at: configuredEventRef.endsAt,
    per_user_limit: 1,
    total_redemptions_cached: 0,
    created_by: "admin-1",
    metadata: { privateEventSecret: "never expose event secret" },
    created: timestamp,
    updated: timestamp,
  });
  return generated;
}

function seedConfiguredEventFixture(
  store: MemoryGamificationStore,
  options: {
    flow?: "one_code" | "two_code";
    categoryCap?: { total: number; leaderboard: number };
    dayCap?: { total: number; leaderboard: number };
    conferenceCap?: { total: number; leaderboard: number };
  } = {},
): { single?: ReturnType<typeof seedConfiguredEventCode>; start?: ReturnType<typeof seedConfiguredEventCode>; finish?: ReturnType<typeof seedConfiguredEventCode> } {
  const flow = options.flow || "one_code";
  store.seed(GAMIFICATION_COLLECTIONS.missions, {
    id: "event-mission",
    key: "workshop.platform-lab",
    slug: "event-platform-lab",
    title: "Attend Platform Lab",
    summary: "Redeem official WTS event evidence.",
    category: "workshop",
    visibility: "public",
    status: "active",
    starts_at: configuredEventRef.startsAt,
    ends_at: configuredEventRef.endsAt,
    event_ref: { ...configuredEventRef, privateInventoryNote: "never expose inventory note" },
    suggested: true,
    sort_order: 1,
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.achievements, {
    id: "event-attendance-badge",
    key: "workshop.platform-lab.attendance",
    badge_name: "Platform Lab attendee",
    badge_description: "You attended Platform Lab.",
    category: "workshop",
    rarity: "common",
    visibility: "public",
    status: "active",
    unlock_rule: { kind: "activity_claim", activityKeys: [flow === "one_code" ? "workshop.platform-lab.attendance" : "workshop.platform-lab.start"] },
    active_from: configuredEventRef.startsAt,
    active_until: configuredEventRef.endsAt,
    sort_order: 1,
    created: timestamp,
    updated: timestamp,
  });
  if (flow === "two_code") {
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "event-completion-badge",
      key: "workshop.platform-lab.completion",
      badge_name: "Platform Lab completed",
      badge_description: "You completed Platform Lab.",
      category: "workshop",
      rarity: "uncommon",
      visibility: "public",
      status: "active",
      unlock_rule: { kind: "claim_set", activityKeys: ["workshop.platform-lab.start", "workshop.platform-lab.finish"] },
      active_from: configuredEventRef.startsAt,
      active_until: configuredEventRef.endsAt,
      sort_order: 2,
      created: timestamp,
      updated: timestamp,
    });
  }
  const activityDefinitions = flow === "one_code"
    ? [{ id: "event-attendance", key: "workshop.platform-lab.attendance", outcome: "attendance", evidence: "single_code", achievement: "event-attendance-badge", meta: true }]
    : [
        { id: "event-start", key: "workshop.platform-lab.start", outcome: "attendance", evidence: "two_code_start", achievement: "event-attendance-badge", meta: false },
        { id: "event-finish", key: "workshop.platform-lab.finish", outcome: "completion", evidence: "two_code_finish", achievement: "", meta: false },
        { id: "event-completion", key: "workshop.platform-lab.completion", outcome: "completion", evidence: "derived_claim_set", achievement: "event-completion-badge", meta: true },
      ];
  for (const definition of activityDefinitions) {
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      id: definition.id,
      key: definition.key,
      mission: "event-mission",
      kind: "workshop",
      category: "workshop",
      outcome_key: definition.outcome,
      evidence_mode: definition.evidence,
      evidence_channel: definition.evidence === "derived_claim_set" ? "" : "wts_qr",
      deployment_label: definition.evidence === "derived_claim_set" ? "" : `WTS ${definition.evidence} sign`,
      achievement: definition.achievement,
      event_ref: { ...configuredEventRef },
      event_meta_eligible: definition.meta,
      per_user_claim_limit: 1,
      max_claims: 100,
      active_from: configuredEventRef.startsAt,
      active_until: configuredEventRef.endsAt,
      status: "active",
      enabled: true,
      metadata: { cap_group_key: "platform-lab-group" },
      created: timestamp,
      updated: timestamp,
    });
  }
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
    id: "event-schedule",
    key: "event-schedule",
    status: "active",
    effective_at: timestamp,
    total_xp_ceiling: flow === "one_code" ? 30 : 40,
    leaderboard_xp_ceiling: flow === "one_code" ? 25 : 30,
    access_level_thresholds: { "1": 0 },
    created: timestamp,
    updated: timestamp,
  });
  const policyDefinitions = flow === "one_code"
    ? [{ activity: "event-attendance", key: "workshop.platform-lab.attendance", total: 30, leaderboard: 25 }]
    : [
        { activity: "event-start", key: "workshop.platform-lab.start", total: 10, leaderboard: 5 },
        { activity: "event-finish", key: "workshop.platform-lab.finish", total: 0, leaderboard: 0 },
        { activity: "event-completion", key: "workshop.platform-lab.completion", total: 30, leaderboard: 25 },
      ];
  for (const policy of policyDefinitions) {
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: `policy-${policy.activity}`,
      schedule: "event-schedule",
      activity: policy.activity,
      policy_key: policy.key,
      active: true,
      total_xp: policy.total,
      leaderboard_xp: policy.leaderboard,
      cap_membership: [
        { dimension: "activity", key: policy.activity },
        { dimension: "related_group", key: "platform-lab-group" },
        { dimension: "category", key: "workshop" },
        { dimension: "conference_day", key: "2026-09-01" },
        { dimension: "conference", key: "conference" },
      ],
      cap_ceiling_overrides: { related_group: { total_xp_ceiling: flow === "one_code" ? 30 : 40, leaderboard_xp_ceiling: flow === "one_code" ? 25 : 30 } },
      score_day: "2026-09-01",
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
      id: `cap-${policy.activity}`,
      schedule: "event-schedule",
      dimension: "activity",
      cap_key: policy.activity,
      member_policy_keys: [policy.key],
      total_xp_ceiling: policy.total,
      leaderboard_xp_ceiling: policy.leaderboard,
      created: timestamp,
      updated: timestamp,
    });
  }
  const policyKeys = policyDefinitions.map((policy) => policy.key);
  for (const cap of [
    { id: "event-related-cap", dimension: "related_group", key: "platform-lab-group", total: flow === "one_code" ? 30 : 40, leaderboard: flow === "one_code" ? 25 : 30 },
    { id: "event-category-cap", dimension: "category", key: "workshop", total: options.categoryCap?.total ?? (flow === "one_code" ? 30 : 40), leaderboard: options.categoryCap?.leaderboard ?? (flow === "one_code" ? 25 : 30) },
    { id: "event-day-cap", dimension: "conference_day", key: "2026-09-01", total: options.dayCap?.total ?? (flow === "one_code" ? 30 : 40), leaderboard: options.dayCap?.leaderboard ?? (flow === "one_code" ? 25 : 30) },
    { id: "event-conference-cap", dimension: "conference", key: "conference", total: options.conferenceCap?.total ?? (flow === "one_code" ? 30 : 40), leaderboard: options.conferenceCap?.leaderboard ?? (flow === "one_code" ? 25 : 30) },
  ]) {
    store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
      id: cap.id,
      schedule: "event-schedule",
      dimension: cap.dimension,
      cap_key: cap.key,
      member_policy_keys: policyKeys,
      total_xp_ceiling: cap.total,
      leaderboard_xp_ceiling: cap.leaderboard,
      created: timestamp,
      updated: timestamp,
    });
  }
  if (flow === "one_code") {
    return { single: seedConfiguredEventCode(store, "event-single-code", "event-attendance", "single") };
  }
  return {
    start: seedConfiguredEventCode(store, "event-start-code", "event-start", "start"),
    finish: seedConfiguredEventCode(store, "event-finish-code", "event-finish", "finish"),
  };
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("gamification accounting", () => {
  it("keeps activity claims, Badges, and direct XP idempotent without a Badge XP duplicate", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedActivity(store);
    seedSchedule(store);
    const accounting = service(store);

    await accounting.recordActivityAward(awardInput());
    await accounting.recordActivityAward(awardInput());

    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toHaveLength(1);
    const events = await store.list<{ amount: number; leaderboard_amount: number }>(GAMIFICATION_COLLECTIONS.xpEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ amount: 20, leaderboard_amount: 10 });
  });

  it("rejects reuse of an evidence operation ID for another claim payload", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedActivity(store);
    seedSchedule(store);
    const accounting = service(store);
    const input = awardInput();
    await accounting.recordActivityAward(input);

    await expect(accounting.recordActivityAward({
      claim: { ...input.claim, user: "user-2" },
    })).rejects.toThrow("different Activity Claim");
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents, { user: "user-2" })).toHaveLength(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { user: "user-2" })).toHaveLength(0);
  });

  it("voids ledger history, rebuilds non-voided totals, and writes an audit action", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedActivity(store);
    seedSchedule(store);
    const accounting = service(store);
    await accounting.recordActivityAward(awardInput());

    let profile = await accounting.rebuildProfile({ id: "user-1", name: "Ada" });
    expect(profile.total_xp).toBe(20);
    const [event] = await store.list<{ id: string }>(GAMIFICATION_COLLECTIONS.xpEvents);
    await accounting.voidXpEvent(event.id, {
      actor: "admin-1",
      actorRole: "admin",
      targetUser: "user-1",
      reason: "Duplicate source correction",
      operationId: "void-1",
    });
    profile = await accounting.rebuildProfile({ id: "user-1", name: "Ada" });

    expect(profile.total_xp).toBe(0);
    expect(profile.leaderboard_xp).toBe(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(1);
    expect((await store.getById<{ voided: boolean }>(GAMIFICATION_COLLECTIONS.xpEvents, event.id)).voided).toBe(true);
    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions, { action: "void_xp_event" })).toEqual([
      expect.objectContaining({ status: "applied", actor_role: "admin" }),
    ]);
  });

  it("derives a direct award from the configured schedule policy and remaining cap", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedActivity(store);
    seedSchedule(store);
    await store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, "cap-checked-in", {
      total_xp_ceiling: 5,
      leaderboard_xp_ceiling: 3,
    });

    await service(store).recordActivityAward(awardInput());

    const [event] = await store.list<{ amount: number; leaderboard_amount: number }>(GAMIFICATION_COLLECTIONS.xpEvents);
    expect(event).toMatchObject({ amount: 5, leaderboard_amount: 3 });
    const [claim] = await store.list<{ cap_outcome: Record<string, unknown> }>(GAMIFICATION_COLLECTIONS.activityClaims);
    expect(claim.cap_outcome).toMatchObject({
      policy: "conference-main-checked-in",
      awarded_total_xp: 5,
      awarded_leaderboard_xp: 3,
    });
  });

  it("serializes concurrent cap consumption while keeping total and Leaderboard XP independent", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedActivity(store);
    seedSchedule(store);
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      ...(await store.getById<Record<string, unknown>>(GAMIFICATION_COLLECTIONS.activities, "activity-checked-in")),
      id: "activity-concurrent-second",
      key: "conference-main-second",
      achievement: "",
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "policy-concurrent-second",
      schedule: "schedule-1",
      activity: "activity-concurrent-second",
      policy_key: "conference-main-second",
      active: true,
      total_xp: 20,
      leaderboard_xp: 10,
      cap_membership: [{ dimension: "conference", key: "conference" }],
      created: timestamp,
      updated: timestamp,
    });
    await store.update(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, "policy-checked-in", {
      cap_membership: [{ dimension: "conference", key: "conference" }],
    });
    await store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, "cap-checked-in", {
      dimension: "conference",
      cap_key: "conference",
      member_policy_keys: ["conference-main-checked-in", "conference-main-second"],
      total_xp_ceiling: 20,
      leaderboard_xp_ceiling: 15,
    });

    await Promise.all([
      service(store).recordActivityAward(awardInput()),
      service(store).recordActivityAward({
        claim: {
          ...awardInput().claim,
          activity: "activity-concurrent-second",
          evidenceFingerprint: "second",
          idempotencyKey: "second",
        },
      }),
    ]);

    const events = await store.list<{ amount: number; leaderboard_amount: number }>(GAMIFICATION_COLLECTIONS.xpEvents);
    expect(events.reduce((sum, event) => sum + event.amount, 0)).toBe(20);
    expect(events.reduce((sum, event) => sum + event.leaderboard_amount, 0)).toBe(15);
  });

  it("revokes a Badge without deleting it and preserves profile visibility preferences during rebuilds", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedActivity(store);
    seedSchedule(store);
    const accounting = service(store);
    await accounting.recordActivityAward(awardInput());
    let profile = await accounting.ensureProfile({ id: "user-1", name: "Ada" });
    profile = await store.update<typeof profile>(GAMIFICATION_COLLECTIONS.profiles, profile.id, {
      ops_board_visible: false,
      ops_board_display_name: "Private Agent",
      public_badges_visible: false,
    });
    const [badge] = await store.list<{ id: string }>(GAMIFICATION_COLLECTIONS.userAchievements);
    await accounting.revokeBadge(badge.id, {
      actor: "admin-1",
      actorRole: "admin",
      targetUser: "user-1",
      reason: "Support correction",
      operationId: "revoke-1",
    });
    profile = await accounting.rebuildProfile({ id: "user-1", name: "Ada" });

    expect((await store.getById<{ status: string }>(GAMIFICATION_COLLECTIONS.userAchievements, badge.id)).status).toBe("revoked");
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toHaveLength(1);
    expect(profile.unlocked_badge_count).toBe(0);
    expect(profile.ops_board_visible).toBe(false);
    expect(profile.ops_board_display_name).toBe("Private Agent");
    expect(profile.public_badges_visible).toBe(false);
  });

  it("rejects reuse of an admin operation ID for a different accounting record", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    store.seed(GAMIFICATION_COLLECTIONS.userAchievements, {
      id: "badge-1",
      user: "user-1",
      achievement: "achievement-1",
      status: "unlocked",
      unlocked_at: timestamp,
      idempotency_key: "user-achievement:v1:user-1:attendance-check-in",
      public_visible: true,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.userAchievements, {
      id: "badge-2",
      user: "user-1",
      achievement: "achievement-2",
      status: "unlocked",
      unlocked_at: timestamp,
      idempotency_key: "user-achievement:v1:user-1:other",
      public_visible: true,
      created: timestamp,
      updated: timestamp,
    });
    const accounting = service(store);
    await accounting.revokeBadge("badge-1", {
      actor: "admin-1",
      actorRole: "admin",
      targetUser: "user-1",
      reason: "Support correction",
      operationId: "operation-1",
    });

    await expect(accounting.revokeBadge("badge-2", {
      actor: "admin-1",
      actorRole: "admin",
      targetUser: "user-1",
      reason: "Support correction",
      operationId: "operation-1",
    })).rejects.toThrow("belongs to another accounting action");
  });

  it("keeps the first score-bearing schedule as the fixed access-level ladder", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedActivity(store);
    seedSchedule(store);
    const accounting = service(store);
    await accounting.recordActivityAward(awardInput());
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      id: "schedule-2",
      key: "wts-2026-september-successor",
      status: "active",
      effective_at: "2026-09-02T12:00:00.000Z",
      total_xp_ceiling: 200,
      leaderboard_xp_ceiling: 160,
      access_level_thresholds: { "1": 0, "2": 10, "3": 30, "4": 60, "5": 100, "6": 150, "7": 200 },
      created: timestamp,
      updated: timestamp,
    });

    const profile = await accounting.rebuildProfile({ id: "user-1" });
    expect(profile.access_level_schedule).toBe("schedule-1");
    expect(profile.next_level_threshold).toBe(30);

    store.seed(GAMIFICATION_COLLECTIONS.xpEvents, {
      id: "event-user-2",
      user: "user-2",
      amount: 20,
      leaderboard_amount: 10,
      category: "attendance",
      reason: "Recorded after successor activation",
      source_type: "activity_claim",
      idempotency_key: "xp-event:v1:user-2:fixture",
      occurred_at: "2026-09-03T12:00:00.000Z",
      voided: false,
      created: timestamp,
      updated: timestamp,
    });
    const laterProfile = await accounting.rebuildProfile({ id: "user-2" });
    expect(laterProfile.access_level_schedule).toBe("schedule-1");
  });

  it("uses a superseded schedule for claims before its successor becomes effective", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedActivity(store);
    seedSchedule(store);
    await store.update(GAMIFICATION_COLLECTIONS.scoreSchedules, "schedule-1", { status: "superseded" });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      id: "schedule-successor",
      key: "wts-2026-successor",
      status: "active",
      effective_at: "2026-09-02T00:00:00.000Z",
      total_xp_ceiling: 50,
      leaderboard_xp_ceiling: 40,
      access_level_thresholds: { "1": 0, "2": 3, "3": 8, "4": 15, "5": 25, "6": 38, "7": 50 },
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "successor-policy",
      schedule: "schedule-successor",
      activity: "activity-checked-in",
      policy_key: "conference-main-checked-in-successor",
      active: true,
      total_xp: 50,
      leaderboard_xp: 40,
      cap_membership: [{ dimension: "activity", key: "activity-checked-in" }],
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
      id: "successor-cap",
      schedule: "schedule-successor",
      dimension: "activity",
      cap_key: "activity-checked-in",
      member_policy_keys: ["conference-main-checked-in-successor"],
      total_xp_ceiling: 50,
      leaderboard_xp_ceiling: 40,
      created: timestamp,
      updated: timestamp,
    });

    await service(store).recordActivityAward(awardInput());

    expect(await store.list<{ amount: number; leaderboard_amount: number }>(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual([
      expect.objectContaining({ amount: 20, leaderboard_amount: 10 }),
    ]);
  });

  it("defaults a new profile to ops-board visibility and a safe non-email handle", async () => {
    const store = new MemoryGamificationStore();
    const profile = await service(store).ensureProfile({ id: "abcdef123456", email: "private@example.com" });

    expect(profile.ops_board_visible).toBe(true);
    expect(profile.public_badges_visible).toBe(true);
    expect(profile.ops_board_display_name).toBe("Agent 123456");
    expect(profile.ops_board_display_name).not.toContain("@");
  });
});

describe("shared Meta Achievement evaluator", () => {
  it("derives one idempotent Meta claim, Badge, and score from an exact claim set", async () => {
    const store = new MemoryGamificationStore();
    seedMetaSourceActivity(store, "source-a", "session.a.attendance", { kind: "session", category: "session", session: "session-a" });
    seedMetaSourceActivity(store, "source-b", "session.b.attendance", { kind: "session", category: "session", session: "session-b" });
    seedMetaConfiguration(store, { kind: "claim_set", activityKeys: ["session.a.attendance", "session.b.attendance"] });
    const accounting = service(store);

    await accounting.recordActivityAward(metaSourceAwardInput("source-a", "a"));
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_meta" })).toHaveLength(0);
    await accounting.recordActivityAward(metaSourceAwardInput("source-b", "b"));
    await accounting.recordActivityAward(metaSourceAwardInput("source-b", "b"));

    const metaClaims = await store.list<any>(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_meta" });
    expect(metaClaims).toEqual([expect.objectContaining({
      activity: "meta-activity",
      status: "accepted",
      outcome_key: "meta",
      metadata: expect.objectContaining({ meta_rule: expect.objectContaining({ kind: "claim_set", source_claim_ids: expect.any(Array) }) }),
    })]);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "meta-achievement", status: "unlocked" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents, { source_claim: metaClaims[0].id })).toEqual([
      expect.objectContaining({ amount: 20, leaderboard_amount: 15 }),
    ]);
  });

  it("uses selected-source claim counts and applies every diversity selector once per source entity", async () => {
    const cases = [
      {
        diversity: "session" as const,
        first: { kind: "session", category: "session", session: "session-a" },
        duplicate: { kind: "session", category: "session", session: "session-a" },
        distinct: { kind: "session", category: "session", session: "session-b" },
      },
      {
        diversity: "booth" as const,
        first: { kind: "booth", category: "booth", partner: "sponsor-a", partner_kind: "sponsor" },
        duplicate: { kind: "booth", category: "booth", partner: "sponsor-a", partner_kind: "sponsor", outcome_key: "completion" },
        distinct: { kind: "booth", category: "booth", partner: "sponsor-b", partner_kind: "sponsor" },
      },
      {
        diversity: "community" as const,
        first: { kind: "community_partner", category: "community", partner: "community-a", partner_kind: "community_partner", mission: "programme-a", community_meta_eligible: true },
        duplicate: { kind: "community_partner", category: "community", partner: "community-a", partner_kind: "community_partner", mission: "programme-a", outcome_key: "completion", community_meta_eligible: true },
        distinct: { kind: "community_partner", category: "community", partner: "community-a", partner_kind: "community_partner", mission: "programme-b", community_meta_eligible: true },
      },
    ];

    for (const testCase of cases) {
      const store = new MemoryGamificationStore();
      seedMetaSourceActivity(store, "source-a", `${testCase.diversity}.a`, testCase.first);
      seedMetaSourceActivity(store, "source-b", `${testCase.diversity}.b`, testCase.duplicate);
      seedMetaSourceActivity(store, "source-c", `${testCase.diversity}.c`, testCase.distinct);
      seedMetaConfiguration(store, {
        kind: "claim_count",
        activityKeys: [`${testCase.diversity}.a`, `${testCase.diversity}.b`, `${testCase.diversity}.c`],
        count: 2,
        sourceDiversity: testCase.diversity,
      }, { activityId: `meta-${testCase.diversity}`, achievementId: `achievement-${testCase.diversity}` });
      const accounting = service(store);

      await accounting.recordActivityAward(metaSourceAwardInput("source-a", `${testCase.diversity}-a`));
      await accounting.recordActivityAward(metaSourceAwardInput("source-b", `${testCase.diversity}-b`));
      expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_meta" })).toHaveLength(0);
      await accounting.recordActivityAward(metaSourceAwardInput("source-c", `${testCase.diversity}-c`));

      expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_meta", status: "accepted" })).toHaveLength(1);
    }
  });

  it("keeps cap-exhausted source claims eligible for their Meta outcome", async () => {
    const store = new MemoryGamificationStore();
    seedMetaSourceActivity(store, "source-a", "booth.a");
    seedMetaSourceActivity(store, "source-b", "booth.b");
    seedMetaConfiguration(store, { kind: "claim_count", activityKeys: ["booth.a", "booth.b"], count: 2 });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "source-a-policy",
      schedule: "meta-schedule-meta-activity",
      activity: "source-a",
      policy_key: "source-a-policy",
      active: true,
      total_xp: 20,
      leaderboard_xp: 15,
      cap_membership: [{ dimension: "activity", key: "source-a" }],
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
      id: "source-a-cap",
      schedule: "meta-schedule-meta-activity",
      dimension: "activity",
      cap_key: "source-a",
      member_policy_keys: ["source-a-policy"],
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
      created: timestamp,
      updated: timestamp,
    });
    const accounting = service(store);

    await accounting.recordActivityAward(metaSourceAwardInput("source-a", "capped-source"));
    await accounting.recordActivityAward(metaSourceAwardInput("source-b", "other-source"));

    const sourceClaim = await store.findOne<any>(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "source-a" });
    const metaClaim = await store.findOne<any>(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_meta", status: "accepted" });
    expect(sourceClaim.cap_outcome).toMatchObject({ awarded_total_xp: 0, awarded_leaderboard_xp: 0 });
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents, { source_claim: sourceClaim.id })).toHaveLength(0);
    expect(metaClaim).toMatchObject({ status: "accepted" });
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents, { source_claim: metaClaim.id })).toEqual([
      expect.objectContaining({ amount: 20, leaderboard_amount: 15 }),
    ]);
  });

  it("retains a cap-exhausted Meta claim and Badge while recording category, day, and conference diagnostics", async () => {
    const store = new MemoryGamificationStore();
    seedMetaSourceActivity(store, "source-a", "booth.a");
    seedMetaSourceActivity(store, "source-b", "booth.b");
    seedMetaConfiguration(store, { kind: "claim_count", activityKeys: ["booth.a", "booth.b"], count: 2 }, {
      caps: [
        { id: "meta-category-cap", dimension: "category", cap_key: "meta", member_policy_keys: ["meta-policy-meta-activity"], total_xp_ceiling: 0, leaderboard_xp_ceiling: 0 },
        { id: "meta-day-cap", dimension: "conference_day", cap_key: "2026-09-01", member_policy_keys: ["meta-policy-meta-activity"], total_xp_ceiling: 0, leaderboard_xp_ceiling: 0 },
        { id: "meta-conference-cap", dimension: "conference", cap_key: "conference", member_policy_keys: ["meta-policy-meta-activity"], total_xp_ceiling: 0, leaderboard_xp_ceiling: 0 },
      ],
    });
    const accounting = service(store);

    await accounting.recordActivityAward(metaSourceAwardInput("source-a", "cap-a"));
    await accounting.recordActivityAward(metaSourceAwardInput("source-b", "cap-b"));

    const metaClaim = await store.findOne<any>(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_meta", status: "accepted" });
    expect(metaClaim.cap_outcome).toMatchObject({ awarded_total_xp: 0, awarded_leaderboard_xp: 0 });
    expect(metaClaim.cap_outcome.applied_caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "category:meta" }),
      expect.objectContaining({ key: "conference_day:2026-09-01" }),
      expect.objectContaining({ key: "conference:conference" }),
    ]));
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "meta-achievement", status: "unlocked" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents, { source_claim: metaClaim.id })).toHaveLength(0);
  });

  it("repairs an interrupted derived Meta outcome from its retained claim", async () => {
    const store = new MemoryGamificationStore();
    seedMetaSourceActivity(store, "source-a", "booth.a");
    seedMetaSourceActivity(store, "source-b", "booth.b");
    seedMetaConfiguration(store, { kind: "claim_count", activityKeys: ["booth.a", "booth.b"], count: 2 });
    for (const [id, activity] of [["source-claim-a", "source-a"], ["source-claim-b", "source-b"]] as const) {
      store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
        id,
        user: "user-1",
        activity,
        source_type: "code_redemption",
        outcome_key: "visit",
        status: "accepted",
        occurred_at: timestamp,
        claimed_at: timestamp,
        evidence_fingerprint: id,
        idempotency_key: id,
        created: timestamp,
        updated: timestamp,
      });
    }
    store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
      id: "interrupted-meta-claim",
      user: "user-1",
      activity: "meta-activity",
      source_type: "system_meta",
      outcome_key: "meta",
      status: "accepted",
      occurred_at: timestamp,
      claimed_at: timestamp,
      evidence_fingerprint: "interrupted-meta",
      idempotency_key: "interrupted-meta",
      cap_outcome: { awarded_total_xp: 20, awarded_leaderboard_xp: 15 },
      metadata: { meta_rule: { kind: "claim_count", source_claim_ids: ["source-claim-a", "source-claim-b"] } },
      created: timestamp,
      updated: timestamp,
    });

    await service(store).evaluateMetaAchievementsForUser({ id: "user-1" });

    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "meta-achievement", status: "unlocked" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents, { source_claim: "interrupted-meta-claim" })).toEqual([
      expect.objectContaining({ amount: 20, leaderboard_amount: 15 }),
    ]);
  });

  it("voids unsupported automatic Meta outcomes without touching a manual Badge award", async () => {
    const store = new MemoryGamificationStore();
    seedUser(store);
    seedMetaSourceActivity(store, "source-a", "booth.a");
    seedMetaSourceActivity(store, "source-b", "booth.b");
    seedMetaConfiguration(store, { kind: "claim_count", activityKeys: ["booth.a", "booth.b"], count: 2 });
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      id: "manual-meta",
      key: "admin.meta.manual",
      kind: "admin_manual",
      category: "meta",
      outcome_key: "manual_award",
      evidence_mode: "admin_manual",
      achievement: "meta-achievement",
      per_user_claim_limit: 1,
      status: "active",
      enabled: true,
      created: timestamp,
      updated: timestamp,
    });
    const accounting = service(store);
    const manual = await accounting.recordManualAward({
      achievementId: "meta-achievement",
      activityId: "manual-meta",
      mode: "badge_only",
    }, {
      actor: "admin-1",
      actorRole: "admin",
      targetUser: "user-1",
      reason: "Approved manual recognition",
      operationId: "manual-meta-award",
    });
    await accounting.recordActivityAward(metaSourceAwardInput("source-a", "void-a"));
    await accounting.recordActivityAward(metaSourceAwardInput("source-b", "void-b"));
    const sourceClaim = await store.findOne<any>(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "source-a", status: "accepted" });
    const metaClaim = await store.findOne<any>(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_meta", status: "accepted" });
    await store.update(GAMIFICATION_COLLECTIONS.achievements, "meta-achievement", { status: "retired" });
    await store.update(GAMIFICATION_COLLECTIONS.activities, "meta-activity", { status: "retired", enabled: false });

    await accounting.voidActivityClaim(sourceClaim.id, {
      actor: "admin-1",
      actorRole: "admin",
      targetUser: "user-1",
      reason: "Source evidence was duplicated",
      operationId: "void-meta-source",
    });

    expect(await store.getById<any>(GAMIFICATION_COLLECTIONS.activityClaims, sourceClaim.id)).toMatchObject({ status: "voided" });
    expect(await store.getById<any>(GAMIFICATION_COLLECTIONS.activityClaims, metaClaim.id)).toMatchObject({ status: "voided" });
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents, { source_claim: metaClaim.id })).toEqual([
      expect.objectContaining({ voided: true }),
    ]);
    expect(await store.getById<any>(GAMIFICATION_COLLECTIONS.userAchievements, manual.badgeId)).toMatchObject({ status: "unlocked" });
    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions, { action: "void_activity_claim" })).toEqual([
      expect.objectContaining({ status: "applied" }),
    ]);
  });

  it("maps the fixed Meta score bands from the declared source breadth", () => {
    expect(metaScoreBandForRule({ kind: "claim_set", activityKeys: ["a", "b"] } as any)).toEqual({ totalXp: 20, leaderboardXp: 15 });
    expect(metaScoreBandForRule({ kind: "claim_count", activityKeys: ["a", "b", "c", "d"], count: 4 } as any)).toEqual({ totalXp: 30, leaderboardXp: 25 });
    expect(metaScoreBandForRule({ kind: "claim_count", activityKeys: ["a", "b", "c", "d", "e"], count: 5 } as any)).toEqual({ totalXp: 40, leaderboardXp: 30 });
  });
});

describe("Mission code cryptography and browser resume", () => {
  it("generates opaque high-entropy codes with a one-time raw value and peppered lookup hash", () => {
    const generated = createMissionCodeGeneration(missionCodePepper);
    const parsed = parseMissionCode(` ${generated.rawCode.toLowerCase().replaceAll("-", " ")} `);

    expect(parsed).toEqual(expect.objectContaining({ lookupPrefix: generated.definition.lookupPrefix }));
    expect(verifyMissionCodeHash(parsed!.normalizedCode, generated.definition.codeHash, missionCodePepper)).toBe(true);
    expect(verifyMissionCodeHash(`${parsed!.normalizedCode}X`, generated.definition.codeHash, missionCodePepper)).toBe(false);
    expect(parseMissionCode("WTS26-NOT-A-CODE")).toBeUndefined();
    expect(JSON.stringify(generated.definition)).not.toContain(generated.rawCode);
    expect(generated.definition.lookupPrefix).toHaveLength(8);
    expect(containsMissionCode(generated.rawCode.split("").join(" "))).toBe(true);
  });

  it("rejects separator-obfuscated bearer codes from persisted public Mission configuration", async () => {
    const store = new MemoryGamificationStore();
    const spacedCode = createMissionCodeGeneration(missionCodePepper).rawCode.split("").join(" ");

    await expect(operationService(store).saveMissionDraft({
      key: "unsafe-public-mission",
      slug: "unsafe-public-mission",
      title: spacedCode,
      summary: "Public Mission summary",
      category: "attendance",
      visibility: "public",
      suggested: false,
      sortOrder: 1,
      operationId: "unsafe-public-mission",
    }, adminActor)).rejects.toThrow("Mission configuration must not include Mission codes");
    expect(await store.list(GAMIFICATION_COLLECTIONS.missions)).toEqual([]);
    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions)).toEqual([]);
  });

  it("keeps a fragment code only in tab storage and resumes login at the code-free route", () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const rawCode = "WTS26-ABCDEFGH-0123456789ABCDEFGHJKMNPQRS";

    expect(missionCodeFromFragment(`#code=${rawCode}&source=qr`)).toBe(rawCode);
    expect(savePendingMissionCode(session, rawCode, 1_000)).toBe(true);
    expect(readPendingMissionCode(session, 1_001)).toBe(rawCode);
    setMissionCodeLoginResume(local);

    expect(local.getItem("redirect_url")).toBe("/missions/redeem");
    expect(local.getItem("redirect_url")).not.toContain(rawCode);
    expect(readPendingMissionCode(session, 1_000 + 15 * 60 * 1000 + 1)).toBeUndefined();
    expect(session.getItem(PENDING_MISSION_CODE_STORAGE_KEY)).toBeNull();

    savePendingMissionCode(session, rawCode);
    clearPendingMissionCode(session);
    expect(readPendingMissionCode(session)).toBeUndefined();
  });
});

describe("secure Mission code redemption", () => {
  it("derives the User from the authenticated operation before redemption can run", async () => {
    const operation = vi.fn();

    await expect(runAuthenticatedGamificationOperation(
      async () => { throw new Error("Unauthorized: Login required"); },
      operation,
    )).rejects.toThrow("Unauthorized: Login required");
    expect(operation).not.toHaveBeenCalled();
  });

  it("accepts once, applies Activity-owned XP, rebuilds the profile, and returns an allowlisted DTO", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedCodeRedemptionActivity(store);
    seedCodeRedemptionSchedule(store);
    const generated = seedMissionCode(store);
    const service = redemptionService(store);

    const accepted = await service.redeem(redemptionInput(generated.rawCode));
    const repeated = await service.redeem(redemptionInput(generated.rawCode));

    expect(accepted).toMatchObject({
      status: "accepted",
      xpAwarded: 20,
      leaderboardXpAwarded: 10,
      profile: { totalXp: 20, accessLevel: 5 },
      badges: [expect.objectContaining({ name: "Checked In" })],
    });
    expect(repeated.status).toBe("already_redeemed");
    expect(await store.list(GAMIFICATION_COLLECTIONS.codeRedemptions, { status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(1);
    expect((await store.list<{ total_xp: number }>(GAMIFICATION_COLLECTIONS.profiles))[0].total_xp).toBe(20);

    const serialized = JSON.stringify(accepted);
    expect(serialized).not.toContain(generated.rawCode);
    expect(serialized).not.toContain(generated.definition.codeHash);
    expect(serialized).not.toContain(generated.definition.lookupPrefix);
    expect(serialized).not.toContain("Private partner code label");
    expect(serialized).not.toContain("never expose");
    expect(serialized).not.toContain("private-request-fingerprint");
  });

  it("collapses concurrent duplicate redemptions into one Redemption, Claim, direct award, Meta award, and cap result", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedCodeRedemptionActivity(store);
    seedCodeRedemptionSchedule(store, 100);
    const meta = seedMetaConfiguration(store, {
      kind: "claim_count",
      activityKeys: ["mission-code-activity"],
      count: 1,
    });
    await store.update(GAMIFICATION_COLLECTIONS.scoreSchedules, `meta-schedule-${meta.activityId}`, {
      effective_at: "2026-08-01T00:00:00.000Z",
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "policy-code-meta",
      schedule: "schedule-code",
      activity: meta.activityId,
      policy_key: "mission-code-meta",
      active: true,
      total_xp: 20,
      leaderboard_xp: 15,
      cap_membership: [{ dimension: "activity", key: meta.activityId }],
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
      id: "cap-code-meta",
      schedule: "schedule-code",
      dimension: "activity",
      cap_key: meta.activityId,
      member_policy_keys: ["mission-code-meta"],
      total_xp_ceiling: 20,
      leaderboard_xp_ceiling: 15,
      created: timestamp,
      updated: timestamp,
    });
    const generated = seedMissionCode(store, { max_redemptions: 1 });

    const results = await Promise.all(Array.from({ length: 20 }, () =>
      redemptionService(store).redeem(redemptionInput(generated.rawCode))
    ));

    expect(results.filter((result) => result.status === "accepted")).toHaveLength(1);
    expect(results.filter((result) => result.status === "already_redeemed")).toHaveLength(19);
    expect(await store.list(GAMIFICATION_COLLECTIONS.codeRedemptions, { status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "activity-code", status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: meta.activityId, status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { status: "unlocked" })).toHaveLength(2);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(2);
    expect((await store.list<{ total_xp: number }>(GAMIFICATION_COLLECTIONS.profiles))[0].total_xp).toBe(40);
  });

  it("preserves accepted accounting and exposes rebuild_pending when the profile cache update fails", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedCodeRedemptionActivity(store);
    seedCodeRedemptionSchedule(store);
    const generated = seedMissionCode(store);
    await service(store).ensureProfile({ id: "user-1", name: "Ada" });
    store.failNextUpdate(GAMIFICATION_COLLECTIONS.profiles);

    const result = await redemptionService(store).redeem(redemptionInput(generated.rawCode));
    const profile = (await store.list<{ rebuild_pending?: boolean; rebuild_support_reference?: string }>(GAMIFICATION_COLLECTIONS.profiles))[0];

    expect(result).toMatchObject({
      status: "accepted",
      profile: { repairState: "rebuild_pending", supportReference: expect.stringMatching(/^GAM-/) },
    });
    expect(profile).toMatchObject({ rebuild_pending: true, rebuild_support_reference: expect.stringMatching(/^GAM-/) });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { status: "unlocked" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents, { voided: false })).toHaveLength(1);
  });

  it("load exercise keeps concurrent redemption and ops-board reads isolated", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedCodeRedemptionActivity(store);
    seedCodeRedemptionSchedule(store);
    const generated = seedMissionCode(store, { max_redemptions: 1 });
    const accounting = service(store);
    await accounting.ensureProfile({ id: "user-1", name: "Ada" });

    const results = await Promise.all([
      ...Array.from({ length: 20 }, () => redemptionService(store).redeem(redemptionInput(generated.rawCode))),
      ...Array.from({ length: 100 }, () => accounting.publicOpsBoardPage(1, 50)),
    ]);

    const redemptionResults = results.slice(0, 20) as Awaited<ReturnType<MissionCodeRedemptionService["redeem"]>>[];
    expect(redemptionResults.filter((result) => result.status === "accepted")).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.codeRedemptions, { status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(1);
  });

  it("records cap-exhausted completion and Badge eligibility without creating a second XP event", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedCodeRedemptionActivity(store);
    seedCodeRedemptionSchedule(store, 20);
    await store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, "cap-code", {
      member_policy_keys: ["mission-code-activity", "mission-prior-activity"],
      leaderboard_xp_ceiling: 10,
    });
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      id: "activity-prior",
      key: "mission-prior-activity",
      kind: "booth",
      category: "booth",
      outcome_key: "completion",
      evidence_mode: "single_code",
      per_user_claim_limit: 1,
      status: "active",
      enabled: true,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "policy-prior",
      schedule: "schedule-code",
      activity: "activity-prior",
      policy_key: "mission-prior-activity",
      active: true,
      total_xp: 20,
      leaderboard_xp: 10,
      cap_membership: [{ dimension: "activity", key: "activity-code" }],
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
      id: "claim-prior",
      user: "user-1",
      activity: "activity-prior",
      source_type: "code_redemption",
      outcome_key: "completion",
      status: "accepted",
      occurred_at: timestamp,
      claimed_at: timestamp,
      evidence_fingerprint: "prior",
      idempotency_key: "prior",
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.xpEvents, {
      id: "event-prior",
      user: "user-1",
      amount: 20,
      leaderboard_amount: 10,
      category: "booth",
      reason: "Prior capped Mission",
      source_type: "activity_claim",
      source_claim: "claim-prior",
      idempotency_key: "prior-event",
      occurred_at: timestamp,
      voided: false,
      created: timestamp,
      updated: timestamp,
    });
    const generated = seedMissionCode(store);

    const result = await redemptionService(store).redeem(redemptionInput(generated.rawCode));

    expect(result).toMatchObject({ status: "accepted", xpAwarded: 0, leaderboardXpAwarded: 0 });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "activity-code", status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { user: "user-1" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(1);
  });

  it("runs the shared Meta evaluator after an accepted code-redemption source claim", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedCodeRedemptionActivity(store);
    seedCodeRedemptionSchedule(store);
    seedMetaSourceActivity(store, "activity-other-meta-source", "other.meta.source");
    store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
      id: "other-meta-source-claim",
      user: "user-1",
      activity: "activity-other-meta-source",
      source_type: "code_redemption",
      outcome_key: "visit",
      status: "accepted",
      occurred_at: timestamp,
      claimed_at: timestamp,
      evidence_fingerprint: "other-meta-source",
      idempotency_key: "other-meta-source",
      cap_outcome: { awarded_total_xp: 0, awarded_leaderboard_xp: 0 },
      metadata: { private_source: "never expose" },
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "redemption-meta-achievement",
      key: "redemption-meta",
      badge_name: "Redemption circuit",
      badge_description: "Safe Meta Badge presentation.",
      category: "meta",
      rarity: "rare",
      visibility: "public",
      status: "active",
      unlock_rule: { kind: "claim_count", activityKeys: ["mission-code-activity", "other.meta.source"], count: 2 },
      sort_order: 2,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      id: "redemption-meta-activity",
      key: "meta.redemption.circuit",
      kind: "meta",
      category: "meta",
      outcome_key: "meta",
      evidence_mode: "meta_rule",
      achievement: "redemption-meta-achievement",
      per_user_claim_limit: 1,
      status: "active",
      enabled: true,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "redemption-meta-policy",
      schedule: "schedule-code",
      activity: "redemption-meta-activity",
      policy_key: "redemption-meta-policy",
      active: true,
      total_xp: 20,
      leaderboard_xp: 15,
      cap_membership: [{ dimension: "activity", key: "redemption-meta-activity" }],
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
      id: "redemption-meta-cap",
      schedule: "schedule-code",
      dimension: "activity",
      cap_key: "redemption-meta-activity",
      member_policy_keys: ["redemption-meta-policy"],
      total_xp_ceiling: 20,
      leaderboard_xp_ceiling: 15,
      created: timestamp,
      updated: timestamp,
    });
    const generated = seedMissionCode(store);

    const result = await redemptionService(store).redeem(redemptionInput(generated.rawCode));

    expect(result).toMatchObject({
      status: "accepted",
      xpAwarded: 40,
      leaderboardXpAwarded: 25,
      badges: expect.arrayContaining([expect.objectContaining({ name: "Redemption circuit" })]),
    });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_meta", status: "accepted" })).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("never expose");
  });

  it("returns invalid without persistence and audits recognized rejection states without awards", async () => {
    const invalidStore = new MemoryGamificationStore();
    const invalidResult = await redemptionService(invalidStore).redeem(redemptionInput("not a Mission code"));
    expect(invalidResult.status).toBe("invalid");
    expect(await invalidStore.list(GAMIFICATION_COLLECTIONS.codeRedemptions)).toHaveLength(0);

    const scenarios: Array<{
      expected: "disabled" | "not_yet_active" | "expired" | "global_limit" | "user_limit";
      code?: Record<string, unknown>;
      activity?: Record<string, unknown>;
      seed?: (store: MemoryGamificationStore) => void;
    }> = [
      { expected: "disabled", code: { enabled: false } },
      { expected: "not_yet_active", code: { starts_at: "2026-09-02T12:00:00.000Z" } },
      { expected: "expired", code: { ends_at: "2026-08-31T12:00:00.000Z" } },
      {
        expected: "global_limit",
        code: { max_redemptions: 1 },
        seed: (store) => store.seed(GAMIFICATION_COLLECTIONS.codeRedemptions, {
          id: "other-redemption",
          user: "user-2",
          code: "code-1",
          activity: "activity-code",
          status: "accepted",
          redeemed_at: timestamp,
          idempotency_key: "code-redemption:v1:user-2:code-1",
          created: timestamp,
          updated: timestamp,
        }),
      },
      {
        expected: "user_limit",
        seed: (store) => store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
          id: "prior-user-claim",
          user: "user-1",
          activity: "activity-code",
          source_type: "hievents_checkin",
          outcome_key: "completion",
          status: "accepted",
          occurred_at: timestamp,
          claimed_at: timestamp,
          evidence_fingerprint: "prior-user-claim",
          idempotency_key: "prior-user-claim",
          created: timestamp,
          updated: timestamp,
        }),
      },
    ];

    for (const scenario of scenarios) {
      const store = new MemoryGamificationStore();
      seedAchievement(store);
      seedCodeRedemptionActivity(store, scenario.activity);
      seedCodeRedemptionSchedule(store);
      const generated = seedMissionCode(store, scenario.code);
      scenario.seed?.(store);

      const result = await redemptionService(store).redeem(redemptionInput(generated.rawCode));

      expect(result.status).toBe(scenario.expected);
      expect(await store.list(GAMIFICATION_COLLECTIONS.codeRedemptions, { status: `rejected_${scenario.expected}` })).toHaveLength(1);
      expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "activity-code", status: "accepted" })).toHaveLength(
        scenario.expected === "user_limit" ? 1 : 0,
      );
      expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(0);
    }
  });

  it("rate-limits invalid attempts before any Code Definition lookup can become an oracle", async () => {
    const store = new MemoryGamificationStore();
    const limiter = new MemoryMissionCodeRateLimiter();
    const service = redemptionService(store, limiter);
    const invalidCode = "WTS26-ABCDEFGH-0123456789ABCDEFGHJKMNPQRS";

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(service.redeem(redemptionInput(invalidCode))).resolves.toMatchObject({ status: "invalid" });
    }
    await expect(service.redeem(redemptionInput(invalidCode))).resolves.toMatchObject({ status: "rate_limited" });
    expect(await store.list(GAMIFICATION_COLLECTIONS.codeRedemptions)).toHaveLength(0);
  });

  it("does not let successful scans of a shared code rate-limit other Users", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedCodeRedemptionActivity(store);
    seedCodeRedemptionSchedule(store);
    const generated = seedMissionCode(store);
    const service = redemptionService(store);

    const results = [];
    for (let attendee = 1; attendee <= 13; attendee += 1) {
      results.push(await service.redeem({
        ...redemptionInput(generated.rawCode, `user-${attendee}`),
        requestFingerprint: `request-fingerprint-${attendee}`,
      }));
    }

    expect(results.map((result) => result.status)).toEqual(Array(13).fill("accepted"));
  });
});

describe("September score schedule", () => {
  it("uses the September 0%, 5%, 15%, 30%, 50%, 75%, and 100% access thresholds", () => {
    const thresholds = { "1": 0, "2": 5, "3": 15, "4": 30, "5": 50, "6": 75, "7": 100 };

    expect(accessLevelForTotalXp(0, thresholds)).toBe(1);
    expect(accessLevelForTotalXp(5, thresholds)).toBe(2);
    expect(accessLevelForTotalXp(15, thresholds)).toBe(3);
    expect(accessLevelForTotalXp(30, thresholds)).toBe(4);
    expect(accessLevelForTotalXp(50, thresholds)).toBe(5);
    expect(accessLevelForTotalXp(75, thresholds)).toBe(6);
    expect(accessLevelForTotalXp(100, thresholds)).toBe(7);
  });

  it("uses active direct policies, group ceilings, and fixed access-level percentages", () => {
    const schedule = calculateSeptemberScoreSchedule([
      {
        key: "booth-visit",
        activityId: "activity-visit",
        active: true,
        totalXp: 5,
        leaderboardXp: 5,
        category: "booth",
        scoreDay: "2026-09-19",
        capMembership: [
          { dimension: "activity", key: "activity-visit" },
          { dimension: "related_group", key: "booth-a" },
        ],
      },
      {
        key: "booth-high-score",
        activityId: "activity-high-score",
        active: true,
        totalXp: 35,
        leaderboardXp: 25,
        category: "booth",
        scoreDay: "2026-09-19",
        capMembership: [
          { dimension: "activity", key: "activity-high-score" },
          { dimension: "related_group", key: "booth-a" },
        ],
      },
      {
        key: "session-attendance",
        activityId: "activity-session",
        active: true,
        totalXp: 20,
        leaderboardXp: 15,
        category: "session",
        scoreDay: "2026-09-19",
        capMembership: [{ dimension: "activity", key: "activity-session" }],
      },
      {
        key: "retired-policy",
        activityId: "activity-retired",
        active: false,
        totalXp: 500,
        leaderboardXp: 500,
        category: "booth",
        capMembership: [{ dimension: "activity", key: "activity-retired" }],
      },
    ]);

    expect(schedule.totalXpCeiling).toBe(55);
    expect(schedule.leaderboardXpCeiling).toBe(40);
    expect(schedule.accessLevelThresholds).toEqual({ "1": 0, "2": 3, "3": 9, "4": 17, "5": 28, "6": 42, "7": 55 });
    expect(schedule.caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "related_group", key: "booth-a", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "conference", key: "conference", totalXpCeiling: 55, leaderboardXpCeiling: 40 }),
    ]));
    expect(accessLevelForTotalXp(0, schedule.accessLevelThresholds)).toBe(1);
    expect(accessLevelForTotalXp(3, schedule.accessLevelThresholds)).toBe(2);
    expect(accessLevelForTotalXp(55, schedule.accessLevelThresholds)).toBe(7);
  });

  it("uses the highest active booth-group ceiling per sponsor and sums only distinct sponsors", () => {
    const boothPolicy = (
      key: string,
      activityId: string,
      partner: string,
      group: string,
      totalXp: number,
      leaderboardXp: number,
    ) => ({
      key,
      activityId,
      active: true,
      totalXp,
      leaderboardXp,
      category: "booth",
      scoreDay: "2026-09-19",
      capMembership: [
        { dimension: "activity" as const, key: activityId },
        { dimension: "related_group" as const, key: group },
        { dimension: "partner" as const, key: partner },
        { dimension: "category" as const, key: "booth" },
        { dimension: "conference_day" as const, key: "2026-09-19" },
        { dimension: "conference" as const, key: "conference" },
      ],
    });
    const schedule = calculateSeptemberScoreSchedule([
      boothPolicy("northstar-visit", "northstar-visit", "sponsor-northstar", "booth.northstar.demo", 5, 5),
      boothPolicy("northstar-high-score", "northstar-high-score", "sponsor-northstar", "booth.northstar.challenge", 35, 25),
      boothPolicy("orbit-high-score", "orbit-high-score", "sponsor-orbit", "booth.orbit.challenge", 35, 25),
    ]);

    expect(schedule.caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "related_group", key: "booth.northstar.demo", totalXpCeiling: 5, leaderboardXpCeiling: 5 }),
      expect.objectContaining({ dimension: "related_group", key: "booth.northstar.challenge", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "partner", key: "sponsor-northstar", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "category", key: "booth", totalXpCeiling: 70, leaderboardXpCeiling: 50 }),
      expect.objectContaining({ dimension: "conference_day", key: "2026-09-19", totalXpCeiling: 70, leaderboardXpCeiling: 50 }),
      expect.objectContaining({ dimension: "conference", key: "conference", totalXpCeiling: 70, leaderboardXpCeiling: 50 }),
    ]));
  });

  it("propagates a booth-group ceiling override to the sponsor and derived caps", () => {
    const schedule = calculateSeptemberScoreSchedule([{
      key: "northstar-win",
      activityId: "northstar-win",
      active: true,
      totalXp: 30,
      leaderboardXp: 25,
      category: "booth",
      scoreDay: "2026-09-19",
      capMembership: [
        { dimension: "activity", key: "northstar-win" },
        { dimension: "related_group", key: "booth.northstar.challenge" },
        { dimension: "partner", key: "sponsor-northstar" },
        { dimension: "category", key: "booth" },
        { dimension: "conference_day", key: "2026-09-19" },
        { dimension: "conference", key: "conference" },
      ],
      capCeilingOverrides: {
        related_group: { totalXpCeiling: 35, leaderboardXpCeiling: 25 },
      },
    }]);

    expect(schedule.caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "related_group", key: "booth.northstar.challenge", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "partner", key: "sponsor-northstar", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "category", key: "booth", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "conference_day", key: "2026-09-19", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "conference", key: "conference", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
    ]));
  });

  it("does not let a non-booth policy raise a sponsor's booth cap", () => {
    const schedule = calculateSeptemberScoreSchedule([
      {
        key: "northstar-high-score",
        activityId: "northstar-high-score",
        active: true,
        totalXp: 35,
        leaderboardXp: 25,
        category: "booth",
        scoreDay: "2026-09-19",
        capMembership: [
          { dimension: "activity", key: "northstar-high-score" },
          { dimension: "related_group", key: "booth.northstar.challenge" },
          { dimension: "partner", key: "sponsor-northstar" },
          { dimension: "category", key: "booth" },
          { dimension: "conference_day", key: "2026-09-19" },
          { dimension: "conference", key: "conference" },
        ],
      },
      {
        key: "northstar-partner-activity",
        activityId: "northstar-partner-activity",
        active: true,
        totalXp: 90,
        leaderboardXp: 90,
        category: "booth",
        scoreDay: "2026-09-19",
        capMembership: [
          { dimension: "activity", key: "northstar-partner-activity" },
          { dimension: "partner", key: "sponsor-northstar" },
          { dimension: "category", key: "booth" },
          { dimension: "conference_day", key: "2026-09-19" },
          { dimension: "conference", key: "conference" },
        ],
      },
    ]);

    expect(schedule.caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "partner", key: "sponsor-northstar", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
    ]));
  });

  it("records the configured 40/30 ceiling for a two-code event group", () => {
    const schedule = calculateSeptemberScoreSchedule([
      {
        key: "workshop-start",
        activityId: "activity-start",
        active: true,
        totalXp: 10,
        leaderboardXp: 5,
        category: "workshop",
        capMembership: [{ dimension: "related_group", key: "workshop-a" }],
        capCeilingOverrides: {
          related_group: { totalXpCeiling: 40, leaderboardXpCeiling: 30 },
        },
      },
      {
        key: "workshop-completion",
        activityId: "activity-completion",
        active: true,
        totalXp: 30,
        leaderboardXp: 25,
        category: "workshop",
        capMembership: [{ dimension: "related_group", key: "workshop-a" }],
        capCeilingOverrides: {
          related_group: { totalXpCeiling: 40, leaderboardXpCeiling: 30 },
        },
      },
    ]);

    expect(schedule.caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "related_group", key: "workshop-a", totalXpCeiling: 40, leaderboardXpCeiling: 30 }),
    ]));
  });
});

describe("Gamification Profile privacy and authorization", () => {
  it("maps an allowlisted current-User DTO without private accounting metadata", () => {
    const summary = buildGamificationProfileSummary(
      {
        id: "profile-1",
        user: "user-1",
        total_xp: 20,
        leaderboard_xp: 10,
        access_level: 2,
        access_level_threshold: 5,
        next_level_threshold: 15,
        xp_into_level: 15,
        xp_to_next_level: 0,
        unlocked_badge_count: 1,
        ops_board_visible: false,
        ops_board_display_name: "Private Agent",
        public_badges_visible: false,
        totals_version: 1,
        totals_recalculated_at: timestamp,
        created: timestamp,
        updated: timestamp,
      } as any,
      [{
        id: "badge-1",
        user: "user-1",
        achievement: "achievement-1",
        status: "unlocked",
        unlocked_at: timestamp,
        idempotency_key: "user-achievement:v1:user-1:attendance-check-in",
        public_visible: false,
        metadata: { sourceMetadata: "do not expose" },
        created: timestamp,
        updated: timestamp,
      } as any],
      [{
        id: "achievement-1",
        key: "attendance-check-in",
        badge_name: "Checked In",
        badge_description: "You arrived at WhatTheStack.",
        icon: "material-symbols:military-tech-outline",
        category: "attendance",
        rarity: "common",
        visibility: "public",
        status: "active",
        unlock_rule: { secretRule: "do not expose" },
        sort_order: 1,
        metadata: { adminNote: "do not expose" },
        created: timestamp,
        updated: timestamp,
      } as any],
    );

    expect(summary).toEqual({
      totalXp: 20,
      leaderboardXp: 10,
      accessLevel: 2,
      accessLevelLabel: "Access Level 2",
      xpIntoLevel: 15,
      xpToNextLevel: 0,
      progressPercent: 100,
      progressAvailable: false,
      repair: { state: "current", supportReference: undefined },
      opsBoard: {
        visible: false,
        displayName: "Private Agent",
        publicBadgesVisible: false,
      },
      revokedBadgeCount: 0,
      badges: [{
        id: "badge-1",
          name: "Checked In",
        description: "You arrived at WhatTheStack.",
        icon: "material-symbols:military-tech-outline",
        category: "attendance",
        rarity: "common",
        retired: false,
        publicVisible: false,
        unlockedAt: timestamp,
      }],
      lockedBadges: [],
      suggestedMissions: [],
    });
    expect(JSON.stringify(summary)).not.toContain("do not expose");
  });

  it("orders the current User's Badge DTO by most recent unlock", () => {
    const summary = buildGamificationProfileSummary({
      user: "user-1",
      total_xp: 0,
      leaderboard_xp: 0,
      access_level: 1,
      access_level_threshold: 0,
      next_level_threshold: 0,
      xp_into_level: 0,
      xp_to_next_level: 0,
      ops_board_visible: true,
      ops_board_display_name: "Agent 000001",
      public_badges_visible: true,
    } as any, [{
      id: "older-user-badge",
      user: "user-1",
      achievement: "older-badge",
      status: "unlocked",
      unlocked_at: "2026-09-18T10:00:00.000Z",
      public_visible: true,
    }, {
      id: "newer-user-badge",
      user: "user-1",
      achievement: "newer-badge",
      status: "unlocked",
      unlocked_at: "2026-09-19T10:00:00.000Z",
      public_visible: true,
    }] as any, [{
      id: "older-badge",
      badge_name: "Older Badge",
      badge_description: "Unlocked first.",
      category: "onboarding",
      rarity: "common",
      visibility: "public",
      status: "active",
    }, {
      id: "newer-badge",
      badge_name: "Newer Badge",
      badge_description: "Unlocked second.",
      category: "meta",
      rarity: "rare",
      visibility: "public",
      status: "active",
    }] as any);

    expect(summary.badges.map((badge) => badge.name)).toEqual(["Newer Badge", "Older Badge"]);
    expect(summary.badges[0].unlockedAt).toBe("2026-09-19T10:00:00.000Z");
  });

  it("shows only safe locked Badge teasers and public suggested Missions to the current User", () => {
    const profile = {
      user: "user-1",
      total_xp: 0,
      leaderboard_xp: 0,
      access_level: 1,
      access_level_threshold: 0,
      next_level_threshold: 0,
      xp_into_level: 0,
      xp_to_next_level: 0,
      ops_board_visible: true,
      ops_board_display_name: "Agent 000001",
      public_badges_visible: true,
    } as any;
    const achievement = (id: string, visibility: string, name: string, teaser?: string) => ({
      id,
      key: id,
      badge_name: name,
      badge_description: `${name} private description`,
      locked_teaser: teaser,
      category: "attendance",
      rarity: "common",
      visibility,
      status: "active",
      unlock_rule: { kind: "activity_claim" },
      sort_order: 1,
    } as any);
    const summary = buildGamificationProfileSummary(profile, [{
      id: "revoked-user-badge",
      achievement: "revoked-badge",
      status: "revoked",
    } as any], [
      achievement("public-badge", "public", "Public Badge"),
      achievement("teaser-badge", "locked_teaser", "Secret Badge Name", "A safe challenge awaits."),
      achievement("hidden-badge", "hidden_until_unlocked", "Hidden spoiler"),
      achievement("revoked-badge", "public", "Revoked Badge"),
    ], [{
      id: "mission-public",
      title: "Public Mission",
      summary: "Redeem WTS-controlled evidence.",
      visibility: "public",
      status: "active",
      suggested: true,
      sort_order: 1,
    } as any, {
      id: "mission-private",
      title: "Private Mission",
      summary: "Never suggest this.",
      visibility: "admin_only",
      status: "active",
      suggested: true,
      sort_order: 2,
    } as any]);

    expect(summary.lockedBadges).toEqual([
      expect.objectContaining({ name: "Locked Badge", teaser: "A safe challenge awaits." }),
      expect.objectContaining({ name: "Public Badge" }),
    ]);
    expect(summary.suggestedMissions).toEqual([
      { title: "Public Mission", summary: "Redeem WTS-controlled evidence.", redemptionPath: "/missions/redeem" },
    ]);
    expect(JSON.stringify(summary)).not.toContain("Hidden spoiler");
    expect(JSON.stringify(summary)).not.toContain("Private Mission");
    expect(JSON.stringify(summary)).not.toContain("Secret Badge Name");
    expect(JSON.stringify(summary)).not.toContain("Revoked Badge");
  });

  it("does not run an accounting operation before authentication succeeds", async () => {
    const operation = vi.fn();
    await expect(runAuthenticatedGamificationOperation(
      async () => { throw new Error("Unauthorized: Login required"); },
      operation,
    )).rejects.toThrow("Unauthorized: Login required");
    expect(operation).not.toHaveBeenCalled();
  });

  it("hides Meta Badge snippets whose configured sources reveal Session attendance", () => {
    const rows = buildGamificationPublicOpsBoardRows(
      [{
        id: "profile-meta",
        user: "user-1",
        total_xp: 99,
        leaderboard_xp: 30,
        access_level: 4,
        access_level_threshold: 30,
        next_level_threshold: 50,
        xp_into_level: 0,
        xp_to_next_level: 20,
        unlocked_badge_count: 1,
        ops_board_visible: true,
        ops_board_display_name: "Meta Agent",
        public_badges_visible: true,
        totals_version: 1,
        totals_recalculated_at: timestamp,
        created: timestamp,
        updated: timestamp,
      } as any],
      [{
        id: "meta-badge",
        user: "user-1",
        achievement: "meta-achievement",
        status: "unlocked",
        unlocked_at: timestamp,
        source_claim: "private-meta-claim",
        idempotency_key: "meta-badge",
        public_visible: true,
        metadata: { source_claim_ids: ["private-source-a", "private-source-b"] },
        created: timestamp,
        updated: timestamp,
      } as any],
      [{
        id: "meta-achievement",
        key: "meta-explorer",
        badge_name: "Meta Explorer",
        badge_description: "Private composition is hidden.",
        category: "meta",
        rarity: "rare",
        visibility: "public",
        status: "active",
        unlock_rule: { kind: "claim_set", activityKeys: ["private-source-a", "private-source-b"] },
        sort_order: 1,
        metadata: { cap_diagnostics: "never expose" },
        created: timestamp,
        updated: timestamp,
      } as any],
      [{
        id: "private-source-a-id",
        key: "private-source-a",
        kind: "session",
        category: "session",
        outcome_key: "attendance",
        evidence_mode: "single_code",
      } as any],
    );

    expect(rows).toEqual([{
      rank: 1,
      displayName: "Meta Agent",
      accessLevel: 4,
      leaderboardXp: 30,
      publicBadgeCount: 0,
      badges: [],
    }]);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("meta-explorer");
    expect(serialized).not.toContain("private-source");
    expect(serialized).not.toContain("never expose");
    expect(serialized).not.toContain("total_xp");
    expect(serialized).not.toContain("99");
  });

  it("supplies private source configuration when building the public ops board", async () => {
    const store = new MemoryGamificationStore();
    store.seed(GAMIFICATION_COLLECTIONS.profiles, {
      id: "profile-private-meta",
      user: "user-1",
      leaderboard_xp: 30,
      access_level: 4,
      ops_board_visible: true,
      ops_board_display_name: "Meta Agent",
      public_badges_visible: true,
    });
    store.seed(GAMIFICATION_COLLECTIONS.userAchievements, {
      id: "private-meta-badge",
      user: "user-1",
      achievement: "private-meta-achievement",
      status: "unlocked",
      public_visible: true,
    });
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "private-meta-achievement",
      key: "private-meta-achievement",
      badge_name: "Session Explorer",
      category: "meta",
      visibility: "public",
      status: "active",
      unlock_rule: { kind: "claim_set", activityKeys: ["private-session-source"] },
    });
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      id: "private-session-source-id",
      key: "private-session-source",
      kind: "session",
      category: "session",
      outcome_key: "attendance",
      evidence_mode: "single_code",
    });

    expect((await service(store).publicOpsBoard())[0]).toMatchObject({
      displayName: "Meta Agent",
      publicBadgeCount: 0,
      badges: [],
    });
  });

  it("uses default visibility, allows opt-out and back-in, and keeps private progress intact", async () => {
    const store = new MemoryGamificationStore();
    const accounting = service(store);
    const user = { id: "visible-user", name: "Visible Agent", email: "private@example.com" };
    await accounting.ensureProfile(user);

    expect(await accounting.publicOpsBoard()).toEqual([expect.objectContaining({ displayName: "Visible Agent", rank: 1 })]);

    const hidden = await accounting.updateVisibilitySettings(user, {
      opsBoardVisible: false,
      opsBoardDisplayName: "Incognito Agent",
      publicBadgesVisible: false,
    });
    expect(hidden.opsBoard).toEqual({ visible: false, displayName: "Incognito Agent", publicBadgesVisible: false });
    expect(await accounting.publicOpsBoard()).toEqual([]);

    const restored = await accounting.updateVisibilitySettings(user, {
      opsBoardVisible: true,
      opsBoardDisplayName: "Incognito Agent",
      publicBadgesVisible: false,
    });
    expect(restored.totalXp).toBe(0);
    expect(restored.opsBoard.visible).toBe(true);
    expect(await accounting.publicOpsBoard()).toEqual([expect.objectContaining({
      rank: 1,
      displayName: "Incognito Agent",
      publicBadgeCount: 0,
    })]);
  });

  it("rejects email display names and never projects persisted email-like names", async () => {
    const store = new MemoryGamificationStore();
    const accounting = service(store);
    const user = { id: "abcdef123456", email: "private@example.com" };
    await accounting.ensureProfile(user);

    await expect(accounting.updateVisibilitySettings(user, {
      opsBoardVisible: true,
      opsBoardDisplayName: "private@example.com",
      publicBadgesVisible: true,
    })).rejects.toThrow("cannot be an email address");
    await expect(accounting.updateVisibilitySettings(user, {
      opsBoardVisible: true,
      opsBoardDisplayName: createMissionCodeGeneration(missionCodePepper).rawCode.split("").join(" "),
      publicBadgesVisible: true,
    })).rejects.toThrow("cannot contain a Mission code");
    await store.update(GAMIFICATION_COLLECTIONS.profiles, "gamification_profiles-1", {
      ops_board_display_name: "another-private@example.com",
    });

    expect(await accounting.publicOpsBoard()).toEqual([expect.objectContaining({
      displayName: "Agent 123456",
    })]);
  });

  it("keeps ticket and attendance Badges out of public rows regardless of Badge visibility", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    const accounting = service(store);
    const user = { id: "user-1", name: "Ada" };
    await accounting.ensureProfile(user);
    const badge = (await accounting.unlockBadge(user.id, "achievement-1"))!;

    expect((await accounting.publicOpsBoard())[0]).toMatchObject({ publicBadgeCount: 0, badges: [] });
    const summary = await accounting.updateBadgeVisibility(user, badge.id, false);
    expect(summary.badges[0]).toMatchObject({ id: badge.id, publicVisible: false });
    expect((await accounting.publicOpsBoard())[0]).toMatchObject({ publicBadgeCount: 0, badges: [] });

    await accounting.updateBadgeVisibility(user, badge.id, true);
    await accounting.updateVisibilitySettings(user, {
      opsBoardVisible: true,
      opsBoardDisplayName: "Ada",
      publicBadgesVisible: false,
    });
    expect((await accounting.publicOpsBoard())[0]).toMatchObject({ publicBadgeCount: 0, badges: [] });
  });

  it("shows only unlocked, explicitly public snippets from privacy-safe categories", () => {
    const profile = {
      id: "profile-1",
      user: "user-1",
      total_xp: 99,
      leaderboard_xp: 20,
      access_level: 3,
      access_level_threshold: 0,
      next_level_threshold: 0,
      xp_into_level: 0,
      xp_to_next_level: 0,
      unlocked_badge_count: 4,
      ops_board_visible: true,
      ops_board_display_name: "Ada",
      public_badges_visible: true,
      totals_version: 1,
      totals_recalculated_at: timestamp,
      created: timestamp,
      updated: timestamp,
    } as any;
    const achievement = (id: string, key: string, visibility: string, status: string) => ({
      id,
      key,
      badge_name: key,
      badge_description: "Private source details are never public.",
      category: "meta",
      rarity: "common",
      visibility,
      status,
      unlock_rule: { private: "rule" },
      sort_order: 1,
      metadata: { private: "metadata" },
      created: timestamp,
      updated: timestamp,
    } as any);
    const badge = (id: string, achievementId: string, status: "unlocked" | "revoked", publicVisible = true) => ({
      id,
      user: "user-1",
      achievement: achievementId,
      status,
      unlocked_at: timestamp,
      idempotency_key: id,
      public_visible: publicVisible,
      metadata: { private: "source" },
      created: timestamp,
      updated: timestamp,
    } as any);

    const [row] = buildGamificationPublicOpsBoardRows(
      [profile],
      [
        badge("public-badge", "public", "unlocked"),
        badge("hidden-badge", "hidden", "unlocked"),
        badge("retired-badge", "retired", "unlocked"),
        badge("private-badge", "private", "unlocked", false),
        badge("revoked-badge", "revoked", "revoked"),
      ],
      [
        achievement("public", "Public Badge", "public", "active"),
        achievement("hidden", "Hidden Badge", "hidden_until_unlocked", "active"),
        achievement("retired", "Retired Badge", "public", "retired"),
        achievement("private", "Private Badge", "public", "active"),
        achievement("revoked", "Revoked Badge", "public", "active"),
      ],
    );

    expect(row).toMatchObject({ publicBadgeCount: 2 });
    expect(row.badges.map((item) => item.name)).toEqual(["Public Badge", "Retired Badge"]);
    expect(JSON.stringify(row)).not.toContain("Private source");
    expect(JSON.stringify(row)).not.toContain("metadata");
  });

  it("keeps the public ops-board DTO allowlisted and uses competition ranks for ties", () => {
    const profile = (id: string, leaderboardXp: number, displayName: string, totalXp: number) => ({
      id,
      user: `user-${id}`,
      total_xp: totalXp,
      leaderboard_xp: leaderboardXp,
      access_level: totalXp > 1 ? 7 : 1,
      access_level_threshold: 0,
      next_level_threshold: 0,
      xp_into_level: 0,
      xp_to_next_level: 0,
      unlocked_badge_count: 99,
      ops_board_visible: true,
      ops_board_display_name: displayName,
      public_badges_visible: true,
      totals_version: 1,
      totals_recalculated_at: timestamp,
      created: timestamp,
      updated: timestamp,
    } as any);
    const rows = buildGamificationPublicOpsBoardRows([
      profile("bravo", 10, "Bravo", 999),
      profile("alpha", 10, "Alpha", 1),
      profile("charlie", 5, "Charlie", 500),
    ], [], []);

    expect(rows.map((row) => [row.displayName, row.rank, row.leaderboardXp])).toEqual([
      ["Alpha", 1, 10],
      ["Bravo", 1, 10],
      ["Charlie", 3, 5],
    ]);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "accessLevel",
      "badges",
      "displayName",
      "leaderboardXp",
      "publicBadgeCount",
      "rank",
    ]);
  });

  it("excludes voided, total-only, manual, and cap-exhausted XP from cached leaderboard totals", () => {
    const profile = rebuildGamificationProfile(
      { access_level: 1 },
      [
        { amount: 20, leaderboard_amount: 20, voided: false },
        { amount: 10, leaderboard_amount: 0, voided: false, category: "ticketing" },
        { amount: 10, leaderboard_amount: 0, voided: false, category: "easter_egg" },
        { amount: 20, leaderboard_amount: 0, voided: false, source_type: "admin_correction" },
        { amount: 100, leaderboard_amount: 100, voided: true },
        { amount: 5, leaderboard_amount: 0, voided: false },
      ] as any,
      [],
      { "1": 0 },
    );

    expect(profile).toMatchObject({ totalXp: 65, leaderboardXp: 20 });
  });

  it("reads the ops board from refreshed profile cache rather than ledger events", async () => {
    const store = new MemoryGamificationStore();
    const accounting = service(store);
    await accounting.ensureProfile({ id: "agent-a", name: "Agent A" });
    await accounting.ensureProfile({ id: "agent-b", name: "Agent B" });
    store.seed(GAMIFICATION_COLLECTIONS.xpEvents, {
      id: "agent-a-xp",
      user: "agent-a",
      amount: 25,
      leaderboard_amount: 25,
      category: "attendance",
      reason: "Cached only after rebuild",
      source_type: "activity_claim",
      idempotency_key: "agent-a-xp",
      occurred_at: timestamp,
      voided: false,
      created: timestamp,
      updated: timestamp,
    });

    expect((await accounting.publicOpsBoard()).map((row) => [row.displayName, row.rank, row.leaderboardXp])).toEqual([
      ["Agent A", 1, 0],
      ["Agent B", 1, 0],
    ]);
    await accounting.rebuildProfile({ id: "agent-a" });
    expect((await accounting.publicOpsBoard()).map((row) => [row.displayName, row.rank, row.leaderboardXp])).toEqual([
      ["Agent A", 1, 25],
      ["Agent B", 2, 0],
    ]);
  });
});

const adminActor = { id: "admin-1", role: "admin" as const };

function operationService(store: MemoryGamificationStore): GamificationOperationsService {
  return new GamificationOperationsService(store, missionCodePepper, () => timestamp);
}

function seedEasterEggDraftSchedule(store: MemoryGamificationStore, id = "easter-egg-schedule"): void {
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
    id,
    key: id,
    status: "draft",
    effective_at: "2026-09-01T00:00:00.000Z",
    total_xp_ceiling: 0,
    leaderboard_xp_ceiling: 0,
    access_level_thresholds: {},
    created: timestamp,
    updated: timestamp,
  });
}

function easterEggDraftInput(eggKey: string, operationId: string, scheduleId = "easter-egg-schedule") {
  return {
    eggKey,
    missionTitle: "A quiet signal found",
    missionSummary: "You noticed one of the details hidden around WhatTheStack.",
    badgeName: "Signal Finder",
    badgeDescription: "You found a hidden WTS signal.",
    badgeIcon: "material-symbols:radar",
    badgeRarity: "rare" as const,
    evidenceChannel: "wts_qr" as const,
    deploymentNote: "WTS-controlled static sign in an attendee-safe public area; no access restrictions or equipment interaction.",
    activeFrom: "2026-09-01T00:00:00.000Z",
    activeUntil: "2026-09-30T23:59:59.000Z",
    maxClaims: 100,
    scoreScheduleId: scheduleId,
    sortOrder: 10,
    operationId,
  };
}

async function activateEasterEggDefinitions(
  store: MemoryGamificationStore,
  configured: Awaited<ReturnType<GamificationOperationsService["saveEasterEggMissionDraft"]>>,
  suffix: string,
): Promise<void> {
  const operations = operationService(store);
  await operations.activateDefinition("achievement", {
    id: configured.achievement.id,
    reason: "Publish spoiler-safe Easter Egg Badge",
    confirmation: true,
    operationId: `activate-easter-achievement-${suffix}`,
  }, adminActor);
  await operations.activateDefinition("mission", {
    id: configured.mission.id,
    reason: "Open hidden Easter Egg Mission",
    confirmation: true,
    operationId: `activate-easter-mission-${suffix}`,
  }, adminActor);
  await operations.activateDefinition("activity", {
    id: configured.activity.id,
    reason: "Accept safe static discovery evidence",
    confirmation: true,
    operationId: `activate-easter-activity-${suffix}`,
  }, adminActor);
}

function seedSessionAttendanceFixture(
  store: MemoryGamificationStore,
  overrides: {
    activity?: Record<string, unknown>;
    caps?: Array<Record<string, unknown>>;
  } = {},
): void {
  store.seed("sessions", {
    id: "session-1",
    slug: "immutable-session-slug",
    title: "Private source Session title",
    abstract: "Public abstract",
    published: true,
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.achievements, {
    id: "session-badge",
    key: "session-attendance-badge",
    badge_name: "Session Participant",
    badge_description: "Safe Session Badge presentation.",
    category: "session",
    rarity: "common",
    visibility: "public",
    status: "active",
    unlock_rule: { kind: "activity_claim", activityKeys: ["session.platform-design.attendance"] },
    sort_order: 1,
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.missions, {
    id: "session-mission",
    key: "session.platform-design",
    slug: "session-platform-design",
    title: "Mission-safe title",
    summary: "Mission-safe summary.",
    category: "session",
    visibility: "public",
    status: "active",
    starts_at: "2026-09-01T00:00:00.000Z",
    ends_at: "2026-09-02T00:00:00.000Z",
    primary_achievement: "session-badge",
    session: "session-1",
    suggested: true,
    sort_order: 1,
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.activities, {
    id: "session-activity",
    key: "session.platform-design.attendance",
    mission: "session-mission",
    kind: "session",
    category: "session",
    outcome_key: "attendance",
    evidence_mode: "single_code",
    evidence_channel: "wts_qr",
    deployment_label: "WTS stage screen",
    achievement: "session-badge",
    session: "session-1",
    session_key: "platform-design",
    session_display_snapshot: { title: "Private source Session title", slug: "immutable-session-slug", format: "Talk" },
    session_meta_eligible: true,
    per_user_claim_limit: 1,
    max_claims: 100,
    active_from: "2026-09-01T00:00:00.000Z",
    active_until: "2026-09-02T00:00:00.000Z",
    status: "active",
    enabled: true,
    created: timestamp,
    updated: timestamp,
    ...overrides.activity,
  });
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
    id: "session-schedule",
    key: "session-score-schedule",
    status: "active",
    effective_at: "2026-09-01T00:00:00.000Z",
    total_xp_ceiling: 20,
    leaderboard_xp_ceiling: 15,
    access_level_thresholds: { "1": 0 },
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
    id: "session-policy",
    schedule: "session-schedule",
    activity: "session-activity",
    policy_key: "session.platform-design.attendance",
    active: true,
    total_xp: 20,
    leaderboard_xp: 15,
    cap_membership: [
      { dimension: "activity", key: "session-activity" },
      { dimension: "category", key: "session" },
      { dimension: "conference_day", key: "2026-09-01" },
      { dimension: "conference", key: "conference" },
    ],
    score_day: "2026-09-01",
    created: timestamp,
    updated: timestamp,
  });
  const caps = overrides.caps || [
    { id: "session-activity-cap", dimension: "activity", cap_key: "session-activity" },
    { id: "session-category-cap", dimension: "category", cap_key: "session" },
    { id: "session-day-cap", dimension: "conference_day", cap_key: "2026-09-01" },
    { id: "session-conference-cap", dimension: "conference", cap_key: "conference" },
  ];
  for (const cap of caps) {
    store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
      schedule: "session-schedule",
      member_policy_keys: ["session.platform-design.attendance"],
      total_xp_ceiling: 20,
      leaderboard_xp_ceiling: 15,
      ...cap,
      created: timestamp,
      updated: timestamp,
    });
  }
}

function seedSessionMissionCode(
  store: MemoryGamificationStore,
  id: string,
  overrides: Record<string, unknown> = {},
) {
  const generated = createMissionCodeGeneration(missionCodePepper);
  store.seed(GAMIFICATION_COLLECTIONS.codes, {
    id,
    key: id,
    label: "Session deployment label",
    activity: "session-activity",
    lookup_prefix: generated.definition.lookupPrefix,
    code_hash: generated.definition.codeHash,
    hash_version: generated.definition.hashVersion,
    evidence_role: "single",
    status: "active",
    enabled: true,
    per_user_limit: 1,
    total_redemptions_cached: 0,
    created_by: "admin-1",
    created: timestamp,
    updated: timestamp,
    ...overrides,
  });
  return generated;
}

describe("configured workshop and surrounding-event Missions", () => {
  it("configures a complete immutable one-code event reference without requiring a host partner", async () => {
    const store = new MemoryGamificationStore();
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "configured-attendance-badge",
      key: "workshop.platform-lab.attendance",
      badge_name: "Platform Lab attendee",
      badge_description: "Attended the configured event.",
      category: "workshop",
      rarity: "common",
      visibility: "public",
      status: "draft",
      unlock_rule: { kind: "activity_claim", activityKeys: ["workshop.platform-lab.attendance"] },
      active_from: configuredEventRef.startsAt,
      active_until: configuredEventRef.endsAt,
      sort_order: 1,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      id: "configured-event-draft-schedule",
      key: "configured-event-draft",
      status: "draft",
      effective_at: "2026-09-01T00:00:00.000Z",
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
      access_level_thresholds: {},
      created: timestamp,
      updated: timestamp,
    });

    const saved = await operationService(store).saveConfiguredEventMissionDraft({
      eventKey: "platform-lab",
      kind: "workshop",
      title: "Platform Lab",
      missionTitle: "Attend Platform Lab",
      summary: "Redeem the official WTS attendance code.",
      visibility: "hidden_until_unlocked",
      locationLabel: "Workshop room A",
      capGroupKey: "platform-lab-group",
      flow: "one_code",
      relatedEventTwoCodeApproved: false,
      suggested: true,
      evidenceChannel: "wts_qr",
      attendanceDeploymentLabel: "WTS room entrance sign",
      activeFrom: configuredEventRef.startsAt,
      activeUntil: configuredEventRef.endsAt,
      perUserClaimLimit: 1,
      maxClaims: 100,
      attendanceAchievementId: "configured-attendance-badge",
      metaEligible: true,
      scoreScheduleId: "configured-event-draft-schedule",
      scoreDay: "2026-09-01",
      sortOrder: 5,
      operationId: "configure-platform-lab",
    }, adminActor);

    expect(saved).toMatchObject({
      mission: {
        key: "workshop.platform-lab",
        visibility: "hidden_until_unlocked",
        suggested: false,
        partnerId: undefined,
        eventRef: {
          eventKey: "platform-lab",
          kind: "workshop",
          title: "Platform Lab",
          startsAt: configuredEventRef.startsAt,
          endsAt: configuredEventRef.endsAt,
          visibility: "hidden_until_unlocked",
          locationLabel: "Workshop room A",
        },
      },
      activities: [{
        key: "workshop.platform-lab.attendance",
        evidenceMode: "single_code",
        evidenceChannel: "wts_qr",
        deploymentLabel: "WTS room entrance sign",
        eventMetaEligible: true,
      }],
    });
    expect(saved.activities[0].scorePolicies).toEqual([
      expect.objectContaining({
        totalXp: 30,
        leaderboardXp: 25,
        capMembership: expect.arrayContaining([
          { dimension: "activity", key: saved.activities[0].id },
          { dimension: "related_group", key: "platform-lab-group" },
          { dimension: "category", key: "workshop" },
          { dimension: "conference_day", key: "2026-09-01" },
          { dimension: "conference", key: "conference" },
        ]),
      }),
    ]);
    await operationService(store).activateDefinition("mission", {
      id: saved.mission.id,
      reason: "Publish configured event Mission",
      confirmation: true,
      operationId: "activate-platform-lab-mission",
    }, adminActor);
    await operationService(store).activateDefinition("activity", {
      id: saved.activities[0].id,
      reason: "Enable official local event evidence",
      confirmation: true,
      operationId: "activate-platform-lab-attendance",
    }, adminActor);
    const codeInput = {
      activityId: saved.activities[0].id,
      label: "Platform Lab entrance",
      quantity: 1,
      evidenceRole: "single" as const,
      startsAt: configuredEventRef.startsAt,
      endsAt: configuredEventRef.endsAt,
      maxRedemptions: 100,
      perUserLimit: 1,
      operationId: "platform-lab-code",
    };
    await expect(operationService(store).generateCodes(codeInput, adminActor)).rejects.toThrow("linked configured event Badge");
    await operationService(store).activateDefinition("achievement", {
      id: "configured-attendance-badge",
      reason: "Enable configured attendance Badge",
      confirmation: true,
      operationId: "activate-platform-lab-badge",
    }, adminActor);
    await expect(operationService(store).generateCodes(codeInput, adminActor)).rejects.toThrow("score schedule");
    const schedule = await operationService(store).activateScoreSchedule("configured-event-draft-schedule", {
      id: "configured-event-draft-schedule",
      reason: "Activate configured event score caps",
      confirmation: true,
      operationId: "activate-platform-lab-schedule",
    }, adminActor);
    expect(schedule).toMatchObject({ totalXpCeiling: 30, leaderboardXpCeiling: 25 });
    await expect(operationService(store).generateCodes(codeInput, adminActor)).resolves.toMatchObject({
      batch: { activityId: saved.activities[0].id, secretsAvailable: true },
    });
    expect(await store.list(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, { schedule: "configured-event-draft-schedule" })).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "related_group", cap_key: "platform-lab-group", total_xp_ceiling: 30, leaderboard_xp_ceiling: 25 }),
      expect.objectContaining({ dimension: "category", cap_key: "workshop" }),
      expect.objectContaining({ dimension: "conference_day", cap_key: "2026-09-01" }),
      expect.objectContaining({ dimension: "conference", cap_key: "conference" }),
    ]));
    expect(JSON.stringify(await operationService(store).operations())).not.toContain("timeline_events");
  });

  it("requires explicit approval for a two-code non-workshop event and registers only its completion outcome for Meta", async () => {
    const store = new MemoryGamificationStore();
    for (const achievement of [
      {
        id: "warmup-attendance-badge",
        key: "warmup.community-warmup.attendance",
        badge_name: "Warmup attendee",
        unlock_rule: { kind: "activity_claim", activityKeys: ["warmup.community-warmup.start"] },
      },
      {
        id: "warmup-completion-badge",
        key: "warmup.community-warmup.completion",
        badge_name: "Warmup completed",
        unlock_rule: { kind: "claim_set", activityKeys: ["warmup.community-warmup.start", "warmup.community-warmup.finish"] },
      },
    ]) {
      store.seed(GAMIFICATION_COLLECTIONS.achievements, {
        ...achievement,
        badge_description: "Configured Badge",
        category: "warmup_event",
        rarity: "common",
        visibility: "public",
        status: "active",
        active_from: configuredEventRef.startsAt,
        active_until: configuredEventRef.endsAt,
        sort_order: 1,
        created: timestamp,
        updated: timestamp,
      });
    }
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      id: "warmup-draft-schedule", key: "warmup-draft", status: "draft", effective_at: timestamp, total_xp_ceiling: 0, leaderboard_xp_ceiling: 0, access_level_thresholds: {}, created: timestamp, updated: timestamp,
    });
    const input = {
      eventKey: "community-warmup",
      kind: "warmup" as const,
      title: "Community Warmup",
      missionTitle: "Complete the Community Warmup",
      summary: "Use both official WTS event codes.",
      visibility: "public" as const,
      locationLabel: "Community hall",
      capGroupKey: "community-warmup-group",
      flow: "two_code" as const,
      relatedEventTwoCodeApproved: false,
      suggested: true,
      evidenceChannel: "wts_link" as const,
      attendanceDeploymentLabel: "WTS check-in page",
      finishDeploymentLabel: "WTS completion page",
      activeFrom: configuredEventRef.startsAt,
      activeUntil: configuredEventRef.endsAt,
      perUserClaimLimit: 1,
      maxClaims: 100,
      attendanceAchievementId: "warmup-attendance-badge",
      completionAchievementId: "warmup-completion-badge",
      metaEligible: true,
      scoreScheduleId: "warmup-draft-schedule",
      scoreDay: "2026-09-01",
      sortOrder: 6,
      operationId: "configure-community-warmup",
    };

    await expect(operationService(store).saveConfiguredEventMissionDraft(input, adminActor)).rejects.toThrow("explicit organizer approval");
    const saved = await operationService(store).saveConfiguredEventMissionDraft({
      ...input,
      relatedEventTwoCodeApproved: true,
      operationId: "configure-community-warmup-approved",
    }, adminActor);

    expect(saved.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceMode: "two_code_start", eventMetaEligible: false }),
      expect.objectContaining({ evidenceMode: "two_code_finish", eventMetaEligible: false }),
      expect.objectContaining({ evidenceMode: "derived_claim_set", eventMetaEligible: true }),
    ]));
    const completion = saved.activities.find((activity) => activity.evidenceMode === "derived_claim_set")!;
    expect(completion.scorePolicies).toEqual([
      expect.objectContaining({
        totalXp: 30,
        leaderboardXp: 25,
        capCeilingOverrides: { related_group: { total_xp_ceiling: 40, leaderboard_xp_ceiling: 30 } },
      }),
    ]);
  });

  it("awards one-code attendance once across QR, link, manual entry, and a reissued code", async () => {
    const store = new MemoryGamificationStore();
    const codes = seedConfiguredEventFixture(store);
    const replacement = seedConfiguredEventCode(store, "event-reissued-code", "event-attendance", "single");
    await store.update(GAMIFICATION_COLLECTIONS.codes, "event-reissued-code", { reissued_from: "event-single-code" });
    const redemption = redemptionService(store);

    const qr = await redemption.redeem({ ...redemptionInput(codes.single!.rawCode), sourceHint: "qr" });
    const link = await redemption.redeem({ ...redemptionInput(codes.single!.rawCode), sourceHint: "link" });
    await store.update(GAMIFICATION_COLLECTIONS.codes, "event-single-code", { status: "disabled", enabled: false, invalidated_at: timestamp });
    const manual = await redemption.redeem({ ...redemptionInput(replacement.rawCode), sourceHint: "manual" });

    expect(qr).toMatchObject({ status: "accepted", xpAwarded: 30, leaderboardXpAwarded: 25, badges: [expect.objectContaining({ name: "Platform Lab attendee" })] });
    expect(link.status).toBe("already_redeemed");
    expect(manual.status).toBe("user_limit");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "event-attendance", status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual([expect.objectContaining({ amount: 30, leaderboard_amount: 25 })]);
  });

  it("time-boxes local event codes to the independent Activity operating window", async () => {
    for (const scenario of [
      { activity: { active_from: "2026-09-01T12:30:00.000Z" }, expected: "not_yet_active" },
      { activity: { active_until: "2026-09-01T11:30:00.000Z" }, expected: "expired" },
    ] as const) {
      const store = new MemoryGamificationStore();
      const codes = seedConfiguredEventFixture(store);
      await store.update(GAMIFICATION_COLLECTIONS.activities, "event-attendance", scenario.activity);

      const result = await redemptionService(store).redeem(redemptionInput(codes.single!.rawCode));

      expect(result.status).toBe(scenario.expected);
      expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
      expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toHaveLength(0);
      expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(0);
    }
  });

  it("disables existing local event codes when the configured Mission is retired", async () => {
    const store = new MemoryGamificationStore();
    const codes = seedConfiguredEventFixture(store);

    await operationService(store).retireDefinition("mission", {
      id: "event-mission",
      reason: "Event was cancelled",
      confirmation: true,
      operationId: "retire-cancelled-platform-lab",
    }, adminActor);
    const result = await redemptionService(store).redeem(redemptionInput(codes.single!.rawCode));

    expect(result.status).toBe("disabled");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(0);
  });

  it("keeps finish-only at 0/0 and derives completion after both claims in either order", async () => {
    for (const order of ["start-first", "finish-first"] as const) {
      const store = new MemoryGamificationStore();
      const codes = seedConfiguredEventFixture(store, { flow: "two_code" });
      const redemption = redemptionService(store);
      const firstCode = order === "start-first" ? codes.start! : codes.finish!;
      const secondCode = order === "start-first" ? codes.finish! : codes.start!;

      const first = await redemption.redeem(redemptionInput(firstCode.rawCode));
      const beforeCompletion = await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_derived", status: "accepted" });
      const second = await redemption.redeem(redemptionInput(secondCode.rawCode));
      const repeatedSecond = await redemption.redeem(redemptionInput(secondCode.rawCode));

      expect(first).toMatchObject(order === "start-first"
        ? { status: "accepted", xpAwarded: 10, leaderboardXpAwarded: 5, badges: [expect.objectContaining({ name: "Platform Lab attendee" })] }
        : { status: "accepted", xpAwarded: 0, leaderboardXpAwarded: 0, badges: undefined });
      expect(beforeCompletion).toHaveLength(0);
      expect(second).toMatchObject(order === "start-first"
        ? { status: "accepted", xpAwarded: 30, leaderboardXpAwarded: 25, badges: [expect.objectContaining({ name: "Platform Lab completed" })] }
        : { status: "accepted", xpAwarded: 40, leaderboardXpAwarded: 30, badges: expect.arrayContaining([expect.objectContaining({ name: "Platform Lab completed" })]) });
      expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_derived", status: "accepted" })).toHaveLength(1);
      expect(repeatedSecond).toMatchObject({
        status: "already_redeemed",
        xpAwarded: 0,
        leaderboardXpAwarded: 0,
      });
      expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual(expect.arrayContaining([
        expect.objectContaining({ amount: 10, leaderboard_amount: 5 }),
        expect.objectContaining({ amount: 30, leaderboard_amount: 25 }),
      ]));
      expect((await service(store).rebuildProfile({ id: "user-1" }))).toMatchObject({ total_xp: 40, leaderboard_xp: 30 });
    }
  });

  it("applies related-group, category, day, and conference caps independently while retaining claims and Badges", async () => {
    const store = new MemoryGamificationStore();
    const codes = seedConfiguredEventFixture(store, {
      flow: "two_code",
      categoryCap: { total: 35, leaderboard: 27 },
      dayCap: { total: 38, leaderboard: 29 },
      conferenceCap: { total: 39, leaderboard: 30 },
    });
    const redemption = redemptionService(store);

    await redemption.redeem(redemptionInput(codes.start!.rawCode));
    const completed = await redemption.redeem(redemptionInput(codes.finish!.rawCode));
    const completionClaim = await store.findOne<any>(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "event-completion", status: "accepted" });

    expect(completed).toMatchObject({ status: "accepted", xpAwarded: 25, leaderboardXpAwarded: 22 });
    expect(completionClaim.cap_outcome.applied_caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "related_group:platform-lab-group" }),
      expect.objectContaining({ key: "category:workshop" }),
      expect.objectContaining({ key: "conference_day:2026-09-01" }),
      expect.objectContaining({ key: "conference:conference" }),
    ]));
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "event-completion-badge", status: "unlocked" })).toHaveLength(1);
    expect((await service(store).rebuildProfile({ id: "user-1" }))).toMatchObject({ total_xp: 35, leaderboard_xp: 27 });
  });

  it("registers the configured event completion with the shared Meta evaluator", async () => {
    const store = new MemoryGamificationStore();
    const codes = seedConfiguredEventFixture(store, { flow: "two_code" });
    seedMetaSourceActivity(store, "conference-checkin", "conference.main.checked_in", { kind: "hievents", category: "attendance" });
    store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
      id: "conference-checkin-claim", user: "user-1", activity: "conference-checkin", source_type: "hievents_checkin", outcome_key: "checked_in", status: "accepted", occurred_at: timestamp, claimed_at: timestamp, evidence_fingerprint: "conference-checkin", idempotency_key: "conference-checkin", cap_outcome: { awarded_total_xp: 0, awarded_leaderboard_xp: 0 }, created: timestamp, updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "event-circuit-badge", key: "event-circuit", badge_name: "Event circuit", badge_description: "Completed the selected circuit.", category: "meta", rarity: "rare", visibility: "public", status: "active", unlock_rule: { kind: "claim_set", activityKeys: ["conference.main.checked_in", "workshop.platform-lab.completion"] }, active_from: configuredEventRef.startsAt, active_until: configuredEventRef.endsAt, sort_order: 3, created: timestamp, updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      id: "event-circuit-activity", key: "meta.event-circuit", kind: "meta", category: "meta", outcome_key: "meta", evidence_mode: "meta_rule", achievement: "event-circuit-badge", per_user_claim_limit: 1, status: "active", enabled: true, active_from: configuredEventRef.startsAt, active_until: configuredEventRef.endsAt, created: timestamp, updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "event-circuit-policy", schedule: "event-schedule", activity: "event-circuit-activity", policy_key: "meta.event-circuit", active: true, total_xp: 20, leaderboard_xp: 15, cap_membership: [{ dimension: "activity", key: "event-circuit-activity" }], created: timestamp, updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
      id: "event-circuit-cap", schedule: "event-schedule", dimension: "activity", cap_key: "event-circuit-activity", member_policy_keys: ["meta.event-circuit"], total_xp_ceiling: 20, leaderboard_xp_ceiling: 15, created: timestamp, updated: timestamp,
    });

    await redemptionService(store).redeem(redemptionInput(codes.finish!.rawCode));
    await redemptionService(store).redeem(redemptionInput(codes.start!.rawCode));
    const repeatedStart = await redemptionService(store).redeem(redemptionInput(codes.start!.rawCode));

    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_meta", status: "accepted" })).toEqual([
      expect.objectContaining({ activity: "event-circuit-activity" }),
    ]);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "event-circuit-badge", status: "unlocked" })).toHaveLength(1);
    expect(repeatedStart).toMatchObject({ status: "already_redeemed", xpAwarded: 0, leaderboardXpAwarded: 0 });
  });

  it("isolates Agenda and Hi.Events state and keeps public redemption DTOs free of event operations data", async () => {
    const store = new MemoryGamificationStore();
    const codes = seedConfiguredEventFixture(store);
    store.seed("agenda_slots", {
      id: "event-agenda-slot", day: "day-1", start_at: configuredEventRef.startsAt, end_at: configuredEventRef.endsAt, kind: "other", title: "Platform Lab", published: true, display_order: 1, created: timestamp, updated: timestamp,
    });
    await expect(service(store).recordActivityAward({
      claim: {
        user: "user-1",
        activity: "event-attendance",
        sourceType: "code_redemption",
        outcomeKey: "attendance",
        occurredAt: timestamp,
        evidenceFingerprint: "event-agenda-slot",
        idempotencyKey: "event-agenda-slot",
      },
    })).rejects.toThrow("verified WTS Mission code redemption evidence");
    const previousUrl = process.env.HIEVENTS_API_URL;
    const previousEventId = process.env.HIEVENTS_EVENT_ID;
    process.env.HIEVENTS_API_URL = "https://unavailable.hievents.invalid";
    process.env.HIEVENTS_EVENT_ID = "unavailable-main-event";
    const sourceFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Hi.Events unavailable"));
    try {
      const result = await redemptionService(store).redeem(redemptionInput(codes.single!.rawCode));
      const serialized = JSON.stringify(result);
      const adminDto = JSON.stringify(await operationService(store).operations());
      expect(result.status).toBe("accepted");
      expect(serialized).not.toContain("Workshop room A");
      expect(serialized).not.toContain("WTS single_code sign");
      expect(serialized).not.toContain("privateInventoryNote");
      expect(serialized).not.toContain("never expose event secret");
      expect(serialized).not.toContain("event_ref");
      expect(adminDto).toContain("Workshop room A");
      expect(adminDto).toContain("WTS single_code sign");
      expect(adminDto).not.toContain("privateInventoryNote");
      expect(adminDto).not.toContain("never expose event secret");
      expect(adminDto).not.toContain(codes.single!.rawCode);
      expect(sourceFetch).not.toHaveBeenCalled();
    } finally {
      sourceFetch.mockRestore();
      if (previousUrl === undefined) delete process.env.HIEVENTS_API_URL;
      else process.env.HIEVENTS_API_URL = previousUrl;
      if (previousEventId === undefined) delete process.env.HIEVENTS_EVENT_ID;
      else process.env.HIEVENTS_EVENT_ID = previousEventId;
    }
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "event-attendance", status: "accepted" })).toHaveLength(1);
  });
});

describe("Session attendance Missions", () => {
  it("uses Agenda Slot data only as configuration context and preserves the independent Activity window", async () => {
    const store = new MemoryGamificationStore();
    store.seed("sessions", {
      id: "session-1",
      slug: "public-session-slug",
      title: "Published Session",
      abstract: "Public abstract",
      format: "Talk",
      published: true,
      created: timestamp,
      updated: timestamp,
    });
    store.seed("conference_days", {
      id: "day-1", key: "main-day", local_date: "2026-09-19", title: "Main day", display_order: 1, published: true, created: timestamp, updated: timestamp,
    });
    store.seed("agenda_slots", {
      id: "slot-1", day: "day-1", start_at: "2026-09-19T08:00:00.000Z", end_at: "2026-09-19T09:00:00.000Z", kind: "session", published: true, display_order: 1, session: "session-1", created: timestamp, updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "session-badge", key: "session-badge", badge_name: "Session Badge", badge_description: "Badge", category: "session", rarity: "common", visibility: "public", status: "active", unlock_rule: { kind: "activity_claim", activityKeys: ["session.platform-design.attendance"] }, sort_order: 1, created: timestamp, updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      id: "session-draft-schedule", key: "session-draft", status: "draft", effective_at: timestamp, total_xp_ceiling: 0, leaderboard_xp_ceiling: 0, access_level_thresholds: {}, created: timestamp, updated: timestamp,
    });
    const operations = operationService(store);

    const before = await operations.operations();
    expect(before.references.sessions).toEqual([expect.objectContaining({
      id: "session-1",
      scheduleContext: { slotId: "slot-1", startAt: "2026-09-19T08:00:00.000Z", endAt: "2026-09-19T09:00:00.000Z", dayDate: "2026-09-19" },
    })]);
    const saved = await operations.saveSessionAttendanceMissionDraft({
      sessionId: "session-1",
      sessionKey: "platform-design",
      title: "Attend Platform Design",
      summary: "Redeem the official WTS code.",
      visibility: "public",
      evidenceChannel: "wts_qr",
      deploymentLabel: "WTS hall screen",
      activeFrom: "2026-09-19T10:15:00.000Z",
      activeUntil: "2026-09-19T10:45:00.000Z",
      perUserClaimLimit: 1,
      maxClaims: 80,
      achievementId: "session-badge",
      metaEligible: true,
      scoreScheduleId: "session-draft-schedule",
      scoreDay: "2026-09-19",
      sortOrder: 3,
      reason: "Configure selected Session attendance",
      operationId: "configure-session-platform-design",
    }, adminActor);

    expect(saved).toMatchObject({
      mission: { key: "session.platform-design", sessionId: "session-1" },
      activity: {
        key: "session.platform-design.attendance",
        sessionId: "session-1",
        sessionKey: "platform-design",
        activeFrom: "2026-09-19T10:15:00.000Z",
        activeUntil: "2026-09-19T10:45:00.000Z",
        sessionDisplaySnapshot: { title: "Published Session", slug: "public-session-slug", format: "Talk" },
        sessionMetaEligible: true,
      },
    });
    const activity = await store.getById<any>(GAMIFICATION_COLLECTIONS.activities, saved.activity.id);
    expect(activity.session_display_snapshot).not.toHaveProperty("startAt");
    expect(activity.session_display_snapshot).not.toHaveProperty("endAt");
    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions, { action: "configuration_change" })).toEqual([
      expect.objectContaining({
        status: "applied",
        related_collection: GAMIFICATION_COLLECTIONS.activities,
        related_record_id: "session.platform-design.attendance",
      }),
    ]);
    await store.update("agenda_slots", "slot-1", {
      start_at: "2026-09-19T14:00:00.000Z",
      end_at: "2026-09-19T15:00:00.000Z",
      published: false,
    });

    expect(await store.getById<any>(GAMIFICATION_COLLECTIONS.activities, saved.activity.id)).toMatchObject({
      active_from: "2026-09-19T10:15:00.000Z",
      active_until: "2026-09-19T10:45:00.000Z",
    });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toHaveLength(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(0);
  });

  it("keeps QR, link, manual, and reissued code delivery to one accepted Session claim and 20/15 direct outcome", async () => {
    const store = new MemoryGamificationStore();
    seedSessionAttendanceFixture(store);
    const original = seedSessionMissionCode(store, "session-code-1");
    const replacement = seedSessionMissionCode(store, "session-code-2", { reissued_from: "session-code-1" });
    const redemption = redemptionService(store);

    const qr = await redemption.redeem({ ...redemptionInput(original.rawCode), sourceHint: "qr" });
    const link = await redemption.redeem({ ...redemptionInput(original.rawCode), sourceHint: "link" });
    await store.update(GAMIFICATION_COLLECTIONS.codes, "session-code-1", { status: "disabled", enabled: false, invalidated_at: timestamp });
    const manual = await redemption.redeem({ ...redemptionInput(replacement.rawCode), sourceHint: "manual" });

    expect(qr).toMatchObject({ status: "accepted", xpAwarded: 20, leaderboardXpAwarded: 15, mission: { title: "Mission-safe title" } });
    expect(link.status).toBe("already_redeemed");
    expect(manual.status).toBe("user_limit");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "session-activity", status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "session-badge", status: "unlocked" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual([
      expect.objectContaining({ amount: 20, leaderboard_amount: 15 }),
    ]);
  });

  it("enforces independent Session Activity windows before code redemption can create evidence", async () => {
    const scenarios: Array<{ activity: Record<string, unknown>; expected: "not_yet_active" | "expired" }> = [
      { activity: { active_from: "2026-09-01T13:00:00.000Z" }, expected: "not_yet_active" },
      { activity: { active_until: "2026-09-01T11:00:00.000Z" }, expected: "expired" },
    ];
    for (const scenario of scenarios) {
      const store = new MemoryGamificationStore();
      seedSessionAttendanceFixture(store, { activity: scenario.activity });
      const code = seedSessionMissionCode(store, "session-window-code");

      const result = await redemptionService(store).redeem(redemptionInput(code.rawCode));

      expect(result.status).toBe(scenario.expected);
      expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
      expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toHaveLength(0);
      expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(0);
    }
  });

  it("does not treat schedule-derived or generic API input as Session attendance evidence", async () => {
    const store = new MemoryGamificationStore();
    seedSessionAttendanceFixture(store);

    await expect(service(store).recordActivityAward({
      claim: {
        user: "user-1",
        activity: "session-activity",
        sourceType: "code_redemption",
        outcomeKey: "attendance",
        occurredAt: timestamp,
        evidenceFingerprint: "agenda-slot-1",
        idempotencyKey: "agenda-slot-1",
      },
    })).rejects.toThrow("verified WTS Mission code redemption evidence");

    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toHaveLength(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(0);
  });

  it("retains cap-exhausted Session Badge and Meta eligibility while recording every cap dimension", async () => {
    const store = new MemoryGamificationStore();
    seedSessionAttendanceFixture(store, {
      caps: [
        { id: "session-activity-cap", dimension: "activity", cap_key: "session-activity", total_xp_ceiling: 0, leaderboard_xp_ceiling: 0 },
        { id: "session-category-cap", dimension: "category", cap_key: "session", total_xp_ceiling: 0, leaderboard_xp_ceiling: 0 },
        { id: "session-day-cap", dimension: "conference_day", cap_key: "2026-09-01", total_xp_ceiling: 0, leaderboard_xp_ceiling: 0 },
        { id: "session-conference-cap", dimension: "conference", cap_key: "conference", total_xp_ceiling: 0, leaderboard_xp_ceiling: 0 },
      ],
    });
    seedMetaSourceActivity(store, "other-meta-source", "other.session.source", {
      kind: "session",
      category: "session",
      session: "session-2",
      session_meta_eligible: true,
    });
    store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
      id: "other-meta-claim", user: "user-1", activity: "other-meta-source", source_type: "code_redemption", outcome_key: "visit", status: "accepted", occurred_at: timestamp, claimed_at: timestamp, evidence_fingerprint: "other-meta", idempotency_key: "other-meta", created: timestamp, updated: timestamp,
    });
    seedMetaConfiguration(store, {
      kind: "claim_count",
      activityKeys: ["session.platform-design.attendance", "other.session.source"],
      count: 2,
      sourceDiversity: "session",
    });
    await store.update(GAMIFICATION_COLLECTIONS.scoreSchedules, "session-schedule", { effective_at: timestamp });
    const code = seedSessionMissionCode(store, "session-capped-code");

    const result = await redemptionService(store).redeem(redemptionInput(code.rawCode));
    const claim = await store.findOne<any>(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "session-activity", status: "accepted" });

    expect(result.status).toBe("accepted");
    expect(claim.cap_outcome).toMatchObject({ awarded_total_xp: 0, awarded_leaderboard_xp: 0 });
    expect(claim.cap_outcome.applied_caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "activity:session-activity" }),
      expect.objectContaining({ key: "category:session" }),
      expect.objectContaining({ key: "conference_day:2026-09-01" }),
      expect.objectContaining({ key: "conference:conference" }),
    ]));
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents, { source_claim: claim.id })).toHaveLength(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "session-badge", status: "unlocked" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { source_type: "system_meta", status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "meta-achievement", status: "unlocked" })).toHaveLength(1);
  });

  it("keeps Session source snapshots and Activity history out of redemption and public ops-board DTOs", async () => {
    const store = new MemoryGamificationStore();
    seedSessionAttendanceFixture(store);
    const code = seedSessionMissionCode(store, "session-privacy-code");
    const result = await redemptionService(store).redeem(redemptionInput(code.rawCode));
    const rows = buildGamificationPublicOpsBoardRows(
      [{
        id: "profile-1", user: "user-1", total_xp: 20, leaderboard_xp: 15, access_level: 2, access_level_threshold: 0, next_level_threshold: 0, xp_into_level: 0, xp_to_next_level: 0, unlocked_badge_count: 1, ops_board_visible: true, ops_board_display_name: "Private Agent", public_badges_visible: true, totals_version: 1, totals_recalculated_at: timestamp, created: timestamp, updated: timestamp,
      } as any],
      [{
        id: "session-badge-user", user: "user-1", achievement: "session-badge", status: "unlocked", unlocked_at: timestamp, source_claim: "private-session-claim", idempotency_key: "session-badge-user", public_visible: true, created: timestamp, updated: timestamp,
      } as any],
      [{
        id: "session-badge", key: "session-attendance-badge", badge_name: "Session Participant", badge_description: "Private source Session title", category: "session", rarity: "common", visibility: "public", status: "active", unlock_rule: { kind: "activity_claim" }, sort_order: 1, metadata: { agenda_slot: "private-slot" }, created: timestamp, updated: timestamp,
      } as any],
    );

    expect(JSON.stringify(result)).not.toContain("Private source Session title");
    expect(JSON.stringify(result)).not.toContain("immutable-session-slug");
    expect(JSON.stringify(result)).not.toContain("session_display_snapshot");
    expect(rows).toEqual([expect.objectContaining({ publicBadgeCount: 0, badges: [] })]);
    expect(JSON.stringify(rows)).not.toContain("Session Participant");
    expect(JSON.stringify(rows)).not.toContain("private-slot");
  });
});

function seedOperationActivity(store: MemoryGamificationStore, overrides: Record<string, unknown> = {}): void {
  store.seed(GAMIFICATION_COLLECTIONS.activities, {
    id: "operation-activity",
    key: "booth.operation.visit",
    kind: "booth",
    category: "booth",
    outcome_key: "visit",
    evidence_mode: "single_code",
    per_user_claim_limit: 1,
    max_claims: 100,
    active_from: "2026-09-01T00:00:00.000Z",
    active_until: "2026-09-30T23:59:59.000Z",
    status: "active",
    enabled: true,
    metadata: { privateOperationalNote: "never expose" },
    created: timestamp,
    updated: timestamp,
    ...overrides,
  });
}

function seedActiveOperationSchedule(store: MemoryGamificationStore): void {
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
    id: "operation-active-schedule",
    key: "operation-active-schedule",
    status: "active",
    effective_at: timestamp,
    total_xp_ceiling: 5,
    leaderboard_xp_ceiling: 5,
    access_level_thresholds: { "1": 0 },
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
    id: "operation-active-policy",
    schedule: "operation-active-schedule",
    activity: "operation-activity",
    policy_key: "operation-active-policy",
    active: true,
    total_xp: 5,
    leaderboard_xp: 5,
    cap_membership: [{ dimension: "activity", key: "operation-activity" }],
    created: timestamp,
    updated: timestamp,
  });
}

describe("admin gamification operations", () => {
  it("does not invoke a privileged operation before admin authorization succeeds", async () => {
    const operation = vi.fn();

    await expect(runAuthenticatedGamificationOperation(
      async () => { throw new Error("Unauthorized: Admin access required"); },
      operation,
    )).rejects.toThrow("Unauthorized: Admin access required");

    expect(operation).not.toHaveBeenCalled();
  });

  it("creates a PocketBase-compatible score schedule draft", async () => {
    const store = new MemoryGamificationStore();

    await operationService(store).createScoreScheduleDraft({
      key: "september-successor",
      effectiveAt: "2026-09-01T00:00:00.000Z",
      reason: "Prepare the next score schedule",
      operationId: "create-september-successor",
    }, adminActor);

    expect(await store.list(GAMIFICATION_COLLECTIONS.scoreSchedules)).toEqual([
      expect.objectContaining({
        key: "september-successor",
        status: "draft",
        access_level_thresholds: { "1": 0 },
      }),
    ]);
  });

  it("rejects incomplete draft activation and inactive claim-set dependencies", async () => {
    const store = new MemoryGamificationStore();
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "draft-claim-set",
      key: "draft-claim-set",
      badge_name: "Draft circuit",
      badge_description: "Incomplete draft",
      category: "booth",
      rarity: "rare",
      visibility: "public",
      status: "draft",
      unlock_rule: { kind: "claim_set", activityKeys: ["missing-a", "missing-b"] },
      sort_order: 0,
      created: timestamp,
      updated: timestamp,
    });

    await expect(operationService(store).activateDefinition("achievement", {
      id: "draft-claim-set",
      reason: "Ready for activation",
      confirmation: true,
      operationId: "activate-invalid-claim-set",
    }, adminActor)).rejects.toThrow("Achievement requires an active start and end window");
    await expect(operationService(store).activateDefinition("achievement", {
      id: "draft-claim-set",
      reason: "Ready for activation",
      confirmation: true,
      operationId: "activate-invalid-claim-set",
    }, adminActor)).rejects.toThrow("Achievement requires an active start and end window");

    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions, { action: "configuration_change" })).toEqual([
      expect.objectContaining({ status: "failed", reason: "Ready for activation" }),
    ]);
  });

  it("enforces the declared Meta score band when a draft policy is configured", async () => {
    const store = new MemoryGamificationStore();
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "meta-achievement-draft",
      key: "meta-achievement-draft",
      badge_name: "Meta draft",
      badge_description: "Meta draft badge",
      category: "meta",
      rarity: "rare",
      visibility: "public",
      status: "draft",
      unlock_rule: { kind: "claim_set", activityKeys: ["source-a", "source-b"] },
      sort_order: 1,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      id: "meta-activity-draft",
      key: "meta.activity.draft",
      kind: "meta",
      category: "meta",
      outcome_key: "meta",
      evidence_mode: "meta_rule",
      achievement: "meta-achievement-draft",
      per_user_claim_limit: 1,
      max_claims: 100,
      active_from: "2026-09-01T00:00:00.000Z",
      active_until: "2026-09-30T23:59:59.000Z",
      status: "draft",
      enabled: true,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      id: "meta-draft-schedule",
      key: "meta-draft-schedule",
      status: "draft",
      effective_at: timestamp,
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
      access_level_thresholds: {},
      created: timestamp,
      updated: timestamp,
    });
    const input = {
      id: "meta-activity-draft",
      key: "meta.activity.draft",
      kind: "meta" as const,
      category: "meta" as const,
      outcomeKey: "meta",
      evidenceMode: "meta_rule" as const,
      achievementId: "meta-achievement-draft",
      perUserClaimLimit: 1,
      maxClaims: 100,
      activeFrom: "2026-09-01T00:00:00.000Z",
      activeUntil: "2026-09-30T23:59:59.000Z",
      enabled: true,
      scorePolicy: {
        scheduleId: "meta-draft-schedule",
        policyKey: "meta.policy.draft",
        enabled: true,
        totalXp: 30,
        leaderboardXp: 25,
        capMembership: [{ dimension: "activity" as const, key: "meta-activity-draft" }],
      },
      operationId: "save-meta-policy-wrong-band",
    };

    await expect(operationService(store).saveActivityDraft(input, adminActor)).rejects.toThrow("20/15");
    await expect(operationService(store).saveActivityDraft({
      ...input,
      scorePolicy: { ...input.scorePolicy, totalXp: 20, leaderboardXp: 15 },
      operationId: "save-meta-policy-correct-band",
    }, adminActor)).resolves.toMatchObject({ id: "meta-activity-draft" });
  });

  it("retires used definitions and only permits an audited successor draft", async () => {
    const store = new MemoryGamificationStore();
    seedOperationActivity(store);
    store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
      id: "used-operation-claim",
      user: "user-1",
      activity: "operation-activity",
      source_type: "code_redemption",
      outcome_key: "visit",
      status: "accepted",
      occurred_at: timestamp,
      claimed_at: timestamp,
      evidence_fingerprint: "used-operation-claim",
      idempotency_key: "used-operation-claim",
      created: timestamp,
      updated: timestamp,
    });
    const operations = operationService(store);

    await expect(operations.saveActivityDraft({
      id: "operation-activity",
      key: "booth.operation.visit",
      kind: "booth",
      category: "booth",
      outcomeKey: "visit",
      evidenceMode: "single_code",
      perUserClaimLimit: 1,
      maxClaims: 100,
      activeFrom: "2026-09-01T00:00:00.000Z",
      activeUntil: "2026-09-30T23:59:59.000Z",
      enabled: true,
      operationId: "change-used-activity",
    }, adminActor)).rejects.toThrow("Only draft Activities can be edited");

    await operations.retireDefinition("activity", {
      id: "operation-activity",
      reason: "Replace deployed booth evidence",
      confirmation: true,
      operationId: "retire-used-activity",
    }, adminActor);
    const successor = await operations.saveActivityDraft({
      successorOf: "operation-activity",
      key: "booth.operation.visit.v2",
      kind: "booth",
      category: "booth",
      outcomeKey: "visit",
      evidenceMode: "single_code",
      perUserClaimLimit: 1,
      maxClaims: 100,
      activeFrom: "2026-09-01T00:00:00.000Z",
      activeUntil: "2026-09-30T23:59:59.000Z",
      enabled: true,
      reason: "Successor for deployed code",
      operationId: "create-activity-successor",
    }, adminActor);

    expect((await store.getById<{ status: string; enabled: boolean }>(GAMIFICATION_COLLECTIONS.activities, "operation-activity"))).toMatchObject({ status: "retired", enabled: false });
    expect(successor).toMatchObject({ key: "booth.operation.visit.v2", status: "draft" });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activities)).toHaveLength(2);
  });

  it("activates a versioned September schedule from only active score-bearing policies", async () => {
    const store = new MemoryGamificationStore();
    seedOperationActivity(store);
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      id: "retired-operation-activity",
      key: "booth.operation.retired",
      kind: "booth",
      category: "booth",
      outcome_key: "visit",
      evidence_mode: "single_code",
      per_user_claim_limit: 1,
      max_claims: 100,
      active_from: "2026-09-01T00:00:00.000Z",
      active_until: "2026-09-30T23:59:59.000Z",
      status: "retired",
      enabled: false,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      id: "historic-schedule",
      key: "historic",
      status: "active",
      effective_at: "2026-09-01T00:00:00.000Z",
      total_xp_ceiling: 10,
      leaderboard_xp_ceiling: 10,
      access_level_thresholds: { "1": 0 },
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      id: "draft-schedule",
      key: "september-v2",
      status: "draft",
      effective_at: "2026-09-10T00:00:00.000Z",
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
      access_level_thresholds: {},
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "score-policy-active",
      schedule: "draft-schedule",
      activity: "operation-activity",
      policy_key: "booth.operation.visit",
      active: true,
      total_xp: 20,
      leaderboard_xp: 10,
      cap_membership: [{ dimension: "activity", key: "operation-activity" }],
      score_day: "2026-09-19",
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "score-policy-retired",
      schedule: "draft-schedule",
      activity: "retired-operation-activity",
      policy_key: "booth.operation.retired",
      active: true,
      total_xp: 500,
      leaderboard_xp: 500,
      cap_membership: [{ dimension: "activity", key: "retired-operation-activity" }],
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "score-policy-total-only-disabled",
      schedule: "draft-schedule",
      activity: "operation-activity",
      policy_key: "booth.operation.total-only",
      active: false,
      total_xp: 900,
      leaderboard_xp: 0,
      cap_membership: [{ dimension: "activity", key: "operation-activity" }],
      created: timestamp,
      updated: timestamp,
    });

    const activated = await operationService(store).activateScoreSchedule("draft-schedule", {
      id: "draft-schedule",
      reason: "Activate configured September scoring",
      confirmation: true,
      operationId: "activate-september-v2",
    }, adminActor);

    expect(activated).toMatchObject({ status: "active", totalXpCeiling: 20, leaderboardXpCeiling: 10 });
    expect(activated.accessLevelThresholds).toEqual({ "1": 0, "2": 1, "3": 3, "4": 6, "5": 10, "6": 15, "7": 20 });
    expect(await store.getById<{ status: string }>(GAMIFICATION_COLLECTIONS.scoreSchedules, "historic-schedule")).toMatchObject({ status: "superseded" });
    expect(await store.list(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, { schedule: "draft-schedule" })).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "conference", total_xp_ceiling: 20, leaderboard_xp_ceiling: 10 }),
    ]));
  });

  it("limits code batches, makes retries unrecoverable instead of regenerating, and keeps DTOs secret-free", async () => {
    const store = new MemoryGamificationStore();
    seedOperationActivity(store);
    seedActiveOperationSchedule(store);
    const operations = operationService(store);
    const input = {
      activityId: "operation-activity",
      label: "Booth A deployment",
      quantity: 2,
      evidenceRole: "single" as const,
      startsAt: "2026-09-02T00:00:00.000Z",
      endsAt: "2026-09-20T00:00:00.000Z",
      maxRedemptions: 100,
      perUserLimit: 1,
      operationId: "code-generation-retry",
    };

    await expect(operations.generateCodes({ ...input, quantity: 101 }, adminActor)).rejects.toThrow("between 1 and 100");
    const generated = await operations.generateCodes(input, adminActor);
    const retried = await operations.generateCodes(input, adminActor);
    await expect(operations.generateCodes({ ...input, maxRedemptions: 99 }, adminActor))
      .rejects.toThrow("different request");
    await expect(operations.generateCodes(input, { id: "admin-2", role: "admin" }))
      .rejects.toThrow("another operation");
    const rawCode = generated.codes![0].rawCode;
    const persisted = await store.list<{ code_hash: string; metadata?: Record<string, unknown> }>(GAMIFICATION_COLLECTIONS.codes);
    const dto = await operations.operations();
    const lookup = await operations.lookupCodes({ rawCode });
    const audit = await store.list(GAMIFICATION_COLLECTIONS.adminActions, { action: "code_generation" });

    expect(generated.batch).toMatchObject({ committed: true, secretsAvailable: true, quantity: 2 });
    expect(retried.batch).toMatchObject({ committed: true, secretsAvailable: false });
    expect(retried.codes).toBeUndefined();
    expect(persisted).toHaveLength(2);
    expect(JSON.stringify(dto)).not.toContain(rawCode);
    expect(JSON.stringify(dto)).not.toContain(persisted[0].code_hash);
    expect(JSON.stringify(dto)).not.toContain("never expose");
    expect(JSON.stringify(lookup)).not.toContain(rawCode);
    expect(JSON.stringify(audit)).not.toContain(rawCode);
    expect(JSON.stringify(audit)).not.toContain(persisted[0].code_hash);
  });

  it("treats a lost transactional code-batch response as committed and unrecoverable", async () => {
    class LostBatchResponseStore extends MemoryGamificationStore {
      override async createManyAtomic<T>(collection: string, rows: Record<string, unknown>[]): Promise<T[]> {
        await super.createManyAtomic<T>(collection, rows);
        throw new Error("Simulated response loss after commit");
      }
    }
    const store = new LostBatchResponseStore();
    seedOperationActivity(store);
    seedActiveOperationSchedule(store);

    const result = await operationService(store).generateCodes({
      activityId: "operation-activity",
      label: "Lost response batch",
      quantity: 3,
      evidenceRole: "single",
      startsAt: "2026-09-02T00:00:00.000Z",
      endsAt: "2026-09-20T00:00:00.000Z",
      maxRedemptions: 100,
      perUserLimit: 1,
      operationId: "lost-code-batch-response",
    }, adminActor);

    expect(result.batch).toMatchObject({ committed: true, secretsAvailable: false, quantity: 0 });
    expect(result.codes).toBeUndefined();
    expect(await store.list(GAMIFICATION_COLLECTIONS.codes, { batch_id: "lost-code-batch-response" })).toHaveLength(3);
  });

  it("does not generate codes before the Activity has an effective active score schedule", async () => {
    const store = new MemoryGamificationStore();
    seedOperationActivity(store);

    await expect(operationService(store).generateCodes({
      activityId: "operation-activity",
      label: "Premature deployment",
      quantity: 1,
      evidenceRole: "single",
      startsAt: "2026-09-02T00:00:00.000Z",
      endsAt: "2026-09-20T00:00:00.000Z",
      maxRedemptions: 100,
      perUserLimit: 1,
      operationId: "premature-code-generation",
    }, adminActor)).rejects.toThrow("applicable score schedule");
    expect(await store.list(GAMIFICATION_COLLECTIONS.codes)).toHaveLength(0);
  });

  it("invalidates without deleting history and reissues only to the same Activity limit", async () => {
    const store = new MemoryGamificationStore();
    seedOperationActivity(store);
    seedActiveOperationSchedule(store);
    const operations = operationService(store);
    const generated = await operations.generateCodes({
      activityId: "operation-activity",
      label: "Leaked booth sign",
      quantity: 1,
      evidenceRole: "single",
      startsAt: "2026-09-02T00:00:00.000Z",
      endsAt: "2026-09-20T00:00:00.000Z",
      maxRedemptions: 100,
      perUserLimit: 1,
      operationId: "initial-leaked-batch",
    }, adminActor);
    const codeId = generated.codes![0].id;
    store.seed(GAMIFICATION_COLLECTIONS.codeRedemptions, {
      id: "accepted-before-invalidation",
      user: "user-1",
      code: codeId,
      activity: "operation-activity",
      status: "accepted",
      redeemed_at: timestamp,
      idempotency_key: "accepted-before-invalidation",
      created: timestamp,
      updated: timestamp,
    });

    await operations.invalidateCode({
      codeId,
      reason: "Printed before the event window",
      confirmation: true,
      operationId: "invalidate-leaked-code",
    }, adminActor);
    const replacement = await operations.reissueCode({
      codeId,
      reason: "Deploy corrected sign",
      confirmation: true,
      operationId: "reissue-leaked-code",
    }, adminActor);
    const [newCode] = await store.list<{ id: string; activity: string; per_user_limit: number; reissued_from: string }>(GAMIFICATION_COLLECTIONS.codes, {
      reissued_from: codeId,
    });

    expect(await store.getById<{ status: string; enabled: boolean; invalidated_reason: string }>(GAMIFICATION_COLLECTIONS.codes, codeId)).toMatchObject({
      status: "disabled",
      enabled: false,
      invalidated_reason: "Printed before the event window",
    });
    expect(await store.list(GAMIFICATION_COLLECTIONS.codeRedemptions, { code: codeId, status: "accepted" })).toHaveLength(1);
    expect(replacement.batch).toMatchObject({ secretsAvailable: true, activityId: "operation-activity" });
    expect(newCode).toMatchObject({ activity: "operation-activity", per_user_limit: 1, reissued_from: codeId });
    await expect(operations.reissueCode({
      codeId,
      reason: "Do not create a second replacement",
      confirmation: true,
      operationId: "second-reissue-leaked-code",
    }, adminActor)).rejects.toThrow("already has an active replacement");
    expect(JSON.stringify(await store.list(GAMIFICATION_COLLECTIONS.adminActions))).not.toContain(generated.codes![0].rawCode);
  });
});

describe("static Easter Egg Missions", () => {
  async function configuredEgg(store: MemoryGamificationStore, eggKey = "quiet-signal", operationId = `configure-${eggKey}`) {
    return operationService(store).saveEasterEggMissionDraft(easterEggDraftInput(eggKey, operationId), adminActor);
  }

  async function activeEggWithCode(store: MemoryGamificationStore, options: {
    codeStartsAt?: string;
    codeEndsAt?: string;
    codeMaxRedemptions?: number;
  } = {}) {
    seedEasterEggDraftSchedule(store);
    const configured = await configuredEgg(store);
    await activateEasterEggDefinitions(store, configured, "quiet-signal");
    await operationService(store).activateScoreSchedule("easter-egg-schedule", {
      id: "easter-egg-schedule",
      reason: "Activate Easter Egg scoring",
      confirmation: true,
      operationId: "activate-easter-egg-schedule",
    }, adminActor);
    const batch = await operationService(store).generateCodes({
      activityId: configured.activity.id,
      label: "Private quiet-signal deployment",
      quantity: 1,
      evidenceRole: "static_puzzle",
      startsAt: options.codeStartsAt || timestamp,
      endsAt: options.codeEndsAt || "2026-09-30T23:59:59.000Z",
      maxRedemptions: options.codeMaxRedemptions || 100,
      perUserLimit: 1,
      operationId: "generate-quiet-signal-code",
    }, adminActor);
    return { configured, batch, rawCode: batch.codes![0].rawCode, codeId: batch.codes![0].id };
  }

  it("creates only the canonical hidden discovery shape with fixed scoring and dynamic category/conference ceilings", async () => {
    const store = new MemoryGamificationStore();
    seedEasterEggDraftSchedule(store);
    const first = await configuredEgg(store, "quiet-signal", "configure-quiet-signal");
    const second = await configuredEgg(store, "second-signal", "configure-second-signal");

    expect(first).toMatchObject({
      achievement: {
        key: "easter_egg.quiet-signal",
        visibility: "hidden_until_unlocked",
        category: "easter_egg",
      },
      mission: {
        key: "easter_egg.quiet-signal",
        visibility: "hidden_until_unlocked",
        suggested: false,
      },
      activity: {
        key: "easter_egg.quiet-signal.discovery",
        kind: "easter_egg",
        category: "easter_egg",
        outcomeKey: "static_discovery",
        evidenceMode: "static_puzzle_code",
        perUserClaimLimit: 1,
      },
    });
    expect(first.mission.partnerId).toBeUndefined();
    expect(first.mission.sessionId).toBeUndefined();
    expect(first.mission.eventRef).toBeUndefined();
    expect(first.activity.scorePolicies).toEqual([
      expect.objectContaining({
        totalXp: 10,
        leaderboardXp: 0,
        capMembership: [
          { dimension: "activity", key: first.activity.id },
          { dimension: "category", key: "easter_egg" },
          { dimension: "conference", key: "conference" },
        ],
      }),
    ]);

    await activateEasterEggDefinitions(store, first, "quiet-signal");
    await activateEasterEggDefinitions(store, second, "second-signal");
    const schedule = await operationService(store).activateScoreSchedule("easter-egg-schedule", {
      id: "easter-egg-schedule",
      reason: "Snapshot all active Easter Egg discoveries",
      confirmation: true,
      operationId: "activate-two-easter-eggs",
    }, adminActor);
    const caps = await store.list<any>(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, { schedule: "easter-egg-schedule" });

    expect(schedule).toMatchObject({ totalXpCeiling: 20, leaderboardXpCeiling: 0 });
    expect(caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "category", cap_key: "easter_egg", total_xp_ceiling: 20, leaderboard_xp_ceiling: 0 }),
      expect.objectContaining({ dimension: "conference", cap_key: "conference", total_xp_ceiling: 20, leaderboard_xp_ceiling: 0 }),
    ]));
    seedEasterEggDraftSchedule(store, "easter-successor-schedule");
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "successor-first-egg-only",
      schedule: "easter-successor-schedule",
      activity: first.activity.id,
      policy_key: first.activity.key,
      active: true,
      total_xp: 10,
      leaderboard_xp: 0,
      cap_membership: [
        { dimension: "activity", key: first.activity.id },
        { dimension: "category", key: "easter_egg" },
        { dimension: "conference", key: "conference" },
      ],
      created: timestamp,
      updated: timestamp,
    });
    await expect(operationService(store).activateScoreSchedule("easter-successor-schedule", {
      id: "easter-successor-schedule",
      reason: "Must retain every active Easter Egg policy",
      confirmation: true,
      operationId: "reject-incomplete-easter-successor",
    }, adminActor)).rejects.toThrow("second-signal.discovery requires its fixed 10/0 policy");
    expect(buildCommunityPartnerMissionPresentations({
      missions: await store.list<any>(GAMIFICATION_COLLECTIONS.missions),
      activities: await store.list<any>(GAMIFICATION_COLLECTIONS.activities),
      achievements: await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    })).toEqual([]);

    await expect(operationService(store).saveActivityDraft({
      key: "easter_egg.bypass.discovery",
      kind: "easter_egg",
      category: "easter_egg",
      outcomeKey: "static_discovery",
      evidenceMode: "static_puzzle_code",
      perUserClaimLimit: 1,
      maxClaims: 1,
      activeFrom: timestamp,
      activeUntil: "2026-09-30T23:59:59.000Z",
      enabled: true,
      operationId: "bypass-easter-operation",
    }, adminActor)).rejects.toThrow("dedicated Easter Egg Mission operation");
    await expect(operationService(store).saveEasterEggMissionDraft({
      ...easterEggDraftInput("unsafe-signal", "unsafe-easter-code"),
      deploymentNote: "Deploy W T S 2 6 - 1 2 3 4 5 6 7 8 - 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 here",
    }, adminActor)).rejects.toThrow("must not include Mission codes");
    await expect(operationService(store).saveEasterEggMissionDraft({
      ...easterEggDraftInput("unsafe-icon", "unsafe-easter-icon"),
      badgeIcon: "WTS26-12345678-12345678901234567890123456",
    }, adminActor)).rejects.toThrow("Easter egg Badge icons must not include Mission codes");
  });

  it("repairs an interrupted accepted redemption without reporting historical XP as newly awarded", async () => {
    const store = new MemoryGamificationStore();
    seedUser(store);
    const { configured, rawCode, codeId } = await activeEggWithCode(store);
    store.seed(GAMIFICATION_COLLECTIONS.codeRedemptions, {
      id: "interrupted-easter-redemption",
      user: "user-1",
      code: codeId,
      activity: configured.activity.id,
      activity_claim: "interrupted-easter-claim",
      status: "accepted",
      redeemed_at: timestamp,
      idempotency_key: `mission-code-redemption:v1:user-1:${codeId}`,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
      id: "interrupted-easter-claim",
      user: "user-1",
      activity: configured.activity.id,
      source_type: "static_puzzle_code",
      source_collection: GAMIFICATION_COLLECTIONS.codeRedemptions,
      source_record_id: "interrupted-easter-redemption",
      outcome_key: "static_discovery",
      status: "accepted",
      occurred_at: timestamp,
      claimed_at: timestamp,
      evidence_fingerprint: `code-redemption:${codeId}`,
      idempotency_key: `activity-claim:v1:user-1:${configured.activity.key}:static_puzzle_code:${codeId}`,
      cap_outcome: {
        schedule: "easter-egg-schedule",
        policy: configured.activity.key,
        awarded_total_xp: 10,
        awarded_leaderboard_xp: 0,
      },
      created: timestamp,
      updated: timestamp,
    });

    expect(await redemptionService(store).redeem(redemptionInput(rawCode))).toMatchObject({
      status: "already_redeemed",
      xpAwarded: 0,
      leaderboardXpAwarded: 0,
    });
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: configured.achievement.id, status: "unlocked" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents, { source_claim: "interrupted-easter-claim" })).toEqual([
      expect.objectContaining({ amount: 10, leaderboard_amount: 0 }),
    ]);
    expect(await store.list(GAMIFICATION_COLLECTIONS.profiles, { user: "user-1" })).toEqual([
      expect.objectContaining({ total_xp: 10, leaderboard_xp: 0 }),
    ]);
  });

  it("redeems static evidence idempotently at 10/0, respects visibility, reissue limits, and neutral Badge revocation", async () => {
    const store = new MemoryGamificationStore();
    seedUser(store);
    const { configured, batch, rawCode, codeId } = await activeEggWithCode(store);
    const operations = operationService(store);
    await service(store).ensureProfile({ id: "user-1", name: "Ada" });

    expect(buildGamificationPublicOpsBoardRows(
      await store.list<any>(GAMIFICATION_COLLECTIONS.profiles),
      await store.list<any>(GAMIFICATION_COLLECTIONS.userAchievements),
      await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    )[0]).toMatchObject({ leaderboardXp: 0, publicBadgeCount: 0, badges: [] });

    const accepted = await redemptionService(store).redeem({
      ...redemptionInput(rawCode),
      sourceHint: "static_puzzle",
    });
    const repeated = await redemptionService(store).redeem(redemptionInput(rawCode));
    const [claim] = await store.list<any>(GAMIFICATION_COLLECTIONS.activityClaims, { activity: configured.activity.id });
    const [xpEvent] = await store.list<any>(GAMIFICATION_COLLECTIONS.xpEvents, { source_claim: claim.id });
    const [badge] = await store.list<any>(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: configured.achievement.id });
    const [profile] = await store.list<any>(GAMIFICATION_COLLECTIONS.profiles, { user: "user-1" });

    expect(accepted).toMatchObject({
      status: "accepted",
      xpAwarded: 10,
      leaderboardXpAwarded: 0,
      mission: { title: "A quiet signal found" },
      badges: [{ name: "Signal Finder", description: "You found a hidden WTS signal." }],
      profile: { totalXp: 10 },
    });
    expect(repeated).toMatchObject({ status: "already_redeemed", xpAwarded: 0, leaderboardXpAwarded: 0 });
    expect(claim).toMatchObject({ source_type: "static_puzzle_code", outcome_key: "static_discovery", status: "accepted" });
    expect(xpEvent).toMatchObject({ amount: 10, leaderboard_amount: 0, category: "easter_egg" });
    expect(profile).toMatchObject({ total_xp: 10, leaderboard_xp: 0 });
    expect(JSON.stringify(accepted)).not.toContain("attendee-safe public area");
    expect(JSON.stringify(accepted)).not.toContain(rawCode);
    expect(Object.keys(accepted)).not.toContain("answer");
    await expect(service(store).recordActivityAward({
      claim: {
        user: "user-2",
        activity: configured.activity.id,
        sourceType: "code_redemption",
        outcomeKey: "static_discovery",
        occurredAt: timestamp,
        evidenceFingerprint: "unverified-puzzle-answer",
        idempotencyKey: "unverified-puzzle-answer",
      },
    })).rejects.toThrow("verified WTS static-code redemption evidence");

    const ownerSummary = buildGamificationProfileSummary(
      profile,
      await store.list<any>(GAMIFICATION_COLLECTIONS.userAchievements, { user: "user-1" }),
      await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    );
    expect(ownerSummary.badges).toEqual([expect.objectContaining({ id: badge.id, name: "Signal Finder", publicVisible: true })]);
    expect(buildGamificationPublicOpsBoardRows(
      [profile],
      await store.list<any>(GAMIFICATION_COLLECTIONS.userAchievements),
      await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    )[0]).toMatchObject({ rank: 1, leaderboardXp: 0, publicBadgeCount: 0, badges: [] });
    expect(JSON.stringify(buildGamificationPublicOpsBoardRows(
      [profile],
      await store.list<any>(GAMIFICATION_COLLECTIONS.userAchievements),
      await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    ))).not.toContain("easter_egg.quiet-signal");

    await store.update(GAMIFICATION_COLLECTIONS.userAchievements, badge.id, { public_visible: false });
    expect(buildGamificationPublicOpsBoardRows(
      [profile],
      await store.list<any>(GAMIFICATION_COLLECTIONS.userAchievements),
      await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    )[0]).toMatchObject({ publicBadgeCount: 0, badges: [] });
    await store.update(GAMIFICATION_COLLECTIONS.userAchievements, badge.id, { public_visible: true });
    await store.update(GAMIFICATION_COLLECTIONS.profiles, profile.id, { public_badges_visible: false });
    expect(buildGamificationPublicOpsBoardRows(
      [profile],
      await store.list<any>(GAMIFICATION_COLLECTIONS.userAchievements),
      await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    )[0]).toMatchObject({ publicBadgeCount: 0, badges: [] });

    await operations.invalidateCode({ codeId, reason: "Replace a static surface", confirmation: true, operationId: "invalidate-egg-code" }, adminActor);
    const replacement = await operations.reissueCode({ codeId, reason: "Deploy replacement static surface", confirmation: true, operationId: "reissue-egg-code" }, adminActor);
    expect(await redemptionService(store).redeem(redemptionInput(replacement.codes![0].rawCode))).toMatchObject({ status: "user_limit" });

    await service(store).revokeBadge(badge.id, {
      actor: "admin-1",
      actorRole: "admin",
      targetUser: "user-1",
      reason: "Neutral profile correction",
      operationId: "revoke-easter-egg-badge",
    });
    const afterRevocation = await redemptionService(store).redeem(redemptionInput(rawCode));
    const correctedSummary = buildGamificationProfileSummary(
      await store.getById<any>(GAMIFICATION_COLLECTIONS.profiles, profile.id),
      await store.list<any>(GAMIFICATION_COLLECTIONS.userAchievements, { user: "user-1" }),
      await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    );
    expect(afterRevocation).toMatchObject({ status: "already_redeemed", xpAwarded: 0, leaderboardXpAwarded: 0 });
    expect(correctedSummary).toMatchObject({ revokedBadgeCount: 1, badges: [] });
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: configured.achievement.id, status: "unlocked" })).toHaveLength(0);
    expect(batch.batch).toMatchObject({ secretsAvailable: true });
  });

  it("keeps a cap-exhausted discovery accepted, Badge-bearing, and eligible for configured Meta rules", async () => {
    const store = new MemoryGamificationStore();
    seedUser(store);
    seedEasterEggDraftSchedule(store);
    const first = await configuredEgg(store, "first-signal", "configure-first-cap-signal");
    const second = await configuredEgg(store, "second-signal", "configure-second-cap-signal");
    await activateEasterEggDefinitions(store, first, "first-cap-signal");
    await activateEasterEggDefinitions(store, second, "second-cap-signal");
    await operationService(store).activateScoreSchedule("easter-egg-schedule", {
      id: "easter-egg-schedule",
      reason: "Activate capped discovery test schedule",
      confirmation: true,
      operationId: "activate-capped-discovery-schedule",
    }, adminActor);
    for (const cap of await store.list<any>(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, { schedule: "easter-egg-schedule" })) {
      if (cap.dimension === "category" || cap.dimension === "conference") {
        await store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, cap.id, { total_xp_ceiling: 10, leaderboard_xp_ceiling: 0 });
      }
    }
    seedMetaConfiguration(store, {
      kind: "claim_set",
      activityKeys: [first.activity.key, second.activity.key],
    }, { achievementId: "egg-meta-badge", achievementKey: "egg-meta", activityId: "egg-meta-activity" });
    await store.update(GAMIFICATION_COLLECTIONS.scoreSchedules, "meta-schedule-egg-meta-activity", {
      effective_at: "2026-08-31T00:00:00.000Z",
    });
    const firstBatch = await operationService(store).generateCodes({ activityId: first.activity.id, label: "First private signal", quantity: 1, evidenceRole: "static_puzzle", startsAt: timestamp, endsAt: "2026-09-30T23:59:59.000Z", maxRedemptions: 100, perUserLimit: 1, operationId: "first-cap-code" }, adminActor);
    const secondBatch = await operationService(store).generateCodes({ activityId: second.activity.id, label: "Second private signal", quantity: 1, evidenceRole: "static_puzzle", startsAt: timestamp, endsAt: "2026-09-30T23:59:59.000Z", maxRedemptions: 100, perUserLimit: 1, operationId: "second-cap-code" }, adminActor);

    expect(await redemptionService(store).redeem(redemptionInput(firstBatch.codes![0].rawCode))).toMatchObject({ status: "accepted", xpAwarded: 10, leaderboardXpAwarded: 0 });
    expect(await redemptionService(store).redeem(redemptionInput(secondBatch.codes![0].rawCode))).toMatchObject({ status: "accepted", xpAwarded: 0, leaderboardXpAwarded: 0 });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: second.activity.id, status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: second.achievement.id, status: "unlocked" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "egg-meta-badge", status: "unlocked" })).toHaveLength(1);
  });

  it("returns every settled code lifecycle state without adding a puzzle-answer state", async () => {
    const invalidStore = new MemoryGamificationStore();
    expect(await redemptionService(invalidStore).redeem(redemptionInput("not-an-easter-code"))).toMatchObject({ status: "invalid" });

    const notActiveStore = new MemoryGamificationStore();
    seedUser(notActiveStore);
    const notActive = await activeEggWithCode(notActiveStore, { codeStartsAt: "2026-09-02T00:00:00.000Z" });
    expect(await redemptionService(notActiveStore).redeem(redemptionInput(notActive.rawCode))).toMatchObject({ status: "not_yet_active" });

    const expiredStore = new MemoryGamificationStore();
    seedUser(expiredStore);
    const expired = await activeEggWithCode(expiredStore, { codeStartsAt: "2026-09-01T00:00:00.000Z", codeEndsAt: "2026-09-01T11:00:00.000Z" });
    expect(await redemptionService(expiredStore).redeem(redemptionInput(expired.rawCode))).toMatchObject({ status: "expired" });

    const disabledStore = new MemoryGamificationStore();
    seedUser(disabledStore);
    const disabled = await activeEggWithCode(disabledStore);
    await operationService(disabledStore).invalidateCode({ codeId: disabled.codeId, reason: "Disable test code", confirmation: true, operationId: "disable-lifecycle-code" }, adminActor);
    expect(await redemptionService(disabledStore).redeem(redemptionInput(disabled.rawCode))).toMatchObject({ status: "disabled" });

    const globalStore = new MemoryGamificationStore();
    seedUser(globalStore);
    const global = await activeEggWithCode(globalStore, { codeMaxRedemptions: 1 });
    globalStore.seed(GAMIFICATION_COLLECTIONS.codeRedemptions, {
      id: "other-user-accepted-egg",
      user: "user-2",
      code: global.codeId,
      activity: global.configured.activity.id,
      status: "accepted",
      redeemed_at: timestamp,
      idempotency_key: "other-user-accepted-egg",
      created: timestamp,
      updated: timestamp,
    });
    expect(await redemptionService(globalStore).redeem(redemptionInput(global.rawCode))).toMatchObject({ status: "global_limit" });

    const rateStore = new MemoryGamificationStore();
    seedUser(rateStore);
    const rate = await activeEggWithCode(rateStore);
    const rateService = redemptionService(rateStore);
    for (let attempt = 0; attempt < 12; attempt += 1) await rateService.redeem(redemptionInput(rate.rawCode));
    expect(await rateService.redeem(redemptionInput(rate.rawCode))).toMatchObject({ status: "rate_limited" });

    expect([
      "accepted",
      "already_redeemed",
      "invalid",
      "not_yet_active",
      "expired",
      "disabled",
      "global_limit",
      "user_limit",
      "rate_limited",
    ]).not.toContain("invalid_answer");
  });
});

describe("admin gamification support accounting", () => {
  const adminAudit = (operationId: string) => ({
    actor: "admin-1",
    actorRole: "admin" as const,
    targetUser: "user-1",
    reason: "Verified event-day support case",
    operationId,
  });

  const manualInput = (overrides: Partial<AdminManualAwardInput> = {}): AdminManualAwardInput => ({
    achievementId: "achievement-1",
    activityId: "activity-checked-in",
    mode: "badge_only",
    occurredAt: timestamp,
    ...overrides,
  });

  function supportFixture(): { store: MemoryGamificationStore; accounting: GamificationAccountingService } {
    const store = new MemoryGamificationStore();
    seedUser(store);
    seedAchievement(store);
    seedActivity(store);
    seedSchedule(store);
    return { store, accounting: service(store) };
  }

  it("requires admin authorization before a support operation can reach the service", async () => {
    const operation = vi.fn();

    await expect(runAuthenticatedGamificationOperation(
      async () => { throw new Error("Unauthorized: Admin access required"); },
      operation,
    )).rejects.toThrow("Unauthorized: Admin access required");

    expect(operation).not.toHaveBeenCalled();
  });

  it("creates one idempotent admin_manual claim and Badge with Badge-only 0/0 accounting", async () => {
    const { store, accounting } = supportFixture();

    const first = await accounting.recordManualAward(manualInput(), adminAudit("manual-badge-only"));
    const repeated = await accounting.recordManualAward(manualInput(), adminAudit("manual-badge-only"));

    expect(first).toMatchObject({ totalXp: 0, leaderboardXp: 0 });
    expect(repeated).toMatchObject({ claimId: first.claimId, badgeId: first.badgeId, totalXp: 0, leaderboardXp: 0 });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toEqual([
      expect.objectContaining({ source_type: "admin_manual", status: "accepted" }),
    ]);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions, { action: "manual_award" })).toEqual([
      expect.objectContaining({ status: "applied", target_user: "user-1", actor: "admin-1" }),
    ]);
  });

  it("replays mutable-state admin repairs with the original operation ID", async () => {
    const { accounting } = supportFixture();
    const input = manualInput({ mode: "missed_evidence" });
    const audit = adminAudit("repair-same-manual-award");

    const first = await accounting.recordManualAward(input, audit);
    const replayed = await accounting.recordManualAward(input, audit);

    expect(replayed).toMatchObject({
      claimId: first.claimId,
      badgeId: first.badgeId,
      totalXp: first.totalXp,
      leaderboardXp: first.leaderboardXp,
    });
  });

  it("rejects a manual award that combines an unrelated Activity and Achievement", async () => {
    const { store, accounting } = supportFixture();
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "unrelated-achievement",
      key: "unrelated-achievement",
      badge_name: "Unrelated Badge",
      badge_description: "Must not use another Activity policy.",
      category: "attendance",
      rarity: "common",
      visibility: "public",
      status: "active",
      unlock_rule: { kind: "manual_only" },
      sort_order: 1,
      created: timestamp,
      updated: timestamp,
    });

    await expect(accounting.recordManualAward(
      manualInput({ achievementId: "unrelated-achievement", mode: "missed_evidence" }),
      adminAudit("unrelated-manual-award"),
    )).rejects.toThrow("configured together");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
  });

  it("uses total Activity policy for missed evidence but defaults its Leaderboard XP to zero", async () => {
    const { store, accounting } = supportFixture();

    const result = await accounting.recordManualAward(manualInput({ mode: "missed_evidence" }), adminAudit("missed-evidence"));
    const [event] = await store.list<{ amount: number; leaderboard_amount: number }>(GAMIFICATION_COLLECTIONS.xpEvents);

    expect(result).toMatchObject({ totalXp: 20, leaderboardXp: 0 });
    expect(event).toMatchObject({ amount: 20, leaderboard_amount: 0 });
  });

  it("requires a confirmed, referenced accounting error before a manual award can affect ranking", async () => {
    const { store, accounting } = supportFixture();

    await expect(accounting.recordManualAward(manualInput({
      mode: "missed_evidence",
      rankingError: "automation",
      supportReference: "SUP-42",
    }), adminAudit("manual-ranking-unconfirmed"))).rejects.toThrow("high-impact confirmation");

    const result = await accounting.recordManualAward(manualInput({
      mode: "missed_evidence",
      rankingError: "automation",
      supportReference: "SUP-42",
      highImpactConfirmed: true,
    }), adminAudit("manual-ranking-confirmed"));

    expect(result).toMatchObject({ totalXp: 20, leaderboardXp: 10 });
    expect(await store.list<{ amount: number; leaderboard_amount: number }>(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual([
      expect.objectContaining({ amount: 20, leaderboard_amount: 10 }),
    ]);
  });

  it("keeps Badge revocation, XP voiding, and signed corrections independent", async () => {
    const { store, accounting } = supportFixture();
    await accounting.recordActivityAward(awardInput());
    const [badge] = await store.list<{ id: string; status: string }>(GAMIFICATION_COLLECTIONS.userAchievements);
    const [awardEvent] = await store.list<{ id: string; voided: boolean }>(GAMIFICATION_COLLECTIONS.xpEvents);

    await accounting.revokeBadge(badge.id, adminAudit("revoke-only"));
    expect(await store.getById<{ voided: boolean }>(GAMIFICATION_COLLECTIONS.xpEvents, awardEvent.id)).toMatchObject({ voided: false });

    await accounting.recordXpCorrection({ amount: -5, leaderboardAmount: 0, highImpactConfirmed: true }, adminAudit("negative-correction"));
    expect(await store.getById<{ status: string }>(GAMIFICATION_COLLECTIONS.userAchievements, badge.id)).toMatchObject({ status: "revoked" });

    await accounting.voidXpEvent(awardEvent.id, adminAudit("void-only"));
    expect(await store.getById<{ status: string }>(GAMIFICATION_COLLECTIONS.userAchievements, badge.id)).toMatchObject({ status: "revoked" });
    expect(await store.list<{ source_type: string; amount: number }>(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_type: "admin_correction", amount: -5 }),
    ]));
  });

  it("binds an admin operation ID to its original correction payload", async () => {
    const { accounting } = supportFixture();
    await accounting.recordXpCorrection(
      { amount: 5, leaderboardAmount: 0 },
      adminAudit("payload-bound-correction"),
    );

    await expect(accounting.recordXpCorrection(
      { amount: 6, leaderboardAmount: 0 },
      adminAudit("payload-bound-correction"),
    )).rejects.toThrow("another accounting action");
  });

  it("binds accounting operation IDs to evidence time and original XP source", async () => {
    const { accounting } = supportFixture();
    await accounting.recordManualAward(
      manualInput({ occurredAt: "2026-09-01T12:00:00.000Z" }),
      adminAudit("time-bound-manual-award"),
    );
    await expect(accounting.recordManualAward(
      manualInput({ occurredAt: "2026-09-01T12:01:00.000Z" }),
      adminAudit("time-bound-manual-award"),
    )).rejects.toThrow("another accounting action");

    await accounting.recordXpCorrection(
      { amount: 5, leaderboardAmount: 0, originalXpEventId: "xp-event-1" },
      adminAudit("source-bound-correction"),
    );
    await expect(accounting.recordXpCorrection(
      { amount: 5, leaderboardAmount: 0, originalXpEventId: "xp-event-2" },
      adminAudit("source-bound-correction"),
    )).rejects.toThrow("another accounting action");
  });

  it("records a separate restored Badge after an audited revocation", async () => {
    const { store, accounting } = supportFixture();
    const first = await accounting.recordManualAward(manualInput(), adminAudit("award-before-revocation"));
    await accounting.revokeBadge(first.badgeId, adminAudit("revoke-before-restoration"));
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      id: "activity-badge-restoration",
      key: "admin.badge.restoration",
      kind: "admin_manual",
      category: "admin_manual",
      outcome_key: "manual_award",
      evidence_mode: "admin_manual",
      achievement: "achievement-1",
      per_user_claim_limit: 1,
      status: "active",
      enabled: true,
      created: timestamp,
      updated: timestamp,
    });

    const restored = await accounting.recordManualAward(manualInput({ activityId: "activity-badge-restoration" }), adminAudit("restore-revoked-badge"));
    const badges = await store.list<{ id: string; status: string }>(GAMIFICATION_COLLECTIONS.userAchievements);

    expect(restored.badgeId).not.toBe(first.badgeId);
    expect(badges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.badgeId, status: "revoked" }),
      expect.objectContaining({ id: restored.badgeId, status: "unlocked" }),
    ]));
  });

  it("requires separate confirmation before a signed correction can alter Leaderboard XP", async () => {
    const { accounting } = supportFixture();
    const correction = {
      amount: 20,
      leaderboardAmount: 10,
      activityId: "activity-checked-in",
      supportReference: "SUP-43",
      rankingError: "prior_accounting" as const,
    };

    await expect(accounting.recordXpCorrection(correction, adminAudit("correction-ranking-unconfirmed")))
      .rejects.toThrow("high-impact confirmation");
    await expect(accounting.recordXpCorrection({ ...correction, highImpactConfirmed: true }, adminAudit("correction-ranking-confirmed")))
      .resolves.toMatchObject({ amount: 20, leaderboard_amount: 10, source_type: "admin_correction" });
  });

  it("retains authoritative writes as rebuild_pending and repairs only the profile cache", async () => {
    const { store, accounting } = supportFixture();
    store.failNextUpdate(GAMIFICATION_COLLECTIONS.profiles);

    await expect(accounting.recordManualAward(manualInput(), adminAudit("manual-rebuild-failure"))).rejects.toThrow("Simulated");

    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions, { action: "manual_award" })).toEqual([
      expect.objectContaining({ status: "rebuild_pending" }),
    ]);

    await accounting.rebuildProfileWithAudit({ id: "user-1", name: "Ada Admin" }, adminAudit("repair-user-1"));

    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions, { action: "manual_award" })).toEqual([
      expect.objectContaining({ status: "applied" }),
    ]);
  });

  it("does not resolve a pending action when its authoritative records were never written", async () => {
    const { store, accounting } = supportFixture();
    store.seed(GAMIFICATION_COLLECTIONS.adminActions, {
      id: "interrupted-manual-award",
      actor: "admin-1",
      actor_role: "admin",
      target_user: "user-1",
      action: "manual_award",
      status: "rebuild_pending",
      reason: "Interrupted before authoritative records",
      correlation_id: "interrupted-operation",
      idempotency_key: "admin-action:v1:manual_award:interrupted-operation",
      related_collection: GAMIFICATION_COLLECTIONS.activities,
      related_record_id: "activity-checked-in",
      after_summary: { achievementId: "achievement-1", totalXpDelta: 0, leaderboardXpDelta: 0 },
      created: timestamp,
      updated: timestamp,
    });

    await accounting.rebuildProfileWithAudit({ id: "user-1", name: "Ada Admin" }, adminAudit("repair-only-cache"));

    expect(await store.getById<{ status: string }>(GAMIFICATION_COLLECTIONS.adminActions, "interrupted-manual-award"))
      .toMatchObject({ status: "rebuild_pending" });
  });
});

describe("admin gamification support search", () => {
  it("returns only the exact case and redacts raw accounting details from history", async () => {
    const store = new MemoryGamificationStore();
    seedUser(store, "user-1", { email: "ada@example.com", name: "Ada Lovelace" });
    seedUser(store, "user-2", { email: "other@example.com", name: "Other User" });
    seedAchievement(store);
    seedActivity(store);
    seedSchedule(store);
    const generated = seedMissionCode(store, { label: "Support booth code" });
    store.seed(GAMIFICATION_COLLECTIONS.codeRedemptions, {
      id: "redemption-support-1",
      user: "user-1",
      code: "code-1",
      activity: "activity-code",
      status: "accepted",
      redeemed_at: timestamp,
      idempotency_key: "support-redemption",
      request_fingerprint: "private-request-fingerprint",
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
      id: "claim-hievents-1",
      user: "user-1",
      activity: "activity-checked-in",
      source_type: "hievents_checkin",
      source_record_id: "hievents-checkin-42",
      outcome_key: "checked_in",
      status: "accepted",
      occurred_at: timestamp,
      claimed_at: timestamp,
      evidence_fingerprint: "private-fingerprint",
      idempotency_key: "claim-hievents-1",
      cap_outcome: { awarded_total_xp: 20, awarded_leaderboard_xp: 10, policy: "attendance" },
       metadata: {
         hievents: { attendeeStableId: "attendee-42" },
         payment: "never expose",
         ticket_url: "https://tickets.example/private",
         ticket_type: "VIP",
         ticket_price: 999,
       },
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.adminActions, {
      id: "audit-support-1",
      actor: "admin-1",
      actor_role: "admin",
      target_user: "user-1",
      action: "manual_award",
      status: "applied",
      reason: "Ticket URL https://tickets.example/private and payment details",
      correlation_id: "SUP-42",
      idempotency_key: "audit-support-1",
      metadata: { api_token: "never expose" },
      created: timestamp,
      updated: timestamp,
    });
    const support = new GamificationAdminSupportService(store);

    const byCode = await support.search("Support booth code");
    const byHiEvents = await support.search("attendee-42");
    const bySupportReference = await support.search("SUP-42");
    const serialized = JSON.stringify(byCode);

    expect(byCode.cases).toHaveLength(1);
    expect(byCode.cases[0].user).toMatchObject({ id: "user-1", email: "ada@example.com" });
    expect(byHiEvents.cases).toHaveLength(1);
    expect(bySupportReference.cases).toHaveLength(1);
    expect(await support.search("Ada")).toMatchObject({ cases: [], historyPage: 1, historyPerPage: 50 });
    expect(serialized).not.toContain(generated.rawCode);
    expect(serialized).not.toContain(generated.definition.codeHash);
    expect(serialized).not.toContain("private-request-fingerprint");
    expect(serialized).not.toContain("tickets.example");
    expect(serialized).not.toContain("payment details");
    expect(serialized).not.toContain("VIP");
    expect(serialized).not.toContain("999");
    expect(serialized).not.toContain("other@example.com");
  });
});

function seedHiEventsConference(store: MemoryGamificationStore): void {
  seedUser(store, "user-1", { email: "ada@example.com", name: "Ada Lovelace" });
  store.seed(GAMIFICATION_COLLECTIONS.missions, {
    id: "mission-main",
    key: "conference.main",
    slug: "conference-main",
    title: "Main conference",
    summary: "Passive conference progress.",
    category: "attendance",
    visibility: "public",
    status: "active",
    suggested: false,
    sort_order: 1,
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.achievements, {
    id: "ticket-achievement",
    key: "conference-main-ticket",
    badge_name: "Ticket confirmed",
    badge_description: "Your conference ticket is recorded.",
    category: "attendance",
    rarity: "common",
    visibility: "public",
    status: "active",
    unlock_rule: { kind: "activity_claim" },
    sort_order: 1,
    created: timestamp,
    updated: timestamp,
  });
  store.seed(GAMIFICATION_COLLECTIONS.achievements, {
    id: "checkin-achievement",
    key: "conference-main-checkin",
    badge_name: "Checked in",
    badge_description: "Your venue check-in is recorded.",
    category: "attendance",
    rarity: "common",
    visibility: "public",
    status: "active",
    unlock_rule: { kind: "activity_claim" },
    sort_order: 2,
    created: timestamp,
    updated: timestamp,
  });
  for (const activity of [
    {
      id: "main-ticket",
      key: "conference.main.ticket_present",
      outcome_key: "ticket_present",
      evidence_mode: "hievents_ticket",
      achievement: "ticket-achievement",
    },
    {
      id: "main-checkin",
      key: "conference.main.checked_in",
      outcome_key: "checked_in",
      evidence_mode: "hievents_checkin",
      achievement: "checkin-achievement",
    },
  ]) {
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      ...activity,
      mission: "mission-main",
      kind: "hievents",
      category: "attendance",
      event_ref: { eventId: "main-event" },
      per_user_claim_limit: 1,
      max_claims: 100,
      status: "active",
      enabled: true,
      created: timestamp,
      updated: timestamp,
    });
  }
  store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
    id: "main-schedule",
    key: "main-score",
    status: "active",
    effective_at: timestamp,
    total_xp_ceiling: 30,
    leaderboard_xp_ceiling: 10,
    access_level_thresholds: { "1": 0, "2": 2, "3": 5, "4": 9, "5": 15, "6": 23, "7": 30 },
    created: timestamp,
    updated: timestamp,
  });
  for (const policy of [
    { id: "main-ticket-policy", activity: "main-ticket", key: "main-ticket", total: 10, leaderboard: 0 },
    { id: "main-checkin-policy", activity: "main-checkin", key: "main-checkin", total: 20, leaderboard: 10 },
  ]) {
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: policy.id,
      schedule: "main-schedule",
      activity: policy.activity,
      policy_key: policy.key,
      active: true,
      total_xp: policy.total,
      leaderboard_xp: policy.leaderboard,
      cap_membership: [{ dimension: "activity", key: policy.activity }],
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
      id: `${policy.id}-cap`,
      schedule: "main-schedule",
      dimension: "activity",
      cap_key: policy.activity,
      member_policy_keys: [policy.key],
      total_xp_ceiling: policy.total,
      leaderboard_xp_ceiling: policy.leaderboard,
      created: timestamp,
      updated: timestamp,
    });
  }
}

function attendee(overrides: Partial<HiEventsSourceAttendee> = {}): HiEventsSourceAttendee {
  return {
    stableId: "attendee-1",
    email: "Ada@Example.com",
    normalizedEmail: "ada@example.com",
    eligibility: "eligible",
    checkedIn: true,
    checkInStableId: "checkin-1",
    checkedInAt: timestamp,
    sourceUpdatedAt: timestamp,
    ...overrides,
  };
}

function completeSnapshot(attendees: HiEventsSourceAttendee[]) {
  return {
    state: "success" as const,
    eventId: "main-event",
    fetchedAt: timestamp,
    sourceUpdatedAt: timestamp,
    pagination: { requestedPages: 2, completedPages: 2, totalPages: 2, complete: true },
    attendees,
  };
}

async function withHiEventsEvent<T>(work: () => Promise<T>): Promise<T> {
  const previous = process.env.HIEVENTS_EVENT_ID;
  process.env.HIEVENTS_EVENT_ID = "main-event";
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env.HIEVENTS_EVENT_ID;
    else process.env.HIEVENTS_EVENT_ID = previous;
  }
}

describe("Hi.Events gamification evidence", () => {
  it("matches only normalized authenticated email and awards fixed ticket/check-in outcomes once", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    let snapshot = completeSnapshot([attendee()]);
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => snapshot,
    });

    const result = await evidence.refreshCurrentUser({ id: "user-1", email: " ADA@EXAMPLE.COM " });
    await evidence.refreshCurrentUser({ id: "user-1", email: "ada@example.com" });

    expect(result.state).toBe("checked_in");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "accepted" })).toHaveLength(2);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { status: "unlocked" })).toHaveLength(2);
    expect(await store.list<{ amount: number; leaderboard_amount: number }>(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: 10, leaderboard_amount: 0 }),
      expect.objectContaining({ amount: 20, leaderboard_amount: 10 }),
    ]));
    expect((await store.list<{ total_xp: number; leaderboard_xp: number }>(GAMIFICATION_COLLECTIONS.profiles))[0]).toMatchObject({ total_xp: 30, leaderboard_xp: 10 });

    snapshot = completeSnapshot([attendee({ email: "ada+ticket@example.com", normalizedEmail: "ada+ticket@example.com" })]);
    expect((await evidence.refreshCurrentUser({ id: "user-1", email: "ada@example.com" })).state).toBe("no_ticket");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "accepted" })).toHaveLength(2);
  }));

  it("retains Hi.Events claims and Badges when independent XP caps are exhausted", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    await store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, "main-ticket-policy-cap", {
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
    });
    await store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, "main-checkin-policy-cap", {
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
    });
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => completeSnapshot([attendee()]),
    });

    expect(await evidence.refreshCurrentUser({ id: "user-1", email: "ada@example.com" }))
      .toMatchObject({ state: "checked_in", ticketPresent: true, checkedIn: true });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "accepted" })).toHaveLength(2);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { status: "unlocked" })).toHaveLength(2);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(0);
  }));

  it("does not silently restore an administratively revoked Hi.Events Badge on refresh", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => completeSnapshot([attendee()]),
    });
    await evidence.refreshCurrentUser({ id: "user-1", email: "ada@example.com" });
    const badge = await store.findOne<any>(GAMIFICATION_COLLECTIONS.userAchievements, {
      user: "user-1",
      achievement: "checkin-achievement",
      status: "unlocked",
    });
    await service(store).revokeBadge(badge!.id, {
      actor: "admin-1",
      actorRole: "admin",
      targetUser: "user-1",
      reason: "Verified source correction",
      operationId: "revoke-checkin-badge",
    });

    await evidence.refreshCurrentUser({ id: "user-1", email: "ada@example.com" });
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, {
      user: "user-1",
      achievement: "checkin-achievement",
      status: "unlocked",
    })).toHaveLength(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, {
      user: "user-1",
      achievement: "checkin-achievement",
      status: "revoked",
    })).toHaveLength(1);
  }));

  it("does not create source evidence from partial or unavailable adapter results", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => ({
        state: "partial" as const,
        eventId: "main-event",
        fetchedAt: timestamp,
        pagination: { requestedPages: 2, completedPages: 1, totalPages: 2, complete: false },
        reason: "request" as const,
      }),
    });

    expect((await evidence.refreshCurrentUser({ id: "user-1", email: "ada@example.com" })).state).toBe("unavailable");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
  }));

  it("requires a complete admin snapshot before source corrections and audits complete-source voids", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    let snapshot: any = completeSnapshot([attendee()]);
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => snapshot,
    });
    const firstPreview = await evidence.previewAdminReconciliation();
    await evidence.applyAdminReconciliation({ id: "admin-1" }, firstPreview.snapshotFingerprint!, "initial-source-sync");
    snapshot = {
      state: "partial",
      eventId: "main-event",
      fetchedAt: timestamp,
      pagination: { requestedPages: 2, completedPages: 1, totalPages: 2, complete: false },
      reason: "request",
    };
    expect((await evidence.applyAdminReconciliation({ id: "admin-1" }, "previous-preview", "partial-source-sync")).state).toBe("partial");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "accepted" })).toHaveLength(2);
    expect(await store.list(GAMIFICATION_COLLECTIONS.hiEventsSyncRuns, {
      actor: "admin-1",
      result_state: "partial",
    })).toHaveLength(1);

    snapshot = completeSnapshot([]);
    const correctionPreview = await evidence.previewAdminReconciliation();
    const reconciled = await evidence.applyAdminReconciliation({ id: "admin-1" }, correctionPreview.snapshotFingerprint!, "source-correction-sync");
    const replayed = await evidence.applyAdminReconciliation({ id: "admin-1" }, correctionPreview.snapshotFingerprint!, "source-correction-sync");
    expect(reconciled.applied).toMatchObject({ corrections: 2 });
    expect(replayed.applied).toMatchObject({ corrections: 2 });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "voided" })).toHaveLength(2);
    expect(await store.list<{ voided: boolean }>(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual(expect.arrayContaining([
      expect.objectContaining({ voided: true }),
    ]));
    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions, { action: "void_activity_claim", status: "applied" })).toHaveLength(2);
    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions, { action: "hievents_reconciliation", status: "applied" })).toEqual([
      expect.objectContaining({ actor: "admin-1", correlation_id: "initial-source-sync" }),
      expect.objectContaining({ actor: "admin-1", correlation_id: "source-correction-sync" }),
    ]);
    const runs = await store.list<{ actor?: string; admin_action?: string }>(GAMIFICATION_COLLECTIONS.hiEventsSyncRuns);
    expect(runs.filter((run) => run.actor === "admin-1" && run.admin_action)).not.toHaveLength(0);
  }));

  it("does not revoke accepted evidence when a complete snapshot has an unrecognized source status", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    let snapshot = completeSnapshot([attendee()]);
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => snapshot,
    });
    const initial = await evidence.previewAdminReconciliation();
    await evidence.applyAdminReconciliation({ id: "admin-1" }, initial.snapshotFingerprint!, "known-status-sync");

    snapshot = completeSnapshot([attendee({ eligibility: "unknown", sourceStatus: "pending_review" })]);
    const uncertain = await evidence.previewAdminReconciliation();
    const applied = await evidence.applyAdminReconciliation({ id: "admin-1" }, uncertain.snapshotFingerprint!, "unknown-status-sync");

    expect(uncertain.proposed.corrections).toBe(0);
    expect(applied.applied?.corrections).toBe(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "accepted" })).toHaveLength(2);
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "voided" })).toHaveLength(0);
  }));

  it("does not revoke accepted evidence when an attendee temporarily has no usable email", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    let snapshot: any = completeSnapshot([attendee()]);
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => snapshot,
    });
    const initial = await evidence.previewAdminReconciliation();
    await evidence.applyAdminReconciliation({ id: "admin-1" }, initial.snapshotFingerprint!, "email-present-sync");

    snapshot = await fetchHiEventsAttendeeSnapshot({
      apiUrl: "https://hievents.example",
      eventId: "main-event",
      accessToken: "test-token",
      fetcher: async () => new Response(JSON.stringify({
        data: [{ id: "attendee-1", status: "active" }],
        meta: { last_page: 1 },
      }), { status: 200 }),
      now: () => timestamp,
    });
    expect(snapshot).toMatchObject({
      state: "success",
      attendees: [expect.objectContaining({ stableId: "attendee-1", normalizedEmail: "", eligibility: "unknown" })],
    });

    const uncertain = await evidence.previewAdminReconciliation();
    const applied = await evidence.applyAdminReconciliation({ id: "admin-1" }, uncertain.snapshotFingerprint!, "email-missing-sync");
    expect(uncertain.proposed.corrections).toBe(0);
    expect(applied.applied?.corrections).toBe(0);
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "accepted" })).toHaveLength(2);

    snapshot = await fetchHiEventsAttendeeSnapshot({
      apiUrl: "https://hievents.example",
      eventId: "main-event",
      accessToken: "test-token",
      fetcher: async () => new Response(JSON.stringify({
        data: [{ id: "attendee-1", email: "ada@example..com", status: "active" }],
        meta: { last_page: 1 },
      }), { status: 200 }),
      now: () => timestamp,
    });
    expect(snapshot).toMatchObject({
      state: "success",
      attendees: [expect.objectContaining({ stableId: "attendee-1", normalizedEmail: "", eligibility: "unknown" })],
    });
    const malformedEmail = await evidence.previewAdminReconciliation();
    expect(malformedEmail.proposed.corrections).toBe(0);
  }));

  it("rejects an admin apply when the complete source changed after preview", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    let snapshot = completeSnapshot([attendee()]);
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => snapshot,
    });
    const preview = await evidence.previewAdminReconciliation();
    snapshot = completeSnapshot([attendee({ stableId: "attendee-2", checkInStableId: "checkin-2" })]);

    await expect(evidence.applyAdminReconciliation({ id: "admin-1" }, preview.snapshotFingerprint!, "changed-source-sync"))
      .rejects.toThrow("changed after the preview");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
  }));

  it("persists ambiguous admin matches for support without awarding either User", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    seedUser(store, "user-2", { email: "ada@example.com", name: "Other Ada" });
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => completeSnapshot([attendee()]),
    });
    const preview = await evidence.previewAdminReconciliation();
    await evidence.applyAdminReconciliation({ id: "admin-1" }, preview.snapshotFingerprint!, "ambiguous-source-sync");

    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
    const support = await new GamificationAdminSupportService(store).search("ada@example.com");
    expect(support.cases).toHaveLength(2);
    expect(support.cases.map((caseFile) => caseFile.status.hiEvents.reconciliationState)).toEqual(["ambiguous", "ambiguous"]);
  }));

  it("records corrected check-in support metadata without another claim or XP event", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    let snapshot = completeSnapshot([attendee()]);
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => snapshot,
    });
    await evidence.refreshCurrentUser({ id: "user-1", email: "ada@example.com" });
    snapshot = completeSnapshot([attendee({ checkInStableId: "checkin-corrected", checkedInAt: "2026-09-01T13:00:00.000Z" })]);
    await evidence.refreshCurrentUser({ id: "user-1", email: "ada@example.com" });

    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { status: "accepted" })).toHaveLength(2);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(2);
    const runs = await store.list<{ checked_in_at?: string; checkin_id?: string }>(GAMIFICATION_COLLECTIONS.hiEventsSyncRuns, { user: "user-1" });
    expect(runs.at(-1)).toMatchObject({ checkin_id: "checkin-corrected", checked_in_at: "2026-09-01T13:00:00.000Z" });
  }));

  it("transfers stable Hi.Events evidence only after a complete snapshot uniquely reassigns its email", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    seedUser(store, "user-2", { email: "grace@example.com", name: "Grace" });
    let snapshot = completeSnapshot([attendee()]);
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => snapshot,
    });
    const first = await evidence.previewAdminReconciliation();
    await evidence.applyAdminReconciliation({ id: "admin-1" }, first.snapshotFingerprint!, "initial-owner-sync");

    snapshot = completeSnapshot([attendee({
      email: "grace@example.com",
      normalizedEmail: "grace@example.com",
    })]);
    const transfer = await evidence.previewAdminReconciliation();
    expect(transfer.proposed).toMatchObject({ corrections: 2, ticketClaims: 1, checkinClaims: 1 });
    await evidence.applyAdminReconciliation({ id: "admin-1" }, transfer.snapshotFingerprint!, "transferred-owner-sync");

    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { user: "user-1", status: "voided" })).toHaveLength(2);
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { user: "user-2", status: "accepted" })).toHaveLength(2);
  }));

  it("does not award a duplicated Hi.Events stable ID associated with different emails", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    seedUser(store, "user-2", { email: "grace@example.com", name: "Grace" });
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => completeSnapshot([
        attendee(),
        attendee({ email: "grace@example.com", normalizedEmail: "grace@example.com" }),
      ]),
    });

    const preview = await evidence.previewAdminReconciliation();
    expect(preview.proposed).toEqual({ ticketClaims: 0, checkinClaims: 0, corrections: 0 });
    expect(preview.matchCounts.ambiguousMatches).toBe(1);
    await evidence.applyAdminReconciliation({ id: "admin-1" }, preview.snapshotFingerprint!, "duplicate-stable-id-sync");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
  }));

  it("rejects Mission codes as Hi.Events audit operation IDs before writing source history", async () => {
    const store = new MemoryGamificationStore();
    const operationId = createMissionCodeGeneration(missionCodePepper).rawCode.split("").join(" ");

    await expect(new GamificationHiEventsEvidenceService(store).applyAdminReconciliation(
      { id: "admin-1" },
      "snapshot-fingerprint",
      operationId,
    )).rejects.toThrow("operation IDs must not contain Mission codes");
    expect(await store.list(GAMIFICATION_COLLECTIONS.adminActions)).toEqual([]);
    expect(await store.list(GAMIFICATION_COLLECTIONS.hiEventsSyncRuns)).toEqual([]);
  });

  it("keeps user and public Hi.Events DTOs free of ticket metadata", async () => withHiEventsEvent(async () => {
    const store = new MemoryGamificationStore();
    seedHiEventsConference(store);
    const evidence = new GamificationHiEventsEvidenceService(store, {
      clock: () => timestamp,
      fetchSnapshot: async () => completeSnapshot([attendee({ ticketTitle: "VIP", ticketPrice: 999, publicUrl: "https://tickets.example/private" })]),
    });
    const status = await evidence.refreshCurrentUser({ id: "user-1", email: "ada@example.com" });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("VIP");
    expect(serialized).not.toContain("tickets.example");
    expect(serialized).not.toContain("999");
    expect(status).toMatchObject({ state: "checked_in", ticketPresent: true, checkedIn: true });
  }));

  it("keeps Hi.Events source metadata and ticket-state Badges out of public ops-board rows", () => {
    const rows = buildGamificationPublicOpsBoardRows(
      [{
        id: "profile-hievents",
        user: "user-1",
        total_xp: 30,
        leaderboard_xp: 10,
        access_level: 2,
        access_level_threshold: 2,
        next_level_threshold: 5,
        xp_into_level: 28,
        xp_to_next_level: 0,
        unlocked_badge_count: 1,
        ops_board_visible: true,
        ops_board_display_name: "Ada",
        public_badges_visible: true,
        totals_version: 1,
        totals_recalculated_at: timestamp,
        created: timestamp,
        updated: timestamp,
      } as any],
      [{
        id: "badge-hievents",
        user: "user-1",
        achievement: "hievents-achievement",
        status: "unlocked",
        unlocked_at: timestamp,
        source_claim: "private-attendee-claim",
        idempotency_key: "badge-hievents",
        public_visible: true,
        metadata: { ticketType: "VIP", checkedInAt: timestamp },
        created: timestamp,
        updated: timestamp,
      } as any],
      [{
        id: "hievents-achievement",
        key: "conference-main-checkin",
        badge_name: "Checked in",
        badge_description: "Private source details are hidden.",
        category: "attendance",
        rarity: "common",
        visibility: "public",
        status: "active",
        unlock_rule: { kind: "activity_claim" },
        sort_order: 1,
        metadata: { ticketPrice: 999, ticketUrl: "https://tickets.example/private" },
        created: timestamp,
        updated: timestamp,
      } as any],
    );
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("VIP");
    expect(serialized).not.toContain("tickets.example");
    expect(serialized).not.toContain("999");
    expect(rows[0]).toMatchObject({ leaderboardXp: 10, publicBadgeCount: 0, badges: [] });
  });

  it("does not depend on Hi.Events when redeeming a local Mission code", async () => {
    const store = new MemoryGamificationStore();
    seedAchievement(store);
    seedCodeRedemptionActivity(store);
    seedCodeRedemptionSchedule(store);
    const generated = seedMissionCode(store);
    const previousUrl = process.env.HIEVENTS_API_URL;
    delete process.env.HIEVENTS_API_URL;
    try {
      await expect(redemptionService(store).redeem(redemptionInput(generated.rawCode))).resolves.toMatchObject({ status: "accepted" });
    } finally {
      if (previousUrl === undefined) delete process.env.HIEVENTS_API_URL;
      else process.env.HIEVENTS_API_URL = previousUrl;
    }
  });
});

describe("sponsor booth Activities and partner consent", () => {
  const sponsorId = "sponsor-northstar";
  const sponsorBoothGroup = "booth.northstar.product-demo";
  const boothScheduleId = "booth-schedule";

  function seedSponsor(store: MemoryGamificationStore): void {
    store.seed("partners", {
      id: sponsorId,
      name: "Northstar Systems",
      type: "sponsor",
      published: true,
      logo: "northstar.svg",
      created: timestamp,
      updated: timestamp,
    });
  }

  function seedConfiguredBooth(store: MemoryGamificationStore, partnerFollowUp = false): void {
    seedSponsor(store);
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      id: boothScheduleId,
      key: "wts-2026-booths",
      status: "active",
      effective_at: timestamp,
      total_xp_ceiling: 35,
      leaderboard_xp_ceiling: 25,
      access_level_thresholds: { "1": 0 },
      created: timestamp,
      updated: timestamp,
    });
    const outcomes = [
      ["visit", 5, 5],
      ["participation", 10, 10],
      ["completion", 20, 15],
      ["win", 30, 25],
      ["high_score", 35, 25],
    ] as const;
    for (const [outcome, totalXp, leaderboardXp] of outcomes) {
      const activityId = `booth-${outcome}`;
      const achievementId = `badge-${outcome}`;
      const policyKey = `booth.${sponsorId}.${outcome}`;
      store.seed(GAMIFICATION_COLLECTIONS.achievements, {
        id: achievementId,
        key: policyKey,
        badge_name: `Northstar ${outcome}`,
        badge_description: `WTS evidence for ${outcome}.`,
        category: "booth",
        rarity: "common",
        visibility: "public",
        status: "active",
        unlock_rule: { kind: "activity_claim" },
        sort_order: 1,
        created: timestamp,
        updated: timestamp,
      });
      store.seed(GAMIFICATION_COLLECTIONS.activities, {
        id: activityId,
        key: policyKey,
        kind: "booth",
        category: "booth",
        outcome_key: outcome,
        evidence_mode: "single_code",
        evidence_channel: "wts_qr",
        deployment_label: "WTS booth artifact",
        achievement: achievementId,
        partner: sponsorId,
        partner_kind: "sponsor",
        per_user_claim_limit: 1,
        max_claims: 100,
        active_from: "2026-09-01T00:00:00.000Z",
        active_until: "2026-09-30T23:59:59.000Z",
        partner_follow_up_enabled: partnerFollowUp,
        partner_follow_up_notice_version: partnerFollowUp ? "2026-09-v1" : "",
        status: "active",
        enabled: true,
        created: timestamp,
        updated: timestamp,
      });
      store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
        id: `policy-${outcome}`,
        schedule: boothScheduleId,
        activity: activityId,
        policy_key: policyKey,
        active: true,
        total_xp: totalXp,
        leaderboard_xp: leaderboardXp,
        cap_membership: [
          { dimension: "activity", key: activityId },
          { dimension: "related_group", key: sponsorBoothGroup },
          { dimension: "partner", key: sponsorId },
          { dimension: "category", key: "booth" },
          { dimension: "conference_day", key: "2026-09-19" },
          { dimension: "conference", key: "conference" },
        ],
        score_day: "2026-09-19",
        created: timestamp,
        updated: timestamp,
      });
      store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
        id: `activity-cap-${outcome}`,
        schedule: boothScheduleId,
        dimension: "activity",
        cap_key: activityId,
        member_policy_keys: [policyKey],
        total_xp_ceiling: totalXp,
        leaderboard_xp_ceiling: leaderboardXp,
        created: timestamp,
        updated: timestamp,
      });
    }
    const memberPolicyKeys = outcomes.map(([outcome]) => `booth.${sponsorId}.${outcome}`);
    for (const dimension of ["related_group", "partner"] as const) {
      store.seed(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, {
        id: `${dimension}-booth-cap`,
        schedule: boothScheduleId,
        dimension,
        cap_key: dimension === "partner" ? sponsorId : sponsorBoothGroup,
        member_policy_keys: memberPolicyKeys,
        total_xp_ceiling: 35,
        leaderboard_xp_ceiling: 25,
        created: timestamp,
        updated: timestamp,
      });
    }
  }

  function seedBoothCode(store: MemoryGamificationStore, id: string, activity = "booth-visit") {
    const generated = createMissionCodeGeneration(missionCodePepper);
    store.seed(GAMIFICATION_COLLECTIONS.codes, {
      id,
      key: id,
      label: "WTS Northstar deployment",
      activity,
      lookup_prefix: generated.definition.lookupPrefix,
      code_hash: generated.definition.codeHash,
      hash_version: generated.definition.hashVersion,
      evidence_role: "single",
      status: "active",
      enabled: true,
      per_user_limit: 1,
      total_redemptions_cached: 0,
      created_by: "admin-1",
      created: timestamp,
      updated: timestamp,
    });
    return generated;
  }

  it("rejects non-WTS evidence for configured sponsor booths", async () => {
    const store = new MemoryGamificationStore();
    seedConfiguredBooth(store);

    await expect(service(store).recordActivityAward({
      claim: {
        user: "user-1",
        activity: "booth-visit",
        sourceType: "code_redemption",
        outcomeKey: "visit",
        occurredAt: timestamp,
        evidenceFingerprint: "external-partner-form",
        idempotencyKey: "external-partner-form",
      },
    })).rejects.toThrow("verified WTS Mission code redemption");
    await expect(service(store).recordActivityAward({
      claim: {
        user: "user-1",
        activity: "booth-high_score",
        sourceType: "code_redemption",
        outcomeKey: "high_score",
        occurredAt: timestamp,
        evidenceFingerprint: "unlinked-high-score-code",
        idempotencyKey: "unlinked-high-score-code",
      },
    })).rejects.toThrow("verified WTS Mission code redemption");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toHaveLength(0);
  });

  it("accepts a high-tier outcome only through its own WTS code without inferring lower tiers", async () => {
    const store = new MemoryGamificationStore();
    seedConfiguredBooth(store);
    const winCode = seedBoothCode(store, "booth-win-code", "booth-win");

    await expect(service(store).recordActivityAward({
      claim: {
        user: "user-1",
        activity: "booth-high_score",
        sourceType: "code_redemption",
        outcomeKey: "high_score",
        occurredAt: timestamp,
        evidenceFingerprint: "staff-score-assertion",
        idempotencyKey: "staff-score-assertion",
      },
    })).rejects.toThrow("verified WTS Mission code redemption");

    const result = await redemptionService(store).redeem(redemptionInput(winCode.rawCode));

    expect(result).toMatchObject({ status: "accepted", xpAwarded: 30, leaderboardXpAwarded: 25 });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "booth-win", status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "badge-win", status: "unlocked" })).toHaveLength(1);
    for (const outcome of ["visit", "participation", "completion", "high_score"]) {
      expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: `booth-${outcome}`, status: "accepted" })).toHaveLength(0);
      expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: `badge-${outcome}`, status: "unlocked" })).toHaveLength(0);
    }
  });

  it("registers a selected high-tier Activity with the shared Meta evaluator", async () => {
    const store = new MemoryGamificationStore();
    seedConfiguredBooth(store);
    seedMetaSourceActivity(store, "booth-orbit-high-score", "booth.orbit.high_score", {
      outcome_key: "high_score",
      partner: "sponsor-orbit",
      partner_kind: "sponsor",
      evidence_channel: "wts_qr",
    });
    seedMetaConfiguration(store, {
      kind: "claim_count",
      activityKeys: [`booth.${sponsorId}.high_score`, "booth.orbit.high_score"],
      count: 2,
      sourceDiversity: "booth",
    });
    store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
      id: "orbit-high-score-claim",
      user: "user-1",
      activity: "booth-orbit-high-score",
      source_type: "code_redemption",
      outcome_key: "high_score",
      status: "accepted",
      occurred_at: timestamp,
      claimed_at: timestamp,
      evidence_fingerprint: "wts-orbit-high-score",
      idempotency_key: "wts-orbit-high-score",
      created: timestamp,
      updated: timestamp,
    });
    const highScoreCode = seedBoothCode(store, "booth-high-score-meta-code", "booth-high_score");

    await redemptionService(store).redeem(redemptionInput(highScoreCode.rawCode));

    const [highScoreClaim] = await store.list<any>(GAMIFICATION_COLLECTIONS.activityClaims, {
      activity: "booth-high_score",
      status: "accepted",
    });
    expect(await store.list<any>(GAMIFICATION_COLLECTIONS.activityClaims, {
      source_type: "system_meta",
      status: "accepted",
    })).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          meta_rule: expect.objectContaining({ source_claim_ids: expect.arrayContaining(["orbit-high-score-claim", highScoreClaim.id]) }),
        }),
      }),
    ]);
  });

  it("applies the fixed outcome bands with independent shared sponsor caps", async () => {
    const store = new MemoryGamificationStore();
    seedConfiguredBooth(store);
    const redemption = redemptionService(store);

    for (const outcome of ["visit", "participation", "completion"]) {
      const code = seedBoothCode(store, `booth-${outcome}-fixed-band-code`, `booth-${outcome}`);
      await redemption.redeem(redemptionInput(code.rawCode));
    }

    expect(await store.list<{ amount: number; leaderboard_amount: number }>(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual([
      expect.objectContaining({ amount: 5, leaderboard_amount: 5 }),
      expect.objectContaining({ amount: 10, leaderboard_amount: 10 }),
      expect.objectContaining({ amount: 20, leaderboard_amount: 10 }),
    ]);
    const completion = await store.findOne<any>(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "booth-completion", user: "user-1" });
    expect(completion.cap_outcome).toMatchObject({ awarded_total_xp: 20, awarded_leaderboard_xp: 10 });
    const schedule = calculateSeptemberScoreSchedule((await store.list<any>(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies)).map((policy) => ({
      key: policy.policy_key,
      activityId: policy.activity,
      active: policy.active,
      totalXp: policy.total_xp,
      leaderboardXp: policy.leaderboard_xp,
      category: "booth",
      scoreDay: policy.score_day,
      capMembership: policy.cap_membership,
    })));
    expect(schedule.caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "partner", key: sponsorId, totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "category", key: "booth", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "conference_day", key: "2026-09-19", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "conference", key: "conference", totalXpCeiling: 35, leaderboardXpCeiling: 25 }),
    ]));
  });

  it("applies independent total and Leaderboard caps across high-tier outcomes", async () => {
    const store = new MemoryGamificationStore();
    seedConfiguredBooth(store);
    const redemption = redemptionService(store);
    const winCode = seedBoothCode(store, "booth-win-independent-cap-code", "booth-win");
    const highScoreCode = seedBoothCode(store, "booth-high-score-independent-cap-code", "booth-high_score");

    await redemption.redeem(redemptionInput(winCode.rawCode));
    await redemption.redeem(redemptionInput(highScoreCode.rawCode));

    expect(await store.list<{ amount: number; leaderboard_amount: number }>(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual([
      expect.objectContaining({ amount: 30, leaderboard_amount: 25 }),
      expect.objectContaining({ amount: 5, leaderboard_amount: 0 }),
    ]);
    expect(await store.findOne<any>(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "booth-high_score", user: "user-1" }))
      .toMatchObject({ cap_outcome: { awarded_total_xp: 5, awarded_leaderboard_xp: 0 } });
  });

  it("keeps a cap-exhausted high-tier claim and Badge while reissued evidence cannot add a second award", async () => {
    const store = new MemoryGamificationStore();
    seedConfiguredBooth(store);
    await store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, "related_group-booth-cap", {
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
    });
    await store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, "partner-booth-cap", {
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
    });
    const original = seedBoothCode(store, "booth-code-original", "booth-high_score");
    const redemption = redemptionService(store);

    const accepted = await redemption.redeem(redemptionInput(original.rawCode));
    await store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, "related_group-booth-cap", {
      total_xp_ceiling: 35,
      leaderboard_xp_ceiling: 25,
    });
    await store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, "partner-booth-cap", {
      total_xp_ceiling: 35,
      leaderboard_xp_ceiling: 25,
    });
    const replayedAfterCapacityChanged = await redemption.redeem(redemptionInput(original.rawCode));
    await store.update(GAMIFICATION_COLLECTIONS.codes, "booth-code-original", {
      status: "disabled",
      enabled: false,
      invalidated_at: timestamp,
    });
    const replacement = seedBoothCode(store, "booth-code-replacement", "booth-high_score");
    await store.update(GAMIFICATION_COLLECTIONS.codes, "booth-code-replacement", {
      reissued_from: "booth-code-original",
    });
    const repeatedThroughReplacement = await redemption.redeem(redemptionInput(replacement.rawCode));

    expect(accepted).toMatchObject({ status: "accepted", xpAwarded: 0, leaderboardXpAwarded: 0 });
    expect(replayedAfterCapacityChanged).toMatchObject({ status: "already_redeemed", xpAwarded: 0, leaderboardXpAwarded: 0 });
    expect(repeatedThroughReplacement).toMatchObject({ status: "user_limit" });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { activity: "booth-high_score", status: "accepted" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements, { achievement: "badge-high_score", status: "unlocked" })).toHaveLength(1);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toHaveLength(0);
    expect(await store.getById<any>(GAMIFICATION_COLLECTIONS.codes, "booth-code-replacement")).toMatchObject({ reissued_from: "booth-code-original" });

    const summary = await service(store).summaryForUser({ id: "user-1" });
    const [profile] = await store.list<any>(GAMIFICATION_COLLECTIONS.profiles, { user: "user-1" });
    const board = buildGamificationPublicOpsBoardRows(
      [{ ...profile, ops_board_visible: true, public_badges_visible: true }],
      await store.list<any>(GAMIFICATION_COLLECTIONS.userAchievements),
      await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    );

    expect(summary.badges).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Northstar high_score", category: "booth" })]));
    expect(JSON.stringify(summary)).not.toContain(`booth.${sponsorId}.high_score`);
    expect(JSON.stringify(summary)).not.toContain("awarded_total_xp");
    expect(JSON.stringify(summary)).not.toContain(original.rawCode);
    expect(board[0]).toMatchObject({ publicBadgeCount: 0, badges: [] });
    expect(JSON.stringify(board)).not.toContain("Northstar");
    expect(JSON.stringify(board)).not.toContain("high_score");
  });

  it("records and withdraws current-User consent without changing gamification or exposing contact history", async () => {
    const store = new MemoryGamificationStore();
    seedUser(store);
    seedUser(store, "booth-staff");
    seedConfiguredBooth(store, true);
    store.seed(GAMIFICATION_COLLECTIONS.activityClaims, {
      id: "booth-visit-claim",
      user: "user-1",
      activity: "booth-visit",
      source_type: "code_redemption",
      outcome_key: "visit",
      status: "accepted",
      occurred_at: timestamp,
      claimed_at: timestamp,
      evidence_fingerprint: "wts-code",
      idempotency_key: "wts-code",
      created: timestamp,
      updated: timestamp,
    });
    const consent = new PartnerContactConsentService(store, () => timestamp);
    const before = {
      claims: await store.list(GAMIFICATION_COLLECTIONS.activityClaims),
      badges: await store.list(GAMIFICATION_COLLECTIONS.userAchievements),
      xp: await store.list(GAMIFICATION_COLLECTIONS.xpEvents),
    };

    const granted = await consent.grant({ id: "user-1", name: "Ada Admin", email: "user-1@example.com" }, "booth-visit");
    await expect(consent.grant({ id: "booth-staff" }, "booth-visit")).rejects.toThrow("Record the Activity");
    await expect(consent.withdraw("booth-staff", granted.consentId!)).rejects.toThrow("your own");
    const handoff = await consent.handoff(granted.consentId!, "admin-1");
    const withdrawn = await consent.withdraw("user-1", granted.consentId!);

    expect(granted).toMatchObject({ state: "granted", purpose: "partner_follow_up", fields: ["name", "email"], handoffState: "not_handed_off" });
    expect(handoff).toMatchObject({ partner: { name: "Northstar Systems" }, contact: { name: "Ada Admin", email: "user-1@example.com" } });
    expect(withdrawn).toMatchObject({ state: "withdrawn", handoffState: "handed_off" });
    await expect(consent.handoff(granted.consentId!, "admin-1")).rejects.toThrow("Withdrawn");
    await expect(consent.grant({ id: "user-1", name: "Ada Admin", email: "user-1@example.com" }, "booth-visit"))
      .rejects.toThrow("already been completed");
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toEqual(before.claims);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toEqual(before.badges);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual(before.xp);
    const disclosures = await store.list<any>(GAMIFICATION_COLLECTIONS.partnerContactDisclosures);
    expect(disclosures).toEqual([expect.objectContaining({ actor: "admin-1", approved_fields: ["name", "email"] })]);
    expect(JSON.stringify(disclosures)).not.toContain("user-1@example.com");
    expect(JSON.stringify(await consent.summariesForUser("user-1"))).not.toContain("user-1@example.com");
  });

  it("requires sponsor-only canonical booth configuration before activation", async () => {
    const store = new MemoryGamificationStore();
    seedSponsor(store);
    const key = "booth.northstar.product-demo";
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "configured-booth-badge",
      key: "configured-booth-badge",
      badge_name: "Configured booth Badge",
      badge_description: "Direct Booth Badge.",
      category: "booth",
      rarity: "common",
      visibility: "public",
      status: "active",
      unlock_rule: { kind: "activity_claim" },
      active_from: "2026-09-01T00:00:00.000Z",
      active_until: "2026-09-30T23:59:59.000Z",
      sort_order: 1,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.missions, {
      id: "configured-booth-mission",
      key,
      slug: "northstar-visit",
      title: "Northstar visit",
      summary: "Visit the WTS artifact.",
      category: "booth",
      visibility: "public",
      status: "active",
      partner: sponsorId,
      partner_key: "northstar",
      starts_at: "2026-09-01T00:00:00.000Z",
      ends_at: "2026-09-30T23:59:59.000Z",
      suggested: false,
      sort_order: 1,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.activities, {
      id: "configured-booth-activity",
      key: `${key}.high_score`,
      mission: "configured-booth-mission",
      kind: "booth",
      category: "booth",
      outcome_key: "high_score",
      evidence_mode: "single_code",
      evidence_channel: "wts_qr",
      deployment_label: "WTS Northstar counter sign",
      achievement: "configured-booth-badge",
      partner: sponsorId,
      partner_kind: "community_partner",
      per_user_claim_limit: 1,
      max_claims: 100,
      active_from: "2026-09-01T00:00:00.000Z",
      active_until: "2026-09-30T23:59:59.000Z",
      status: "draft",
      enabled: true,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, {
      id: "configured-booth-policy",
      schedule: "draft-booth-schedule",
      activity: "configured-booth-activity",
      policy_key: `${key}.high_score`,
      active: true,
      total_xp: 5,
      leaderboard_xp: 5,
      cap_membership: [
        { dimension: "activity", key: "configured-booth-activity" },
        { dimension: "related_group", key },
        { dimension: "partner", key: sponsorId },
        { dimension: "category", key: "booth" },
        { dimension: "conference_day", key: "2026-09-19" },
        { dimension: "conference", key: "conference" },
      ],
      cap_ceiling_overrides: {
        related_group: { total_xp_ceiling: 35, leaderboard_xp_ceiling: 25 },
        partner: { total_xp_ceiling: 35, leaderboard_xp_ceiling: 25 },
      },
      score_day: "2026-09-19",
      created: timestamp,
      updated: timestamp,
    });

    await expect(operationService(store).activateDefinition("activity", {
      id: "configured-booth-activity",
      reason: "Activate sponsor visit",
      confirmation: true,
      operationId: "activate-invalid-sponsor-booth",
    }, adminActor)).rejects.toThrow("partner kind sponsor");
    await store.update(GAMIFICATION_COLLECTIONS.activities, "configured-booth-activity", { partner_kind: "sponsor" });
    await expect(operationService(store).activateDefinition("activity", {
      id: "configured-booth-activity",
      reason: "Activate sponsor high score",
      confirmation: true,
      operationId: "activate-invalid-high-score-band",
    }, adminActor)).rejects.toThrow("fixed outcome band");
    await store.update(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, "configured-booth-policy", {
      total_xp: 35,
      leaderboard_xp: 25,
    });
    await expect(operationService(store).activateDefinition("activity", {
      id: "configured-booth-activity",
      reason: "Activate sponsor high score",
      confirmation: true,
      operationId: "activate-valid-high-score-booth",
    }, adminActor)).resolves.toMatchObject({ id: "configured-booth-activity", status: "active" });
  });
});

describe("Community Partner Activities", () => {
  const partnerId = "community-partner-1";
  const partnerKey = "cloud-native-meetup";
  const programmeKey = "hack-night";
  const missionKey = `community.${partnerKey}.${programmeKey}`;
  const activeUntil = "2026-09-02T12:00:00.000Z";

  function seedCommunityConfigurationDependencies(store: MemoryGamificationStore, flow: "one_code" | "two_code"): void {
    store.seed("partners", {
      id: partnerId,
      name: "Cloud Native Meetup",
      // Public classification deliberately disagrees with gamification classification.
      type: "sponsor",
      tier: "silver",
      published: true,
      created: timestamp,
      updated: timestamp,
    });
    store.seed(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      id: "community-draft-schedule",
      key: "community-schedule",
      status: "draft",
      effective_at: timestamp,
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
      access_level_thresholds: {},
      created: timestamp,
      updated: timestamp,
    });
    const directKey = flow === "one_code" ? `${missionKey}.attendance` : `${missionKey}.start`;
    store.seed(GAMIFICATION_COLLECTIONS.achievements, {
      id: "community-direct-badge",
      key: `${missionKey}.direct-badge`,
      badge_name: "Community participant",
      badge_description: "Completed a WTS-managed Community Partner Activity.",
      category: "community",
      rarity: "uncommon",
      visibility: "locked_teaser",
      locked_teaser: "A Community Partner challenge awaits.",
      status: "active",
      unlock_rule: { kind: "activity_claim", activityKeys: [directKey] },
      active_from: timestamp,
      active_until: activeUntil,
      sort_order: 1,
      created: timestamp,
      updated: timestamp,
    });
    if (flow === "one_code") {
      for (const outcome of ["participation", "completion"] as const) {
        store.seed(GAMIFICATION_COLLECTIONS.achievements, {
          id: `community-${outcome}-badge`,
          key: `${missionKey}.${outcome}-badge`,
          badge_name: `Community ${outcome}`,
          badge_description: `Recorded WTS-managed Community Partner ${outcome}.`,
          category: "community",
          rarity: "uncommon",
          visibility: "public",
          status: "active",
          unlock_rule: { kind: "activity_claim", activityKeys: [`${missionKey}.${outcome}`] },
          active_from: timestamp,
          active_until: activeUntil,
          sort_order: outcome === "participation" ? 2 : 3,
          created: timestamp,
          updated: timestamp,
        });
      }
    }
    if (flow === "two_code") {
      store.seed(GAMIFICATION_COLLECTIONS.achievements, {
        id: "community-completion-badge",
        key: `${missionKey}.completion-badge`,
        badge_name: "Community finisher",
        badge_description: "Recorded both WTS-managed programme checkpoints.",
        category: "community",
        rarity: "rare",
        visibility: "public",
        status: "active",
        unlock_rule: { kind: "claim_set", activityKeys: [`${missionKey}.start`, `${missionKey}.finish`] },
        active_from: timestamp,
        active_until: activeUntil,
        sort_order: 2,
        created: timestamp,
        updated: timestamp,
      });
    }
  }

  async function configureCommunityProgramme(
    store: MemoryGamificationStore,
    flow: "one_code" | "two_code" = "one_code",
    outcomes: Array<"attendance" | "participation" | "completion"> = ["attendance"],
  ) {
    seedCommunityConfigurationDependencies(store, flow);
    return operationService(store).saveCommunityPartnerMissionDraft({
      partnerId,
      partnerKey,
      activityKey: programmeKey,
      missionTitle: "Cloud Native Hack Night",
      summary: "Join a WTS-managed Community Partner challenge.",
      visibility: flow === "one_code" ? "public" : "hidden_until_unlocked",
      suggested: true,
      flow,
      outcomes: flow === "one_code" ? outcomes.map((outcome) => ({
        outcome,
        deploymentLabel: `WTS Community Partner ${outcome} card`,
        achievementId: outcome === "attendance" ? "community-direct-badge" : `community-${outcome}-badge`,
        metaEligible: outcome === "completion" || (outcomes.length === 1 && outcome === "attendance"),
        partnerFollowUp: { enabled: outcome === "attendance", noticeVersion: outcome === "attendance" ? "2026-09-v1" : undefined },
      })) : [],
      communityTwoCodeApproved: flow === "two_code",
      evidenceChannel: flow === "one_code" ? "wts_static_code" : "wts_qr",
      primaryDeploymentLabel: flow === "two_code" ? "WTS Community Partner start card" : undefined,
      finishDeploymentLabel: flow === "two_code" ? "WTS Community Partner finish card" : undefined,
      activeFrom: timestamp,
      activeUntil,
      perUserClaimLimit: 1,
      maxClaims: 100,
      directAchievementId: flow === "two_code" ? "community-direct-badge" : undefined,
      completionAchievementId: flow === "two_code" ? "community-completion-badge" : undefined,
      metaEligible: true,
      partnerFollowUp: { enabled: true, noticeVersion: "2026-09-v1" },
      scoreScheduleId: "community-draft-schedule",
      scoreDay: "2026-09-01",
      sortOrder: 10,
      operationId: `configure-community-${flow}`,
    }, adminActor);
  }

  async function activateCommunityProgramme(
    store: MemoryGamificationStore,
    configured: Awaited<ReturnType<typeof configureCommunityProgramme>>,
  ): Promise<void> {
    const operations = operationService(store);
    await operations.activateDefinition("mission", {
      id: configured.mission.id,
      reason: "Approve Community Partner presentation",
      confirmation: true,
      operationId: `activate-${configured.mission.id}`,
    }, adminActor);
    for (const activity of configured.activities) {
      await operations.activateDefinition("activity", {
        id: activity.id,
        reason: "Activate WTS-managed Community Partner evidence",
        confirmation: true,
        operationId: `activate-${activity.id}`,
      }, adminActor);
    }
    await operations.activateScoreSchedule("community-draft-schedule", {
      id: "community-draft-schedule",
      reason: "Activate Community Partner caps",
      confirmation: true,
      operationId: "activate-community-schedule",
    }, adminActor);
  }

  it("configures explicit canonical community classification without inferring public partner type or tier", async () => {
    const store = new MemoryGamificationStore();
    const configured = await configureCommunityProgramme(store, "one_code", ["attendance", "participation", "completion"]);
    const activity = configured.activities.find((candidate) => candidate.outcomeKey === "attendance")!;
    const policy = (await store.list<any>(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies))
      .find((candidate) => candidate.activity === activity.id);

    expect(configured.mission).toMatchObject({
      key: missionKey,
      category: "community",
      visibility: "public",
      suggested: true,
      partnerId,
      partnerKey,
    });
    expect(activity).toMatchObject({
      key: `${missionKey}.attendance`,
      kind: "community_partner",
      category: "community",
      partnerId,
      partnerKind: "community_partner",
      evidenceMode: "single_code",
      evidenceChannel: "wts_static_code",
      communityMetaEligible: false,
      partnerFollowUp: { enabled: true, noticeVersion: "2026-09-v1" },
    });
    expect(configured.activities.map((candidate) => [candidate.outcomeKey, candidate.communityMetaEligible])).toEqual([
      ["attendance", false],
      ["participation", false],
      ["completion", true],
    ]);
    const programmePolicies = await store.list<any>(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies);
    expect(programmePolicies.map((candidate) => [candidate.total_xp, candidate.leaderboard_xp])).toEqual([[20, 15], [25, 20], [30, 25]]);
    expect(programmePolicies.every((candidate) => candidate.cap_ceiling_overrides.related_group.total_xp_ceiling === 30 && candidate.cap_ceiling_overrides.related_group.leaderboard_xp_ceiling === 25)).toBe(true);
    expect(policy).toMatchObject({
      total_xp: 20,
      leaderboard_xp: 15,
      cap_membership: expect.arrayContaining([
        { dimension: "activity", key: activity.id },
        { dimension: "related_group", key: missionKey },
        { dimension: "partner", key: partnerId },
        { dimension: "category", key: "community" },
        { dimension: "conference_day", key: "2026-09-01" },
        { dimension: "conference", key: "conference" },
      ]),
    });
    expect((await store.getById<any>("partners", partnerId)).type).toBe("sponsor");
    await activateCommunityProgramme(store, configured);
    expect(await store.findOne<any>(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, { dimension: "partner", cap_key: partnerId }))
      .toMatchObject({ total_xp_ceiling: 30, leaderboard_xp_ceiling: 25 });
  });

  it("applies one highest active programme ceiling per Community Partner and propagates approved 40/30 groups", () => {
    const policies = [
      {
        key: "community.one.attendance", activityId: "community-one-attendance", kind: "community_partner" as const,
        active: true, totalXp: 20, leaderboardXp: 15, category: "community", scoreDay: "2026-09-01",
        capMembership: [{ dimension: "activity" as const, key: "community-one-attendance" }, { dimension: "related_group" as const, key: "programme-one" }, { dimension: "partner" as const, key: "partner-one" }],
      },
      {
        key: "community.two.completion", activityId: "community-two-completion", kind: "community_partner" as const,
        active: true, totalXp: 30, leaderboardXp: 25, category: "community", scoreDay: "2026-09-01",
        capMembership: [{ dimension: "activity" as const, key: "community-two-completion" }, { dimension: "related_group" as const, key: "programme-two" }, { dimension: "partner" as const, key: "partner-one" }],
      },
      {
        key: "community.three.start", activityId: "community-three-start", kind: "community_partner" as const,
        active: true, totalXp: 10, leaderboardXp: 5, category: "community", scoreDay: "2026-09-01",
        capMembership: [{ dimension: "activity" as const, key: "community-three-start" }, { dimension: "related_group" as const, key: "programme-three" }, { dimension: "partner" as const, key: "partner-two" }],
        capCeilingOverrides: { related_group: { totalXpCeiling: 40, leaderboardXpCeiling: 30 } },
      },
    ];
    const schedule = calculateSeptemberScoreSchedule(policies);

    expect(schedule.caps).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "partner", key: "partner-one", totalXpCeiling: 30, leaderboardXpCeiling: 25 }),
      expect.objectContaining({ dimension: "partner", key: "partner-two", totalXpCeiling: 40, leaderboardXpCeiling: 30 }),
      expect.objectContaining({ dimension: "category", key: "community", totalXpCeiling: 70, leaderboardXpCeiling: 55 }),
      expect.objectContaining({ dimension: "conference_day", key: "2026-09-01", totalXpCeiling: 70, leaderboardXpCeiling: 55 }),
    ]));
  });

  it("derives a multi-outcome programme ceiling from active outcomes only", async () => {
    const store = new MemoryGamificationStore();
    const configured = await configureCommunityProgramme(store, "one_code", ["attendance", "participation", "completion"]);
    const operations = operationService(store);
    await operations.activateDefinition("mission", { id: configured.mission.id, reason: "Publish programme", confirmation: true, operationId: "active-only-mission" }, adminActor);
    const attendance = configured.activities.find((activity) => activity.outcomeKey === "attendance")!;
    await operations.activateDefinition("activity", { id: attendance.id, reason: "Open attendance only", confirmation: true, operationId: "active-only-attendance" }, adminActor);
    await operations.activateScoreSchedule("community-draft-schedule", { id: "community-draft-schedule", reason: "Score active outcomes", confirmation: true, operationId: "active-only-schedule" }, adminActor);

    expect(await store.findOne<any>(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, { dimension: "partner", cap_key: partnerId }))
      .toMatchObject({ total_xp_ceiling: 20, leaderboard_xp_ceiling: 15 });
  });

  it("isolates evidence, preserves one claim across reissues, and keeps consent separate from accounting", async () => {
    const store = new MemoryGamificationStore();
    seedUser(store);
    seedUser(store, "user-2");
    const configured = await configureCommunityProgramme(store);
    await activateCommunityProgramme(store, configured);
    const activity = configured.activities[0];
    const operations = operationService(store);

    await expect(service(store).recordActivityAward({
      claim: {
        user: "user-2",
        activity: activity.id,
        sourceType: "code_redemption",
        sourceCollection: "external_rsvp_forms",
        sourceRecordId: "partner-assertion",
        outcomeKey: "attendance",
        occurredAt: timestamp,
        evidenceFingerprint: "screenshot-click",
        idempotencyKey: "external-community-evidence",
      },
    })).rejects.toThrow("verified WTS Mission code redemption");

    const batch = await operations.generateCodes({
      activityId: activity.id,
      label: "WTS static Community Partner code",
      quantity: 1,
      evidenceRole: "single",
      startsAt: timestamp,
      endsAt: activeUntil,
      maxRedemptions: 100,
      perUserLimit: 1,
      operationId: "community-code-original",
    }, adminActor);
    const accepted = await redemptionService(store).redeem(redemptionInput(batch.codes![0].rawCode));
    const beforeConsent = {
      claims: await store.list(GAMIFICATION_COLLECTIONS.activityClaims),
      badges: await store.list(GAMIFICATION_COLLECTIONS.userAchievements),
      xp: await store.list(GAMIFICATION_COLLECTIONS.xpEvents),
    };
    const consent = new PartnerContactConsentService(store, () => timestamp);
    const granted = await consent.grant({ id: "user-1", name: "Ada Admin", email: "user-1@example.com" }, activity.id);
    const withdrawn = await consent.withdraw("user-1", granted.consentId!);

    await operations.invalidateCode({
      codeId: batch.codes![0].id,
      reason: "Replace damaged WTS card",
      confirmation: true,
      operationId: "invalidate-community-code",
    }, adminActor);
    const replacement = await operations.reissueCode({
      codeId: batch.codes![0].id,
      reason: "Replace damaged WTS card",
      confirmation: true,
      operationId: "reissue-community-code",
    }, adminActor);
    const repeated = await redemptionService(store).redeem(redemptionInput(replacement.codes![0].rawCode));

    expect(accepted).toMatchObject({ status: "accepted", xpAwarded: 20, leaderboardXpAwarded: 15 });
    expect(granted).toMatchObject({ state: "granted", activityLabel: "Cloud Native Hack Night", fields: ["name", "email"] });
    expect(withdrawn).toMatchObject({ state: "withdrawn" });
    expect(repeated).toMatchObject({ status: "user_limit" });
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims)).toEqual(beforeConsent.claims);
    expect(await store.list(GAMIFICATION_COLLECTIONS.userAchievements)).toEqual(beforeConsent.badges);
    expect(await store.list(GAMIFICATION_COLLECTIONS.xpEvents)).toEqual(beforeConsent.xp);
    expect(await store.list(GAMIFICATION_COLLECTIONS.activityClaims, { user: "user-1", activity: activity.id, status: "accepted" })).toHaveLength(1);
  });

  it("uses the established approved two-code model and designates only derived completion for Meta", async () => {
    const store = new MemoryGamificationStore();
    seedUser(store);
    const configured = await configureCommunityProgramme(store, "two_code");
    expect(configured.mission).toMatchObject({ visibility: "hidden_until_unlocked", suggested: false });
    expect(configured.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: `${missionKey}.start`, evidenceMode: "two_code_start", communityMetaEligible: false }),
      expect.objectContaining({ key: `${missionKey}.finish`, evidenceMode: "two_code_finish", communityMetaEligible: false }),
      expect.objectContaining({ key: `${missionKey}.completion`, evidenceMode: "derived_claim_set", communityMetaEligible: true, partnerFollowUp: { enabled: true, noticeVersion: "2026-09-v1" } }),
    ]));
    await activateCommunityProgramme(store, configured);
    const start = configured.activities.find((activity) => activity.evidenceMode === "two_code_start")!;
    const finish = configured.activities.find((activity) => activity.evidenceMode === "two_code_finish")!;
    const operations = operationService(store);
    const finishBatch = await operations.generateCodes({ activityId: finish.id, label: "WTS community finish", quantity: 1, evidenceRole: "finish", startsAt: timestamp, endsAt: activeUntil, maxRedemptions: 100, perUserLimit: 1, operationId: "community-finish-code" }, adminActor);
    const startBatch = await operations.generateCodes({ activityId: start.id, label: "WTS community start", quantity: 1, evidenceRole: "start", startsAt: timestamp, endsAt: activeUntil, maxRedemptions: 100, perUserLimit: 1, operationId: "community-start-code" }, adminActor);

    const finishFirst = await redemptionService(store).redeem(redemptionInput(finishBatch.codes![0].rawCode));
    const completed = await redemptionService(store).redeem(redemptionInput(startBatch.codes![0].rawCode));
    const claims = await store.list<any>(GAMIFICATION_COLLECTIONS.activityClaims, { user: "user-1", status: "accepted" });
    const partnerCap = (await store.list<any>(GAMIFICATION_COLLECTIONS.scoreScheduleCaps))
      .find((cap) => cap.dimension === "partner" && cap.cap_key === partnerId);

    expect(finishFirst).toMatchObject({ status: "accepted", xpAwarded: 0, leaderboardXpAwarded: 0 });
    expect(completed).toMatchObject({ status: "accepted", xpAwarded: 40, leaderboardXpAwarded: 30 });
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ activity: start.id, source_type: "code_redemption" }),
      expect.objectContaining({ activity: finish.id, source_type: "code_redemption" }),
      expect.objectContaining({ activity: configured.activities.find((activity) => activity.evidenceMode === "derived_claim_set")!.id, source_type: "system_derived" }),
    ]));
    expect(partnerCap).toMatchObject({ total_xp_ceiling: 40, leaderboard_xp_ceiling: 30 });
    expect(buildCommunityPartnerMissionPresentations({
      missions: await store.list<any>(GAMIFICATION_COLLECTIONS.missions),
      activities: await store.list<any>(GAMIFICATION_COLLECTIONS.activities),
      achievements: await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    })).toEqual([]);
  });

  it("keeps non-designated Community Activities out of Meta selection and public DTOs", async () => {
    const store = new MemoryGamificationStore();
    seedUser(store);
    const configured = await configureCommunityProgramme(store);
    const activity = await store.getById<any>(GAMIFICATION_COLLECTIONS.activities, configured.activities[0].id);
    const duplicate = { ...activity, id: "community-duplicate", key: `${missionKey}.participation`, outcome_key: "participation", community_meta_eligible: false };
    const selected = selectedMetaSourceActivities({
      kind: "claim_count",
      activityKeys: [activity.key, duplicate.key],
      count: 1,
      sourceDiversity: "community",
    }, [activity, duplicate]);
    expect(selected.map((candidate) => candidate.id)).toEqual([activity.id]);

    await activateCommunityProgramme(store, configured);
    const batch = await operationService(store).generateCodes({ activityId: activity.id, label: "WTS community public DTO", quantity: 1, evidenceRole: "single", startsAt: timestamp, endsAt: activeUntil, maxRedemptions: 100, perUserLimit: 1, operationId: "community-dto-code" }, adminActor);
    await redemptionService(store).redeem(redemptionInput(batch.codes![0].rawCode));
    const summary = await service(store).summaryForUser({ id: "user-1" });
    const board = await service(store).publicOpsBoard();
    const serializedSummary = JSON.stringify(summary);
    const serializedBoard = JSON.stringify(board);
    const publicMissions = buildCommunityPartnerMissionPresentations({
      missions: await store.list<any>(GAMIFICATION_COLLECTIONS.missions),
      activities: await store.list<any>(GAMIFICATION_COLLECTIONS.activities),
      achievements: await store.list<any>(GAMIFICATION_COLLECTIONS.achievements),
    });

    expect(summary.badges).toEqual([expect.objectContaining({ name: "Community participant", category: "community" })]);
    expect(serializedSummary).not.toContain(missionKey);
    expect(serializedSummary).not.toContain(partnerId);
    expect(serializedSummary).not.toContain("WTS Community Partner start card");
    expect(board[0]).toMatchObject({ publicBadgeCount: 0, badges: [] });
    expect(serializedBoard).not.toContain("Cloud Native Meetup");
    expect(serializedBoard).not.toContain(missionKey);
    expect(publicMissions).toEqual([expect.objectContaining({
      title: "Cloud Native Hack Night",
      visibility: "public",
      badge: expect.objectContaining({ name: "Community participant", description: "A Community Partner challenge awaits." }),
    })]);
    expect(JSON.stringify(publicMissions)).not.toContain(missionKey);
    expect(JSON.stringify(publicMissions)).not.toContain(partnerId);
    expect(JSON.stringify(publicMissions)).not.toContain("deployment");
  });

  it("keeps Community Partner configuration behind the established admin authorization boundary", async () => {
    await expect(runAuthenticatedGamificationOperation(
      async () => { throw new Error("Admins only"); },
      async () => operationService(new MemoryGamificationStore()).operations(),
    )).rejects.toThrow("Admins only");
  });
});

describe("Hi.Events adapter pagination", () => {
  it("returns typed complete, partial, and unavailable outcomes without using empty arrays as failures", async () => {
    const firstPage = {
      data: [{ id: "a", email: "ada@example.com", status: "active" }],
      meta: { last_page: 2 },
    };
    const secondPage = {
      data: [{ id: "b", email: "other@example.com", status: "active", check_ins: [{ id: "c", created_at: timestamp }] }],
      meta: { last_page: 2 },
    };
    let calls = 0;
    const complete = await fetchHiEventsAttendeeSnapshot({
      apiUrl: "https://hievents.example",
      eventId: "main-event",
      accessToken: "test-token",
      fetcher: async () => new Response(JSON.stringify(calls++ === 0 ? firstPage : secondPage), { status: 200 }),
      now: () => timestamp,
    });
    expect(complete).toMatchObject({ state: "success", pagination: { complete: true, completedPages: 2 } });
    if (complete.state === "success") expect(complete.attendees).toHaveLength(2);

    calls = 0;
    const partial = await fetchHiEventsAttendeeSnapshot({
      apiUrl: "https://hievents.example",
      eventId: "main-event",
      accessToken: "test-token",
      fetcher: async () => {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify(firstPage), { status: 200 });
        throw new Error("network interrupted");
      },
      now: () => timestamp,
    });
    expect(partial).toMatchObject({ state: "partial", pagination: { complete: false, completedPages: 1 } });

    const unavailable = await fetchHiEventsAttendeeSnapshot({
      apiUrl: "https://hievents.example",
      eventId: "main-event",
      accessToken: "test-token",
      fetcher: async () => new Response("no", { status: 401 }),
      now: () => timestamp,
    });
    expect(unavailable).toMatchObject({ state: "unavailable", reason: "authentication" });

    const malformed = await fetchHiEventsAttendeeSnapshot({
      apiUrl: "https://hievents.example",
      eventId: "main-event",
      accessToken: "test-token",
      fetcher: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
      now: () => timestamp,
    });
    expect(malformed).toMatchObject({ state: "partial", reason: "malformed_pagination", pagination: { complete: false } });

    let crossOriginCalls = 0;
    const crossOrigin = await fetchHiEventsAttendeeSnapshot({
      apiUrl: "https://hievents.example",
      eventId: "main-event",
      accessToken: "test-token",
      fetcher: async () => {
        crossOriginCalls += 1;
        return new Response(JSON.stringify({
          data: [],
          links: { next: "https://attacker.example/steal-token" },
          meta: { last_page: 2 },
        }), { status: 200 });
      },
      now: () => timestamp,
    });
    expect(crossOrigin).toMatchObject({ state: "partial", reason: "malformed_pagination" });
    expect(crossOriginCalls).toBe(1);

    const malformedRows = await fetchHiEventsAttendeeSnapshot({
      apiUrl: "https://hievents.example",
      eventId: "main-event",
      accessToken: "test-token",
      fetcher: async () => new Response(JSON.stringify({ data: [null], meta: { last_page: 1 } }), { status: 200 }),
      now: () => timestamp,
    });
    expect(malformedRows).toMatchObject({ state: "partial", reason: "malformed_data", pagination: { complete: false } });
  });

  it("retries a transient page failure within a bounded budget before declaring the snapshot partial", async () => {
    let calls = 0;
    const snapshot = await fetchHiEventsAttendeeSnapshot({
      apiUrl: "https://hievents.example",
      eventId: "main-event",
      accessToken: "test-token",
      maxRetries: 2,
      retryBaseMs: 1,
      fetcher: async () => {
        calls += 1;
        if (calls < 3) return new Response("busy", { status: 503 });
        return new Response(JSON.stringify({
          data: [{ id: "recovered", email: "ada@example.com", status: "active" }],
          meta: { last_page: 1 },
        }), { status: 200 });
      },
      now: () => timestamp,
    });

    expect(snapshot).toMatchObject({ state: "success", pagination: { complete: true, completedPages: 1 } });
    expect(calls).toBe(3);
  });
});

describe("gamification deployment configuration", () => {
  it("passes Mission-code and Hi.Events server secrets to the web app", () => {
    const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
    const webapp = compose.slice(compose.indexOf("  webapp:"), compose.indexOf("\n  pocketbase:\n    build:"));

    expect(webapp).toContain("GAMIFICATION_CODE_PEPPER=${GAMIFICATION_CODE_PEPPER:?");
    expect(webapp).toContain("POCKETBASE_SUPERUSER_EMAIL=${POCKETBASE_SUPERUSER_EMAIL:?");
    expect(webapp).toContain("POCKETBASE_SUPERUSER_PASSWORD=${POCKETBASE_SUPERUSER_PASSWORD:?");
    for (const variable of ["HIEVENTS_API_URL", "HIEVENTS_EVENT_ID", "HIEVENTS_EMAIL", "HIEVENTS_PASSWORD", "HIEVENTS_ACCOUNT_ID"]) {
      expect(webapp).toContain(`${variable}=\${${variable}}`);
    }
    expect(webapp).not.toMatch(/(?:PUBLIC_|VITE_)GAMIFICATION_CODE_PEPPER/);
  });

  it("bakes only public browser configuration and declares container readiness", () => {
    const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
    const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

    expect(compose).toContain("PUBLIC_SITE_URL: ${PUBLIC_SITE_URL:-https://wts.sh}");
    expect(compose).toContain("VITE_LISTMONK_LIST_ID: ${VITE_LISTMONK_LIST_ID:-2}");
    expect(compose).toContain("VITE_TURNSTILE_SITE_KEY: ${VITE_TURNSTILE_SITE_KEY:-}");
    expect(compose).toContain("http://127.0.0.1:3000/");
    expect(compose).toContain("start_period: 30s");
    expect(dockerfile).toContain("ARG PUBLIC_SITE_URL=https://wts.sh");
    expect(dockerfile).toContain("ARG VITE_LISTMONK_LIST_ID");
    expect(dockerfile).toContain("ARG VITE_TURNSTILE_SITE_KEY");
    expect(dockerfile).not.toContain("ARG GAMIFICATION_CODE_PEPPER");
  });

  it("fails PocketBase startup on migration errors and excludes local secrets from Docker builds", () => {
    const entrypoint = readFileSync(new URL("../../pocketbase/entrypoint.sh", import.meta.url), "utf8");
    const dockerignore = readFileSync(new URL("../../.dockerignore", import.meta.url), "utf8");

    expect(entrypoint).toMatch(/^#!\/bin\/sh\n\nset -eu/);
    expect(dockerignore).toContain(".env.*");
    expect(dockerignore).toContain("pocketbase/pb_data");
    expect(dockerignore).toContain("pocketbase/pocketbase");
  });
});
