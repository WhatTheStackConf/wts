import { createHmac, randomUUID } from "node:crypto";
import { samePersistedJson } from "~/lib/persisted-json";
import {
  GAMIFICATION_COLLECTIONS,
  withGamificationLocks,
  type GamificationAccountingStore,
} from "~/lib/gamification-accounting";
import {
  calculateSeptemberScoreSchedule,
  type CalculatedScoreCap,
  type SeptemberScorePolicy,
} from "~/lib/gamification";
import {
  COMMUNITY_PARTNER_SCORE_BANDS,
  communityPartnerActivityKey,
  communityPartnerMissionKey,
  isCommunityPartnerOutcome,
  type CommunityPartnerOutcome,
} from "~/lib/gamification-community-partners";
import {
  metaRuleDiversity,
  metaRuleActivityKeys,
  metaRuleSourceBreadth,
  metaScoreBandForRule,
  metaSourceEntityKey,
  selectedMetaSourceActivities,
} from "~/lib/gamification-meta-achievements";
import {
  configuredEventActivityKind,
  configuredEventCategory,
  configuredEventMissionKey,
  configuredEventReference,
  isConfiguredEventActivityKind,
  isConfiguredEventKind,
  sameConfiguredEventReference,
  type ConfiguredEventKind,
  type ConfiguredEventReference,
} from "~/lib/gamification-event-missions";
import {
  containsMissionCode,
  createMissionCodeGeneration,
  hashNormalizedMissionCode,
  MISSION_CODE_HASH_VERSION,
  parseMissionCode,
  verifyMissionCodeHash,
} from "~/lib/mission-code-crypto";
import type {
  AgendaSlotRecord,
  ConferenceDayRecord,
  EventProgrammeRecord,
  GamificationAchievementRecord,
  GamificationActivityRecord,
  GamificationActivityClaimRecord,
  GamificationCapMembership,
  GamificationCodeEvidenceRole,
  GamificationCodeRecord,
  GamificationCodeRedemptionRecord,
  GamificationDefinitionStatus,
  GamificationEvidenceChannel,
  GamificationMissionRecord,
  GamificationMetaSourceDiversity,
  GamificationProfileRecord,
  GamificationScoreScheduleCapRecord,
  GamificationScoreSchedulePolicyRecord,
  GamificationScoreScheduleRecord,
  GamificationSessionDisplaySnapshot,
  GamificationUserAchievementRecord,
  PartnerRecord,
  SessionRecord,
} from "~/lib/pocketbase-types";

const GAMIFICATION_CATEGORIES = [
  "onboarding",
  "ticketing",
  "attendance",
  "session",
  "partner",
  "booth",
  "workshop",
  "satellite_event",
  "warmup_event",
  "community",
  "social",
  "easter_egg",
  "meta",
  "admin_manual",
] as const;

const ACTIVITY_KINDS = [
  "qr",
  "session",
  "booth",
  "workshop",
  "warmup_event",
  "satellite_event",
  "community_partner",
  "social",
  "easter_egg",
  "hievents",
  "admin_manual",
  "meta",
] as const;

const EVIDENCE_MODES = [
  "single_code",
  "two_code_start",
  "two_code_finish",
  "hievents_ticket",
  "hievents_checkin",
  "static_puzzle_code",
  "admin_manual",
  "derived_claim_set",
  "meta_rule",
] as const;

const CODE_EVIDENCE_ROLES = ["single", "start", "finish", "static_puzzle"] as const;
const EVIDENCE_CHANNELS = ["wts_qr", "wts_link", "wts_manual_code", "wts_static_code"] as const;
const CAP_DIMENSIONS = ["activity", "related_group", "partner", "category", "conference_day", "conference"] as const;
const UNLOCK_RULE_KINDS = ["activity_claim", "claim_count", "claim_set", "manual_only"] as const;
const BOOTH_OUTCOMES = ["visit", "participation", "completion", "win", "high_score"] as const;
const BOOTH_SCORE_BANDS = {
  visit: { totalXp: 5, leaderboardXp: 5 },
  participation: { totalXp: 10, leaderboardXp: 10 },
  completion: { totalXp: 20, leaderboardXp: 15 },
  win: { totalXp: 30, leaderboardXp: 25 },
  high_score: { totalXp: 35, leaderboardXp: 25 },
} as const;
const BOOTH_CAP = { totalXp: 35, leaderboardXp: 25 } as const;
/** Prevent lifecycle publication while the create-only booth catalogue is being prepared. */
export const BOOTH_SETUP_LOCK = "configuration:wts26-booth-catalogue";

type GamificationCategory = (typeof GAMIFICATION_CATEGORIES)[number];
type ActivityKind = (typeof ACTIVITY_KINDS)[number];
type EvidenceMode = (typeof EVIDENCE_MODES)[number];
type BoothOutcome = (typeof BOOTH_OUTCOMES)[number];
type UnlockRuleKind = (typeof UNLOCK_RULE_KINDS)[number];

export type GamificationDefinitionKind = "achievement" | "mission" | "activity";
export type AdminEventRefDto = Omit<Partial<ConfiguredEventReference>, "kind"> & {
  kind?: string;
  eventId?: string;
};

export interface AdminOperationActor {
  id: string;
  role: "admin";
}

export interface AdminUnlockRuleInput {
  kind: UnlockRuleKind;
  activityKeys?: string[];
  category?: GamificationCategory;
  count?: number;
  sourceDiversity?: GamificationMetaSourceDiversity;
}

export interface AdminAchievementDraftInput {
  id?: string;
  successorOf?: string;
  key: string;
  badgeName: string;
  badgeDescription: string;
  lockedTeaser?: string;
  icon?: string;
  category: GamificationCategory;
  rarity: GamificationAchievementRecord["rarity"];
  visibility: Exclude<GamificationAchievementRecord["visibility"], "retired">;
  unlockRule: AdminUnlockRuleInput;
  activeFrom?: string;
  activeUntil?: string;
  sortOrder: number;
  reason?: string;
  operationId?: string;
}

export interface AdminMissionDraftInput {
  id?: string;
  successorOf?: string;
  key: string;
  slug: string;
  title: string;
  summary: string;
  category: GamificationCategory;
  visibility: GamificationMissionRecord["visibility"];
  startsAt?: string;
  endsAt?: string;
  primaryAchievementId?: string;
  partnerId?: string;
  partnerKey?: string;
  sessionId?: string;
  eventRef?: AdminEventRefDto;
  suggested: boolean;
  sortOrder: number;
  reason?: string;
  operationId?: string;
}

export interface AdminScorePolicyInput {
  scheduleId: string;
  policyKey: string;
  enabled: boolean;
  totalXp: number;
  leaderboardXp: number;
  capMembership: GamificationCapMembership[];
  capCeilingOverrides?: GamificationScoreSchedulePolicyRecord["cap_ceiling_overrides"];
  scoreDay?: string;
}

export interface AdminActivityDraftInput {
  id?: string;
  successorOf?: string;
  key: string;
  missionId?: string;
  kind: ActivityKind;
  category: GamificationCategory;
  outcomeKey: string;
  evidenceMode: EvidenceMode;
  evidenceChannel?: GamificationEvidenceChannel;
  deploymentLabel?: string;
  achievementId?: string;
  partnerId?: string;
  partnerKind?: GamificationActivityRecord["partner_kind"];
  sessionId?: string;
  eventRef?: AdminEventRefDto;
  perUserClaimLimit: number;
  maxClaims?: number;
  activeFrom?: string;
  activeUntil?: string;
  enabled: boolean;
  partnerFollowUp?: {
    enabled: boolean;
    noticeVersion?: string;
  };
  scorePolicy?: AdminScorePolicyInput;
  reason?: string;
  operationId?: string;
}

export interface AdminScoreScheduleDraftInput {
  key: string;
  effectiveAt: string;
  reason?: string;
  operationId?: string;
}

export interface AdminSessionAttendanceMissionDraftInput {
  sessionId: string;
  /** Organizer-supplied immutable key, never a Session slug. */
  sessionKey: string;
  title: string;
  summary: string;
  visibility: GamificationMissionRecord["visibility"];
  evidenceChannel: GamificationEvidenceChannel;
  deploymentLabel: string;
  activeFrom: string;
  activeUntil: string;
  perUserClaimLimit: number;
  maxClaims: number;
  achievementId?: string;
  metaEligible: boolean;
  scoreScheduleId: string;
  scoreDay: string;
  sortOrder: number;
  reason?: string;
  operationId: string;
}

export interface AdminConfiguredEventMissionDraftInput {
  /** Organizer-controlled immutable key; never an Agenda Slot or timeline record ID. */
  eventKey: string;
  kind: ConfiguredEventKind;
  title: string;
  missionTitle: string;
  summary: string;
  visibility: GamificationMissionRecord["visibility"];
  locationLabel?: string;
  hostPartnerId?: string;
  capGroupKey: string;
  flow: "one_code" | "two_code";
  relatedEventTwoCodeApproved: boolean;
  suggested: boolean;
  evidenceChannel: GamificationEvidenceChannel;
  attendanceDeploymentLabel: string;
  finishDeploymentLabel?: string;
  activeFrom: string;
  activeUntil: string;
  perUserClaimLimit: number;
  maxClaims: number;
  attendanceAchievementId?: string;
  completionAchievementId?: string;
  metaEligible: boolean;
  scoreScheduleId: string;
  scoreDay: string;
  sortOrder: number;
  reason?: string;
  operationId: string;
}

export interface AdminCommunityPartnerMissionDraftInput {
  partnerId: string;
  /** Organizer-controlled identity, independent of the partner's public type or tier. */
  partnerKey: string;
  /** Organizer-controlled immutable programme key. */
  activityKey: string;
  missionTitle: string;
  summary: string;
  visibility: GamificationMissionRecord["visibility"];
  suggested: boolean;
  flow: "one_code" | "two_code";
  outcomes: Array<{
    outcome: CommunityPartnerOutcome;
    deploymentLabel: string;
    achievementId: string;
    metaEligible: boolean;
    partnerFollowUp: { enabled: boolean; noticeVersion?: string };
  }>;
  communityTwoCodeApproved: boolean;
  evidenceChannel: GamificationEvidenceChannel;
  primaryDeploymentLabel?: string;
  finishDeploymentLabel?: string;
  activeFrom: string;
  activeUntil: string;
  perUserClaimLimit: number;
  maxClaims: number;
  directAchievementId?: string;
  completionAchievementId?: string;
  metaEligible: boolean;
  partnerFollowUp: {
    enabled: boolean;
    noticeVersion?: string;
  };
  scoreScheduleId: string;
  scoreDay: string;
  sortOrder: number;
  reason?: string;
  operationId: string;
}

export interface AdminEasterEggMissionDraftInput {
  /** Organizer-controlled immutable key; never a discovery location or code. */
  eggKey: string;
  missionTitle: string;
  missionSummary: string;
  badgeName: string;
  badgeDescription: string;
  badgeIcon?: string;
  badgeRarity: GamificationAchievementRecord["rarity"];
  evidenceChannel: "wts_qr" | "wts_link" | "wts_manual_code";
  /** Private admin-only note describing the safe WTS-controlled deployment surface. */
  deploymentNote: string;
  activeFrom: string;
  activeUntil: string;
  maxClaims: number;
  scoreScheduleId: string;
  sortOrder: number;
  reason?: string;
  operationId: string;
}

export interface AdminLifecycleInput {
  id: string;
  reason: string;
  confirmation: boolean;
  operationId: string;
}

export interface AdminCodeGenerationInput {
  activityId: string;
  label: string;
  quantity: number;
  evidenceRole: GamificationCodeEvidenceRole;
  startsAt: string;
  endsAt: string;
  maxRedemptions: number;
  perUserLimit: number;
  operationId: string;
}

export type AdminCodeRegistrationInput = Omit<AdminCodeGenerationInput, "quantity"> & { rawCodes: string[] };

/** A repeatable receipt, never an export of bearer secrets or code hashes. */
export interface AdminCodeRegistrationResult {
  batch: {
    id: string;
    label: string;
    activityId: string;
    quantity: number;
    committed: true;
    secretsAvailable: false;
  };
  codes: Array<{ id: string; label: string; lookupPrefix: string }>;
}

export interface AdminCodeInvalidationInput {
  codeId: string;
  reason: string;
  confirmation: boolean;
  operationId: string;
}

export interface AdminCodeReissueInput {
  codeId: string;
  label?: string;
  reason: string;
  confirmation: boolean;
  operationId: string;
}

export interface AdminCodeLookupInput {
  query?: string;
  rawCode?: string;
}

export interface AdminAchievementDto {
  id: string;
  key: string;
  badgeName: string;
  badgeDescription: string;
  lockedTeaser?: string;
  icon?: string;
  category: GamificationCategory;
  rarity: GamificationAchievementRecord["rarity"];
  visibility: GamificationAchievementRecord["visibility"];
  status: GamificationDefinitionStatus;
  unlockRule: AdminUnlockRuleInput;
  activeFrom?: string;
  activeUntil?: string;
  sortOrder: number;
}

export interface AdminMissionDto {
  id: string;
  key: string;
  slug: string;
  title: string;
  summary: string;
  category: GamificationCategory;
  visibility: GamificationMissionRecord["visibility"];
  status: GamificationDefinitionStatus;
  startsAt?: string;
  endsAt?: string;
  primaryAchievementId?: string;
  partnerId?: string;
  partnerKey?: string;
  sessionId?: string;
  eventRef?: AdminEventRefDto;
  suggested: boolean;
  sortOrder: number;
}

export interface AdminScorePolicyDto {
  id: string;
  scheduleId: string;
  scheduleKey: string;
  policyKey: string;
  enabled: boolean;
  totalXp: number;
  leaderboardXp: number;
  capMembership: GamificationCapMembership[];
  capCeilingOverrides?: GamificationScoreSchedulePolicyRecord["cap_ceiling_overrides"];
  scoreDay?: string;
}

export interface AdminActivityDto {
  id: string;
  key: string;
  missionId?: string;
  missionKey?: string;
  kind: ActivityKind;
  category: GamificationCategory;
  outcomeKey: string;
  evidenceMode: EvidenceMode;
  evidenceChannel?: GamificationEvidenceChannel;
  deploymentLabel?: string;
  achievementId?: string;
  partnerId?: string;
  partnerKind?: GamificationActivityRecord["partner_kind"];
  sessionId?: string;
  sessionKey?: string;
  sessionDisplaySnapshot?: GamificationSessionDisplaySnapshot;
  sessionMetaEligible?: boolean;
  eventRef?: AdminEventRefDto;
  eventMetaEligible?: boolean;
  communityMetaEligible?: boolean;
  perUserClaimLimit: number;
  maxClaims?: number;
  activeFrom?: string;
  activeUntil?: string;
  status: GamificationDefinitionStatus;
  enabled: boolean;
  partnerFollowUp?: {
    enabled: boolean;
    noticeVersion?: string;
  };
  acceptedClaims: number;
  rejectedRedemptions: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  scorePolicies: AdminScorePolicyDto[];
}

export interface AdminCodeDto {
  id: string;
  batchId?: string;
  label: string;
  lookupPrefix: string;
  activityId: string;
  activityKey?: string;
  activityStatus?: GamificationDefinitionStatus;
  missionId?: string;
  missionKey?: string;
  evidenceRole: GamificationCodeEvidenceRole;
  status: GamificationCodeRecord["status"];
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
  maxRedemptions?: number;
  perUserLimit: number;
  totalRedemptions: number;
  acceptedRedemptions: number;
  rejectedRedemptions: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  invalidatedAt?: string;
  reissuedFromCodeId?: string;
}

export interface AdminScoreScheduleDto {
  id: string;
  key: string;
  status: GamificationScoreScheduleRecord["status"];
  effectiveAt: string;
  totalXpCeiling: number;
  leaderboardXpCeiling: number;
  accessLevelThresholds: Record<string, number>;
}

export interface AdminGamificationOperationsDto {
  achievements: AdminAchievementDto[];
  missions: AdminMissionDto[];
  activities: AdminActivityDto[];
  codes: AdminCodeDto[];
  schedules: AdminScoreScheduleDto[];
  references: {
    partners: Array<{ id: string; name: string; type: PartnerRecord["type"] }>;
    sessions: Array<{
      id: string;
      title: string;
      published: boolean;
      scheduleContext?: { slotId: string; startAt: string; endAt: string; dayDate: string };
    }>;
  };
  profileCache: {
    state: "empty" | "current" | "rebuild_pending";
    profiles: number;
    lastRecalculatedAt?: string;
  };
}

export interface AdminOneTimeCodeDto {
  id: string;
  label: string;
  rawCode: string;
  redemptionUrl: string;
  qrLink: string;
}

export interface AdminCodeBatchResult {
  batch: {
    id: string;
    label: string;
    activityId: string;
    quantity: number;
    committed: boolean;
    secretsAvailable: boolean;
  };
  codes?: AdminOneTimeCodeDto[];
  csvExport?: string;
}

interface GamificationContext {
  achievements: GamificationAchievementRecord[];
  missions: GamificationMissionRecord[];
  activities: GamificationActivityRecord[];
  codes: GamificationCodeRecord[];
  redemptions: GamificationCodeRedemptionRecord[];
  activityClaims: GamificationActivityClaimRecord[];
  policies: GamificationScoreSchedulePolicyRecord[];
  schedules: GamificationScoreScheduleRecord[];
  caps: GamificationScoreScheduleCapRecord[];
  profiles: GamificationProfileRecord[];
  userAchievements: GamificationUserAchievementRecord[];
  partners: PartnerRecord[];
  sessions: SessionRecord[];
  agendaSlots: AgendaSlotRecord[];
  eventProgrammes: EventProgrammeRecord[];
  conferenceDays: ConferenceDayRecord[];
  adminActions: Array<{
    id: string;
    action: string;
    status: "applied" | "rebuild_pending" | "failed";
    correlation_id?: string;
    idempotency_key: string;
    related_collection?: string;
    related_record_id?: string;
  }>;
}

function now(): string {
  return new Date().toISOString();
}

let scheduleActivationQueue: Promise<unknown> = Promise.resolve();
let configurationMutationQueue: Promise<unknown> = Promise.resolve();

function hasValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanOptionalText(value: unknown): string | undefined {
  const text = cleanText(value);
  return text || undefined;
}

function cleanKey(value: unknown): string {
  const key = cleanText(value);
  assertNoSecretText(key, "Keys");
  return key.toLowerCase();
}

function validDate(value: unknown): value is string {
  return hasValue(value) && Number.isFinite(Date.parse(value));
}

function isISODate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isCategory(value: unknown): value is GamificationCategory {
  return typeof value === "string" && (GAMIFICATION_CATEGORIES as readonly string[]).includes(value);
}

function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === "string" && (ACTIVITY_KINDS as readonly string[]).includes(value);
}

function isEvidenceMode(value: unknown): value is EvidenceMode {
  return typeof value === "string" && (EVIDENCE_MODES as readonly string[]).includes(value);
}

function isEvidenceChannel(value: unknown): value is GamificationEvidenceChannel {
  return typeof value === "string" && (EVIDENCE_CHANNELS as readonly string[]).includes(value);
}

function isBoothOutcome(value: unknown): value is BoothOutcome {
  return typeof value === "string" && (BOOTH_OUTCOMES as readonly string[]).includes(value);
}

function boothActivityKey(missionKey: string, outcome: BoothOutcome): string {
  return `${missionKey}.${outcome}`;
}

function boothCapGroupKey(missionKey: string): string {
  return missionKey;
}

function isBoothMissionKey(value: string): boolean {
  return /^booth\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value);
}

function isCodeEvidenceRole(value: unknown): value is GamificationCodeEvidenceRole {
  return typeof value === "string" && (CODE_EVIDENCE_ROLES as readonly string[]).includes(value);
}

function isUnlockRuleKind(value: unknown): value is UnlockRuleKind {
  return typeof value === "string" && (UNLOCK_RULE_KINDS as readonly string[]).includes(value);
}

function isMetaSourceDiversity(value: unknown): value is GamificationMetaSourceDiversity {
  return value === "session" || value === "booth" || value === "community";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function operationId(value: unknown): string {
  const id = cleanText(value);
  if (!id || id.length > 160) throw new Error("A stable admin operation ID is required.");
  assertNoSecretText(id, "Operation IDs");
  return id;
}

function safeReason(value: unknown, fallback?: string): string {
  const reason = cleanText(value) || fallback || "Administrative configuration change.";
  if (reason.length > 500) throw new Error("Reason must be 500 characters or fewer.");
  assertNoSecretText(reason, "Reasons");
  return reason;
}

function requiredReason(value: unknown): string {
  if (!cleanText(value)) throw new Error("A non-empty reason is required.");
  return safeReason(value);
}

function safeOperationalLabel(value: unknown): string {
  const label = cleanText(value);
  if (!label || label.length > 160) throw new Error("A code batch needs a human-readable label of 160 characters or fewer.");
  assertNoSecretText(label, "Code labels");
  return label;
}

function safeDiscoveryDeploymentNote(value: unknown): string {
  const note = cleanText(value);
  if (!note || note.length > 500) {
    throw new Error("Easter egg discovery requires a private safe-surface deployment note of 500 characters or fewer.");
  }
  assertNoSecretText(note, "Easter egg deployment notes");
  return note;
}

function assertNoSecretText(value: string, field: string): void {
  if (containsMissionCode(value)) {
    throw new Error(`${field} must not include Mission codes.`);
  }
  if (/\b[a-f0-9]{64}\b/i.test(value)) throw new Error(`${field} must not include hashes or tokens.`);
}

function assertNoSecretInput(value: unknown, field: string): void {
  const serialized = JSON.stringify(value);
  if (serialized) assertNoSecretText(serialized, field);
}

function safeEventRef(value: unknown): AdminMissionDto["eventRef"] {
  const configured = configuredEventReference(value);
  if (configured) return configured;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const eventRef = {
    kind: cleanOptionalText(record.kind),
    eventKey: cleanOptionalText(record.eventKey || record.event_key),
    eventId: cleanOptionalText(record.eventId || record.event_id),
    title: cleanOptionalText(record.title),
  };
  return Object.values(eventRef).some(Boolean) ? eventRef : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function ruleActivityKeys(rule: Record<string, unknown>): string[] | undefined {
  const rawKeys = rule.activityKeys || rule.activity_keys;
  const activityKeys = (Array.isArray(rawKeys) ? rawKeys as unknown[] : [])
    .filter((key): key is string => typeof key === "string")
    .map(cleanText)
    .filter(Boolean);
  return activityKeys.length ? [...new Set(activityKeys)] : undefined;
}

function safeUnlockRule(value: unknown): AdminUnlockRuleInput {
  const rule = recordValue(value);
  const sourceDiversity = rule.sourceDiversity || rule.source_diversity || rule.diversity;
  return {
    kind: isUnlockRuleKind(rule.kind) ? rule.kind : "activity_claim",
    activityKeys: ruleActivityKeys(rule),
    category: isCategory(rule.category) ? rule.category : undefined,
    count: finiteNonNegative(rule.count) ? Number(rule.count) : undefined,
    sourceDiversity: isMetaSourceDiversity(sourceDiversity) ? sourceDiversity : undefined,
  };
}

function safeAchievement(record: GamificationAchievementRecord): AdminAchievementDto {
  return {
    id: record.id,
    key: record.key,
    badgeName: record.badge_name,
    badgeDescription: record.badge_description,
    lockedTeaser: cleanOptionalText(record.locked_teaser),
    icon: cleanOptionalText(record.icon),
    category: record.category,
    rarity: record.rarity,
    visibility: record.visibility,
    status: record.status,
    unlockRule: safeUnlockRule(record.unlock_rule),
    activeFrom: cleanOptionalText(record.active_from),
    activeUntil: cleanOptionalText(record.active_until),
    sortOrder: Number(record.sort_order),
  };
}

function safeMission(record: GamificationMissionRecord): AdminMissionDto {
  return {
    id: record.id,
    key: record.key,
    slug: record.slug,
    title: record.title,
    summary: record.summary,
    category: record.category,
    visibility: record.visibility,
    status: record.status,
    startsAt: cleanOptionalText(record.starts_at),
    endsAt: cleanOptionalText(record.ends_at),
    primaryAchievementId: cleanOptionalText(record.primary_achievement),
    partnerId: cleanOptionalText(record.partner),
    partnerKey: cleanOptionalText(record.partner_key),
    sessionId: cleanOptionalText(record.session),
    eventRef: safeEventRef(record.event_ref),
    suggested: Boolean(record.suggested),
    sortOrder: Number(record.sort_order),
  };
}

function safeSchedule(record: GamificationScoreScheduleRecord): AdminScoreScheduleDto {
  return {
    id: record.id,
    key: record.key,
    status: record.status,
    effectiveAt: record.effective_at,
    totalXpCeiling: Number(record.total_xp_ceiling),
    leaderboardXpCeiling: Number(record.leaderboard_xp_ceiling),
    accessLevelThresholds: { ...record.access_level_thresholds },
  };
}

function safePolicy(
  record: GamificationScoreSchedulePolicyRecord,
  schedulesById: Map<string, GamificationScoreScheduleRecord>,
): AdminScorePolicyDto {
  return {
    id: record.id,
    scheduleId: record.schedule,
    scheduleKey: schedulesById.get(record.schedule)?.key || "Unknown schedule",
    policyKey: record.policy_key,
    enabled: Boolean(record.active),
    totalXp: Number(record.total_xp),
    leaderboardXp: Number(record.leaderboard_xp),
    capMembership: Array.isArray(record.cap_membership) ? record.cap_membership : [],
    capCeilingOverrides: record.cap_ceiling_overrides,
    scoreDay: cleanOptionalText(record.score_day),
  };
}

function safeSessionDisplaySnapshot(value: unknown): GamificationSessionDisplaySnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const snapshot = value as Record<string, unknown>;
  const title = cleanOptionalText(snapshot.title);
  const slug = cleanOptionalText(snapshot.slug);
  if (!title || !slug) return undefined;
  const format = cleanOptionalText(snapshot.format);
  return { title, slug, format };
}

function sessionDisplaySnapshot(session: SessionRecord): GamificationSessionDisplaySnapshot {
  const title = cleanText(session.title);
  const slug = cleanText(session.slug);
  if (!title || !slug) throw new Error("The selected Session needs a title and slug before configuring attendance.");
  return { title, slug, format: cleanOptionalText(session.format) };
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  return values.filter(validDate).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function safeActivity(
  record: GamificationActivityRecord,
  context: GamificationContext,
): AdminActivityDto {
  const missionsById = new Map(context.missions.map((mission) => [mission.id, mission]));
  const schedulesById = new Map(context.schedules.map((schedule) => [schedule.id, schedule]));
  const redemptions = context.redemptions.filter((redemption) => redemption.activity === record.id);
  const claims = context.activityClaims.filter((claim) => claim.activity === record.id && claim.status === "accepted");
  return {
    id: record.id,
    key: record.key,
    missionId: cleanOptionalText(record.mission),
    missionKey: record.mission ? missionsById.get(record.mission)?.key : undefined,
    kind: record.kind,
    category: record.category,
    outcomeKey: record.outcome_key,
    evidenceMode: record.evidence_mode,
    evidenceChannel: isEvidenceChannel(record.evidence_channel) ? record.evidence_channel : undefined,
    deploymentLabel: cleanOptionalText(record.deployment_label),
    achievementId: cleanOptionalText(record.achievement),
    partnerId: cleanOptionalText(record.partner),
    partnerKind: record.partner_kind,
    sessionId: cleanOptionalText(record.session),
    sessionKey: cleanOptionalText(record.session_key),
    sessionDisplaySnapshot: safeSessionDisplaySnapshot(record.session_display_snapshot),
    sessionMetaEligible: record.kind === "session" ? Boolean(record.session_meta_eligible) : undefined,
    eventRef: safeEventRef(record.event_ref),
    eventMetaEligible: isConfiguredEventActivityKind(record.kind) ? Boolean(record.event_meta_eligible) : undefined,
    communityMetaEligible: record.kind === "community_partner" ? Boolean(record.community_meta_eligible) : undefined,
    perUserClaimLimit: Number(record.per_user_claim_limit),
    maxClaims: finiteNonNegative(record.max_claims) ? Number(record.max_claims) : undefined,
    activeFrom: cleanOptionalText(record.active_from),
    activeUntil: cleanOptionalText(record.active_until),
    status: record.status,
    enabled: Boolean(record.enabled),
    partnerFollowUp: record.kind === "booth" || record.kind === "community_partner" ? {
      enabled: Boolean(record.partner_follow_up_enabled),
      noticeVersion: cleanOptionalText(record.partner_follow_up_notice_version),
    } : undefined,
    acceptedClaims: claims.length,
    rejectedRedemptions: redemptions.filter((redemption) => redemption.status !== "accepted").length,
    lastAttemptAt: latestTimestamp(redemptions.map((redemption) => redemption.redeemed_at)),
    lastSuccessAt: latestTimestamp(claims.map((claim) => claim.claimed_at || claim.occurred_at)),
    scorePolicies: context.policies
      .filter((policy) => policy.activity === record.id)
      .map((policy) => safePolicy(policy, schedulesById)),
  };
}

function safeCode(record: GamificationCodeRecord, context: GamificationContext): AdminCodeDto {
  const activity = context.activities.find((candidate) => candidate.id === record.activity);
  const mission = activity?.mission ? context.missions.find((candidate) => candidate.id === activity.mission) : undefined;
  const redemptions = context.redemptions.filter((redemption) => redemption.code === record.id);
  const accepted = redemptions.filter((redemption) => redemption.status === "accepted");
  return {
    id: record.id,
    batchId: cleanOptionalText(record.batch_id),
    label: record.label,
    lookupPrefix: record.lookup_prefix,
    activityId: record.activity,
    activityKey: activity?.key,
    activityStatus: activity?.status,
    missionId: activity?.mission,
    missionKey: mission?.key,
    evidenceRole: record.evidence_role,
    status: record.status,
    enabled: Boolean(record.enabled),
    startsAt: cleanOptionalText(record.starts_at),
    endsAt: cleanOptionalText(record.ends_at),
    maxRedemptions: finiteNonNegative(record.max_redemptions) ? Number(record.max_redemptions) : undefined,
    perUserLimit: Number(record.per_user_limit),
    totalRedemptions: Number(record.total_redemptions_cached),
    acceptedRedemptions: accepted.length,
    rejectedRedemptions: redemptions.length - accepted.length,
    lastAttemptAt: latestTimestamp(redemptions.map((redemption) => redemption.redeemed_at)),
    lastSuccessAt: latestTimestamp(accepted.map((redemption) => redemption.redeemed_at)),
    invalidatedAt: cleanOptionalText(record.invalidated_at),
    reissuedFromCodeId: cleanOptionalText(record.reissued_from),
  };
}

function safeSessionReference(
  session: SessionRecord,
  context: GamificationContext,
): AdminGamificationOperationsDto["references"]["sessions"][number] {
  const slot = context.agendaSlots.find((candidate) =>
    candidate.kind === "session" && candidate.session === session.id && candidate.published
  );
  const programme = slot
    ? context.eventProgrammes.find((candidate) => candidate.id === slot.programme)
    : undefined;
  const day = programme
    ? context.conferenceDays.find((candidate) => candidate.id === programme.day && candidate.published)
    : undefined;
  return {
    id: session.id,
    title: cleanText(session.title) || session.id,
    published: Boolean(session.published),
    // This is admin-only configuration context. It is never persisted as evidence.
    scheduleContext: slot && day
      ? { slotId: slot.id, startAt: slot.start_at, endAt: slot.end_at, dayDate: day.local_date }
      : undefined,
  };
}

function definitionSummary(record: { id: string; key?: string; status?: string }): Record<string, unknown> {
  return { id: record.id, key: record.key || undefined, status: record.status || undefined };
}

function expectedCodeRole(evidenceMode: EvidenceMode): GamificationCodeEvidenceRole | undefined {
  if (evidenceMode === "single_code") return "single";
  if (evidenceMode === "two_code_start") return "start";
  if (evidenceMode === "two_code_finish") return "finish";
  if (evidenceMode === "static_puzzle_code") return "static_puzzle";
  return undefined;
}

function auditIdempotencyKey(action: string, id: string): string {
  return `admin-action:v1:${action}:${id}`;
}

function calculatedCapOverrides(
  value: GamificationScoreSchedulePolicyRecord["cap_ceiling_overrides"],
): SeptemberScorePolicy["capCeilingOverrides"] {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [GamificationCapMembership["dimension"], { total_xp_ceiling: number; leaderboard_xp_ceiling: number }] => Boolean(entry[1]))
      .map(([dimension, override]) => [dimension, {
        totalXpCeiling: Number(override.total_xp_ceiling),
        leaderboardXpCeiling: Number(override.leaderboard_xp_ceiling),
      }]),
  );
}

function hasRequiredWindow(from: unknown, until: unknown, label: string, errors: string[]): void {
  if (!validDate(from) || !validDate(until)) {
    errors.push(`${label} requires an active start and end window.`);
    return;
  }
  if (Date.parse(from) >= Date.parse(until)) errors.push(`${label} end must be after its start.`);
}

function uniqueKeys(values: string[]): boolean {
  return new Set(values).size === values.length;
}

type ScoreBand = { totalXp: number; leaderboardXp: number };
type GroupedScoreBand = ScoreBand & { groupTotal: number; groupLeaderboard: number };
type CapRequirement = readonly [GamificationCapMembership["dimension"], string];
type CapCeilingOverrides = GamificationScoreSchedulePolicyRecord["cap_ceiling_overrides"];
/** A validation rule as `[failed, message]`; failed rules report their messages in list order. */
type Check = readonly [unknown, string];
type AuditStart = { record: { id: string }; replayed: boolean; failed: boolean; existing: boolean };
type CodeIdentity = { lookupPrefix: string; codeHash: string };
type CodeGenerationConfig = Required<AdminCodeGenerationInput>;
type CommunityOutcomeInput = AdminCommunityPartnerMissionDraftInput["outcomes"][number];

const MISSION_VISIBILITIES: string[] = ["public", "hidden_until_unlocked", "admin_only"];
const BADGE_RARITIES: string[] = ["common", "uncommon", "rare", "epic", "legendary"];
const EASTER_EGG_EVIDENCE_CHANNELS: string[] = ["wts_qr", "wts_link", "wts_manual_code"];
const REDEEMABLE_CODE_MODES: string[] = ["single_code", "two_code_start", "two_code_finish"];
const EASTER_EGG_KEY = /^easter_egg\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EASTER_EGG_DISCOVERY_KEY = /^easter_egg\.([a-z0-9]+(?:-[a-z0-9]+)*)\.discovery$/;
const SCORING_TWO_CODE_BANDS = new Map<string, GroupedScoreBand>([
  ["two_code_start", { totalXp: 10, leaderboardXp: 5, groupTotal: 40, groupLeaderboard: 30 }],
  ["derived_claim_set", { totalXp: 30, leaderboardXp: 25, groupTotal: 40, groupLeaderboard: 30 }],
]);
const TWO_CODE_SCORE_BANDS = new Map<string, GroupedScoreBand>([
  ...SCORING_TWO_CODE_BANDS,
  ["two_code_finish", { totalXp: 0, leaderboardXp: 0, groupTotal: 40, groupLeaderboard: 30 }],
]);
const CONFIGURED_EVENT_SCORE_BANDS = new Map<string, GroupedScoreBand>([
  ["single_code", { totalXp: 30, leaderboardXp: 25, groupTotal: 30, groupLeaderboard: 25 }],
  ...TWO_CODE_SCORE_BANDS,
]);
const TWO_CODE_KEY_SUFFIXES = new Map<string, "start" | "finish" | "completion">([
  ["two_code_start", "start"],
  ["two_code_finish", "finish"],
  ["derived_claim_set", "completion"],
]);
const CONFIGURED_EVENT_KEY_SUFFIXES = new Map<string, string>([["single_code", "attendance"], ...TWO_CODE_KEY_SUFFIXES]);
const META_DIVERSITY_SOURCE_KINDS = [
  ["session", "session"],
  ["booth", "booth"],
  ["community", "community_partner"],
] as const;

const DRAFT_EDIT_COPY: Record<GamificationDefinitionKind, { notDraft: string; hasAccounting: string }> = {
  achievement: {
    notDraft: "Only draft Achievements can be edited. Retire used definitions and create successors.",
    hasAccounting: "This Achievement has Badge history. Retire it and create an audited successor instead.",
  },
  mission: {
    notDraft: "Only draft Missions can be edited. Retire used definitions and create successors.",
    hasAccounting: "This Mission has accepted evidence. Retire it and create an audited successor instead.",
  },
  activity: {
    notDraft: "Only draft Activities can be edited. Retire used definitions and create successors.",
    hasAccounting: "This Activity has accepted evidence. Retire it and create an audited successor instead.",
  },
};

function failedChecks(checks: Check[]): string[] {
  return checks.filter(([failed]) => failed).map(([, message]) => message);
}

function isImmutableKey(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function hasValidWindow(from: unknown, until: unknown): boolean {
  return validDate(from) && validDate(until) && Date.parse(from) < Date.parse(until);
}

function assertMissionVisibility(value: unknown, message: string): void {
  if (!MISSION_VISIBILITIES.includes(value as string)) throw new Error(message);
}

function assertCodeFlow(value: unknown, message: string): void {
  if (value !== "one_code" && value !== "two_code") throw new Error(message);
}

function assertPresentationCopy(fields: Array<readonly [string, string]>, missingMessage: string): void {
  if (fields.some(([value]) => !value)) throw new Error(missingMessage);
  for (const [value, label] of fields) assertNoSecretText(value, label);
}

interface CanonicalEvidenceInput {
  activeFrom: string;
  activeUntil: string;
  perUserClaimLimit: number;
  maxClaims: number;
  scoreDay: string;
  sortOrder: number;
}

interface CanonicalEvidenceCopy {
  window: string;
  limits: string;
  scoreDay: string;
  sortOrder: string;
}

/** Canonical Mission evidence is one claim per User inside an independent active window. */
function assertCanonicalEvidenceLimits(input: CanonicalEvidenceInput, copy: CanonicalEvidenceCopy): void {
  if (!hasValidWindow(input.activeFrom, input.activeUntil)) throw new Error(copy.window);
  if (input.perUserClaimLimit !== 1 || !isPositiveInteger(input.maxClaims)) throw new Error(copy.limits);
  if (!isISODate(input.scoreDay)) throw new Error(copy.scoreDay);
  if (!Number.isInteger(input.sortOrder)) throw new Error(copy.sortOrder);
}

function requireDraftSchedule(context: GamificationContext, scheduleId: unknown, message: string): GamificationScoreScheduleRecord {
  const schedule = context.schedules.find((candidate) => candidate.id === cleanText(scheduleId));
  if (!schedule || schedule.status !== "draft") throw new Error(message);
  return schedule;
}

function findAchievement(context: GamificationContext, id: string | undefined): GamificationAchievementRecord | undefined {
  return id ? context.achievements.find((candidate) => candidate.id === id) : undefined;
}

function missionFor(activity: GamificationActivityRecord, context: GamificationContext): GamificationMissionRecord | undefined {
  return activity.mission ? context.missions.find((candidate) => candidate.id === activity.mission) : undefined;
}

function activePoliciesFor(activityId: string, context: GamificationContext): GamificationScoreSchedulePolicyRecord[] {
  return context.policies.filter((policy) => policy.activity === activityId && policy.active);
}

function isDirectClaimRule(rule: AdminUnlockRuleInput, activityKey: string): boolean {
  return rule.kind === "activity_claim" && (!rule.activityKeys?.length || rule.activityKeys.includes(activityKey));
}

function isDirectClaimBadge(
  achievement: GamificationAchievementRecord | undefined,
  activityKey: string,
  category?: string,
): achievement is GamificationAchievementRecord {
  return achievement !== undefined &&
    (category === undefined || achievement.category === category) &&
    isDirectClaimRule(safeUnlockRule(achievement.unlock_rule), activityKey);
}

function isExactClaimSetBadge(
  achievement: GamificationAchievementRecord | undefined,
  activityKeys: Array<string | undefined>,
  category?: string,
): achievement is GamificationAchievementRecord {
  if (achievement === undefined || (category !== undefined && achievement.category !== category)) return false;
  const rule = safeUnlockRule(achievement.unlock_rule);
  return rule.kind === "claim_set" &&
    JSON.stringify([...(rule.activityKeys || [])].sort()) === JSON.stringify([...activityKeys].sort());
}

function matchesScoreBand(actual: ScoreBand, expected: ScoreBand | undefined): boolean {
  return expected !== undefined && actual.totalXp === expected.totalXp && actual.leaderboardXp === expected.leaderboardXp;
}

function recordScoreBand(policy: GamificationScoreSchedulePolicyRecord): ScoreBand {
  return { totalXp: policy.total_xp, leaderboardXp: policy.leaderboard_xp };
}

function boothOutcomeBand(outcome: unknown): ScoreBand | undefined {
  return isBoothOutcome(outcome) ? BOOTH_SCORE_BANDS[outcome] : undefined;
}

function communityOutcomeBand(outcome: unknown): ScoreBand | undefined {
  return isCommunityPartnerOutcome(outcome) ? COMMUNITY_PARTNER_SCORE_BANDS[outcome] : undefined;
}

function communityScoreBand(
  activity: GamificationActivityRecord,
  approvedTwoCode: boolean,
  twoCodeBands: Map<string, ScoreBand>,
): ScoreBand | undefined {
  if (approvedTwoCode) return twoCodeBands.get(activity.evidence_mode);
  return activity.evidence_mode === "single_code" ? communityOutcomeBand(activity.outcome_key) : undefined;
}

function hasCapMemberships(memberships: unknown, required: CapRequirement[]): boolean {
  const list: GamificationCapMembership[] = Array.isArray(memberships) ? memberships : [];
  return required.every(([dimension, key]) =>
    list.some((membership) => membership.dimension === dimension && membership.key === key)
  );
}

function dayAndConferenceCaps(scoreDay: string | undefined): CapRequirement[] {
  return [["conference_day", scoreDay || ""], ["conference", "conference"]];
}

function exceedsBoothCap(overrides: CapCeilingOverrides): boolean {
  return Object.values(overrides || {}).some((override) =>
    override ? override.total_xp_ceiling > BOOTH_CAP.totalXp || override.leaderboard_xp_ceiling > BOOTH_CAP.leaderboardXp : false
  );
}

function recordCapOverrides(overrides: SeptemberScorePolicy["capCeilingOverrides"]): CapCeilingOverrides {
  return Object.fromEntries(Object.entries(overrides || {}).map(([dimension, ceiling]) => [dimension, {
    total_xp_ceiling: ceiling.totalXpCeiling,
    leaderboard_xp_ceiling: ceiling.leaderboardXpCeiling,
  }])) as CapCeilingOverrides;
}

function relatedGroupKey(policy: SeptemberScorePolicy): string | undefined {
  return policy.capMembership.find((membership) => membership.dimension === "related_group")?.key;
}

/** Community one-code programmes share the ceiling of their highest scoring active outcome. */
function highestCommunityGroupBand(policies: SeptemberScorePolicy[], groupKey: string | undefined): ScoreBand {
  return policies
    .filter((candidate) =>
      candidate.kind === "community_partner" &&
      candidate.capMembership.some((membership) => membership.dimension === "related_group" && membership.key === groupKey)
    )
    .reduce((current, candidate) =>
      candidate.totalXp > current.totalXp
        ? { totalXp: candidate.totalXp, leaderboardXp: candidate.leaderboardXp }
        : current,
    { totalXp: 0, leaderboardXp: 0 });
}

function isCanonicalBoothMission(mission: GamificationMissionRecord | undefined): mission is GamificationMissionRecord {
  return mission !== undefined &&
    isBoothMissionKey(mission.key) &&
    Boolean(cleanText(mission.partner_key)) &&
    mission.key.startsWith(`booth.${mission.partner_key}.`);
}

function isCanonicalCommunityPolicyMission(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
): mission is GamificationMissionRecord {
  return Boolean(activity.partner) &&
    activity.partner_kind === "community_partner" &&
    mission !== undefined &&
    mission.category === "community" &&
    mission.partner === activity.partner &&
    Boolean(cleanText(mission.partner_key)) &&
    mission.key.startsWith(`community.${mission.partner_key}.`);
}

function hasValidCommunityGroupCeiling(
  relatedOverride: NonNullable<CapCeilingOverrides>["related_group"],
  approvedTwoCode: boolean,
  expected: ScoreBand,
): boolean {
  if (!relatedOverride) return false;
  if (approvedTwoCode) return relatedOverride.total_xp_ceiling === 40 && relatedOverride.leaderboard_xp_ceiling === 30;
  return Object.values(COMMUNITY_PARTNER_SCORE_BANDS).some((band) =>
    band.totalXp === relatedOverride.total_xp_ceiling && band.leaderboardXp === relatedOverride.leaderboard_xp_ceiling
  ) &&
    relatedOverride.total_xp_ceiling >= expected.totalXp &&
    relatedOverride.leaderboard_xp_ceiling >= expected.leaderboardXp;
}

function isApprovedCommunityTwoCode(activity: GamificationActivityRecord, mission: GamificationMissionRecord | undefined): boolean {
  return mission?.metadata?.community_two_code_approved === true &&
    activity.metadata?.community_two_code_approved === true;
}

function hasCommunityPolicyCaps(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord,
  input: AdminScorePolicyInput,
): boolean {
  return hasCapMemberships(input.capMembership, [
    ["activity", activity.id],
    ["related_group", mission.key],
    ["partner", activity.partner || ""],
    ["category", "community"],
    ...dayAndConferenceCaps(input.scoreDay),
  ]) && isISODate(input.scoreDay);
}

function hasConfiguredEventPolicyCaps(activity: GamificationActivityRecord, capGroupKey: string, input: AdminScorePolicyInput): boolean {
  return Boolean(capGroupKey) &&
    hasCapMemberships(input.capMembership, [
      ["activity", activity.id],
      ["related_group", capGroupKey],
      ["category", activity.category],
      ...dayAndConferenceCaps(input.scoreDay),
    ]) &&
    isISODate(input.scoreDay);
}

function matchesGroupCeiling(override: NonNullable<CapCeilingOverrides>["related_group"], expected: GroupedScoreBand): boolean {
  return Boolean(override) &&
    override!.total_xp_ceiling === expected.groupTotal &&
    override!.leaderboard_xp_ceiling === expected.groupLeaderboard;
}

function hasPartnerCapMembership(memberships: unknown): boolean {
  return Array.isArray(memberships) && memberships.some((membership: GamificationCapMembership) => membership.dimension === "partner");
}

function sameMembershipSet(memberships: GamificationCapMembership[], expected: string[]): boolean {
  const actual = new Set(memberships.map((membership) => `${membership.dimension}:${membership.key}`));
  return actual.size === new Set(expected).size && expected.every((membership) => actual.has(membership));
}

function scorePolicyInput(policy: GamificationScoreSchedulePolicyRecord): AdminScorePolicyInput {
  return {
    scheduleId: policy.schedule,
    policyKey: policy.policy_key,
    enabled: policy.active,
    totalXp: policy.total_xp,
    leaderboardXp: policy.leaderboard_xp,
    capMembership: policy.cap_membership,
    capCeilingOverrides: policy.cap_ceiling_overrides,
    scoreDay: policy.score_day,
  };
}

function policyAssertionErrors(
  policies: GamificationScoreSchedulePolicyRecord[],
  missingMessage: string,
  fallbackMessage: string,
  assertPolicy: (input: AdminScorePolicyInput) => void,
): string[] {
  const errors = policies.length === 0 ? [missingMessage] : [];
  for (const policy of policies) {
    try {
      assertPolicy(scorePolicyInput(policy));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : fallbackMessage);
    }
  }
  return errors;
}

interface TwoCodeFlow {
  start?: GamificationActivityRecord;
  finish?: GamificationActivityRecord;
  completion?: GamificationActivityRecord;
  twoCode: boolean;
}

function twoCodeFlow(activities: GamificationActivityRecord[]): TwoCodeFlow {
  const start = activities.find((candidate) => candidate.evidence_mode === "two_code_start");
  const finish = activities.find((candidate) => candidate.evidence_mode === "two_code_finish");
  const completion = activities.find((candidate) => candidate.evidence_mode === "derived_claim_set");
  return { start, finish, completion, twoCode: activities.length === 3 && Boolean(start && finish && completion) };
}

function isCompletionOnlyMeta(flow: TwoCodeFlow, field: "event_meta_eligible" | "community_meta_eligible"): boolean {
  return !flow.start?.[field] && !flow.finish?.[field] && typeof flow.completion?.[field] === "boolean";
}

function redeemableArtifactErrors(activity: GamificationActivityRecord, copy: { code: string; derived: string }): string[] {
  if (REDEEMABLE_CODE_MODES.includes(activity.evidence_mode)) {
    return isEvidenceChannel(activity.evidence_channel) && cleanText(activity.deployment_label) ? [] : [copy.code];
  }
  return activity.evidence_mode === "derived_claim_set" && (activity.evidence_channel || cleanText(activity.deployment_label))
    ? [copy.derived]
    : [];
}

function isHiddenEasterEggBadge(achievement: GamificationAchievementRecord): boolean {
  return achievement.category === "easter_egg" &&
    achievement.visibility === "hidden_until_unlocked" &&
    safeUnlockRule(achievement.unlock_rule).kind === "activity_claim";
}

function isHiddenRelationFreeEasterEggMission(mission: GamificationMissionRecord): boolean {
  return mission.category === "easter_egg" &&
    mission.visibility === "hidden_until_unlocked" &&
    !mission.suggested &&
    !mission.partner &&
    !mission.session &&
    !safeEventRef(mission.event_ref);
}

function isEasterEggDiscoveryShape(activity: GamificationActivityRecord): boolean {
  return activity.kind === "easter_egg" &&
    activity.category === "easter_egg" &&
    activity.outcome_key === "static_discovery" &&
    activity.evidence_mode === "static_puzzle_code";
}

function isEasterEggDefinition(activity: GamificationActivityRecord): boolean {
  return activity.kind === "easter_egg" || activity.category === "easter_egg";
}

function assertAchievementDraftInput(input: AdminAchievementDraftInput, key: string): void {
  if (!key) throw new Error("Achievement key is required.");
  if (input.category === "easter_egg" || key.startsWith("easter_egg.")) {
    throw new Error("Configure Easter Egg Badges through the dedicated Easter Egg Mission operation.");
  }
  if (!isUnlockRuleKind(input.unlockRule?.kind)) throw new Error("Choose a valid Achievement unlock rule.");
  if (!isCategory(input.category)) throw new Error("Choose a valid Achievement category.");
  if (!cleanText(input.badgeName) || !cleanText(input.badgeDescription)) {
    throw new Error("Badge name and description are required.");
  }
  if (!Number.isInteger(input.sortOrder)) throw new Error("Achievement sort order must be a whole number.");
}

function assertMissionDraftInput(input: AdminMissionDraftInput, key: string, slug: string): void {
  if (!key || !slug) throw new Error("Mission key and slug are required.");
  if (input.category === "easter_egg" || key.startsWith("easter_egg.")) {
    throw new Error("Configure Easter Egg Missions through the dedicated Easter Egg Mission operation.");
  }
  if (!isCategory(input.category) || !cleanText(input.title) || !cleanText(input.summary)) {
    throw new Error("Mission category, title, and summary are required.");
  }
  if (!Number.isInteger(input.sortOrder)) throw new Error("Mission sort order must be a whole number.");
}

function assertGenericMissionDraft(existing: GamificationMissionRecord | undefined, key: string): void {
  if (existing?.category === "community" || key.startsWith("community.")) {
    throw new Error("Configure Community Partner programmes through the dedicated Community Partner operation.");
  }
  if (existing && configuredEventReference(existing.event_ref)) {
    throw new Error("Configured event Missions may only be changed through the dedicated event operation.");
  }
}

function assertGenericActivityDraft(input: AdminActivityDraftInput): void {
  if (input.kind === "session") {
    throw new Error("Configure Session attendance through the dedicated Session Mission operation.");
  }
  if (isConfiguredEventActivityKind(input.kind)) {
    throw new Error("Configure workshops and surrounding events through the dedicated event Mission operation.");
  }
  if (input.kind === "community_partner") {
    throw new Error("Configure Community Partner Activities through the dedicated Community Partner operation.");
  }
  if (input.kind === "easter_egg" || input.category === "easter_egg" || cleanText(input.key).startsWith("easter_egg.")) {
    throw new Error("Configure Easter Egg Activities through the dedicated Easter Egg Mission operation.");
  }
}

function assertActivityDraftInput(input: AdminActivityDraftInput, key: string): void {
  if (!key || !isCategory(input.category) || !isActivityKind(input.kind) || !isEvidenceMode(input.evidenceMode)) {
    throw new Error("Activity key, category, kind, and evidence mode are required.");
  }
  if (!cleanText(input.outcomeKey) || !isPositiveInteger(input.perUserClaimLimit)) {
    throw new Error("Activity outcome and per-User claim limit are required.");
  }
  if (input.kind === "qr" && (input.evidenceMode !== "single_code" || input.outcomeKey !== "completion")) {
    throw new Error("QR Activities require single-code evidence and the completion outcome.");
  }
}

interface CodeActivityDefinition {
  key: string;
  outcome: string;
  evidenceMode: EvidenceMode;
  deploymentLabel: string | undefined;
  achievement: string | undefined;
  metaEligible: boolean;
  score: ScoreBand;
}

interface CommunityActivityDefinition extends CodeActivityDefinition {
  followUp: { enabled: boolean; noticeVersion?: string };
}

const SESSION_EVIDENCE_COPY: CanonicalEvidenceCopy = {
  window: "Session Mission evidence requires a valid independent active window.",
  limits: "Session attendance supports one claim per User and requires a positive global claim limit.",
  scoreDay: "Session scoring requires a configured conference score day.",
  sortOrder: "Session Mission sort order must be a whole number.",
};

interface SessionAttendancePlan {
  sessionId: string;
  sessionKey: string;
  missionKey: string;
  activityKey: string;
  slug: string;
  missionTitle: string;
  missionSummary: string;
  deploymentLabel: string;
}

interface SessionAttendanceSources {
  session: SessionRecord;
  schedule: GamificationScoreScheduleRecord;
  achievementId: string;
}

interface ExistingSessionAttendance {
  mission: GamificationMissionRecord | undefined;
  activity: GamificationActivityRecord | undefined;
}

function parseSessionAttendanceInput(input: AdminSessionAttendanceMissionDraftInput): SessionAttendancePlan {
  const sessionId = cleanText(input.sessionId);
  const sessionKey = cleanKey(input.sessionKey);
  const missionKey = `session.${sessionKey}`;
  const activityKey = `${missionKey}.attendance`;
  const missionTitle = cleanText(input.title);
  const missionSummary = cleanText(input.summary);
  const deploymentLabel = safeOperationalLabel(input.deploymentLabel);
  if (!sessionId || !isImmutableKey(sessionKey)) {
    throw new Error("Choose a Session and provide an immutable lowercase Session key.");
  }
  assertPresentationCopy(
    [[missionTitle, "Session Mission title"], [missionSummary, "Session Mission summary"]],
    "Session Mission title and summary are required.",
  );
  assertMissionVisibility(input.visibility, "Choose a valid Session Mission visibility.");
  if (!isEvidenceChannel(input.evidenceChannel)) {
    throw new Error("Session Missions require a WTS-controlled deployment artifact and channel.");
  }
  assertCanonicalEvidenceLimits(input, SESSION_EVIDENCE_COPY);
  return {
    sessionId,
    sessionKey,
    missionKey,
    activityKey,
    slug: `session-${sessionKey}`,
    missionTitle,
    missionSummary,
    deploymentLabel,
  };
}

function resolveSessionAttendanceSources(
  input: AdminSessionAttendanceMissionDraftInput,
  plan: SessionAttendancePlan,
  context: GamificationContext,
): SessionAttendanceSources {
  const session = context.sessions.find((candidate) => candidate.id === plan.sessionId);
  if (!session?.published) throw new Error("Choose an existing published Session.");
  const schedule = requireDraftSchedule(context, input.scoreScheduleId, "Choose a draft score schedule for the Session policy.");
  const achievementId = cleanText(input.achievementId);
  const achievement = context.achievements.find((candidate) => candidate.id === achievementId);
  if (achievementId && !isDirectClaimBadge(achievement, plan.activityKey, "session")) {
    throw new Error("A direct Session Badge must use a Session Activity-claim rule for this immutable Activity key.");
  }
  return { session, schedule, achievementId };
}

function sessionAttendanceAuditSummary(
  input: AdminSessionAttendanceMissionDraftInput,
  plan: SessionAttendancePlan,
  sources: SessionAttendanceSources,
): Record<string, unknown> {
  return {
    definition: "session_attendance",
    sessionId: plan.sessionId,
    sessionKey: plan.sessionKey,
    missionKey: plan.missionKey,
    activityKey: plan.activityKey,
    title: plan.missionTitle,
    summary: plan.missionSummary,
    visibility: input.visibility,
    evidenceChannel: input.evidenceChannel,
    deploymentLabel: plan.deploymentLabel,
    activeFrom: input.activeFrom,
    activeUntil: input.activeUntil,
    maxClaims: input.maxClaims,
    achievementId: sources.achievementId || undefined,
    metaEligible: Boolean(input.metaEligible),
    scoreScheduleId: sources.schedule.id,
    scoreDay: input.scoreDay,
    sortOrder: input.sortOrder,
  };
}

function sessionSourceMismatch(plan: SessionAttendancePlan, existing: ExistingSessionAttendance): boolean {
  const { mission, activity } = existing;
  return Boolean(
    (mission && (mission.session !== plan.sessionId || mission.slug !== plan.slug)) ||
    (activity && (activity.session !== plan.sessionId || activity.session_key !== plan.sessionKey)),
  );
}

function sessionAttendanceConflicts(
  auditExists: boolean,
  plan: SessionAttendancePlan,
  existing: ExistingSessionAttendance,
  context: GamificationContext,
): Check[] {
  return [
    [!auditExists && (existing.mission || existing.activity), "This immutable Session Mission key is already configured."],
    [sessionSourceMismatch(plan, existing), "The interrupted Session Mission configuration does not match this immutable Session source."],
    [
      context.activities.some((activity) =>
        activity.id !== existing.activity?.id &&
        activity.kind === "session" &&
        activity.session === plan.sessionId &&
        activity.status !== "retired",
      ),
      "This Session already has a configured attendance Activity. Retire it before creating an audited successor.",
    ],
    [
      context.missions.some((mission) => mission.id !== existing.mission?.id && mission.slug === plan.slug),
      "This Session Mission slug is already in use.",
    ],
  ];
}

const CONFIGURED_EVENT_EVIDENCE_COPY: CanonicalEvidenceCopy = {
  window: "Configured events require a valid independent operating window.",
  limits: "Configured events support one claim per Activity and require a positive global claim limit.",
  scoreDay: "Configured event scoring requires a score day.",
  sortOrder: "Event Mission sort order must be a whole number.",
};

interface ConfiguredEventCopy {
  eventKey: string;
  title: string;
  missionTitle: string;
  summary: string;
  attendanceDeploymentLabel: string;
  finishDeploymentLabel: string | undefined;
}

interface ConfiguredEventPlan extends ConfiguredEventCopy {
  schedule: GamificationScoreScheduleRecord;
  hostPartnerId: string;
  missionKey: string;
  capGroupKey: string;
  slug: string;
  attendanceKey: string;
  finishKey: string;
  completionKey: string;
  category: GamificationActivityRecord["category"];
  activityKind: GamificationActivityRecord["kind"];
  attendanceAchievement: GamificationAchievementRecord | undefined;
  completionAchievement: GamificationAchievementRecord | undefined;
  eventRef: ConfiguredEventReference;
  activityKeys: string[];
}

function parseConfiguredEventInput(input: AdminConfiguredEventMissionDraftInput): ConfiguredEventCopy {
  const eventKey = cleanKey(input.eventKey);
  const title = cleanText(input.title);
  const missionTitle = cleanText(input.missionTitle);
  const summary = cleanText(input.summary);
  if (!isImmutableKey(eventKey) || !isConfiguredEventKind(input.kind)) {
    throw new Error("Provide an immutable lowercase event key and supported event kind.");
  }
  assertPresentationCopy(
    [[title, "Event title"], [missionTitle, "Event Mission title"], [summary, "Event Mission summary"]],
    "Event title, Mission title, and summary are required.",
  );
  assertMissionVisibility(input.visibility, "Choose a valid event Mission visibility.");
  assertCodeFlow(input.flow, "Choose one-code attendance or two-code completion.");
  if (input.flow === "two_code" && input.kind !== "workshop" && !input.relatedEventTwoCodeApproved) {
    throw new Error("Two-code completion outside workshops requires explicit organizer approval.");
  }
  if (!isEvidenceChannel(input.evidenceChannel)) {
    throw new Error("Configured events require a WTS-controlled QR, link, or manual-code artifact.");
  }
  const attendanceDeploymentLabel = safeOperationalLabel(input.attendanceDeploymentLabel);
  const finishDeploymentLabel = input.flow === "two_code" ? safeOperationalLabel(input.finishDeploymentLabel) : undefined;
  assertCanonicalEvidenceLimits(input, CONFIGURED_EVENT_EVIDENCE_COPY);
  return { eventKey, title, missionTitle, summary, attendanceDeploymentLabel, finishDeploymentLabel };
}

function configuredEventAttendanceBadge(
  input: AdminConfiguredEventMissionDraftInput,
  attendanceKey: string,
  category: string,
  context: GamificationContext,
): GamificationAchievementRecord | undefined {
  const achievementId = cleanText(input.attendanceAchievementId);
  const achievement = findAchievement(context, achievementId);
  if (achievementId && !achievement) throw new Error("Choose an existing attendance Badge.");
  if (achievement && !isDirectClaimBadge(achievement, attendanceKey, category)) {
    throw new Error("The attendance Badge must use this event's direct Activity-claim rule.");
  }
  return achievement;
}

function configuredEventCompletionBadge(
  input: AdminConfiguredEventMissionDraftInput,
  claimSet: string[],
  category: string,
  context: GamificationContext,
): GamificationAchievementRecord | undefined {
  if (input.flow !== "two_code") return undefined;
  const achievement = findAchievement(context, cleanText(input.completionAchievementId));
  if (!isExactClaimSetBadge(achievement, claimSet, category)) {
    throw new Error("Two-code completion requires a Badge with the exact configured start-and-finish claim set.");
  }
  return achievement;
}

function planConfiguredEvent(
  input: AdminConfiguredEventMissionDraftInput,
  copy: ConfiguredEventCopy,
  context: GamificationContext,
): ConfiguredEventPlan {
  const schedule = requireDraftSchedule(context, input.scoreScheduleId, "Choose a draft score schedule for the configured event.");
  const hostPartnerId = cleanText(input.hostPartnerId);
  if (hostPartnerId && !context.partners.some((partner) => partner.id === hostPartnerId)) {
    throw new Error("Choose an existing host partner or leave host attribution empty for a WTS-run event.");
  }
  const missionKey = configuredEventMissionKey(input.kind, copy.eventKey);
  const capGroupKey = cleanKey(input.capGroupKey);
  if (!capGroupKey) throw new Error("Configured events require an organizer-supplied cap group key.");
  const attendanceKey = `${missionKey}.${input.flow === "one_code" ? "attendance" : "start"}`;
  const finishKey = `${missionKey}.finish`;
  const completionKey = `${missionKey}.completion`;
  const category = configuredEventCategory(input.kind);
  const attendanceAchievement = configuredEventAttendanceBadge(input, attendanceKey, category, context);
  const completionAchievement = configuredEventCompletionBadge(input, [finishKey, attendanceKey], category, context);
  return {
    ...copy,
    schedule,
    hostPartnerId,
    missionKey,
    capGroupKey,
    slug: `${input.kind}-${copy.eventKey}`,
    attendanceKey,
    finishKey,
    completionKey,
    category,
    activityKind: configuredEventActivityKind(input.kind),
    attendanceAchievement,
    completionAchievement,
    eventRef: {
      eventKey: copy.eventKey,
      kind: input.kind,
      title: copy.title,
      startsAt: input.activeFrom,
      endsAt: input.activeUntil,
      visibility: input.visibility,
      locationLabel: cleanOptionalText(input.locationLabel),
    },
    activityKeys: input.flow === "one_code" ? [attendanceKey] : [attendanceKey, finishKey, completionKey],
  };
}

function configuredEventAuditSummary(input: AdminConfiguredEventMissionDraftInput, plan: ConfiguredEventPlan): Record<string, unknown> {
  return {
    definition: "configured_event",
    eventRef: plan.eventRef,
    missionKey: plan.missionKey,
    activityKeys: plan.activityKeys,
    flow: input.flow,
    hostPartnerId: plan.hostPartnerId || undefined,
    capGroupKey: plan.capGroupKey,
    metaEligible: Boolean(input.metaEligible),
    scoreScheduleId: plan.schedule.id,
    scoreDay: input.scoreDay,
    request: {
      title: plan.title,
      missionTitle: plan.missionTitle,
      summary: plan.summary,
      visibility: input.visibility,
      locationLabel: cleanOptionalText(input.locationLabel),
      hostPartnerId: plan.hostPartnerId || undefined,
      relatedEventTwoCodeApproved: Boolean(input.relatedEventTwoCodeApproved),
      suggested: Boolean(input.suggested),
      evidenceChannel: input.evidenceChannel,
      attendanceDeploymentLabel: plan.attendanceDeploymentLabel,
      finishDeploymentLabel: plan.finishDeploymentLabel || undefined,
      activeFrom: input.activeFrom,
      activeUntil: input.activeUntil,
      perUserClaimLimit: input.perUserClaimLimit,
      maxClaims: input.maxClaims,
      attendanceAchievementId: plan.attendanceAchievement?.id,
      completionAchievementId: plan.completionAchievement?.id,
      sortOrder: input.sortOrder,
    },
  };
}

function configuredEventConflicts(
  auditExists: boolean,
  plan: ConfiguredEventPlan,
  existingMission: GamificationMissionRecord | undefined,
  existingActivities: GamificationActivityRecord[],
): Check[] {
  const missionMismatch = existingMission !== undefined && (
    !sameConfiguredEventReference(existingMission.event_ref, plan.eventRef) || existingMission.slug !== plan.slug
  );
  return [
    [!auditExists && (existingMission || existingActivities.length > 0), "This immutable event key is already configured."],
    [
      missionMismatch || existingActivities.some((activity) => !sameConfiguredEventReference(activity.event_ref, plan.eventRef)),
      "The interrupted event configuration does not match this immutable event reference.",
    ],
  ];
}

function configuredEventActivityDefinitions(
  input: AdminConfiguredEventMissionDraftInput,
  plan: ConfiguredEventPlan,
): CodeActivityDefinition[] {
  if (input.flow === "one_code") {
    return [{
      key: plan.attendanceKey,
      outcome: "attendance",
      evidenceMode: "single_code",
      deploymentLabel: plan.attendanceDeploymentLabel,
      achievement: plan.attendanceAchievement?.id,
      metaEligible: Boolean(input.metaEligible),
      score: { totalXp: 30, leaderboardXp: 25 },
    }];
  }
  return [
    {
      key: plan.attendanceKey,
      outcome: "attendance",
      evidenceMode: "two_code_start",
      deploymentLabel: plan.attendanceDeploymentLabel,
      achievement: plan.attendanceAchievement?.id,
      metaEligible: false,
      score: { totalXp: 10, leaderboardXp: 5 },
    },
    {
      key: plan.finishKey,
      outcome: "completion",
      evidenceMode: "two_code_finish",
      deploymentLabel: plan.finishDeploymentLabel,
      achievement: undefined,
      metaEligible: false,
      score: { totalXp: 0, leaderboardXp: 0 },
    },
    {
      key: plan.completionKey,
      outcome: "completion",
      evidenceMode: "derived_claim_set",
      deploymentLabel: undefined,
      achievement: plan.completionAchievement?.id,
      metaEligible: Boolean(input.metaEligible),
      score: { totalXp: 30, leaderboardXp: 25 },
    },
  ];
}

function configuredEventActivityRow(
  input: AdminConfiguredEventMissionDraftInput,
  plan: ConfiguredEventPlan,
  definition: CodeActivityDefinition,
  missionId: string,
): Record<string, unknown> {
  return {
    key: definition.key,
    mission: missionId,
    kind: plan.activityKind,
    category: plan.category,
    outcome_key: definition.outcome,
    evidence_mode: definition.evidenceMode,
    evidence_channel: definition.evidenceMode === "derived_claim_set" ? "" : input.evidenceChannel,
    deployment_label: definition.deploymentLabel || "",
    achievement: definition.achievement || "",
    partner: plan.hostPartnerId,
    partner_kind: plan.hostPartnerId ? "workshop_host" : "",
    event_ref: plan.eventRef,
    event_meta_eligible: definition.metaEligible,
    per_user_claim_limit: 1,
    max_claims: input.maxClaims,
    active_from: input.activeFrom,
    active_until: input.activeUntil,
    status: "draft",
    enabled: true,
    metadata: { cap_group_key: plan.capGroupKey },
  };
}

function configuredEventScorePolicy(
  input: AdminConfiguredEventMissionDraftInput,
  plan: ConfiguredEventPlan,
  definition: CodeActivityDefinition,
  activityId: string,
): AdminScorePolicyInput {
  const oneCode = input.flow === "one_code";
  return {
    scheduleId: plan.schedule.id,
    policyKey: definition.key,
    enabled: true,
    totalXp: definition.score.totalXp,
    leaderboardXp: definition.score.leaderboardXp,
    capMembership: [
      { dimension: "activity", key: activityId },
      { dimension: "related_group", key: plan.capGroupKey },
      { dimension: "category", key: plan.category },
      { dimension: "conference_day", key: input.scoreDay },
      { dimension: "conference", key: "conference" },
    ],
    capCeilingOverrides: {
      related_group: {
        total_xp_ceiling: oneCode ? 30 : 40,
        leaderboard_xp_ceiling: oneCode ? 25 : 30,
      },
    },
    scoreDay: input.scoreDay,
  };
}

const COMMUNITY_PARTNER_EVIDENCE_COPY: CanonicalEvidenceCopy = {
  window: "Community Partner programmes require a valid independent operating window.",
  limits: "Community Partner Activities support one claim per User and require a positive global claim limit.",
  scoreDay: "Community Partner scoring requires a score day.",
  sortOrder: "Community Partner Mission sort order must be a whole number.",
};

interface CommunityPartnerIdentity {
  partnerId: string;
  partnerKey: string;
  programmeKey: string;
  missionTitle: string;
  summary: string;
}

interface CommunityPartnerDeploymentLabels {
  primaryDeploymentLabel: string | undefined;
  outcomeDeploymentLabels: Map<CommunityPartnerOutcome, string>;
  finishDeploymentLabel: string | undefined;
}

interface CommunityPartnerCopy extends CommunityPartnerIdentity, CommunityPartnerDeploymentLabels {
  selectedOutcomes: CommunityOutcomeInput[];
}

type CommunityOutcomeDefinition = CommunityOutcomeInput & { key: string; achievement: GamificationAchievementRecord };

interface CommunityPartnerPlan extends CommunityPartnerCopy {
  schedule: GamificationScoreScheduleRecord;
  missionKey: string;
  slug: string;
  directKey: string;
  finishKey: string;
  completionKey: string;
  directAchievement: GamificationAchievementRecord | undefined;
  oneCodeDefinitions: CommunityOutcomeDefinition[];
  completionAchievement: GamificationAchievementRecord | undefined;
  activityKeys: string[];
}

function parseCommunityPartnerIdentity(input: AdminCommunityPartnerMissionDraftInput): CommunityPartnerIdentity {
  const partnerId = cleanText(input.partnerId);
  const partnerKey = cleanKey(input.partnerKey);
  const programmeKey = cleanKey(input.activityKey);
  if (!partnerId || !isImmutableKey(partnerKey) || !isImmutableKey(programmeKey)) {
    throw new Error("Choose an existing partner and provide immutable lowercase partner and programme keys.");
  }
  const missionTitle = cleanText(input.missionTitle);
  const summary = cleanText(input.summary);
  assertPresentationCopy(
    [[missionTitle, "Community Partner Mission title"], [summary, "Community Partner Mission summary"]],
    "Community Partner Mission title and summary are required.",
  );
  assertMissionVisibility(input.visibility, "Choose a valid Community Partner Mission visibility.");
  assertCodeFlow(input.flow, "Choose a one-code or explicitly approved two-code programme.");
  return { partnerId, partnerKey, programmeKey, missionTitle, summary };
}

function isCommunityOutcomeSelection(outcomes: CommunityOutcomeInput[]): boolean {
  return outcomes.length >= 1 && outcomes.length <= 3 &&
    outcomes.every((definition) => isCommunityPartnerOutcome(definition.outcome)) &&
    uniqueKeys(outcomes.map((definition) => definition.outcome));
}

function assertCommunityOutcomeSelection(flow: AdminCommunityPartnerMissionDraftInput["flow"], outcomes: CommunityOutcomeInput[]): void {
  if (flow === "one_code" && !isCommunityOutcomeSelection(outcomes)) {
    throw new Error("Choose each Community Partner attendance, participation, or completion outcome at most once.");
  }
  if (outcomes.filter((definition) => definition.metaEligible).length > 1) {
    throw new Error("At most one qualifying Activity per Community Partner programme may register with Meta rules.");
  }
  if (outcomes.some((definition) => definition.partnerFollowUp.enabled && !cleanText(definition.partnerFollowUp.noticeVersion))) {
    throw new Error("Enabled Community Partner follow-up requires a notice version.");
  }
}

function communityDeploymentLabels(
  input: AdminCommunityPartnerMissionDraftInput,
  selectedOutcomes: CommunityOutcomeInput[],
): CommunityPartnerDeploymentLabels {
  const twoCode = input.flow === "two_code";
  const primaryDeploymentLabel = twoCode ? safeOperationalLabel(input.primaryDeploymentLabel) : undefined;
  const outcomeDeploymentLabels = new Map(selectedOutcomes.map((definition) => [definition.outcome, safeOperationalLabel(definition.deploymentLabel)]));
  const finishDeploymentLabel = twoCode ? safeOperationalLabel(input.finishDeploymentLabel) : undefined;
  return { primaryDeploymentLabel, outcomeDeploymentLabels, finishDeploymentLabel };
}

function parseCommunityPartnerInput(input: AdminCommunityPartnerMissionDraftInput): CommunityPartnerCopy {
  const identity = parseCommunityPartnerIdentity(input);
  const selectedOutcomes = input.flow === "one_code" && Array.isArray(input.outcomes) ? input.outcomes : [];
  assertCommunityOutcomeSelection(input.flow, selectedOutcomes);
  if (input.flow === "two_code" && !input.communityTwoCodeApproved) {
    throw new Error("Community Partner two-code completion requires explicit organizer approval.");
  }
  if (!isEvidenceChannel(input.evidenceChannel)) {
    throw new Error("Community Partner Activities require a WTS-controlled QR, link, manual, or static-code artifact.");
  }
  const labels = communityDeploymentLabels(input, selectedOutcomes);
  assertCanonicalEvidenceLimits(input, COMMUNITY_PARTNER_EVIDENCE_COPY);
  if (input.flow === "two_code" && input.partnerFollowUp.enabled && !cleanText(input.partnerFollowUp.noticeVersion)) {
    throw new Error("Enabled Community Partner follow-up requires a notice version.");
  }
  return { ...identity, selectedOutcomes, ...labels };
}

function communityDirectBadge(
  input: AdminCommunityPartnerMissionDraftInput,
  directKey: string,
  context: GamificationContext,
): GamificationAchievementRecord | undefined {
  if (input.flow !== "two_code") return undefined;
  const achievement = findAchievement(context, cleanText(input.directAchievementId));
  if (!achievement || achievement.category !== "community") {
    throw new Error("Community Partner programmes require a distinct Community Badge for their direct Activity.");
  }
  if (!isDirectClaimRule(safeUnlockRule(achievement.unlock_rule), directKey)) {
    throw new Error("The direct Community Badge must use this programme's Activity-claim rule.");
  }
  return achievement;
}

function communityOutcomeDefinition(
  definition: CommunityOutcomeInput,
  missionKey: string,
  context: GamificationContext,
): CommunityOutcomeDefinition {
  const key = communityPartnerActivityKey(missionKey, definition.outcome);
  const achievement = context.achievements.find((candidate) => candidate.id === cleanText(definition.achievementId));
  if (!isDirectClaimBadge(achievement, key, "community")) {
    throw new Error(`The ${definition.outcome} Community Badge must use that outcome's direct Activity-claim rule.`);
  }
  return { ...definition, key, achievement };
}

function communityCompletionBadge(
  input: AdminCommunityPartnerMissionDraftInput,
  claimSet: string[],
  context: GamificationContext,
): GamificationAchievementRecord | undefined {
  if (input.flow !== "two_code") return undefined;
  const achievement = findAchievement(context, cleanText(input.completionAchievementId));
  if (!isExactClaimSetBadge(achievement, claimSet, "community")) {
    throw new Error("Community Partner two-code completion requires a distinct Badge with the exact start-and-finish claim set.");
  }
  return achievement;
}

function planCommunityPartnerProgramme(
  input: AdminCommunityPartnerMissionDraftInput,
  copy: CommunityPartnerCopy,
  context: GamificationContext,
): CommunityPartnerPlan {
  // Public partner type/tier is intentionally not consulted here.
  if (!context.partners.some((partner) => partner.id === copy.partnerId)) throw new Error("Choose an existing Community Partner record.");
  const schedule = requireDraftSchedule(context, input.scoreScheduleId, "Choose a draft score schedule for the Community Partner programme.");
  const missionKey = communityPartnerMissionKey(copy.partnerKey, copy.programmeKey);
  const directKey = communityPartnerActivityKey(missionKey, "start");
  const finishKey = communityPartnerActivityKey(missionKey, "finish");
  const completionKey = communityPartnerActivityKey(missionKey, "completion");
  const directAchievement = communityDirectBadge(input, directKey, context);
  const oneCodeDefinitions = copy.selectedOutcomes.map((definition) => communityOutcomeDefinition(definition, missionKey, context));
  const completionAchievement = communityCompletionBadge(input, [directKey, finishKey], context);
  return {
    ...copy,
    schedule,
    missionKey,
    slug: `community-${copy.partnerKey}-${copy.programmeKey}`,
    directKey,
    finishKey,
    completionKey,
    directAchievement,
    oneCodeDefinitions,
    completionAchievement,
    activityKeys: input.flow === "one_code" ? oneCodeDefinitions.map((definition) => definition.key) : [directKey, finishKey, completionKey],
  };
}

function communityPartnerAuditRequest(input: AdminCommunityPartnerMissionDraftInput, plan: CommunityPartnerPlan): Record<string, unknown> {
  return {
    missionTitle: plan.missionTitle,
    summary: plan.summary,
    visibility: input.visibility,
    suggested: Boolean(input.suggested),
    communityTwoCodeApproved: Boolean(input.communityTwoCodeApproved),
    evidenceChannel: input.evidenceChannel,
    primaryDeploymentLabel: plan.primaryDeploymentLabel || undefined,
    finishDeploymentLabel: plan.finishDeploymentLabel || undefined,
    activeFrom: input.activeFrom,
    activeUntil: input.activeUntil,
    perUserClaimLimit: input.perUserClaimLimit,
    maxClaims: input.maxClaims,
    directAchievementId: plan.directAchievement?.id,
    completionAchievementId: plan.completionAchievement?.id,
    partnerFollowUp: input.partnerFollowUp,
    outcomes: plan.oneCodeDefinitions.map((definition) => ({
      outcome: definition.outcome,
      deploymentLabel: cleanText(definition.deploymentLabel),
      achievementId: definition.achievement.id,
      metaEligible: Boolean(definition.metaEligible),
      partnerFollowUp: definition.partnerFollowUp,
    })),
    sortOrder: input.sortOrder,
  };
}

function communityPartnerAuditSummary(input: AdminCommunityPartnerMissionDraftInput, plan: CommunityPartnerPlan): Record<string, unknown> {
  const oneCode = input.flow === "one_code";
  return {
    definition: "community_partner_programme",
    partnerId: plan.partnerId,
    partnerKey: plan.partnerKey,
    missionKey: plan.missionKey,
    activityKeys: plan.activityKeys,
    flow: input.flow,
    outcomes: oneCode ? plan.oneCodeDefinitions.map((definition) => definition.outcome) : ["completion"],
    metaEligible: oneCode ? plan.oneCodeDefinitions.some((definition) => definition.metaEligible) : Boolean(input.metaEligible),
    scoreScheduleId: plan.schedule.id,
    scoreDay: input.scoreDay,
    request: communityPartnerAuditRequest(input, plan),
  };
}

function communityProgrammeMismatch(
  plan: CommunityPartnerPlan,
  existingMission: GamificationMissionRecord | undefined,
  existingActivities: GamificationActivityRecord[],
): boolean {
  const missionMismatch = existingMission !== undefined && (
    existingMission.partner !== plan.partnerId ||
    existingMission.partner_key !== plan.partnerKey ||
    existingMission.slug !== plan.slug
  );
  return missionMismatch || existingActivities.some((activity) =>
    activity.partner !== plan.partnerId || activity.mission !== existingMission?.id
  );
}

function communityPartnerConflicts(
  auditExists: boolean,
  plan: CommunityPartnerPlan,
  existingMission: GamificationMissionRecord | undefined,
  existingActivities: GamificationActivityRecord[],
): Check[] {
  return [
    [!auditExists && (existingMission || existingActivities.length > 0), "This immutable Community Partner programme key is already configured."],
    [
      communityProgrammeMismatch(plan, existingMission, existingActivities),
      "The interrupted Community Partner configuration does not match this immutable partner programme.",
    ],
  ];
}

function communityPartnerActivityDefinitions(
  input: AdminCommunityPartnerMissionDraftInput,
  plan: CommunityPartnerPlan,
): CommunityActivityDefinition[] {
  if (input.flow === "one_code") {
    return plan.oneCodeDefinitions.map((definition) => ({
      key: definition.key,
      outcome: definition.outcome,
      evidenceMode: "single_code",
      deploymentLabel: plan.outcomeDeploymentLabels.get(definition.outcome),
      achievement: definition.achievement.id,
      metaEligible: Boolean(definition.metaEligible),
      followUp: definition.partnerFollowUp,
      score: COMMUNITY_PARTNER_SCORE_BANDS[definition.outcome],
    }));
  }
  return [
    {
      key: plan.directKey,
      outcome: "attendance",
      evidenceMode: "two_code_start",
      deploymentLabel: plan.primaryDeploymentLabel,
      achievement: plan.directAchievement!.id,
      metaEligible: false,
      followUp: { enabled: false },
      score: { totalXp: 10, leaderboardXp: 5 },
    },
    {
      key: plan.finishKey,
      outcome: "completion",
      evidenceMode: "two_code_finish",
      deploymentLabel: plan.finishDeploymentLabel,
      achievement: undefined,
      metaEligible: false,
      followUp: { enabled: false },
      score: { totalXp: 0, leaderboardXp: 0 },
    },
    {
      key: plan.completionKey,
      outcome: "completion",
      evidenceMode: "derived_claim_set",
      deploymentLabel: undefined,
      achievement: plan.completionAchievement!.id,
      metaEligible: Boolean(input.metaEligible),
      followUp: input.partnerFollowUp,
      score: COMMUNITY_PARTNER_SCORE_BANDS.completion,
    },
  ];
}

function communityProgrammeMetadata(input: AdminCommunityPartnerMissionDraftInput, plan: CommunityPartnerPlan): Record<string, unknown> {
  return {
    community_programme: true,
    community_two_code_approved: input.flow === "two_code",
    cap_group_key: plan.missionKey,
  };
}

function communityPartnerActivityRow(
  input: AdminCommunityPartnerMissionDraftInput,
  plan: CommunityPartnerPlan,
  definition: CommunityActivityDefinition,
  missionId: string,
): Record<string, unknown> {
  return {
    key: definition.key,
    mission: missionId,
    kind: "community_partner",
    category: "community",
    outcome_key: definition.outcome,
    evidence_mode: definition.evidenceMode,
    evidence_channel: definition.evidenceMode === "derived_claim_set" ? "" : input.evidenceChannel,
    deployment_label: definition.deploymentLabel || "",
    achievement: definition.achievement || "",
    partner: plan.partnerId,
    partner_kind: "community_partner",
    community_meta_eligible: definition.metaEligible,
    per_user_claim_limit: 1,
    max_claims: input.maxClaims,
    active_from: input.activeFrom,
    active_until: input.activeUntil,
    status: "draft",
    enabled: true,
    partner_follow_up_enabled: Boolean(definition.followUp.enabled),
    partner_follow_up_notice_version: cleanText("noticeVersion" in definition.followUp ? definition.followUp.noticeVersion : undefined),
    metadata: communityProgrammeMetadata(input, plan),
  };
}

function communityRelatedGroupCeiling(
  input: AdminCommunityPartnerMissionDraftInput,
  plan: CommunityPartnerPlan,
): { total_xp_ceiling: number; leaderboard_xp_ceiling: number } {
  if (input.flow === "two_code") return { total_xp_ceiling: 40, leaderboard_xp_ceiling: 30 };
  const ceiling = plan.oneCodeDefinitions.reduce(
    (current, definition) => ({
      totalXp: Math.max(current.totalXp, COMMUNITY_PARTNER_SCORE_BANDS[definition.outcome].totalXp),
      leaderboardXp: Math.max(current.leaderboardXp, COMMUNITY_PARTNER_SCORE_BANDS[definition.outcome].leaderboardXp),
    }),
    { totalXp: 0, leaderboardXp: 0 },
  );
  return { total_xp_ceiling: ceiling.totalXp, leaderboard_xp_ceiling: ceiling.leaderboardXp };
}

function communityPartnerScorePolicy(
  input: AdminCommunityPartnerMissionDraftInput,
  plan: CommunityPartnerPlan,
  definition: CommunityActivityDefinition,
  activityId: string,
): AdminScorePolicyInput {
  return {
    scheduleId: plan.schedule.id,
    policyKey: definition.key,
    enabled: true,
    totalXp: definition.score.totalXp,
    leaderboardXp: definition.score.leaderboardXp,
    capMembership: [
      { dimension: "activity", key: activityId },
      { dimension: "related_group", key: plan.missionKey },
      { dimension: "partner", key: plan.partnerId },
      { dimension: "category", key: "community" },
      { dimension: "conference_day", key: input.scoreDay },
      { dimension: "conference", key: "conference" },
    ],
    capCeilingOverrides: { related_group: communityRelatedGroupCeiling(input, plan) },
    scoreDay: input.scoreDay,
  };
}

interface EasterEggCopy {
  eggKey: string;
  missionKey: string;
  activityKey: string;
  missionTitle: string;
  missionSummary: string;
  badgeName: string;
  badgeDescription: string;
  deploymentNote: string;
}

interface ExistingEasterEgg {
  achievement: GamificationAchievementRecord | undefined;
  mission: GamificationMissionRecord | undefined;
  activity: GamificationActivityRecord | undefined;
}

function parseEasterEggInput(input: AdminEasterEggMissionDraftInput): EasterEggCopy {
  const eggKey = cleanKey(input.eggKey);
  if (!isImmutableKey(eggKey)) {
    throw new Error("Provide an immutable lowercase easter egg key without discovery details.");
  }
  const missionKey = `easter_egg.${eggKey}`;
  const missionTitle = cleanText(input.missionTitle);
  const missionSummary = cleanText(input.missionSummary);
  const badgeName = cleanText(input.badgeName);
  const badgeDescription = cleanText(input.badgeDescription);
  assertPresentationCopy(
    [
      [missionTitle, "Easter egg Mission titles"],
      [missionSummary, "Easter egg Mission summaries"],
      [badgeName, "Easter egg Badge names"],
      [badgeDescription, "Easter egg Badge descriptions"],
    ],
    "Easter egg Mission and spoiler-safe post-unlock Badge copy are required.",
  );
  assertNoSecretText(cleanText(input.badgeIcon), "Easter egg Badge icons");
  if (!BADGE_RARITIES.includes(input.badgeRarity)) {
    throw new Error("Choose a valid Easter Egg Badge rarity.");
  }
  if (!EASTER_EGG_EVIDENCE_CHANNELS.includes(input.evidenceChannel)) {
    throw new Error("Easter egg discovery requires a WTS-controlled static QR, fragment link, or manually entered code.");
  }
  const deploymentNote = safeDiscoveryDeploymentNote(input.deploymentNote);
  if (!hasValidWindow(input.activeFrom, input.activeUntil)) {
    throw new Error("Easter egg discovery requires a valid active start and end window.");
  }
  if (!isPositiveInteger(input.maxClaims)) {
    throw new Error("Easter egg discovery requires a positive global claim limit.");
  }
  if (!Number.isInteger(input.sortOrder)) throw new Error("Easter egg Mission sort order must be a whole number.");
  return {
    eggKey,
    missionKey,
    activityKey: `${missionKey}.discovery`,
    missionTitle,
    missionSummary,
    badgeName,
    badgeDescription,
    deploymentNote,
  };
}

function easterEggAuditSummary(
  input: AdminEasterEggMissionDraftInput,
  copy: EasterEggCopy,
  schedule: GamificationScoreScheduleRecord,
): Record<string, unknown> {
  return {
    definition: "easter_egg_discovery",
    missionKey: copy.missionKey,
    activityKey: copy.activityKey,
    missionTitle: copy.missionTitle,
    missionSummary: copy.missionSummary,
    badgeName: copy.badgeName,
    badgeDescription: copy.badgeDescription,
    badgeIcon: cleanOptionalText(input.badgeIcon),
    badgeRarity: input.badgeRarity,
    evidenceChannel: input.evidenceChannel,
    deploymentNote: copy.deploymentNote,
    activeFrom: input.activeFrom,
    activeUntil: input.activeUntil,
    maxClaims: input.maxClaims,
    scoreScheduleId: schedule.id,
    sortOrder: input.sortOrder,
  };
}

function matchesCanonicalEasterEggShape(existing: ExistingEasterEgg): boolean {
  return (!existing.achievement || isHiddenEasterEggBadge(existing.achievement)) &&
    (!existing.mission || isHiddenRelationFreeEasterEggMission(existing.mission)) &&
    (!existing.activity || isEasterEggDiscoveryShape(existing.activity));
}

function codeRegistrationReceipt(
  config: CodeGenerationConfig,
  identities: CodeIdentity[],
  records: GamificationCodeRecord[],
): AdminCodeRegistrationResult {
  const ordered = identities.map((identity) => records.find((record) =>
    record.lookup_prefix === identity.lookupPrefix && record.code_hash === identity.codeHash && record.activity === config.activityId
  ));
  if (records.length !== identities.length || ordered.some((record) => !record)) {
    throw new Error("The prior registration is incomplete. Contact an administrator.");
  }
  return {
    batch: { id: config.operationId, label: config.label, activityId: config.activityId, quantity: identities.length, committed: true, secretsAvailable: false },
    codes: ordered.map((record) => ({ id: record!.id, label: config.label, lookupPrefix: record!.lookup_prefix })),
  };
}

function codeRegistrationRows(
  config: CodeGenerationConfig,
  identities: CodeIdentity[],
  actor: AdminOperationActor,
): Record<string, unknown>[] {
  return identities.map((identity) => ({
    key: `code-${randomUUID()}`,
    batch_id: config.operationId,
    label: config.label,
    activity: config.activityId,
    lookup_prefix: identity.lookupPrefix,
    code_hash: identity.codeHash,
    hash_version: MISSION_CODE_HASH_VERSION,
    evidence_role: config.evidenceRole,
    status: "active",
    enabled: true,
    starts_at: config.startsAt,
    ends_at: config.endsAt,
    max_redemptions: config.maxRedemptions,
    per_user_limit: config.perUserLimit,
    total_redemptions_cached: 0,
    created_by: actor.id,
    reissued_from: "",
  }));
}

interface CodeProgrammeReadinessCopy {
  mission: string;
  activities: string;
  badges: string;
}

const CONFIGURED_EVENT_CODE_READINESS: CodeProgrammeReadinessCopy = {
  mission: "Activate the configured event Mission before generating its codes.",
  activities: "Activate every Activity in the configured event flow before generating its codes.",
  badges: "Activate every linked configured event Badge before generating its codes.",
};

const COMMUNITY_PARTNER_CODE_READINESS: CodeProgrammeReadinessCopy = {
  mission: "Activate the Community Partner Mission before generating its codes.",
  activities: "Activate every Activity in the Community Partner programme before generating its codes.",
  badges: "Activate every linked Community Partner Badge before generating its codes.",
};

/** A multi-Activity programme issues codes only once its Mission, every Activity, and every linked Badge are live. */
function assertProgrammeReadyForCodes(
  activity: GamificationActivityRecord,
  context: GamificationContext,
  belongsToProgramme: (candidate: GamificationActivityRecord) => boolean,
  copy: CodeProgrammeReadinessCopy,
): void {
  const mission = missionFor(activity, context);
  if (!mission || mission.status !== "active") throw new Error(copy.mission);
  const programmeActivities = context.activities.filter((candidate) =>
    candidate.mission === activity.mission && belongsToProgramme(candidate) && candidate.status !== "retired",
  );
  if (programmeActivities.some((candidate) => candidate.status !== "active" || !candidate.enabled)) {
    throw new Error(copy.activities);
  }
  const linkedAchievements = programmeActivities
    .flatMap((candidate) => candidate.achievement ? [context.achievements.find((achievement) => achievement.id === candidate.achievement)] : [])
    .filter((achievement): achievement is GamificationAchievementRecord => Boolean(achievement));
  if (linkedAchievements.some((achievement) => achievement.status !== "active")) {
    throw new Error(copy.badges);
  }
}

function hasEffectiveScorePolicy(activity: GamificationActivityRecord, startsAt: string, context: GamificationContext): boolean {
  return context.policies.some((policy) =>
    policy.activity === activity.id &&
    policy.active &&
    context.schedules.some((schedule) =>
      schedule.id === policy.schedule &&
      schedule.status === "active" &&
      Date.parse(schedule.effective_at) <= Date.parse(startsAt)
    )
  );
}

interface ReissuableCode {
  original: GamificationCodeRecord;
  label: string;
  activity: GamificationActivityRecord;
  priorReplacement: GamificationCodeRecord | undefined;
}

function requireReissuableCode(input: AdminCodeReissueInput, context: GamificationContext): ReissuableCode {
  const original = context.codes.find((candidate) => candidate.id === input.codeId);
  if (!original) throw new Error("Code was not found.");
  const label = hasValue(input.label) ? safeOperationalLabel(input.label) : safeOperationalLabel(original.label);
  if (!original.invalidated_at || original.status !== "disabled") {
    throw new Error("Invalidate the original code before issuing a replacement.");
  }
  const activity = context.activities.find((candidate) => candidate.id === original.activity);
  if (!activity || activity.status !== "active" || !activity.enabled) throw new Error("The original code's Activity is not active.");
  const priorReplacement = context.codes.find((code) => code.batch_id === input.operationId && code.reissued_from === original.id);
  if (!priorReplacement && context.codes.some((code) => code.reissued_from === original.id && code.status === "active" && code.enabled)) {
    throw new Error("This invalidated code already has an active replacement. Invalidate that replacement before reissuing it.");
  }
  return { original, label, activity, priorReplacement };
}

function replacementCodeRow(
  input: AdminCodeReissueInput,
  code: ReissuableCode,
  definition: ReturnType<typeof createMissionCodeGeneration>["definition"],
  actor: AdminOperationActor,
): Record<string, unknown> {
  const { original, activity } = code;
  return {
    key: `code-${randomUUID()}`,
    batch_id: input.operationId,
    label: code.label,
    activity: activity.id,
    lookup_prefix: definition.lookupPrefix,
    code_hash: definition.codeHash,
    hash_version: definition.hashVersion,
    evidence_role: original.evidence_role,
    status: "active",
    enabled: true,
    starts_at: original.starts_at || activity.active_from || "",
    ends_at: original.ends_at || activity.active_until || "",
    max_redemptions: original.max_redemptions,
    // The Activity-wide limit blocks a second award through any replacement code.
    per_user_limit: activity.per_user_claim_limit,
    total_redemptions_cached: 0,
    created_by: actor.id,
    reissued_from: original.id,
  };
}

type UnlockRuleRecord = GamificationAchievementRecord["unlock_rule"];

function metaRuleErrors(rule: UnlockRuleRecord, sourceKeys: string[], selectedSources: GamificationActivityRecord[]): string[] {
  const breadth = metaRuleSourceBreadth(rule);
  return failedChecks([
    [sourceKeys.length === 0, "Meta Achievements require selected qualifying source Activities."],
    [!breadth || breadth < 2, "Meta Achievements require at least two qualifying source entities."],
    [rule.kind === "claim_set" && sourceKeys.length !== breadth, "Meta claim sets must name each exact qualifying Activity once."],
    [
      rule.kind === "claim_count" && (!isPositiveInteger(rule.count) || rule.count! > sourceKeys.length),
      "Meta claim counts require a positive count within the selected source Activities.",
    ],
    [selectedSources.length !== sourceKeys.length, "Every Meta source Activity must be configured exactly once."],
  ]);
}

function requiredMetaDiversity(sources: GamificationActivityRecord[]): GamificationMetaSourceDiversity | undefined {
  if (sources.length < 2) return undefined;
  return META_DIVERSITY_SOURCE_KINDS.find(([, kind]) => sources.every((activity) => activity.kind === kind))?.[0];
}

function metaDiversityErrors(rule: UnlockRuleRecord, sources: GamificationActivityRecord[]): string[] {
  const diversity = metaRuleDiversity(rule);
  const requiredDiversity = requiredMetaDiversity(sources);
  const errors = requiredDiversity && diversity !== requiredDiversity
    ? [`Cross-${requiredDiversity} Meta Achievements require explicit ${requiredDiversity} source diversity.`]
    : [];
  if (!diversity) return errors;
  const entityKeys = sources.map((activity) => metaSourceEntityKey(activity, diversity));
  if (entityKeys.some((key) => !key)) {
    errors.push(`Meta ${diversity} diversity sources require the matching configured source reference.`);
  } else if (new Set(entityKeys).size !== entityKeys.length) {
    errors.push(`Meta ${diversity} diversity cannot count multiple Activities from one source entity.`);
  }
  return errors;
}

function isCanonicalMetaActivity(activity: GamificationActivityRecord): boolean {
  return activity.category === "meta" &&
    activity.outcome_key === "meta" &&
    activity.evidence_mode === "meta_rule" &&
    !activity.mission &&
    activity.per_user_claim_limit === 1 &&
    activity.status === "active" &&
    Boolean(activity.enabled);
}

function metaPolicyBandErrors(expectedBand: ScoreBand | undefined, policies: GamificationScoreSchedulePolicyRecord[]): string[] {
  if (!expectedBand || policies.length === 0) return ["Meta Achievements require an active fixed-band score policy."];
  return policies.some((policy) => !matchesScoreBand(recordScoreBand(policy), expectedBand))
    ? [`Meta source breadth requires the ${expectedBand.totalXp}/${expectedBand.leaderboardXp} total/Leaderboard XP band.`]
    : [];
}

function metaLinkedActivityErrors(
  achievement: GamificationAchievementRecord,
  rule: UnlockRuleRecord,
  context: GamificationContext,
): string[] {
  const linkedActivities = context.activities.filter((activity) => activity.achievement === achievement.id);
  const metaActivities = linkedActivities.filter((activity) => activity.kind === "meta");
  if (linkedActivities.length !== 1 || metaActivities.length !== 1) {
    return ["Meta Achievements require exactly one linked Meta Activity and no direct source Activity."];
  }
  const metaActivity = metaActivities[0];
  return [
    ...failedChecks([
      [metaActivity.key !== `meta.${achievement.key}`, "Meta Activity key must be the canonical meta.{achievementKey} value."],
      [!isCanonicalMetaActivity(metaActivity), "The linked Meta Activity must be active, missionless, one-per-User, meta-rule evidence."],
    ]),
    ...metaPolicyBandErrors(metaScoreBandForRule(rule), activePoliciesFor(metaActivity.id, context)),
  ];
}

interface ConfiguredEventFlow extends TwoCodeFlow {
  activities: GamificationActivityRecord[];
  oneCode: boolean;
}

function configuredEventFlow(activity: GamificationActivityRecord, context: GamificationContext): ConfiguredEventFlow {
  const activities = context.activities.filter((candidate) =>
    candidate.mission === activity.mission &&
    candidate.status !== "retired" &&
    isConfiguredEventActivityKind(candidate.kind),
  );
  return {
    ...twoCodeFlow(activities),
    activities,
    oneCode: activities.length === 1 && activities[0].evidence_mode === "single_code",
  };
}

function matchesConfiguredEventIdentity(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  eventRef: ConfiguredEventReference,
): boolean {
  const expectedCategory = configuredEventCategory(eventRef.kind);
  return activity.kind === configuredEventActivityKind(eventRef.kind) &&
    activity.category === expectedCategory &&
    mission !== undefined &&
    mission.key === configuredEventMissionKey(eventRef.kind, eventRef.eventKey) &&
    mission.category === expectedCategory &&
    sameConfiguredEventReference(mission.event_ref, eventRef);
}

function matchesConfiguredEventWindow(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  eventRef: ConfiguredEventReference,
): boolean {
  return activity.active_from === eventRef.startsAt &&
    activity.active_until === eventRef.endsAt &&
    mission?.starts_at === eventRef.startsAt &&
    mission?.ends_at === eventRef.endsAt &&
    mission?.visibility === eventRef.visibility;
}

function configuredEventReferenceErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  eventRef: ConfiguredEventReference,
): string[] {
  const identityErrors = failedChecks([
    [!matchesConfiguredEventIdentity(activity, mission, eventRef), "Configured event Mission and Activity references, kinds, and categories must match."],
    [
      !matchesConfiguredEventWindow(activity, mission, eventRef),
      "Configured event operating windows and visibility must match the immutable event reference.",
    ],
  ]);
  const capGroupKey = cleanKey(activity.metadata?.cap_group_key);
  return [
    ...identityErrors,
    ...failedChecks([
      [
        !capGroupKey || capGroupKey !== cleanKey(mission?.metadata?.cap_group_key),
        "Configured event Mission and Activities require one matching immutable cap group key.",
      ],
      [typeof activity.event_meta_eligible !== "boolean", "Configured event Activities must explicitly register Meta eligibility."],
    ]),
  ];
}

function configuredEventHostErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  context: GamificationContext,
): string[] {
  if (activity.partner || mission?.partner) {
    const validHost = Boolean(activity.partner) &&
      activity.partner === mission?.partner &&
      activity.partner_kind === "workshop_host" &&
      context.partners.some((partner) => partner.id === activity.partner);
    return validHost ? [] : ["Optional event host attribution must use the same existing host partner on the Mission and Activities."];
  }
  return activity.partner_kind ? ["WTS-run events must not have a partner kind without a host relation."] : [];
}

function expectedConfiguredEventKey(activity: GamificationActivityRecord, eventRef: ConfiguredEventReference): string {
  const keySuffix = CONFIGURED_EVENT_KEY_SUFFIXES.get(activity.evidence_mode);
  return keySuffix ? `${configuredEventMissionKey(eventRef.kind, eventRef.eventKey)}.${keySuffix}` : "";
}

/** Workshops are two-code by design; other configured events need recorded organizer approval. */
function hasApprovedEventTwoCode(mission: GamificationMissionRecord | undefined, eventRef: ConfiguredEventReference): boolean {
  return eventRef.kind === "workshop" || mission?.metadata?.related_event_two_code_approved === true;
}

function configuredEventFlowErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  eventRef: ConfiguredEventReference,
  flow: ConfiguredEventFlow,
): string[] {
  const expectedKey = expectedConfiguredEventKey(activity, eventRef);
  return [
    ...failedChecks([
      [
        !flow.oneCode && !flow.twoCode,
        "Configured events require either one attendance Activity or one start, finish, and derived completion Activity.",
      ],
      [
        flow.twoCode && !hasApprovedEventTwoCode(mission, eventRef),
        "Two-code completion outside workshops requires recorded explicit organizer approval.",
      ],
      [!expectedKey || activity.key !== expectedKey, "Configured event Activity key does not match its immutable event outcome."],
    ]),
    ...redeemableArtifactErrors(activity, {
      code: "Configured event code Activities require a WTS-controlled evidence channel and deployment artifact.",
      derived: "Derived event completion must not have a redeemable artifact.",
    }),
    ...failedChecks([
      [
        flow.oneCode && activity.event_meta_eligible !== true && flow.activities.some((candidate) => candidate.event_meta_eligible),
        "One-code events may register only their attendance Activity for Meta.",
      ],
      [
        flow.twoCode && !isCompletionOnlyMeta(flow, "event_meta_eligible"),
        "Two-code events may register only their derived completion Activity for Meta.",
      ],
    ]),
  ];
}

function configuredEventBadgeErrors(flow: ConfiguredEventFlow, context: GamificationContext): string[] {
  const completionAchievement = findAchievement(context, flow.completion?.achievement);
  const directActivity = flow.oneCode ? flow.activities[0] : flow.start;
  return failedChecks([
    [
      flow.twoCode && !isExactClaimSetBadge(completionAchievement, [flow.start?.key, flow.finish?.key]),
      "Derived event completion requires the exact start-and-finish Achievement claim set.",
    ],
    [
      directActivity?.achievement &&
        !isDirectClaimBadge(findAchievement(context, directActivity.achievement), directActivity.key),
      "Configured event attendance Badges require the direct attendance/start Activity-claim rule.",
    ],
  ]);
}

interface CommunityProgrammeFlow extends TwoCodeFlow {
  activities: GamificationActivityRecord[];
  oneCode: boolean;
}

function isCommunityOneCodeProgramme(activities: GamificationActivityRecord[]): boolean {
  return activities.length >= 1 && activities.length <= 3 &&
    activities.every((candidate) => candidate.evidence_mode === "single_code") &&
    activities.every((candidate) => isCommunityPartnerOutcome(candidate.outcome_key)) &&
    uniqueKeys(activities.map((candidate) => candidate.outcome_key));
}

function communityProgrammeFlow(mission: GamificationMissionRecord, context: GamificationContext): CommunityProgrammeFlow {
  const activities = context.activities.filter((candidate) =>
    candidate.mission === mission.id && candidate.kind === "community_partner" && candidate.status !== "retired",
  );
  return { ...twoCodeFlow(activities), activities, oneCode: isCommunityOneCodeProgramme(activities) };
}

function isCanonicalCommunityActivity(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  context: GamificationContext,
): mission is GamificationMissionRecord {
  const partnerKey = cleanKey(mission?.partner_key);
  return activity.category === "community" &&
    activity.partner_kind === "community_partner" &&
    Boolean(activity.partner) &&
    context.partners.some((partner) => partner.id === activity.partner) &&
    mission !== undefined &&
    mission.category === "community" &&
    mission.partner === activity.partner &&
    Boolean(partnerKey) &&
    mission.key.startsWith(`community.${partnerKey}.`);
}

function expectedCommunityActivityKey(activity: GamificationActivityRecord, missionKey: string, oneCode: boolean): string {
  if (oneCode && isCommunityPartnerOutcome(activity.outcome_key)) return communityPartnerActivityKey(missionKey, activity.outcome_key);
  const keySuffix = TWO_CODE_KEY_SUFFIXES.get(activity.evidence_mode);
  return keySuffix ? communityPartnerActivityKey(missionKey, keySuffix) : "";
}

function communityProgrammeShapeErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord,
  flow: CommunityProgrammeFlow,
): string[] {
  const expectedKey = expectedCommunityActivityKey(activity, mission.key, flow.oneCode);
  return [
    ...failedChecks([
      [mission.visibility !== "public" && mission.suggested, "Only explicitly public Community Partner Missions may be suggested."],
      [typeof activity.community_meta_eligible !== "boolean", "Community Partner Activities must explicitly register Meta eligibility."],
      [
        !flow.oneCode && !flow.twoCode,
        "Community Partner programmes require one selected outcome or one approved start, finish, and derived completion flow.",
      ],
      [
        flow.twoCode && mission.metadata?.community_two_code_approved !== true,
        "Community Partner two-code completion requires recorded explicit organizer approval.",
      ],
      [
        flow.oneCode && !isCommunityPartnerOutcome(activity.outcome_key),
        "Community Partner one-code Activities support attendance, participation, or completion only.",
      ],
      [!expectedKey || activity.key !== expectedKey, "Community Partner Activity key does not match its immutable programme outcome."],
    ]),
    ...redeemableArtifactErrors(activity, {
      code: "Community Partner code Activities require a WTS-controlled evidence channel and deployment artifact.",
      derived: "Derived Community Partner completion must not have a redeemable artifact.",
    }),
  ];
}

function communityProgrammeMetaErrors(flow: CommunityProgrammeFlow): string[] {
  const metaActivities = flow.activities.filter((candidate) => candidate.community_meta_eligible === true);
  return failedChecks([
    [
      metaActivities.length > 1 || (flow.twoCode && metaActivities.some((candidate) => candidate.id !== flow.completion?.id)),
      "At most one designated qualifying Activity per Community Partner programme may register with Meta rules.",
    ],
    [
      flow.twoCode && !isCompletionOnlyMeta(flow, "community_meta_eligible"),
      "Community Partner two-code programmes may register only derived completion with Meta rules.",
    ],
  ]);
}

function communityProgrammeBadgeErrors(flow: CommunityProgrammeFlow, context: GamificationContext): string[] {
  const completionAchievement = findAchievement(context, flow.completion?.achievement);
  const errors = failedChecks([[
    flow.twoCode && !isExactClaimSetBadge(completionAchievement, [flow.start?.key, flow.finish?.key], "community"),
    "Derived Community Partner completion requires the exact start-and-finish Community Badge claim set.",
  ]]);
  const directActivities = flow.oneCode ? flow.activities : flow.start ? [flow.start] : [];
  for (const directActivity of directActivities) {
    if (!isDirectClaimBadge(findAchievement(context, directActivity.achievement), directActivity.key, "community")) {
      errors.push("Community Partner direct Activities require distinct Community Activity-claim Badges.");
    }
  }
  return errors;
}

function communityProgrammeFollowUpErrors(flow: CommunityProgrammeFlow): string[] {
  const followUpActivities = flow.activities.filter((candidate) => candidate.partner_follow_up_enabled);
  const misplaced = !flow.oneCode && followUpActivities.some((candidate) => candidate.id !== flow.completion?.id);
  return misplaced || followUpActivities.some((candidate) => !cleanText(candidate.partner_follow_up_notice_version))
    ? ["Community Partner follow-up may be configured only on the programme's qualifying outcome with a notice version."]
    : [];
}

function communityProgrammeCeilingErrors(flow: CommunityProgrammeFlow, context: GamificationContext): string[] {
  if (!flow.oneCode) return [];
  const ceiling = flow.activities.reduce((current, candidate) => {
    const band = communityOutcomeBand(candidate.outcome_key);
    return band && band.totalXp > current.totalXp ? band : current;
  }, { totalXp: 0, leaderboardXp: 0 });
  const programmePolicies = context.policies.filter((policy) =>
    flow.activities.some((candidate) => candidate.id === policy.activity) && policy.active
  );
  return programmePolicies.some((policy) =>
    policy.cap_ceiling_overrides?.related_group?.total_xp_ceiling !== ceiling.totalXp ||
    policy.cap_ceiling_overrides?.related_group?.leaderboard_xp_ceiling !== ceiling.leaderboardXp
  )
    ? ["Every Community Partner programme policy must share its highest active outcome ceiling."]
    : [];
}

function isCanonicalEasterEggDiscoveryMission(
  mission: GamificationMissionRecord | undefined,
  expectedMissionKey: string,
  activity: GamificationActivityRecord,
): boolean {
  return mission !== undefined &&
    mission.key === expectedMissionKey &&
    isHiddenRelationFreeEasterEggMission(mission) &&
    mission.primary_achievement === activity.achievement &&
    !cleanText(mission.partner_key);
}

function hasSingleDiscoveryActivity(
  mission: GamificationMissionRecord | undefined,
  activity: GamificationActivityRecord,
  context: GamificationContext,
): boolean {
  const missionActivities = mission ? context.activities.filter((candidate) =>
    candidate.mission === mission.id && candidate.status !== "retired"
  ) : [];
  return missionActivities.length === 1 && missionActivities[0]?.id === activity.id;
}

function isCanonicalEasterEggDiscoveryBadge(achievement: GamificationAchievementRecord | undefined, expectedMissionKey: string): boolean {
  return achievement !== undefined &&
    achievement.key === expectedMissionKey &&
    isHiddenEasterEggBadge(achievement) &&
    !cleanText(achievement.locked_teaser);
}

function sharesEasterEggWindow(
  mission: GamificationMissionRecord,
  activity: GamificationActivityRecord,
  achievement: GamificationAchievementRecord | undefined,
): boolean {
  return mission.starts_at === activity.active_from &&
    mission.ends_at === activity.active_until &&
    (!achievement || (achievement.active_from === activity.active_from && achievement.active_until === activity.active_until));
}

function easterEggDiscoveryErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  context: GamificationContext,
): string[] {
  const match = EASTER_EGG_DISCOVERY_KEY.exec(activity.key);
  const expectedMissionKey = match ? `easter_egg.${match[1]}` : "";
  const achievement = findAchievement(context, activity.achievement);
  return failedChecks([
    [
      !isEasterEggDiscoveryShape(activity) || !match,
      "Easter egg Activities require the canonical easter_egg.{eggKey}.discovery static-discovery shape.",
    ],
    [
      !isCanonicalEasterEggDiscoveryMission(mission, expectedMissionKey, activity),
      "Easter egg discovery requires one hidden, unsuggested, relation-free canonical Mission.",
    ],
    [!hasSingleDiscoveryActivity(mission, activity, context), "Each Easter Egg Mission requires exactly one non-retired discovery Activity."],
    [
      !isCanonicalEasterEggDiscoveryBadge(achievement, expectedMissionKey),
      "Easter egg discovery requires its hidden-until-unlocked direct Activity-claim Badge without locked teaser copy.",
    ],
    [
      !EASTER_EGG_EVIDENCE_CHANNELS.includes(activity.evidence_channel || "") || !cleanText(activity.deployment_label),
      "Easter egg discovery requires a WTS-controlled static QR, fragment link, or manual-code surface and private deployment note.",
    ],
    [
      activity.partner || activity.partner_kind || activity.session || safeEventRef(activity.event_ref),
      "Easter egg discovery must not carry partner, staff, Session, or event privileges or relations.",
    ],
    [
      mission && !sharesEasterEggWindow(mission, activity, achievement),
      "Easter egg Mission, discovery Activity, and Badge must share one active window.",
    ],
  ]);
}

function inactiveDependencyErrors(activityKeys: string[], context: GamificationContext): string[] {
  return activityKeys
    .filter((activityKey) => {
      const activity = context.activities.find((candidate) => candidate.id === activityKey || candidate.key === activityKey);
      return !activity || activity.status !== "active" || !activity.enabled;
    })
    .map((activityKey) => `Achievement dependency ${activityKey} is not active.`);
}

function easterEggBadgeActivationErrors(
  achievement: GamificationAchievementRecord,
  rule: AdminUnlockRuleInput,
  context: GamificationContext,
): string[] {
  const mission = context.missions.find((candidate) => candidate.primary_achievement === achievement.id && candidate.status !== "retired");
  const activity = context.activities.find((candidate) => candidate.achievement === achievement.id && candidate.status !== "retired");
  const canonical = EASTER_EGG_KEY.test(achievement.key) &&
    achievement.visibility === "hidden_until_unlocked" &&
    !cleanText(achievement.locked_teaser) &&
    rule.kind === "activity_claim" &&
    mission !== undefined &&
    activity !== undefined &&
    mission.key === achievement.key &&
    activity.key === `${achievement.key}.discovery`;
  return canonical
    ? []
    : ["Easter egg Badges require one matching hidden Mission and direct static-discovery Activity with spoiler-safe post-unlock copy."];
}

function claimRuleActivationErrors(rule: AdminUnlockRuleInput, activityKeys: string[]): string[] {
  return failedChecks([
    [rule.kind === "claim_set" && activityKeys.length < 2, "Claim-set Achievements require at least two Activities."],
    [
      rule.kind === "claim_count" && (!isPositiveInteger(rule.count) || (!rule.category && activityKeys.length === 0)),
      "Claim-count Achievements require a positive count and qualifying Activities or category.",
    ],
  ]);
}

function missionPresentationErrors(mission: GamificationMissionRecord): string[] {
  const errors = failedChecks([
    [!cleanText(mission.title) || !cleanText(mission.summary), "Mission title and summary are required."],
  ]);
  hasRequiredWindow(mission.starts_at, mission.ends_at, "Mission", errors);
  return errors;
}

function missionPrimaryAchievementErrors(mission: GamificationMissionRecord, context: GamificationContext): string[] {
  if (!mission.primary_achievement) return [];
  const achievement = context.achievements.find((candidate) => candidate.id === mission.primary_achievement);
  return failedChecks([
    [!achievement || achievement.status !== "active", "Mission primary Achievement must be active."],
    [achievement && achievement.category !== mission.category, "Mission and primary Achievement categories must match."],
  ]);
}

function matchesConfiguredEventMission(mission: GamificationMissionRecord, eventRef: ConfiguredEventReference): boolean {
  return mission.key === configuredEventMissionKey(eventRef.kind, eventRef.eventKey) &&
    mission.category === configuredEventCategory(eventRef.kind) &&
    mission.starts_at === eventRef.startsAt &&
    mission.ends_at === eventRef.endsAt &&
    mission.visibility === eventRef.visibility;
}

function configuredEventMissionErrors(mission: GamificationMissionRecord): string[] {
  const eventRef = configuredEventReference(mission.event_ref);
  if (!eventRef) return [];
  return failedChecks([
    [!matchesConfiguredEventMission(mission, eventRef), "Configured event Mission must match its immutable reference, window, and visibility."],
    [mission.visibility !== "public" && mission.suggested, "Internal or unannounced event Missions cannot be public suggestions."],
  ]);
}

function isCanonicalCommunityMission(mission: GamificationMissionRecord, context: GamificationContext): boolean {
  return mission.category === "community" &&
    Boolean(mission.partner) &&
    context.partners.some((partner) => partner.id === mission.partner) &&
    Boolean(cleanText(mission.partner_key)) &&
    mission.key.startsWith(`community.${mission.partner_key}.`);
}

function communityMissionErrors(mission: GamificationMissionRecord, context: GamificationContext): string[] {
  if (mission.category !== "community" && !mission.key.startsWith("community.")) return [];
  return failedChecks([
    [
      !isCanonicalCommunityMission(mission, context),
      "Community Partner Missions require an existing partner and immutable community.{partnerKey}.{activityKey} key.",
    ],
    [mission.visibility !== "public" && mission.suggested, "Only explicitly public Community Partner Missions may be suggested."],
  ]);
}

function easterEggMissionErrors(mission: GamificationMissionRecord, context: GamificationContext): string[] {
  if (mission.category !== "easter_egg" && !mission.key.startsWith("easter_egg.")) return [];
  const missionActivities = context.activities.filter((candidate) => candidate.mission === mission.id && candidate.status !== "retired");
  const canonical = EASTER_EGG_KEY.test(mission.key) &&
    isHiddenRelationFreeEasterEggMission(mission) &&
    !cleanText(mission.partner_key) &&
    missionActivities.length === 1 &&
    missionActivities[0]?.key === `${mission.key}.discovery`;
  return canonical ? [] : ["Easter egg Missions require one hidden, unsuggested, relation-free canonical discovery Activity."];
}

function missionActivationErrors(mission: GamificationMissionRecord, context: GamificationContext): string[] {
  return [
    ...missionPresentationErrors(mission),
    ...missionPrimaryAchievementErrors(mission, context),
    ...configuredEventMissionErrors(mission),
    ...communityMissionErrors(mission, context),
    ...easterEggMissionErrors(mission, context),
  ];
}

function activityEvidenceKindErrors(activity: GamificationActivityRecord): string[] {
  const hieventsEvidence = activity.evidence_mode === "hievents_ticket" || activity.evidence_mode === "hievents_checkin";
  return failedChecks([
    [
      activity.kind === "qr" && (activity.evidence_mode !== "single_code" || activity.outcome_key !== "completion"),
      "QR Activities require single-code evidence and the completion outcome.",
    ],
    [hieventsEvidence && activity.kind !== "hievents", "Only Hi.Events Activities may use Hi.Events evidence."],
    [activity.kind === "hievents" && !hieventsEvidence, "Hi.Events Activities require ticket or check-in evidence."],
    [
      expectedCodeRole(activity.evidence_mode) && ["hievents", "admin_manual", "meta"].includes(activity.kind),
      "This Activity kind cannot use redeemable code evidence.",
    ],
  ]);
}

function activityBasicsErrors(activity: GamificationActivityRecord): string[] {
  const errors = failedChecks([
    [!cleanText(activity.outcome_key), "Activity outcome is required."],
    [activity.per_user_claim_limit !== 1, "September Activities must have a per-User claim limit of one."],
    [!isPositiveInteger(Number(activity.max_claims)), "Activity global claim limit is required."],
  ]);
  hasRequiredWindow(activity.active_from, activity.active_until, "Activity", errors);
  return [...errors, ...activityEvidenceKindErrors(activity)];
}

/** Programme Activities may activate before their draft Badge; other Activities need an active Badge. */
function hasActivatableAchievementStatus(activity: GamificationActivityRecord, achievement: GamificationAchievementRecord): boolean {
  return activity.kind === "meta" || activity.kind === "community_partner" || isConfiguredEventActivityKind(activity.kind)
    ? ["draft", "active"].includes(achievement.status)
    : achievement.status === "active";
}

function activityAchievementErrors(activity: GamificationActivityRecord, context: GamificationContext): string[] {
  if (!activity.achievement) return [];
  const achievement = context.achievements.find((candidate) => candidate.id === activity.achievement);
  return failedChecks([
    [!achievement || !hasActivatableAchievementStatus(activity, achievement), "Related Achievement must be active."],
    [achievement && achievement.category !== activity.category, "Activity and Achievement categories must match."],
  ]);
}

function activityRelationErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  context: GamificationContext,
): string[] {
  return [
    ...failedChecks([
      [activity.evidence_mode.includes("code") && (!mission || mission.status !== "active"), "Code Activities require an active Mission."],
      [mission && mission.status !== "active", "Related Mission must be active."],
      [mission && mission.category !== activity.category, "Activity and Mission categories must match."],
    ]),
    ...activityAchievementErrors(activity, context),
  ];
}

function isSessionAttendanceShape(activity: GamificationActivityRecord): boolean {
  return activity.category === "session" &&
    activity.outcome_key === "attendance" &&
    activity.evidence_mode === "single_code" &&
    isEvidenceChannel(activity.evidence_channel) &&
    Boolean(cleanText(activity.deployment_label));
}

function usesSessionAttendanceKeys(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  sessionKey: string | undefined,
): boolean {
  const expectedMissionKey = sessionKey ? `session.${sessionKey}` : "";
  const expectedActivityKey = expectedMissionKey ? `${expectedMissionKey}.attendance` : "";
  return mission !== undefined &&
    mission.session === activity.session &&
    mission.key === expectedMissionKey &&
    activity.key === expectedActivityKey;
}

function sessionPolicyErrors(activity: GamificationActivityRecord, context: GamificationContext): string[] {
  const policies = activePoliciesFor(activity.id, context);
  const errors = policies.length === 0 ? ["Session Activities require an active direct score policy."] : [];
  for (const policy of policies) {
    errors.push(...failedChecks([
      [policy.total_xp !== 20 || policy.leaderboard_xp !== 15, "Session direct score policies must use the fixed 20/15 total/Leaderboard XP band."],
      [
        !hasCapMemberships(policy.cap_membership, [
          ["activity", activity.id],
          ["category", "session"],
          ...dayAndConferenceCaps(policy.score_day),
        ]) || !isISODate(policy.score_day),
        "Session direct score policies require Activity, session category, day, and conference caps.",
      ],
    ]));
  }
  return errors;
}

function sessionActivityErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  context: GamificationContext,
): string[] {
  const session = context.sessions.find((candidate) => candidate.id === activity.session);
  const sessionKey = cleanOptionalText(activity.session_key);
  const directAchievement = findAchievement(context, activity.achievement);
  return [
    ...failedChecks([
      [!session?.published, "Session Activities require a published Session reference."],
      [!sessionKey || !isImmutableKey(sessionKey), "Session Activities require an immutable Session key."],
      [!safeSessionDisplaySnapshot(activity.session_display_snapshot), "Session Activities require a safe Session display snapshot."],
      [typeof activity.session_meta_eligible !== "boolean", "Session Activities must explicitly configure Meta eligibility."],
      [
        !isSessionAttendanceShape(activity),
        "Session Activities require Session attendance, WTS-controlled single-code evidence, and a deployment artifact.",
      ],
      [
        !usesSessionAttendanceKeys(activity, mission, sessionKey),
        "Session Mission and Activity keys must use the immutable session.{sessionKey}.attendance form.",
      ],
      [
        context.activities.some((candidate) =>
          candidate.id !== activity.id &&
          candidate.kind === "session" &&
          candidate.session === activity.session &&
          candidate.status !== "retired",
        ),
        "Only one non-retired Session attendance Activity may be configured for a Session.",
      ],
      [
        directAchievement && !isDirectClaimBadge(directAchievement, activity.key),
        "A direct Session Badge must use this Activity's direct Activity-claim rule.",
      ],
    ]),
    ...sessionPolicyErrors(activity, context),
  ];
}

function partnerReferenceErrors(activity: GamificationActivityRecord, context: GamificationContext): string[] {
  if (!["booth", "community_partner"].includes(activity.kind)) return [];
  return failedChecks([[
    !activity.partner || !context.partners.some((partner) => partner.id === activity.partner) || !activity.partner_kind,
    "Partner Activities require an existing partner and partner kind.",
  ]]);
}

function boothMissionErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  partner: PartnerRecord,
  outcome: BoothOutcome,
  context: GamificationContext,
): string[] {
  const expectedKey = mission ? boothActivityKey(mission.key, outcome) : "";
  return failedChecks([
    [!isCanonicalBoothMission(mission), "Booth Mission key must use the immutable booth.{partnerKey}.{activityKey} form."],
    [activity.key !== expectedKey, `Booth Activity key must be the immutable ${expectedKey} value.`],
    [!mission || mission.partner !== partner.id, "Booth Mission must reference the same sponsor partner."],
    [
      mission && context.missions.some((candidate) =>
        candidate.id !== mission.id &&
        candidate.partner === partner.id &&
        cleanText(candidate.partner_key) &&
        candidate.partner_key !== mission.partner_key,
      ),
      "Booth Missions for one sponsor must use the same immutable sponsor key.",
    ],
  ]);
}

function boothPolicyErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  outcome: BoothOutcome | undefined,
  policy: GamificationScoreSchedulePolicyRecord,
): string[] {
  const expected = outcome ? BOOTH_SCORE_BANDS[outcome] : undefined;
  return failedChecks([
    [!matchesScoreBand(recordScoreBand(policy), expected), "Booth direct score policy does not match its fixed outcome band."],
    [
      !activity.partner || !hasCapMemberships(policy.cap_membership, [
        ["activity", activity.id],
        ["related_group", mission ? boothCapGroupKey(mission.key) : ""],
        ["partner", activity.partner],
        ["category", "booth"],
        ...dayAndConferenceCaps(policy.score_day),
      ]),
      "Booth direct score policy must include Activity, booth-group, sponsor partner, category, day, and conference caps.",
    ],
    [!isISODate(policy.score_day), "Booth direct score policy requires a conference day for derived category/day/conference caps."],
    [exceedsBoothCap(policy.cap_ceiling_overrides), "Booth cap ceilings cannot exceed 35 total XP or 25 Leaderboard XP."],
  ]);
}

function boothPoliciesErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  outcome: BoothOutcome | undefined,
  context: GamificationContext,
): string[] {
  const policies = activePoliciesFor(activity.id, context);
  const errors = policies.length === 0 ? ["Booth Activities require an active direct score policy."] : [];
  for (const policy of policies) errors.push(...boothPolicyErrors(activity, mission, outcome, policy));
  return errors;
}

function boothActivityErrors(
  activity: GamificationActivityRecord,
  mission: GamificationMissionRecord | undefined,
  context: GamificationContext,
): string[] {
  const partner = context.partners.find((candidate) => candidate.id === activity.partner);
  const outcome = isBoothOutcome(activity.outcome_key) ? activity.outcome_key : undefined;
  return [
    ...failedChecks([
      [
        activity.category !== "booth" || !outcome,
        "Booth Activities support only the booth category and visit, participation, completion, win, or high_score outcomes.",
      ],
      [
        !partner || partner.type !== "sponsor" || activity.partner_kind !== "sponsor",
        "Booth Activities require an existing sponsor partner with partner kind sponsor.",
      ],
      [
        activity.evidence_mode !== "single_code" || !isEvidenceChannel(activity.evidence_channel),
        "Booth Activities require a WTS-controlled single-code evidence channel.",
      ],
      [!cleanText(activity.deployment_label), "Booth Activities require a WTS artifact deployment label before activation."],
    ]),
    ...(partner && outcome ? boothMissionErrors(activity, mission, partner, outcome, context) : []),
    ...failedChecks([
      [
        context.activities.some((candidate) =>
          candidate.id !== activity.id &&
          candidate.kind === "booth" &&
          candidate.mission === activity.mission &&
          candidate.outcome_key === activity.outcome_key &&
          candidate.status !== "retired",
        ),
        "Only one non-retired Booth Activity may be configured for each sponsor outcome.",
      ],
      [
        !isDirectClaimBadge(findAchievement(context, activity.achievement), activity.key),
        "Booth Activities require an active direct Activity-claim Achievement rule.",
      ],
      [
        activity.partner_follow_up_enabled && !cleanText(activity.partner_follow_up_notice_version),
        "Enabled partner follow-up requires a notice version.",
      ],
    ]),
    ...boothPoliciesErrors(activity, mission, outcome, context),
  ];
}

function hieventsSourceErrors(activity: GamificationActivityRecord): string[] {
  const eventRef = safeEventRef(activity.event_ref);
  return !eventRef?.eventKey && !eventRef?.eventId ? ["This Activity requires an event source reference."] : [];
}

function metaActivityActivationErrors(activity: GamificationActivityRecord, context: GamificationContext): string[] {
  const evidenceErrors = failedChecks([
    [activity.kind === "meta" && activity.evidence_mode !== "meta_rule", "Meta Activities require meta-rule evidence."],
    [activity.kind !== "meta" && activity.evidence_mode === "meta_rule", "Only Meta Activities may use meta-rule evidence."],
  ]);
  if (activity.kind !== "meta") return evidenceErrors;
  const achievement = context.achievements.find((candidate) => candidate.id === activity.achievement);
  return [
    ...evidenceErrors,
    ...failedChecks([
      [activity.category !== "meta" || activity.outcome_key !== "meta", "Meta Activities require the meta category and outcome."],
      [activity.mission, "Meta Activities cannot belong to a redeemable Mission."],
      [!achievement || achievement.category !== "meta", "Meta Activities require a linked Meta Achievement."],
      [
        achievement && achievement.unlock_rule.kind !== "claim_set" && achievement.unlock_rule.kind !== "claim_count",
        "Meta Activities require a claim-set or selected-source claim-count Achievement rule.",
      ],
    ]),
  ];
}

function scheduledMetaPolicyErrors(
  policy: SeptemberScorePolicy,
  activity: GamificationActivityRecord,
  context: GamificationContext,
): string[] {
  const achievement = context.achievements.find((candidate) => candidate.id === activity.achievement);
  const expectedBand = achievement ? metaScoreBandForRule(achievement.unlock_rule) : undefined;
  return failedChecks([
    [!matchesScoreBand(policy, expectedBand), `Meta score policy ${policy.key} does not match its required fixed score band.`],
    [
      !hasCapMemberships(policy.capMembership, [["category", "meta"], ...dayAndConferenceCaps(policy.scoreDay)]) || !policy.scoreDay,
      `Meta score policy ${policy.key} must include meta category, day, and conference caps.`,
    ],
  ]);
}

function scheduledBoothPolicyErrors(
  policy: SeptemberScorePolicy,
  activity: GamificationActivityRecord,
  context: GamificationContext,
): string[] {
  const groupKey = activity.mission
    ? boothCapGroupKey(context.missions.find((candidate) => candidate.id === activity.mission)?.key || "")
    : "";
  return failedChecks([
    [!matchesScoreBand(policy, boothOutcomeBand(activity.outcome_key)), `Booth score policy ${policy.key} does not match its fixed outcome band.`],
    [
      !activity.partner || !hasCapMemberships(policy.capMembership, [
        ["related_group", groupKey],
        ["partner", activity.partner],
        ["category", "booth"],
        ...dayAndConferenceCaps(policy.scoreDay),
      ]),
      `Booth score policy ${policy.key} must include booth-group, partner, category, day, and conference caps.`,
    ],
    [!policy.scoreDay, `Booth score policy ${policy.key} requires a conference day.`],
  ]);
}

function matchesCalculatedCeiling(
  override: NonNullable<SeptemberScorePolicy["capCeilingOverrides"]>["related_group"],
  ceiling: ScoreBand,
): boolean {
  return Boolean(override) &&
    override!.totalXpCeiling === ceiling.totalXp &&
    override!.leaderboardXpCeiling === ceiling.leaderboardXp;
}

function scheduledCommunityPolicyErrors(
  policy: SeptemberScorePolicy,
  activity: GamificationActivityRecord,
  policies: SeptemberScorePolicy[],
  context: GamificationContext,
): string[] {
  const mission = missionFor(activity, context);
  const approvedTwoCode = mission?.metadata?.community_two_code_approved === true;
  const groupKey = relatedGroupKey(policy);
  const programmeCeiling = approvedTwoCode
    ? { totalXp: 40, leaderboardXp: 30 }
    : highestCommunityGroupBand(policies, groupKey);
  const expected = communityScoreBand(activity, approvedTwoCode, SCORING_TWO_CODE_BANDS);
  return failedChecks([
    [!matchesScoreBand(policy, expected), `Community Partner score policy ${policy.key} does not match its fixed outcome band.`],
    [
      !mission || !activity.partner || !hasCapMemberships(policy.capMembership, [
        ["related_group", mission.key],
        ["partner", activity.partner],
        ["category", "community"],
        ...dayAndConferenceCaps(policy.scoreDay),
      ]) || !policy.scoreDay,
      `Community Partner score policy ${policy.key} must include programme, partner, category, day, and conference caps.`,
    ],
    [
      expected && !matchesCalculatedCeiling(policy.capCeilingOverrides?.related_group, programmeCeiling),
      `Community Partner score policy ${policy.key} has an invalid programme ceiling.`,
    ],
  ]);
}

function scheduledSessionPolicyErrors(policy: SeptemberScorePolicy): string[] {
  return failedChecks([
    [policy.totalXp !== 20 || policy.leaderboardXp !== 15, `Session score policy ${policy.key} does not match the fixed 20/15 score band.`],
    [
      !hasCapMemberships(policy.capMembership, [["category", "session"], ...dayAndConferenceCaps(policy.scoreDay)]) || !policy.scoreDay,
      `Session score policy ${policy.key} must include session category, day, and conference caps.`,
    ],
  ]);
}

function capMembershipErrors(
  policy: SeptemberScorePolicy,
  activity: GamificationActivityRecord | undefined,
  membership: GamificationCapMembership,
): string[] {
  return failedChecks([
    [
      !(CAP_DIMENSIONS as readonly string[]).includes(membership.dimension) || !cleanText(membership.key),
      `Score policy ${policy.key} has an invalid cap membership.`,
    ],
    [
      !["activity", "related_group", "partner", "category", "conference_day", "conference"].includes(membership.dimension),
      `Score policy ${policy.key} has an unsupported cap membership.`,
    ],
    [
      membership.dimension === "partner" && activity?.partner !== membership.key,
      `Score policy ${policy.key} partner cap must match the Activity partner.`,
    ],
    [
      membership.dimension === "category" && activity?.category !== membership.key,
      `Score policy ${policy.key} category cap must match the Activity category.`,
    ],
    [
      membership.dimension === "conference_day" && policy.scoreDay !== membership.key,
      `Score policy ${policy.key} conference-day cap must match its score day.`,
    ],
    [
      membership.dimension === "conference" && membership.key !== "conference",
      `Score policy ${policy.key} conference cap must use the conference key.`,
    ],
  ]);
}

function scheduledPolicyCapErrors(policy: SeptemberScorePolicy, activity: GamificationActivityRecord | undefined): string[] {
  const memberships = policy.capMembership || [];
  const errors = failedChecks([
    [policy.scoreDay && !isISODate(policy.scoreDay), `Score policy ${policy.key} has an invalid score day.`],
    [
      !memberships.some((membership) => membership.dimension === "activity" && membership.key === policy.activityId),
      `Score policy ${policy.key} must include its Activity cap membership.`,
    ],
    [
      !uniqueKeys(memberships.map((membership) => `${membership.dimension}:${membership.key}`)),
      `Score policy ${policy.key} repeats a cap membership.`,
    ],
  ]);
  for (const membership of memberships) errors.push(...capMembershipErrors(policy, activity, membership));
  return errors;
}

/** Server-only configuration and code lifecycle service. It returns only explicit admin DTOs. */
export class GamificationOperationsService {
  constructor(
    private readonly store: GamificationAccountingStore,
    private readonly codePepper: string,
    private readonly clock: () => string = now,
  ) {}

  async operations(): Promise<AdminGamificationOperationsDto> {
    const context = await this.context();
    const lastRecalculatedAt = latestTimestamp(context.profiles.map((profile) => profile.totals_recalculated_at));
    return {
      achievements: context.achievements.map(safeAchievement).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)),
      missions: context.missions.map(safeMission).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)),
      activities: context.activities.map((activity) => safeActivity(activity, context)).sort((a, b) => a.key.localeCompare(b.key)),
      codes: context.codes.map((code) => safeCode(code, context)).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
      schedules: context.schedules.map(safeSchedule).sort((a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt)),
      references: {
        partners: context.partners.map((partner) => ({ id: partner.id, name: cleanText(partner.name) || partner.id, type: partner.type })).sort((a, b) => a.name.localeCompare(b.name)),
        sessions: context.sessions.map((session) => safeSessionReference(session, context)).sort((a, b) => a.title.localeCompare(b.title)),
      },
      profileCache: {
        state: context.adminActions.some((action) => action.status === "rebuild_pending") ||
          context.profiles.some((profile) => profile.rebuild_pending)
          ? "rebuild_pending"
          : context.profiles.length > 0 ? "current" : "empty",
        profiles: context.profiles.length,
        lastRecalculatedAt,
      },
    };
  }

  async saveAchievementDraft(input: AdminAchievementDraftInput, actor: AdminOperationActor): Promise<AdminAchievementDto> {
    const queued = configurationMutationQueue.catch(() => undefined).then(() => withGamificationLocks(
      this.store,
      ["configuration:gamification"],
      () => this.saveAchievementDraftNow(input, actor),
    ));
    configurationMutationQueue = queued;
    return queued;
  }

  private async saveAchievementDraftNow(input: AdminAchievementDraftInput, actor: AdminOperationActor): Promise<AdminAchievementDto> {
    assertNoSecretInput(input, "Achievement configuration");
    const key = cleanKey(input.key);
    assertAchievementDraftInput(input, key);
    const context = await this.context();
    const existing = input.id ? this.requireDefinition("achievement", input.id, context) as GamificationAchievementRecord : undefined;
    await this.assertConfigurationOperationAvailable(GAMIFICATION_COLLECTIONS.achievements, existing?.id, input.operationId);
    await this.assertEditableDraft("achievement", existing, input.successorOf, context);
    if (context.achievements.some((achievement) => achievement.key === key && achievement.id !== existing?.id)) {
      throw new Error("Achievement key is already in use.");
    }
    const record = await this.saveDraftRecord<GamificationAchievementRecord>(
      GAMIFICATION_COLLECTIONS.achievements,
      existing?.id,
      this.achievementBody(input, key, "draft"),
    );
    await this.recordCompletedAudit(actor, "configuration_change", GAMIFICATION_COLLECTIONS.achievements, record.id, input.operationId, input.reason, {
      definition: "achievement",
      result: definitionSummary(record),
      successorOf: cleanOptionalText(input.successorOf),
    });
    return safeAchievement(record);
  }

  async saveMissionDraft(input: AdminMissionDraftInput, actor: AdminOperationActor): Promise<AdminMissionDto> {
    const queued = configurationMutationQueue.catch(() => undefined).then(() => withGamificationLocks(
      this.store,
      ["configuration:gamification"],
      () => this.saveMissionDraftNow(input, actor),
    ));
    configurationMutationQueue = queued;
    return queued;
  }

  private async saveMissionDraftNow(input: AdminMissionDraftInput, actor: AdminOperationActor): Promise<AdminMissionDto> {
    assertNoSecretInput(input, "Mission configuration");
    const key = cleanKey(input.key);
    const slug = cleanKey(input.slug);
    assertMissionDraftInput(input, key, slug);
    const context = await this.context();
    const existing = input.id ? this.requireDefinition("mission", input.id, context) as GamificationMissionRecord : undefined;
    assertGenericMissionDraft(existing, key);
    await this.assertConfigurationOperationAvailable(GAMIFICATION_COLLECTIONS.missions, existing?.id, input.operationId);
    await this.assertEditableDraft("mission", existing, input.successorOf, context);
    if (context.missions.some((mission) => mission.key === key && mission.id !== existing?.id)) {
      throw new Error("Mission key is already in use.");
    }
    if (context.missions.some((mission) => mission.slug === slug && mission.id !== existing?.id)) {
      throw new Error("Mission slug is already in use.");
    }
    const record = await this.saveDraftRecord<GamificationMissionRecord>(
      GAMIFICATION_COLLECTIONS.missions,
      existing?.id,
      this.missionBody(input, key, slug, "draft"),
    );
    await this.recordCompletedAudit(actor, "configuration_change", GAMIFICATION_COLLECTIONS.missions, record.id, input.operationId, input.reason, {
      definition: "mission",
      result: definitionSummary(record),
      successorOf: cleanOptionalText(input.successorOf),
    });
    return safeMission(record);
  }

  async saveActivityDraft(input: AdminActivityDraftInput, actor: AdminOperationActor): Promise<AdminActivityDto> {
    const queued = configurationMutationQueue.catch(() => undefined).then(() => withGamificationLocks(
      this.store,
      ["configuration:gamification"],
      () => this.saveActivityDraftNow(input, actor),
    ));
    configurationMutationQueue = queued;
    return queued;
  }

  private async saveActivityDraftNow(input: AdminActivityDraftInput, actor: AdminOperationActor): Promise<AdminActivityDto> {
    assertNoSecretInput(input, "Activity configuration");
    assertGenericActivityDraft(input);
    const key = cleanKey(input.key);
    assertActivityDraftInput(input, key);
    const context = await this.context();
    const existing = input.id ? this.requireDefinition("activity", input.id, context) as GamificationActivityRecord : undefined;
    await this.assertConfigurationOperationAvailable(GAMIFICATION_COLLECTIONS.activities, existing?.id, input.operationId);
    await this.assertEditableDraft("activity", existing, input.successorOf, context);
    if (context.activities.some((activity) => activity.key === key && activity.id !== existing?.id)) {
      throw new Error("Activity key is already in use.");
    }
    const record = await this.saveDraftRecord<GamificationActivityRecord>(
      GAMIFICATION_COLLECTIONS.activities,
      existing?.id,
      this.activityBody(input, key, "draft"),
    );
    if (input.scorePolicy) await this.saveScorePolicy(record, input.scorePolicy, context);
    else if (existing) await this.disableDraftPolicies(record.id, context);
    await this.recordCompletedAudit(actor, "configuration_change", GAMIFICATION_COLLECTIONS.activities, record.id, input.operationId, input.reason, {
      definition: "activity",
      result: definitionSummary(record),
      scorePolicySchedule: input.scorePolicy?.scheduleId,
      successorOf: cleanOptionalText(input.successorOf),
    });
    return safeActivity(record, await this.context());
  }

  /**
   * Creates the only supported Session attendance shape. The Agenda Slot is read
   * by the admin UI as context only; this operation persists the supplied Activity
   * evidence window and a schedule-free Session presentation snapshot.
   */
  async saveSessionAttendanceMissionDraft(
    input: AdminSessionAttendanceMissionDraftInput,
    actor: AdminOperationActor,
  ): Promise<{ mission: AdminMissionDto; activity: AdminActivityDto }> {
    assertNoSecretInput(input, "Session Mission configuration");
    const plan = parseSessionAttendanceInput(input);
    const context = await this.context();
    const sources = resolveSessionAttendanceSources(input, plan, context);
    // The immutable Activity key is the durable operation target before an ID exists.
    const audit = await this.beginAudit(
      actor,
      "configuration_change",
      GAMIFICATION_COLLECTIONS.activities,
      plan.activityKey,
      input.operationId,
      safeReason(input.reason),
      sessionAttendanceAuditSummary(input, plan, sources),
    );
    const existing: ExistingSessionAttendance = {
      mission: context.missions.find((mission) => mission.key === plan.missionKey),
      activity: context.activities.find((activity) => activity.key === plan.activityKey),
    };
    if (audit.replayed) {
      if (!existing.mission || !existing.activity) throw new Error("The prior Session Mission configuration is incomplete. Contact an administrator.");
      return { mission: safeMission(existing.mission), activity: safeActivity(existing.activity, context) };
    }
    await this.resumeCanonicalAudit(audit, sessionAttendanceConflicts(audit.existing, plan, existing, context));
    return this.failingAudit(audit.record.id, async () => {
      const { mission, activity } = await this.createSessionAttendanceRecords(input, plan, sources, existing, context);
      await this.completeAudit(audit.record.id);
      const completedContext = await this.context();
      return { mission: safeMission(mission), activity: safeActivity(activity, completedContext) };
    });
  }

  private async createSessionAttendanceRecords(
    input: AdminSessionAttendanceMissionDraftInput,
    plan: SessionAttendancePlan,
    sources: SessionAttendanceSources,
    existing: ExistingSessionAttendance,
    context: GamificationContext,
  ): Promise<{ mission: GamificationMissionRecord; activity: GamificationActivityRecord }> {
    const mission = existing.mission || await this.store.create<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, {
      key: plan.missionKey,
      slug: plan.slug,
      title: plan.missionTitle,
      summary: plan.missionSummary,
      category: "session",
      visibility: input.visibility,
      status: "draft",
      starts_at: input.activeFrom,
      ends_at: input.activeUntil,
      primary_achievement: sources.achievementId,
      session: plan.sessionId,
      suggested: input.visibility === "public",
      sort_order: input.sortOrder,
      metadata: { session_key: plan.sessionKey },
    });
    const activity = existing.activity || await this.store.create<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, {
      key: plan.activityKey,
      mission: mission.id,
      kind: "session",
      category: "session",
      outcome_key: "attendance",
      evidence_mode: "single_code",
      evidence_channel: input.evidenceChannel,
      deployment_label: plan.deploymentLabel,
      achievement: sources.achievementId,
      session: plan.sessionId,
      session_key: plan.sessionKey,
      session_display_snapshot: sessionDisplaySnapshot(sources.session),
      session_meta_eligible: Boolean(input.metaEligible),
      per_user_claim_limit: 1,
      max_claims: input.maxClaims,
      active_from: input.activeFrom,
      active_until: input.activeUntil,
      status: "draft",
      enabled: true,
      metadata: {},
    });
    await this.saveScorePolicy(activity, {
      scheduleId: sources.schedule.id,
      policyKey: plan.activityKey,
      enabled: true,
      totalXp: 20,
      leaderboardXp: 15,
      capMembership: [
        { dimension: "activity", key: activity.id },
        { dimension: "category", key: "session" },
        { dimension: "conference_day", key: input.scoreDay },
        { dimension: "conference", key: "conference" },
      ],
      scoreDay: input.scoreDay,
    }, context);
    return { mission, activity };
  }

  /** Creates the canonical local-code inventory for one configured non-Session event. */
  async saveConfiguredEventMissionDraft(
    input: AdminConfiguredEventMissionDraftInput,
    actor: AdminOperationActor,
  ): Promise<{ mission: AdminMissionDto; activities: AdminActivityDto[] }> {
    assertNoSecretInput(input, "Event Mission configuration");
    const copy = parseConfiguredEventInput(input);
    const context = await this.context();
    const plan = planConfiguredEvent(input, copy, context);
    const audit = await this.beginAudit(
      actor,
      "configuration_change",
      GAMIFICATION_COLLECTIONS.activities,
      plan.missionKey,
      input.operationId,
      safeReason(input.reason),
      configuredEventAuditSummary(input, plan),
    );
    const existingMission = context.missions.find((mission) => mission.key === plan.missionKey);
    const existingActivities = context.activities.filter((activity) => plan.activityKeys.includes(activity.key));
    if (audit.replayed) {
      if (!existingMission || existingActivities.length !== plan.activityKeys.length) {
        throw new Error("The prior configured event operation is incomplete. Contact an administrator.");
      }
      return {
        mission: safeMission(existingMission),
        activities: existingActivities.map((activity) => safeActivity(activity, context)),
      };
    }
    await this.resumeCanonicalAudit(audit, configuredEventConflicts(audit.existing, plan, existingMission, existingActivities));
    return this.failingAudit(audit.record.id, async () => {
      const mission = existingMission || await this.createConfiguredEventMission(input, plan);
      const activities: GamificationActivityRecord[] = [];
      for (const definition of configuredEventActivityDefinitions(input, plan)) {
        const existing = existingActivities.find((activity) => activity.key === definition.key);
        const activity = existing || await this.store.create<GamificationActivityRecord>(
          GAMIFICATION_COLLECTIONS.activities,
          configuredEventActivityRow(input, plan, definition, mission.id),
        );
        activities.push(activity);
        await this.saveScorePolicy(activity, configuredEventScorePolicy(input, plan, definition, activity.id), context);
      }
      await this.completeAudit(audit.record.id);
      const completedContext = await this.context();
      return {
        mission: safeMission(mission),
        activities: activities.map((activity) => safeActivity(activity, completedContext)),
      };
    });
  }

  private createConfiguredEventMission(input: AdminConfiguredEventMissionDraftInput, plan: ConfiguredEventPlan): Promise<GamificationMissionRecord> {
    return this.store.create<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, {
      key: plan.missionKey,
      slug: plan.slug,
      title: plan.missionTitle,
      summary: plan.summary,
      category: plan.category,
      visibility: input.visibility,
      status: "draft",
      starts_at: input.activeFrom,
      ends_at: input.activeUntil,
      primary_achievement: "",
      partner: plan.hostPartnerId,
      partner_key: "",
      event_ref: plan.eventRef,
      suggested: input.visibility === "public" && Boolean(input.suggested),
      sort_order: input.sortOrder,
      metadata: {
        cap_group_key: plan.capGroupKey,
        related_event_two_code_approved: input.kind !== "workshop" && input.flow === "two_code",
      },
    });
  }

  /** Creates one canonical Community Partner programme without deriving classification from public partner data. */
  async saveCommunityPartnerMissionDraft(
    input: AdminCommunityPartnerMissionDraftInput,
    actor: AdminOperationActor,
  ): Promise<{ mission: AdminMissionDto; activities: AdminActivityDto[] }> {
    assertNoSecretInput(input, "Community Partner Mission configuration");
    const copy = parseCommunityPartnerInput(input);
    const context = await this.context();
    const plan = planCommunityPartnerProgramme(input, copy, context);
    const audit = await this.beginAudit(
      actor,
      "configuration_change",
      GAMIFICATION_COLLECTIONS.activities,
      plan.missionKey,
      input.operationId,
      safeReason(input.reason),
      communityPartnerAuditSummary(input, plan),
    );
    const existingMission = context.missions.find((mission) => mission.key === plan.missionKey);
    const existingActivities = context.activities.filter((activity) => plan.activityKeys.includes(activity.key));
    if (audit.replayed) {
      if (!existingMission || existingActivities.length !== plan.activityKeys.length) {
        throw new Error("The prior Community Partner configuration is incomplete. Contact an administrator.");
      }
      return { mission: safeMission(existingMission), activities: existingActivities.map((activity) => safeActivity(activity, context)) };
    }
    await this.resumeCanonicalAudit(audit, communityPartnerConflicts(audit.existing, plan, existingMission, existingActivities));
    return this.failingAudit(audit.record.id, async () => {
      const mission = existingMission || await this.createCommunityPartnerMission(input, plan);
      const activities: GamificationActivityRecord[] = [];
      for (const definition of communityPartnerActivityDefinitions(input, plan)) {
        const existing = existingActivities.find((activity) => activity.key === definition.key);
        const activity = existing || await this.store.create<GamificationActivityRecord>(
          GAMIFICATION_COLLECTIONS.activities,
          communityPartnerActivityRow(input, plan, definition, mission.id),
        );
        activities.push(activity);
        await this.saveScorePolicy(activity, communityPartnerScorePolicy(input, plan, definition, activity.id), await this.context());
      }
      await this.completeAudit(audit.record.id);
      const completedContext = await this.context();
      return { mission: safeMission(mission), activities: activities.map((activity) => safeActivity(activity, completedContext)) };
    });
  }

  private createCommunityPartnerMission(input: AdminCommunityPartnerMissionDraftInput, plan: CommunityPartnerPlan): Promise<GamificationMissionRecord> {
    return this.store.create<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, {
      key: plan.missionKey,
      slug: plan.slug,
      title: plan.missionTitle,
      summary: plan.summary,
      category: "community",
      visibility: input.visibility,
      status: "draft",
      starts_at: input.activeFrom,
      ends_at: input.activeUntil,
      primary_achievement: "",
      partner: plan.partnerId,
      partner_key: plan.partnerKey,
      suggested: input.visibility === "public" && Boolean(input.suggested),
      sort_order: input.sortOrder,
      metadata: communityProgrammeMetadata(input, plan),
    });
  }

  /** Creates the only supported September easter-egg inventory shape. */
  async saveEasterEggMissionDraft(
    input: AdminEasterEggMissionDraftInput,
    actor: AdminOperationActor,
  ): Promise<{ achievement: AdminAchievementDto; mission: AdminMissionDto; activity: AdminActivityDto }> {
    const copy = parseEasterEggInput(input);
    const context = await this.context();
    const schedule = requireDraftSchedule(context, input.scoreScheduleId, "Choose a draft score schedule for the Easter Egg discovery policy.");
    const existing: ExistingEasterEgg = {
      achievement: context.achievements.find((achievement) => achievement.key === copy.missionKey),
      mission: context.missions.find((mission) => mission.key === copy.missionKey),
      activity: context.activities.find((activity) => activity.key === copy.activityKey),
    };
    const audit = await this.beginAudit(
      actor,
      "configuration_change",
      GAMIFICATION_COLLECTIONS.activities,
      copy.activityKey,
      input.operationId,
      safeReason(input.reason),
      easterEggAuditSummary(input, copy, schedule),
    );
    if (audit.replayed) {
      if (!existing.achievement || !existing.mission || !existing.activity) {
        throw new Error("The prior Easter Egg Mission configuration is incomplete. Contact an administrator.");
      }
      return {
        achievement: safeAchievement(existing.achievement),
        mission: safeMission(existing.mission),
        activity: safeActivity(existing.activity, context),
      };
    }
    await this.resumeCanonicalAudit(audit, [
      [
        !audit.existing && (existing.achievement || existing.mission || existing.activity),
        "This immutable Easter Egg Mission key is already configured.",
      ],
      [
        !matchesCanonicalEasterEggShape(existing),
        "The interrupted Easter Egg configuration does not match the canonical hidden static-discovery shape.",
      ],
    ]);
    return this.failingAudit(audit.record.id, async () => {
      const { achievement, mission, activity } = await this.createEasterEggRecords(input, copy, schedule, existing);
      await this.completeAudit(audit.record.id);
      const completedContext = await this.context();
      return {
        achievement: safeAchievement(achievement),
        mission: safeMission(mission),
        activity: safeActivity(activity, completedContext),
      };
    });
  }

  private async createEasterEggRecords(
    input: AdminEasterEggMissionDraftInput,
    copy: EasterEggCopy,
    schedule: GamificationScoreScheduleRecord,
    existing: ExistingEasterEgg,
  ): Promise<{ achievement: GamificationAchievementRecord; mission: GamificationMissionRecord; activity: GamificationActivityRecord }> {
    const achievement = existing.achievement || await this.store.create<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, {
      key: copy.missionKey,
      badge_name: copy.badgeName,
      badge_description: copy.badgeDescription,
      locked_teaser: "",
      icon: cleanText(input.badgeIcon),
      category: "easter_egg",
      rarity: input.badgeRarity,
      visibility: "hidden_until_unlocked",
      status: "draft",
      unlock_rule: { kind: "activity_claim" },
      active_from: input.activeFrom,
      active_until: input.activeUntil,
      sort_order: input.sortOrder,
      metadata: { spoiler_safe_post_unlock_copy: true },
    });
    const mission = existing.mission || await this.store.create<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, {
      key: copy.missionKey,
      slug: `easter-egg-${copy.eggKey}`,
      title: copy.missionTitle,
      summary: copy.missionSummary,
      category: "easter_egg",
      visibility: "hidden_until_unlocked",
      status: "draft",
      starts_at: input.activeFrom,
      ends_at: input.activeUntil,
      primary_achievement: achievement.id,
      partner: "",
      partner_key: "",
      session: "",
      event_ref: {},
      suggested: false,
      sort_order: input.sortOrder,
      metadata: { safe_static_discovery: true },
    });
    const activity = existing.activity || await this.store.create<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, {
      key: copy.activityKey,
      mission: mission.id,
      kind: "easter_egg",
      category: "easter_egg",
      outcome_key: "static_discovery",
      evidence_mode: "static_puzzle_code",
      evidence_channel: input.evidenceChannel,
      deployment_label: copy.deploymentNote,
      achievement: achievement.id,
      partner: "",
      partner_kind: "",
      session: "",
      event_ref: {},
      per_user_claim_limit: 1,
      max_claims: input.maxClaims,
      active_from: input.activeFrom,
      active_until: input.activeUntil,
      status: "draft",
      enabled: true,
      metadata: { safe_static_discovery: true },
    });
    await this.saveScorePolicy(activity, {
      scheduleId: schedule.id,
      policyKey: copy.activityKey,
      enabled: true,
      totalXp: 10,
      leaderboardXp: 0,
      capMembership: [
        { dimension: "activity", key: activity.id },
        { dimension: "category", key: "easter_egg" },
        { dimension: "conference", key: "conference" },
      ],
    }, await this.context());
    return { achievement, mission, activity };
  }

  async createScoreScheduleDraft(input: AdminScoreScheduleDraftInput, actor: AdminOperationActor): Promise<AdminScoreScheduleDto> {
    const queued = configurationMutationQueue.catch(() => undefined).then(() => this.createScoreScheduleDraftNow(input, actor));
    configurationMutationQueue = queued;
    return queued;
  }

  private async createScoreScheduleDraftNow(input: AdminScoreScheduleDraftInput, actor: AdminOperationActor): Promise<AdminScoreScheduleDto> {
    const key = cleanKey(input.key);
    if (!key || !validDate(input.effectiveAt)) throw new Error("Score schedule key and effective time are required.");
    const context = await this.context();
    await this.assertConfigurationOperationAvailable(GAMIFICATION_COLLECTIONS.scoreSchedules, undefined, input.operationId);
    if (context.schedules.some((schedule) => schedule.key === key)) throw new Error("Score schedule key is already in use.");
    const record = await this.store.create<GamificationScoreScheduleRecord>(GAMIFICATION_COLLECTIONS.scoreSchedules, {
      key,
      status: "draft",
      effective_at: input.effectiveAt,
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
      access_level_thresholds: { "1": 0 },
      activation_reason: "",
    });
    await this.recordCompletedAudit(actor, "configuration_change", GAMIFICATION_COLLECTIONS.scoreSchedules, record.id, input.operationId, input.reason, {
      definition: "score_schedule",
      result: definitionSummary(record),
    });
    return safeSchedule(record);
  }

  async activateDefinition(kind: GamificationDefinitionKind, input: AdminLifecycleInput, actor: AdminOperationActor): Promise<{ id: string; status: "active" }> {
    return withGamificationLocks(this.store, [BOOTH_SETUP_LOCK], () => this.activateDefinitionNow(kind, input, actor));
  }

  private async activateDefinitionNow(kind: GamificationDefinitionKind, input: AdminLifecycleInput, actor: AdminOperationActor): Promise<{ id: string; status: "active" }> {
    this.requireConfirmation(input.confirmation, "Activation");
    const reason = requiredReason(input.reason);
    const context = await this.context();
    const definition = this.requireDefinition(kind, input.id, context);
    if (definition.status === "retired") throw new Error("Retired definitions cannot be reactivated. Create a successor instead.");
    const audit = await this.beginAudit(actor, "configuration_change", this.collectionFor(kind), definition.id, input.operationId, reason, {
      operation: "activate",
      definitionId: definition.id,
    });
    if (audit.replayed) return { id: definition.id, status: "active" };
    if (audit.failed) await this.resumeAudit(audit.record.id);
    try {
      const errors = this.validateForActivation(kind, definition.id, context);
      if (errors.length > 0) throw new Error(errors.join(" "));
      const body: Record<string, unknown> = { status: "active" };
      if (kind === "activity") body.enabled = true;
      await this.store.update(this.collectionFor(kind), definition.id, body);
      await this.completeAudit(audit.record.id);
      return { id: definition.id, status: "active" };
    } catch (error) {
      await this.failAudit(audit.record.id);
      throw error;
    }
  }

  async retireDefinition(kind: GamificationDefinitionKind, input: AdminLifecycleInput, actor: AdminOperationActor): Promise<{ id: string; status: "retired" }> {
    return withGamificationLocks(this.store, [BOOTH_SETUP_LOCK], () => this.retireDefinitionNow(kind, input, actor));
  }

  private async retireDefinitionNow(kind: GamificationDefinitionKind, input: AdminLifecycleInput, actor: AdminOperationActor): Promise<{ id: string; status: "retired" }> {
    this.requireConfirmation(input.confirmation, "Retirement");
    const reason = requiredReason(input.reason);
    const context = await this.context();
    const definition = this.requireDefinition(kind, input.id, context);
    const audit = await this.beginAudit(actor, "configuration_change", this.collectionFor(kind), definition.id, input.operationId, reason, {
      operation: "retire",
      definitionId: definition.id,
    });
    if (audit.replayed) return { id: definition.id, status: "retired" };
    if (audit.failed) await this.resumeAudit(audit.record.id);
    try {
      const body: Record<string, unknown> = { status: "retired" };
      if (kind === "activity") body.enabled = false;
      if (kind === "achievement") body.visibility = "retired";
      await this.store.update(this.collectionFor(kind), definition.id, body);
      await this.completeAudit(audit.record.id);
      return { id: definition.id, status: "retired" };
    } catch (error) {
      await this.failAudit(audit.record.id);
      throw error;
    }
  }

  async activateScoreSchedule(id: string, input: AdminLifecycleInput, actor: AdminOperationActor): Promise<AdminScoreScheduleDto> {
    const queued = scheduleActivationQueue.catch(() => undefined).then(() => withGamificationLocks(
      this.store,
      ["configuration:score-schedule"],
      () => this.activateScoreScheduleNow(id, input, actor),
    ));
    scheduleActivationQueue = queued;
    return queued;
  }

  private async activateScoreScheduleNow(id: string, input: AdminLifecycleInput, actor: AdminOperationActor): Promise<AdminScoreScheduleDto> {
    this.requireConfirmation(input.confirmation, "Score schedule activation");
    const reason = requiredReason(input.reason);
    const context = await this.context();
    const schedule = context.schedules.find((candidate) => candidate.id === id);
    if (!schedule) throw new Error("Score schedule was not found.");
    const timestamp = this.clock();
    const audit = await this.beginAudit(actor, "schedule_activation", GAMIFICATION_COLLECTIONS.scoreSchedules, schedule.id, input.operationId, reason, {
      scheduleId: schedule.id,
    });
    if (audit.replayed) return safeSchedule(await this.store.getById<GamificationScoreScheduleRecord>(GAMIFICATION_COLLECTIONS.scoreSchedules, schedule.id));
    if (schedule.status === "active" && audit.existing) {
      if (audit.failed) await this.resumeAudit(audit.record.id);
      await this.supersedeOtherSchedules(schedule.id, timestamp);
      await this.completeAudit(audit.record.id);
      return safeSchedule(schedule);
    }
    if (schedule.status !== "draft") {
      await this.failAudit(audit.record.id);
      throw new Error("Only a draft score schedule can be activated.");
    }
    if (audit.failed) await this.resumeAudit(audit.record.id);
    try {
      const policies = this.policiesReadyForActivation(schedule.id, context);
      const calculated = calculateSeptemberScoreSchedule(policies);
      const priorActiveScheduleIds = context.schedules
        .filter((candidate) => candidate.status === "active")
        .map((candidate) => candidate.id);
      // Persist the calculated snapshot while this schedule is still a draft. A failed calculation cannot remove a live policy.
      await this.saveCalculatedCaps(schedule.id, calculated.caps, context);
      const activated = await this.store.update<GamificationScoreScheduleRecord>(GAMIFICATION_COLLECTIONS.scoreSchedules, schedule.id, {
        status: "active",
        total_xp_ceiling: calculated.totalXpCeiling,
        leaderboard_xp_ceiling: calculated.leaderboardXpCeiling,
        access_level_thresholds: calculated.accessLevelThresholds,
        activation_reason: reason,
        metadata: {
          calculated_caps: calculated.caps.map((cap) => this.safeCap(cap)),
          activated_policy_keys: calculated.policies.map((policy) => policy.key),
        },
      });
      await this.supersedeSchedules(priorActiveScheduleIds, timestamp);
      await this.completeAudit(audit.record.id);
      return safeSchedule(activated);
    } catch (error) {
      await this.failAudit(audit.record.id);
      throw error;
    }
  }

  private policiesReadyForActivation(scheduleId: string, context: GamificationContext): SeptemberScorePolicy[] {
    const policies = this.activePoliciesForSchedule(scheduleId, context);
    if (policies.length === 0) throw new Error("Add at least one active score-bearing policy for an active Activity before activation.");
    const policyActivityIds = new Set(policies.map((policy) => policy.activityId));
    const omittedEasterEgg = context.activities.find((activity) =>
      activity.kind === "easter_egg" &&
      activity.category === "easter_egg" &&
      activity.status === "active" &&
      activity.enabled &&
      !policyActivityIds.has(activity.id)
    );
    if (omittedEasterEgg) {
      throw new Error(`Active Easter Egg discovery ${omittedEasterEgg.key} requires its fixed 10/0 policy on every successor score schedule.`);
    }
    const errors = this.validatePolicies(policies, context);
    if (errors.length > 0) throw new Error(errors.join(" "));
    return policies;
  }

  async generateCodes(input: AdminCodeGenerationInput, actor: AdminOperationActor): Promise<AdminCodeBatchResult> {
    return withGamificationLocks(this.store, ["code-inventory", `code-operation:${operationId(input.operationId)}`], () =>
      this.generateCodesNow(input, actor)
    );
  }

  async registerCodes(input: AdminCodeRegistrationInput, actor: AdminOperationActor): Promise<AdminCodeRegistrationResult> {
    // Parse and snapshot before awaiting a lock; never put caller-supplied secrets in audit data.
    if (!Array.isArray(input.rawCodes) || input.rawCodes.length < 1 || input.rawCodes.length > 100) {
      throw new Error("Register between 1 and 100 codes per batch.");
    }
    const parsed = input.rawCodes.map((rawCode) => parseMissionCode(rawCode));
    if (parsed.some((code) => !code)) throw new Error("Every supplied Mission code must have a valid format.");
    const identities = parsed.map((code) => ({
      lookupPrefix: code!.lookupPrefix,
      codeHash: hashNormalizedMissionCode(code!.normalizedCode, this.codePepper),
    }));
    if (!uniqueKeys(identities.map((code) => code.lookupPrefix)) || !uniqueKeys(identities.map((code) => code.codeHash))) {
      throw new Error("Supplied Mission codes and lookup prefixes must be unique.");
    }
    const config = this.validateCodeGenerationInput({
      activityId: input.activityId,
      label: input.label,
      quantity: identities.length,
      evidenceRole: input.evidenceRole,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      maxRedemptions: input.maxRedemptions,
      perUserLimit: input.perUserLimit,
      operationId: input.operationId,
    });
    assertNoSecretInput(config, "Code registration configuration");
    // Domain separation and base64url keep this opaque payload commitment distinct from stored code hashes.
    const payloadDigest = createHmac("sha256", this.codePepper)
      .update(`mission-code-registration:v1:${JSON.stringify({ config, identities })}`)
      .digest("base64url");
    return withGamificationLocks(this.store, ["code-inventory", "configuration:gamification", `code-operation:${config.operationId}`], () =>
      this.registerCodesNow(config, identities, payloadDigest, actor)
    );
  }

  private async registerCodesNow(
    config: CodeGenerationConfig,
    identities: CodeIdentity[],
    payloadDigest: string,
    actor: AdminOperationActor,
  ): Promise<AdminCodeRegistrationResult> {
    if (!this.store.createManyAtomic) throw new Error("Code registration requires atomic batch storage.");
    const context = await this.context();
    const priorBatch = context.codes.filter((code) => code.batch_id === config.operationId);
    const priorAudit = await this.store.findOne(GAMIFICATION_COLLECTIONS.adminActions, { idempotency_key: auditIdempotencyKey("code_generation", config.operationId) });
    // Reconcile existing commands first, but validation failures are not Admin Actions.
    if (!priorAudit) {
      if (priorBatch.length > 0) throw new Error("This batch ID belongs to another operation.");
      this.assertCodesRegistrable(config, identities, context);
    }
    // Reuse the existing audit action enum; the operation kind and reason distinguish registration.
    const audit = await this.beginAudit(actor, "code_generation", GAMIFICATION_COLLECTIONS.codes, config.operationId, config.operationId,
      "Registered preprinted Mission code batch.", { operation: "code_registration", ...config, payloadDigest });
    const replayed = await this.replayCodeRegistration(audit, config, identities, priorBatch);
    if (replayed) return replayed;
    try {
      if (priorAudit) this.assertCodesRegistrable(config, identities, context);
      if (audit.failed) await this.resumeAudit(audit.record.id);
      await this.store.createManyAtomic<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, codeRegistrationRows(config, identities, actor));
    } catch (error) {
      return this.recoverCodeRegistration(config, identities, audit.record.id, error);
    }
    const result = codeRegistrationReceipt(
      config,
      identities,
      await this.store.list<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, { batch_id: config.operationId }),
    );
    await this.completeAudit(audit.record.id);
    return result;
  }

  private assertCodesRegistrable(config: CodeGenerationConfig, identities: CodeIdentity[], context: GamificationContext): void {
    this.requireCodeGenerationActivity(config, context);
    const prefixes = new Set(identities.map((code) => code.lookupPrefix));
    const hashes = new Set(identities.map((code) => code.codeHash));
    if (context.codes.some((code) => prefixes.has(code.lookup_prefix) || hashes.has(code.code_hash))) {
      throw new Error("A supplied Mission code or lookup prefix is already registered. No codes were registered.");
    }
  }

  private async replayCodeRegistration(
    audit: AuditStart,
    config: CodeGenerationConfig,
    identities: CodeIdentity[],
    priorBatch: GamificationCodeRecord[],
  ): Promise<AdminCodeRegistrationResult | undefined> {
    if ((!audit.existing || audit.failed) && priorBatch.length > 0) {
      await this.failAudit(audit.record.id);
      throw new Error("This batch ID belongs to another operation.");
    }
    if (!audit.replayed && priorBatch.length === 0) return undefined;
    const result = codeRegistrationReceipt(config, identities, priorBatch);
    if (!audit.replayed) await this.completeAudit(audit.record.id);
    return result;
  }

  private async recoverCodeRegistration(
    config: CodeGenerationConfig,
    identities: CodeIdentity[],
    auditId: string,
    error: unknown,
  ): Promise<AdminCodeRegistrationResult> {
    // A lost atomic response may still represent a full commit. Read back exact identities.
    const persisted = await this.store.list<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, { batch_id: config.operationId });
    if (persisted.length > 0) {
      const result = codeRegistrationReceipt(config, identities, persisted);
      await this.completeAudit(auditId);
      return result;
    }
    await this.failAudit(auditId);
    throw error;
  }

  private requireCodeGenerationActivity(config: AdminCodeGenerationInput, context: GamificationContext): GamificationActivityRecord {
    const activity = context.activities.find((candidate) => candidate.id === config.activityId);
    if (!activity || activity.status !== "active" || !activity.enabled) throw new Error("Choose an active enabled Activity.");
    this.assertCodeProgrammeReady(activity, context);
    if (!hasEffectiveScorePolicy(activity, config.startsAt, context)) {
      throw new Error("Activate an applicable score schedule before generating codes for this Activity.");
    }
    if (expectedCodeRole(activity.evidence_mode) !== config.evidenceRole) {
      throw new Error("Code evidence role must match the configured Activity evidence mode.");
    }
    this.assertCodeWindowInsideActivity(config.startsAt, config.endsAt, activity);
    return activity;
  }

  private assertCodeProgrammeReady(activity: GamificationActivityRecord, context: GamificationContext): void {
    if (isConfiguredEventActivityKind(activity.kind) && configuredEventReference(activity.event_ref)) {
      assertProgrammeReadyForCodes(activity, context, (candidate) => isConfiguredEventActivityKind(candidate.kind), CONFIGURED_EVENT_CODE_READINESS);
    }
    if (activity.kind === "community_partner") {
      assertProgrammeReadyForCodes(activity, context, (candidate) => candidate.kind === "community_partner", COMMUNITY_PARTNER_CODE_READINESS);
    }
    if (isEasterEggDefinition(activity)) this.assertEasterEggReadyForCodes(activity, context);
  }

  private assertEasterEggReadyForCodes(activity: GamificationActivityRecord, context: GamificationContext): void {
    const mission = missionFor(activity, context);
    const achievement = findAchievement(context, activity.achievement);
    const validationErrors = this.validateEasterEggActivity(activity, mission, context);
    if (validationErrors.length > 0 || mission?.status !== "active" || achievement?.status !== "active") {
      throw new Error(validationErrors.join(" ") || "Activate the canonical hidden Easter Egg Mission and Badge before generating codes.");
    }
  }

  private async generateCodesNow(input: AdminCodeGenerationInput, actor: AdminOperationActor): Promise<AdminCodeBatchResult> {
    const config = this.validateCodeGenerationInput(input);
    const context = await this.context();
    const activity = this.requireCodeGenerationActivity(config, context);
    const audit = await this.beginAudit(actor, "code_generation", GAMIFICATION_COLLECTIONS.codes, config.operationId, config.operationId, "Generated Mission code batch.", {
      batchId: config.operationId,
      activity: definitionSummary(activity),
      label: config.label,
      quantity: config.quantity,
      evidenceRole: config.evidenceRole,
      startsAt: config.startsAt,
      endsAt: config.endsAt,
      maxRedemptions: config.maxRedemptions,
      perUserLimit: config.perUserLimit,
    });
    if (audit.replayed) return this.committedLostBatch(config.operationId, config.label, activity.id);
    const priorBatch = context.codes.filter((code) => code.batch_id === config.operationId);
    if (priorBatch.length > 0) {
      return this.unrecoverableBatch(config.operationId, config.label, activity.id);
    }
    if (audit.failed) await this.resumeAudit(audit.record.id);
    const createdCodes: GamificationCodeRecord[] = [];
    try {
      const oneTimeCodes: AdminOneTimeCodeDto[] = [];
      const pending = Array.from({ length: config.quantity }, () => {
        const generated = createMissionCodeGeneration(this.codePepper);
        return {
          generated,
          body: {
          key: `code-${randomUUID()}`,
          batch_id: config.operationId,
          label: config.label,
          activity: activity.id,
          lookup_prefix: generated.definition.lookupPrefix,
          code_hash: generated.definition.codeHash,
          hash_version: generated.definition.hashVersion,
          evidence_role: config.evidenceRole,
          status: "active",
          enabled: true,
          starts_at: config.startsAt,
          ends_at: config.endsAt,
          max_redemptions: config.maxRedemptions,
          per_user_limit: config.perUserLimit,
          total_redemptions_cached: 0,
          created_by: actor.id,
          reissued_from: "",
          },
        };
      });
      const records = this.store.createManyAtomic
        ? await this.store.createManyAtomic<GamificationCodeRecord>(
          GAMIFICATION_COLLECTIONS.codes,
          pending.map((entry) => entry.body),
        )
        : await Promise.all(pending.map((entry) =>
          this.store.create<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, entry.body)
        ));
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const generated = pending[index].generated;
        createdCodes.push(record);
        const redemptionUrl = `/missions/redeem#code=${generated.rawCode}`;
        oneTimeCodes.push({ id: record.id, label: record.label, rawCode: generated.rawCode, redemptionUrl, qrLink: redemptionUrl });
      }
      await this.completeAudit(audit.record.id);
      return {
        batch: {
          id: config.operationId,
          label: config.label,
          activityId: activity.id,
          quantity: oneTimeCodes.length,
          committed: true,
          secretsAvailable: true,
        },
        codes: oneTimeCodes,
        csvExport: this.codeCsv(oneTimeCodes),
      };
    } catch (error) {
      const persistedBatch = await this.store.list<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, { batch_id: config.operationId }).catch(() => []);
      if (persistedBatch.length === config.quantity) {
        await this.completeAudit(audit.record.id).catch(() => undefined);
        return this.committedLostBatch(config.operationId, config.label, activity.id);
      }
      const codesToDisable = new Map([...createdCodes, ...persistedBatch].map((code) => [code.id, code]));
      await Promise.all([...codesToDisable.values()].map((code) => this.store.update(GAMIFICATION_COLLECTIONS.codes, code.id, {
        status: "disabled",
        enabled: false,
        invalidated_at: this.clock(),
        invalidated_by: actor.id,
        invalidated_reason: "Code batch generation did not complete.",
      }).catch(() => undefined)));
      await this.failAudit(audit.record.id);
      throw error;
    }
  }

  async invalidateCode(input: AdminCodeInvalidationInput, actor: AdminOperationActor): Promise<AdminCodeDto> {
    return withGamificationLocks(this.store, [`code:${cleanText(input.codeId)}`], () =>
      this.invalidateCodeNow(input, actor)
    );
  }

  private async invalidateCodeNow(input: AdminCodeInvalidationInput, actor: AdminOperationActor): Promise<AdminCodeDto> {
    this.requireConfirmation(input.confirmation, "Code invalidation");
    const reason = requiredReason(input.reason);
    const context = await this.context();
    const code = context.codes.find((candidate) => candidate.id === input.codeId);
    if (!code) throw new Error("Code was not found.");
    const audit = await this.beginAudit(actor, "code_invalidation", GAMIFICATION_COLLECTIONS.codes, code.id, input.operationId, reason, {
      code: { id: code.id, label: code.label, lookupPrefix: code.lookup_prefix },
      activityId: code.activity,
    });
    if (audit.replayed) return safeCode(await this.store.getById<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, code.id), await this.context());
    if (audit.failed) await this.resumeAudit(audit.record.id);
    if (code.invalidated_at) {
      await this.completeAudit(audit.record.id);
      return safeCode(await this.store.getById<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, code.id), await this.context());
    }
    {
      try {
        await this.store.update<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, code.id, {
          status: "disabled",
          enabled: false,
          invalidated_at: this.clock(),
          invalidated_by: actor.id,
          invalidated_reason: reason,
        });
        await this.completeAudit(audit.record.id);
      } catch (error) {
        await this.failAudit(audit.record.id);
        throw error;
      }
    }
    return safeCode(await this.store.getById<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, code.id), await this.context());
  }

  async reissueCode(input: AdminCodeReissueInput, actor: AdminOperationActor): Promise<AdminCodeBatchResult> {
    return withGamificationLocks(this.store, ["code-inventory", `code:${cleanText(input.codeId)}`], () =>
      this.reissueCodeNow(input, actor)
    );
  }

  private async reissueCodeNow(input: AdminCodeReissueInput, actor: AdminOperationActor): Promise<AdminCodeBatchResult> {
    this.requireConfirmation(input.confirmation, "Code reissue");
    const reason = requiredReason(input.reason);
    const context = await this.context();
    const code = requireReissuableCode(input, context);
    const { original, label, activity, priorReplacement } = code;
    const audit = await this.beginAudit(actor, "code_reissue", GAMIFICATION_COLLECTIONS.codes, original.id, input.operationId, reason, {
      originalCode: { id: original.id, label: original.label, lookupPrefix: original.lookup_prefix },
      activity: definitionSummary(activity),
      replacementLabel: label,
    });
    if (audit.replayed) return this.committedLostBatch(input.operationId, label, activity.id);
    if (priorReplacement) {
      if (audit.failed) await this.resumeAudit(audit.record.id);
      await this.completeAudit(audit.record.id);
      return this.committedLostBatch(input.operationId, priorReplacement.label, activity.id);
    }
    if (audit.failed) await this.resumeAudit(audit.record.id);
    return this.failingAudit(audit.record.id, () => this.createReplacementCode(input, code, actor, audit.record.id));
  }

  private async createReplacementCode(
    input: AdminCodeReissueInput,
    code: ReissuableCode,
    actor: AdminOperationActor,
    auditId: string,
  ): Promise<AdminCodeBatchResult> {
    const generated = createMissionCodeGeneration(this.codePepper);
    const record = await this.store.create<GamificationCodeRecord>(
      GAMIFICATION_COLLECTIONS.codes,
      replacementCodeRow(input, code, generated.definition, actor),
    );
    try {
      await this.completeAudit(auditId);
    } catch {
      // The replacement exists but its one-time secret cannot be recovered after an interrupted response.
      return this.committedLostBatch(input.operationId, record.label, code.activity.id);
    }
    const redemptionUrl = `/missions/redeem#code=${generated.rawCode}`;
    const oneTimeCode = { id: record.id, label: record.label, rawCode: generated.rawCode, redemptionUrl, qrLink: redemptionUrl };
    return {
      batch: { id: input.operationId, label: record.label, activityId: code.activity.id, quantity: 1, committed: true, secretsAvailable: true },
      codes: [oneTimeCode],
      csvExport: this.codeCsv([oneTimeCode]),
    };
  }

  async lookupCodes(input: AdminCodeLookupInput): Promise<AdminCodeDto[]> {
    const context = await this.context();
    let codes = context.codes;
    if (hasValue(input.rawCode)) {
      const parsed = parseMissionCode(input.rawCode);
      if (!parsed) return [];
      codes = codes.filter((code) =>
        code.lookup_prefix === parsed.lookupPrefix && verifyMissionCodeHash(parsed.normalizedCode, code.code_hash, this.codePepper),
      );
    }
    const query = cleanText(input.query).toLowerCase();
    if (query) {
      const activitiesById = new Map(context.activities.map((activity) => [activity.id, activity]));
      const missionsById = new Map(context.missions.map((mission) => [mission.id, mission]));
      const redemptionCodeIds = new Set(context.redemptions.filter((redemption) => redemption.id === query).map((redemption) => redemption.code));
      codes = codes.filter((code) => {
        const activity = activitiesById.get(code.activity);
        const mission = activity?.mission ? missionsById.get(activity.mission) : undefined;
        return [code.id, code.batch_id, code.label, code.lookup_prefix, activity?.id, activity?.key, mission?.id, mission?.key]
          .some((value) => cleanText(value).toLowerCase().includes(query)) || redemptionCodeIds.has(code.id);
      });
    }
    return codes.map((code) => safeCode(code, context));
  }

  private async context(): Promise<GamificationContext> {
    const [
      achievements,
      missions,
      activities,
      codes,
      redemptions,
      activityClaims,
      policies,
      schedules,
      caps,
      profiles,
      userAchievements,
      partners,
      sessions,
      agendaSlots,
      eventProgrammes,
      conferenceDays,
      adminActions,
    ] = await Promise.all([
      this.store.list<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, undefined, { sort: "key", limit: 1000 }),
      this.store.list<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, undefined, { sort: "key", limit: 1000 }),
      this.store.list<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, undefined, { sort: "key", limit: 2000 }),
      this.store.list<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, undefined, { sort: "-created,id", limit: 5000 }),
      this.store.list<GamificationCodeRedemptionRecord>(GAMIFICATION_COLLECTIONS.codeRedemptions, undefined, { sort: "-redeemed_at,id", limit: 5000 }),
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, undefined, { sort: "-claimed_at,id", limit: 5000 }),
      this.store.list<GamificationScoreSchedulePolicyRecord>(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, undefined, { limit: 2000 }),
      this.store.list<GamificationScoreScheduleRecord>(GAMIFICATION_COLLECTIONS.scoreSchedules, undefined, { sort: "-effective_at,id", limit: 100 }),
      this.store.list<GamificationScoreScheduleCapRecord>(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, undefined, { limit: 5000 }),
      this.store.list<GamificationProfileRecord>(GAMIFICATION_COLLECTIONS.profiles, undefined, { limit: 5000 }),
      this.store.list<GamificationUserAchievementRecord>(GAMIFICATION_COLLECTIONS.userAchievements, undefined, { sort: "-unlocked_at,id", limit: 5000 }),
      this.store.list<PartnerRecord>("partners", undefined, { sort: "name,id", limit: 1000 }),
      this.store.list<SessionRecord>("sessions", undefined, { sort: "title,id", limit: 1000 }),
      this.store.list<AgendaSlotRecord>("agenda_slots", undefined, { sort: "start_at,id", limit: 2000 }),
      this.store.list<EventProgrammeRecord>("event_programmes", undefined, { sort: "day,display_order,id", limit: 500 }),
      this.store.list<ConferenceDayRecord>("conference_days", undefined, { sort: "display_order,local_date,id", limit: 100 }),
      this.store.list<GamificationContext["adminActions"][number]>(GAMIFICATION_COLLECTIONS.adminActions, undefined, { sort: "-created,id", limit: 5000 }),
    ]);
    return {
      achievements,
      missions,
      activities,
      codes,
      redemptions,
      activityClaims,
      policies,
      schedules,
      caps,
      profiles,
      userAchievements,
      partners,
      sessions,
      agendaSlots,
      eventProgrammes,
      conferenceDays,
      adminActions,
    };
  }

  private achievementBody(input: AdminAchievementDraftInput, key: string, status: GamificationDefinitionStatus): Record<string, unknown> {
    return {
      key,
      badge_name: cleanText(input.badgeName),
      badge_description: cleanText(input.badgeDescription),
      locked_teaser: cleanText(input.lockedTeaser),
      icon: cleanText(input.icon),
      category: input.category,
      rarity: input.rarity,
      visibility: input.visibility,
      status,
      unlock_rule: safeUnlockRule(input.unlockRule),
      active_from: cleanText(input.activeFrom),
      active_until: cleanText(input.activeUntil),
      sort_order: input.sortOrder,
      metadata: input.successorOf ? { successor_of: input.successorOf } : {},
    };
  }

  private missionBody(input: AdminMissionDraftInput, key: string, slug: string, status: GamificationDefinitionStatus): Record<string, unknown> {
    return {
      key,
      slug,
      title: cleanText(input.title),
      summary: cleanText(input.summary),
      category: input.category,
      visibility: input.visibility,
      status,
      starts_at: cleanText(input.startsAt),
      ends_at: cleanText(input.endsAt),
      primary_achievement: cleanText(input.primaryAchievementId),
      partner: cleanText(input.partnerId),
      partner_key: cleanKey(input.partnerKey),
      session: cleanText(input.sessionId),
      event_ref: safeEventRef(input.eventRef) || {},
      suggested: input.visibility === "public" && Boolean(input.suggested),
      sort_order: input.sortOrder,
      metadata: input.successorOf ? { successor_of: input.successorOf } : {},
    };
  }

  private activityBody(input: AdminActivityDraftInput, key: string, status: GamificationDefinitionStatus): Record<string, unknown> {
    return {
      key,
      mission: cleanText(input.missionId),
      kind: input.kind,
      category: input.category,
      outcome_key: cleanText(input.outcomeKey),
      evidence_mode: input.evidenceMode,
      evidence_channel: cleanText(input.evidenceChannel),
      deployment_label: cleanText(input.deploymentLabel),
      achievement: cleanText(input.achievementId),
      partner: cleanText(input.partnerId),
      partner_kind: cleanText(input.partnerKind),
      session: cleanText(input.sessionId),
      event_ref: safeEventRef(input.eventRef) || {},
      per_user_claim_limit: input.perUserClaimLimit,
      max_claims: input.maxClaims || 0,
      active_from: cleanText(input.activeFrom),
      active_until: cleanText(input.activeUntil),
      status,
      enabled: Boolean(input.enabled),
      partner_follow_up_enabled: Boolean(input.partnerFollowUp?.enabled),
      partner_follow_up_notice_version: cleanText(input.partnerFollowUp?.noticeVersion),
      metadata: input.successorOf ? { successor_of: input.successorOf } : {},
    };
  }

  private async saveScorePolicy(activity: GamificationActivityRecord, input: AdminScorePolicyInput, context: GamificationContext): Promise<void> {
    const schedule = context.schedules.find((candidate) => candidate.id === cleanText(input.scheduleId));
    if (!schedule || schedule.status !== "draft") throw new Error("Direct score policies can only be configured on a draft score schedule.");
    const policyKey = cleanKey(input.policyKey);
    if (!policyKey) throw new Error("Score policy key is required.");
    this.assertBoothScorePolicy(activity, input, context);
    this.assertCommunityPartnerScorePolicy(activity, input, context);
    this.assertSessionScorePolicy(activity, input);
    this.assertConfiguredEventScorePolicy(activity, input);
    this.assertEasterEggScorePolicy(activity, input);
    this.assertMetaScorePolicy(activity, input, context);
    const body = {
      schedule: schedule.id,
      activity: activity.id,
      policy_key: policyKey,
      active: Boolean(input.enabled),
      total_xp: input.totalXp,
      leaderboard_xp: input.leaderboardXp,
      cap_membership: Array.isArray(input.capMembership) ? input.capMembership : [],
      cap_ceiling_overrides: input.capCeilingOverrides || {},
      score_day: cleanText(input.scoreDay),
      metadata: {},
    };
    const existing = context.policies.find((policy) => policy.schedule === schedule.id && policy.activity === activity.id);
    if (existing) {
      await this.store.update(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, existing.id, body);
    } else {
      if (context.policies.some((policy) => policy.schedule === schedule.id && policy.policy_key === policyKey)) {
        throw new Error("Score policy key is already in use for this schedule.");
      }
      await this.store.create(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, body);
    }
    await Promise.all(context.policies
      .filter((policy) => policy.activity === activity.id && policy.schedule !== schedule.id)
      .filter((policy) => context.schedules.find((candidate) => candidate.id === policy.schedule)?.status === "draft")
      .map((policy) => this.store.update(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, policy.id, { active: false })));
  }

  private async disableDraftPolicies(activityId: string, context: GamificationContext): Promise<void> {
    await Promise.all(context.policies
      .filter((policy) => policy.activity === activityId && policy.active)
      .filter((policy) => context.schedules.find((schedule) => schedule.id === policy.schedule)?.status === "draft")
      .map((policy) => this.store.update(GAMIFICATION_COLLECTIONS.scoreSchedulePolicies, policy.id, { active: false })));
  }

  private assertBoothScorePolicy(
    activity: GamificationActivityRecord,
    input: AdminScorePolicyInput,
    context: GamificationContext,
  ): void {
    if (activity.kind !== "booth") return;
    if (!matchesScoreBand(input, boothOutcomeBand(activity.outcome_key))) {
      throw new Error("Booth visit, participation, completion, win, and high-score policies require fixed 5/5, 10/10, 20/15, 30/25, and 35/25 total/Leaderboard XP bands.");
    }
    if (!activity.partner) throw new Error("Booth score policies require a sponsor partner.");
    const mission = missionFor(activity, context);
    if (!isCanonicalBoothMission(mission)) {
      throw new Error("Booth score policies require a canonical Mission matching its immutable sponsor key.");
    }
    if (!hasCapMemberships(input.capMembership, [
      ["activity", activity.id],
      ["related_group", boothCapGroupKey(mission.key)],
      ["partner", activity.partner],
      ["category", "booth"],
      ...dayAndConferenceCaps(input.scoreDay),
    ])) {
      throw new Error("Booth score policies require Activity, booth-group, sponsor partner, category, day, and conference cap membership.");
    }
    if (!isISODate(input.scoreDay)) {
      throw new Error("Booth score policies require a conference day; category, day, and conference caps are then derived from the configured membership.");
    }
    if (exceedsBoothCap(input.capCeilingOverrides)) {
      throw new Error("Booth cap ceilings cannot exceed 35 total XP or 25 Leaderboard XP.");
    }
  }

  private assertCommunityPartnerScorePolicy(
    activity: GamificationActivityRecord,
    input: AdminScorePolicyInput,
    context: GamificationContext,
  ): void {
    if (activity.kind !== "community_partner") return;
    const mission = missionFor(activity, context);
    const approvedTwoCode = isApprovedCommunityTwoCode(activity, mission);
    const expected = communityScoreBand(activity, approvedTwoCode, TWO_CODE_SCORE_BANDS);
    if (!expected || !matchesScoreBand(input, expected)) {
      throw new Error("Community Partner policies require fixed 20/15 attendance, 25/20 participation, 30/25 completion, or approved shared two-code score bands.");
    }
    if (!isCanonicalCommunityPolicyMission(activity, mission)) {
      throw new Error("Community Partner score policies require a canonical Mission and explicit gamification partner classification.");
    }
    if (!hasCommunityPolicyCaps(activity, mission, input)) {
      throw new Error("Community Partner score policies require Activity, programme, partner, category, day, and conference cap membership.");
    }
    if (!hasValidCommunityGroupCeiling(input.capCeilingOverrides?.related_group, approvedTwoCode, expected)) {
      throw new Error(`Community Partner programme scoring requires a valid shared related-group ceiling for its highest configured outcome.`);
    }
  }

  private assertSessionScorePolicy(activity: GamificationActivityRecord, input: AdminScorePolicyInput): void {
    if (activity.kind !== "session") return;
    if (input.totalXp !== 20 || input.leaderboardXp !== 15) {
      throw new Error("Session attendance policies require the fixed 20/15 total/Leaderboard XP band.");
    }
    if (
      !hasCapMemberships(input.capMembership, [["activity", activity.id], ["category", "session"], ...dayAndConferenceCaps(input.scoreDay)]) ||
      !isISODate(input.scoreDay)
    ) {
      throw new Error("Session attendance policies require Activity, session category, day, and conference cap membership.");
    }
  }

  private assertConfiguredEventScorePolicy(activity: GamificationActivityRecord, input: AdminScorePolicyInput): void {
    if (!isConfiguredEventActivityKind(activity.kind) || !configuredEventReference(activity.event_ref)) return;
    const expected = CONFIGURED_EVENT_SCORE_BANDS.get(activity.evidence_mode);
    if (!expected || !matchesScoreBand(input, expected)) {
      throw new Error("Configured event policies require fixed 30/25 attendance, 10/5 start, 0/0 finish, and 30/25 derived completion bands.");
    }
    const capGroupKey = cleanKey(activity.metadata?.cap_group_key);
    if (!hasConfiguredEventPolicyCaps(activity, capGroupKey, input)) {
      throw new Error("Configured event policies require Activity, related-event, category, day, and conference cap membership.");
    }
    if (hasPartnerCapMembership(input.capMembership)) {
      throw new Error("Optional event host attribution must not create Partner Activity scoring.");
    }
    if (!matchesGroupCeiling(input.capCeilingOverrides?.related_group, expected)) {
      throw new Error(`Configured event related-group scoring requires the ${expected.groupTotal}/${expected.groupLeaderboard} ceiling.`);
    }
  }

  private assertEasterEggScorePolicy(activity: GamificationActivityRecord, input: AdminScorePolicyInput): void {
    if (!isEasterEggDefinition(activity)) return;
    if (input.totalXp !== 10 || input.leaderboardXp !== 0) {
      throw new Error("Easter egg discovery policies require the fixed 10/0 total/Leaderboard XP band.");
    }
    const memberships = Array.isArray(input.capMembership) ? input.capMembership : [];
    if (!sameMembershipSet(memberships, [`activity:${activity.id}`, "category:easter_egg", "conference:conference"])) {
      throw new Error("Easter egg discovery policies require only Activity, easter-egg category, and conference cap membership.");
    }
    if (input.scoreDay || Object.keys(input.capCeilingOverrides || {}).length > 0) {
      throw new Error("Easter egg category and conference ceilings are derived from active discoveries without day caps or overrides.");
    }
  }

  private assertMetaScorePolicy(activity: GamificationActivityRecord, input: AdminScorePolicyInput, context: GamificationContext): void {
    if (activity.kind !== "meta") return;
    const achievement = context.achievements.find((candidate) => candidate.id === activity.achievement);
    const expectedBand = achievement ? metaScoreBandForRule(achievement.unlock_rule) : undefined;
    if (!expectedBand) throw new Error("Meta Activities require an Achievement rule with at least two qualifying source entities.");
    if (input.totalXp !== expectedBand.totalXp || input.leaderboardXp !== expectedBand.leaderboardXp) {
      throw new Error(`This Meta Activity requires the ${expectedBand.totalXp}/${expectedBand.leaderboardXp} total/Leaderboard XP band.`);
    }
  }

  private validateMetaAchievement(achievement: GamificationAchievementRecord, context: GamificationContext): string[] {
    const rule = achievement.unlock_rule;
    const sourceKeys = metaRuleActivityKeys(rule);
    if (rule.kind !== "claim_set" && rule.kind !== "claim_count") {
      return ["Meta Achievements support only claim-set or selected-source claim-count rules."];
    }
    const selectedSources = selectedMetaSourceActivities(rule, context.activities);
    return [
      ...metaRuleErrors(rule, sourceKeys, selectedSources),
      ...metaDiversityErrors(rule, selectedSources),
      ...failedChecks([[
        context.missions.some((mission) => mission.primary_achievement === achievement.id),
        "Meta Achievements cannot be attached to a redeemable Mission.",
      ]]),
      ...metaLinkedActivityErrors(achievement, rule, context),
    ];
  }

  private validateConfiguredEventActivity(
    activity: GamificationActivityRecord,
    mission: GamificationMissionRecord | undefined,
    context: GamificationContext,
  ): string[] {
    const eventRef = configuredEventReference(activity.event_ref);
    if (!eventRef) return ["Configured event Activities require a complete immutable event reference."];
    const flow = configuredEventFlow(activity, context);
    return [
      ...configuredEventReferenceErrors(activity, mission, eventRef),
      ...configuredEventHostErrors(activity, mission, context),
      ...configuredEventFlowErrors(activity, mission, eventRef, flow),
      ...configuredEventBadgeErrors(flow, context),
      ...policyAssertionErrors(
        activePoliciesFor(activity.id, context),
        "Configured event Activities require an active score policy.",
        "Configured event score policy is invalid.",
        (input) => this.assertConfiguredEventScorePolicy(activity, input),
      ),
    ];
  }

  private validateCommunityPartnerActivity(
    activity: GamificationActivityRecord,
    mission: GamificationMissionRecord | undefined,
    context: GamificationContext,
  ): string[] {
    if (!isCanonicalCommunityActivity(activity, mission, context)) {
      return ["Community Partner Activities require a canonical Community Mission and explicit gamification partner classification."];
    }
    const flow = communityProgrammeFlow(mission, context);
    return [
      ...communityProgrammeShapeErrors(activity, mission, flow),
      ...communityProgrammeMetaErrors(flow),
      ...communityProgrammeBadgeErrors(flow, context),
      ...communityProgrammeFollowUpErrors(flow),
      ...communityProgrammeCeilingErrors(flow, context),
      ...policyAssertionErrors(
        activePoliciesFor(activity.id, context),
        "Community Partner Activities require an active direct score policy.",
        "Community Partner score policy is invalid.",
        (input) => this.assertCommunityPartnerScorePolicy(activity, input, context),
      ),
    ];
  }

  private validateEasterEggActivity(
    activity: GamificationActivityRecord,
    mission: GamificationMissionRecord | undefined,
    context: GamificationContext,
  ): string[] {
    return [
      ...easterEggDiscoveryErrors(activity, mission, context),
      ...policyAssertionErrors(
        activePoliciesFor(activity.id, context),
        "Easter egg discovery requires an active fixed score policy.",
        "Easter egg score policy is invalid.",
        (input) => this.assertEasterEggScorePolicy(activity, input),
      ),
    ];
  }

  private validateForActivation(kind: GamificationDefinitionKind, id: string, context: GamificationContext): string[] {
    if (kind === "achievement") {
      return this.validateAchievementForActivation(context.achievements.find((candidate) => candidate.id === id)!, context);
    }
    if (kind === "mission") return missionActivationErrors(context.missions.find((candidate) => candidate.id === id)!, context);
    return this.validateActivityForActivation(context.activities.find((candidate) => candidate.id === id)!, context);
  }

  private validateAchievementForActivation(achievement: GamificationAchievementRecord, context: GamificationContext): string[] {
    const errors = failedChecks([
      [!cleanText(achievement.badge_name) || !cleanText(achievement.badge_description), "Badge presentation is incomplete."],
    ]);
    hasRequiredWindow(achievement.active_from, achievement.active_until, "Achievement", errors);
    const rule = safeUnlockRule(achievement.unlock_rule);
    const activityKeys = rule.activityKeys || [];
    return [
      ...errors,
      ...failedChecks([
        [!isUnlockRuleKind(rule.kind), "Achievement unlock rule is invalid."],
        [!uniqueKeys(activityKeys), "Achievement unlock rule repeats an Activity."],
      ]),
      ...this.achievementCategoryErrors(achievement, rule, activityKeys, context),
      ...inactiveDependencyErrors(activityKeys, context),
    ];
  }

  private achievementCategoryErrors(
    achievement: GamificationAchievementRecord,
    rule: AdminUnlockRuleInput,
    activityKeys: string[],
    context: GamificationContext,
  ): string[] {
    if (achievement.category === "meta") return this.validateMetaAchievement(achievement, context);
    if (achievement.category === "easter_egg" || achievement.key.startsWith("easter_egg.")) {
      return easterEggBadgeActivationErrors(achievement, rule, context);
    }
    return claimRuleActivationErrors(rule, activityKeys);
  }

  private validateActivityForActivation(activity: GamificationActivityRecord, context: GamificationContext): string[] {
    const mission = missionFor(activity, context);
    return [
      ...activityBasicsErrors(activity),
      ...activityRelationErrors(activity, mission, context),
      ...(activity.kind === "session" ? sessionActivityErrors(activity, mission, context) : []),
      ...partnerReferenceErrors(activity, context),
      ...this.partnerProgrammeErrors(activity, mission, context),
      ...this.eventSourceErrors(activity, mission, context),
      ...(isEasterEggDefinition(activity) || activity.key.startsWith("easter_egg.")
        ? this.validateEasterEggActivity(activity, mission, context)
        : []),
      ...metaActivityActivationErrors(activity, context),
    ];
  }

  private partnerProgrammeErrors(
    activity: GamificationActivityRecord,
    mission: GamificationMissionRecord | undefined,
    context: GamificationContext,
  ): string[] {
    if (activity.kind === "booth") return boothActivityErrors(activity, mission, context);
    if (activity.kind === "community_partner") return this.validateCommunityPartnerActivity(activity, mission, context);
    return activity.partner_follow_up_enabled || cleanText(activity.partner_follow_up_notice_version)
      ? ["Partner follow-up consent may only be configured for sponsor Booth or Community Partner Activities."]
      : [];
  }

  private eventSourceErrors(
    activity: GamificationActivityRecord,
    mission: GamificationMissionRecord | undefined,
    context: GamificationContext,
  ): string[] {
    if (isConfiguredEventActivityKind(activity.kind)) return this.validateConfiguredEventActivity(activity, mission, context);
    return activity.kind === "hievents" ? hieventsSourceErrors(activity) : [];
  }

  private activePoliciesForSchedule(scheduleId: string, context: GamificationContext): SeptemberScorePolicy[] {
    const activitiesById = new Map(context.activities.map((activity) => [activity.id, activity]));
    const policies = context.policies
      .filter((policy) => policy.schedule === scheduleId && policy.active)
      .map((policy) => {
        const activity = activitiesById.get(policy.activity);
        return {
          key: policy.policy_key,
          activityId: policy.activity,
          kind: activity?.kind,
          active: Boolean(activity && activity.status === "active" && activity.enabled && policy.active),
          totalXp: Number(policy.total_xp),
          leaderboardXp: Number(policy.leaderboard_xp),
          category: activity?.category || "admin_manual",
          scoreDay: cleanOptionalText(policy.score_day),
          capMembership: Array.isArray(policy.cap_membership) ? policy.cap_membership : [],
          capCeilingOverrides: calculatedCapOverrides(policy.cap_ceiling_overrides),
        };
      })
      .filter((policy) => policy.active && (policy.totalXp > 0 || policy.leaderboardXp > 0));
    for (const policy of policies) {
      const activity = activitiesById.get(policy.activityId);
      const mission = activity?.mission ? context.missions.find((candidate) => candidate.id === activity.mission) : undefined;
      if (activity?.kind !== "community_partner" || mission?.metadata?.community_two_code_approved === true) continue;
      const ceiling = highestCommunityGroupBand(policies, relatedGroupKey(policy));
      policy.capCeilingOverrides = {
        ...policy.capCeilingOverrides,
        related_group: { totalXpCeiling: ceiling.totalXp, leaderboardXpCeiling: ceiling.leaderboardXp },
      };
    }
    return policies;
  }

  private validatePolicies(policies: SeptemberScorePolicy[], context: GamificationContext): string[] {
    const activitiesById = new Map(context.activities.map((activity) => [activity.id, activity]));
    const errors = uniqueKeys(policies.map((policy) => policy.key)) ? [] : ["Score policy keys must be unique."];
    for (const policy of policies) {
      errors.push(...this.scheduledPolicyErrors(policy, activitiesById.get(policy.activityId), policies, context));
    }
    return errors;
  }

  private scheduledPolicyErrors(
    policy: SeptemberScorePolicy,
    activity: GamificationActivityRecord | undefined,
    policies: SeptemberScorePolicy[],
    context: GamificationContext,
  ): string[] {
    return [
      ...failedChecks([
        [!activity || activity.status !== "active" || !activity.enabled, `Score policy ${policy.key} has an inactive Activity.`],
        [
          !finiteNonNegative(policy.totalXp) || !finiteNonNegative(policy.leaderboardXp) || policy.leaderboardXp > policy.totalXp,
          `Score policy ${policy.key} has incompatible total and Leaderboard XP.`,
        ],
      ]),
      ...(activity ? this.scheduledKindPolicyErrors(policy, activity, policies, context) : []),
      ...scheduledPolicyCapErrors(policy, activity),
    ];
  }

  private scheduledKindPolicyErrors(
    policy: SeptemberScorePolicy,
    activity: GamificationActivityRecord,
    policies: SeptemberScorePolicy[],
    context: GamificationContext,
  ): string[] {
    return [
      ...(activity.kind === "meta" ? scheduledMetaPolicyErrors(policy, activity, context) : []),
      ...(activity.kind === "booth" && isEvidenceChannel(activity.evidence_channel) ? scheduledBoothPolicyErrors(policy, activity, context) : []),
      ...(activity.kind === "community_partner" ? scheduledCommunityPolicyErrors(policy, activity, policies, context) : []),
      ...(activity.kind === "session" ? scheduledSessionPolicyErrors(policy) : []),
      ...(isEasterEggDefinition(activity) ? this.scheduledEasterEggPolicyErrors(policy, activity) : []),
    ];
  }

  private scheduledEasterEggPolicyErrors(policy: SeptemberScorePolicy, activity: GamificationActivityRecord): string[] {
    try {
      this.assertEasterEggScorePolicy(activity, {
        scheduleId: "",
        policyKey: policy.key,
        enabled: policy.active,
        totalXp: policy.totalXp,
        leaderboardXp: policy.leaderboardXp,
        capMembership: policy.capMembership,
        capCeilingOverrides: recordCapOverrides(policy.capCeilingOverrides),
        scoreDay: policy.scoreDay,
      });
      return [];
    } catch (error) {
      return [error instanceof Error ? `Easter egg score policy ${policy.key} is invalid: ${error.message}` : `Easter egg score policy ${policy.key} is invalid.`];
    }
  }

  private async saveCalculatedCaps(scheduleId: string, caps: CalculatedScoreCap[], context: GamificationContext): Promise<void> {
    for (const cap of caps) {
      const existing = context.caps.find((candidate) => candidate.schedule === scheduleId && candidate.dimension === cap.dimension && candidate.cap_key === cap.key);
      const body = {
        schedule: scheduleId,
        dimension: cap.dimension,
        cap_key: cap.key,
        member_policy_keys: cap.memberPolicyKeys,
        total_xp_ceiling: cap.totalXpCeiling,
        leaderboard_xp_ceiling: cap.leaderboardXpCeiling,
      };
      if (existing) await this.store.update(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, existing.id, body);
      else await this.store.create(GAMIFICATION_COLLECTIONS.scoreScheduleCaps, body);
    }
  }

  private async supersedeSchedules(ids: string[], timestamp: string): Promise<void> {
    for (const id of ids) {
      await this.store.update<GamificationScoreScheduleRecord>(GAMIFICATION_COLLECTIONS.scoreSchedules, id, {
        status: "superseded",
        superseded_at: timestamp,
      });
    }
  }

  private async supersedeOtherSchedules(scheduleId: string, timestamp: string): Promise<void> {
    const schedules = await this.store.list<GamificationScoreScheduleRecord>(GAMIFICATION_COLLECTIONS.scoreSchedules, { status: "active" });
    await this.supersedeSchedules(schedules.filter((schedule) => schedule.id !== scheduleId).map((schedule) => schedule.id), timestamp);
  }

  private safeCap(cap: CalculatedScoreCap): Record<string, unknown> {
    return {
      dimension: cap.dimension,
      key: cap.key,
      memberPolicyKeys: cap.memberPolicyKeys,
      totalXpCeiling: cap.totalXpCeiling,
      leaderboardXpCeiling: cap.leaderboardXpCeiling,
    };
  }

  private validateCodeGenerationInput(input: AdminCodeGenerationInput): Required<AdminCodeGenerationInput> {
    const label = safeOperationalLabel(input.label);
    const id = operationId(input.operationId);
    if (!cleanText(input.activityId)) throw new Error("A code batch needs an Activity.");
    if (!isPositiveInteger(input.quantity) || input.quantity > 100) throw new Error("Generate between 1 and 100 codes per batch.");
    if (!isCodeEvidenceRole(input.evidenceRole)) throw new Error("Choose a valid code evidence role.");
    if (!validDate(input.startsAt) || !validDate(input.endsAt) || Date.parse(input.startsAt) >= Date.parse(input.endsAt)) {
      throw new Error("Code batches need a valid active start and end window.");
    }
    if (!isPositiveInteger(input.maxRedemptions) || !isPositiveInteger(input.perUserLimit)) {
      throw new Error("Code batches need positive global and per-User redemption limits.");
    }
    return { ...input, activityId: cleanText(input.activityId), label, operationId: id };
  }

  private assertCodeWindowInsideActivity(startsAt: string, endsAt: string, activity: GamificationActivityRecord): void {
    if (!validDate(activity.active_from) || !validDate(activity.active_until)) throw new Error("Activity needs an active window before code generation.");
    if (Date.parse(startsAt) < Date.parse(activity.active_from) || Date.parse(endsAt) > Date.parse(activity.active_until)) {
      throw new Error("Code window must stay within the Activity active window.");
    }
  }

  private codeCsv(codes: AdminOneTimeCodeDto[]): string {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    return ["Label,Code,Redemption URL", ...codes.map((code) => [code.label, code.rawCode, code.redemptionUrl].map(quote).join(","))].join("\n");
  }

  private committedLostBatch(batchId: string, label: string, activityId: string): AdminCodeBatchResult {
    return {
      batch: {
        id: batchId,
        label,
        activityId,
        quantity: 0,
        committed: true,
        secretsAvailable: false,
      },
    };
  }

  private unrecoverableBatch(batchId: string, label: string, activityId: string): AdminCodeBatchResult {
    return {
      batch: {
        id: batchId,
        label,
        activityId,
        quantity: 0,
        committed: false,
        secretsAvailable: false,
      },
    };
  }

  private requireConfirmation(confirmed: boolean, operation: string): void {
    if (!confirmed) throw new Error(`${operation} requires confirmation.`);
  }

  private collectionFor(kind: GamificationDefinitionKind): string {
    if (kind === "achievement") return GAMIFICATION_COLLECTIONS.achievements;
    if (kind === "mission") return GAMIFICATION_COLLECTIONS.missions;
    return GAMIFICATION_COLLECTIONS.activities;
  }

  private requireDefinition(kind: GamificationDefinitionKind, id: string, context: GamificationContext): GamificationAchievementRecord | GamificationMissionRecord | GamificationActivityRecord {
    const collection = kind === "achievement" ? context.achievements : kind === "mission" ? context.missions : context.activities;
    const definition = collection.find((candidate) => candidate.id === id);
    if (!definition) throw new Error("Gamification definition was not found.");
    return definition;
  }

  private async validateSuccessor(id: string | undefined, kind: GamificationDefinitionKind, context: GamificationContext): Promise<void> {
    if (!id) return;
    const predecessor = this.requireDefinition(kind, id, context);
    if (predecessor.status !== "retired") throw new Error("A successor can only replace a retired definition.");
  }

  private async definitionHasAccounting(kind: GamificationDefinitionKind, id: string, context: GamificationContext): Promise<boolean> {
    if (kind === "activity") {
      return context.activityClaims.some((claim) => claim.activity === id && claim.status === "accepted");
    }
    if (kind === "achievement") return context.userAchievements.some((achievement) => achievement.achievement === id);
    const activityIds = new Set(context.activities.filter((activity) => activity.mission === id).map((activity) => activity.id));
    return context.activityClaims.some((claim) => activityIds.has(claim.activity) && claim.status === "accepted");
  }

  private async beginAudit(
    actor: AdminOperationActor,
    action: "configuration_change" | "schedule_activation" | "code_generation" | "code_invalidation" | "code_reissue",
    collection: string,
    recordId: string,
    id: string,
    reason: string,
    afterSummary: Record<string, unknown>,
  ): Promise<{ record: { id: string }; replayed: boolean; failed: boolean; existing: boolean }> {
    assertNoSecretInput(afterSummary, "Audit summaries");
    const correlationId = operationId(id);
    const idempotencyKey = auditIdempotencyKey(action, correlationId);
    const existing = await this.store.findOne<{
      id: string;
      actor: string;
      actor_role: "admin";
      reason: string;
      status: "applied" | "rebuild_pending" | "failed";
      related_collection?: string;
      related_record_id?: string;
      after_summary?: Record<string, unknown>;
    }>(
      GAMIFICATION_COLLECTIONS.adminActions,
      { idempotency_key: idempotencyKey },
    );
    if (existing) {
      if (
        existing.actor !== actor.id ||
        existing.actor_role !== actor.role ||
        existing.reason !== safeReason(reason) ||
        existing.related_collection !== collection ||
        existing.related_record_id !== recordId
      ) {
        throw new Error("This admin operation ID belongs to another operation.");
      }
      if (!samePersistedJson(existing.after_summary || {}, afterSummary)) {
        throw new Error("This admin operation ID belongs to a different request.");
      }
      return { record: existing, replayed: existing.status === "applied", failed: existing.status === "failed", existing: true };
    }
    const record = await this.store.create<{ id: string }>(GAMIFICATION_COLLECTIONS.adminActions, {
      actor: actor.id,
      actor_role: actor.role,
      action,
      status: "rebuild_pending",
      reason: safeReason(reason),
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
      related_collection: collection,
      related_record_id: recordId,
      after_summary: afterSummary,
    });
    return { record, replayed: false, failed: false, existing: false };
  }

  private async recordCompletedAudit(
    actor: AdminOperationActor,
    action: "configuration_change",
    collection: string,
    recordId: string,
    id: string | undefined,
    reason: string | undefined,
    afterSummary: Record<string, unknown>,
  ): Promise<void> {
    assertNoSecretInput(afterSummary, "Audit summaries");
    const correlationId = cleanOptionalText(id) || randomUUID();
    const key = auditIdempotencyKey(action, correlationId);
    const existing = await this.store.findOne<{
      id: string;
      actor: string;
      actor_role: "admin";
      reason: string;
      related_collection?: string;
      related_record_id?: string;
      after_summary?: Record<string, unknown>;
    }>(GAMIFICATION_COLLECTIONS.adminActions, { idempotency_key: key });
    if (existing) {
      if (
        existing.actor !== actor.id ||
        existing.actor_role !== actor.role ||
        existing.reason !== safeReason(reason) ||
        existing.related_collection !== collection ||
        existing.related_record_id !== recordId ||
        !samePersistedJson(existing.after_summary || {}, afterSummary)
      ) {
        throw new Error("This admin operation ID belongs to another operation.");
      }
      return;
    }
    await this.store.create(GAMIFICATION_COLLECTIONS.adminActions, {
      actor: actor.id,
      actor_role: actor.role,
      action,
      status: "applied",
      reason: safeReason(reason),
      correlation_id: correlationId,
      idempotency_key: key,
      related_collection: collection,
      related_record_id: recordId,
      after_summary: afterSummary,
    });
  }

  private async completeAudit(id: string): Promise<void> {
    await this.store.update(GAMIFICATION_COLLECTIONS.adminActions, id, { status: "applied" });
  }

  private async assertConfigurationOperationAvailable(collection: string, recordId: string | undefined, id: string | undefined): Promise<void> {
    if (!cleanText(id)) return;
    const existing = await this.store.findOne<{ related_collection?: string; related_record_id?: string }>(
      GAMIFICATION_COLLECTIONS.adminActions,
      { idempotency_key: auditIdempotencyKey("configuration_change", cleanText(id)) },
    );
    if (!existing) return;
    if (existing.related_collection !== collection || existing.related_record_id !== recordId) {
      throw new Error("This admin operation ID belongs to another operation.");
    }
    throw new Error("This configuration operation was already applied. Refresh the catalog before making another change.");
  }

  private async resumeAudit(id: string): Promise<void> {
    await this.store.update(GAMIFICATION_COLLECTIONS.adminActions, id, { status: "rebuild_pending" });
  }

  private async failAudit(id: string): Promise<void> {
    try {
      await this.store.update(GAMIFICATION_COLLECTIONS.adminActions, id, { status: "failed" });
    } catch {
      // Keep the source operation error if recording the failure also fails.
    }
  }

  private async assertEditableDraft(
    kind: GamificationDefinitionKind,
    existing: { id: string; status?: string } | undefined,
    successorOf: string | undefined,
    context: GamificationContext,
  ): Promise<void> {
    if (existing?.status !== undefined && existing.status !== "draft") throw new Error(DRAFT_EDIT_COPY[kind].notDraft);
    if (existing && await this.definitionHasAccounting(kind, existing.id, context)) throw new Error(DRAFT_EDIT_COPY[kind].hasAccounting);
    await this.validateSuccessor(successorOf, kind, context);
  }

  private saveDraftRecord<T>(collection: string, existingId: string | undefined, body: Record<string, unknown>): Promise<T> {
    return existingId ? this.store.update<T>(collection, existingId, body) : this.store.create<T>(collection, body);
  }

  /** Resumes an interrupted canonical operation, or fails its audit on the first conflicting persisted shape. */
  private async resumeCanonicalAudit(audit: AuditStart, conflicts: Check[]): Promise<void> {
    if (audit.failed) await this.resumeAudit(audit.record.id);
    const conflict = conflicts.find(([present]) => present);
    if (!conflict) return;
    await this.failAudit(audit.record.id);
    throw new Error(conflict[1]);
  }

  private async failingAudit<T>(auditId: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      await this.failAudit(auditId);
      throw error;
    }
  }
}
