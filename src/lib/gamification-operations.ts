import { randomUUID } from "node:crypto";
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
  parseMissionCode,
  verifyMissionCodeHash,
} from "~/lib/mission-code-crypto";
import type {
  AgendaSlotRecord,
  ConferenceDayRecord,
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

function safeUnlockRule(value: unknown): AdminUnlockRuleInput {
  const rule = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const kind = isUnlockRuleKind(rule.kind) ? rule.kind : "activity_claim";
  const activityKeys = Array.isArray(rule.activityKeys || rule.activity_keys)
    ? (rule.activityKeys || rule.activity_keys) as unknown[]
    : [];
  const cleanedActivityKeys = activityKeys
    .filter((key): key is string => typeof key === "string")
    .map(cleanText)
    .filter(Boolean);
  const sourceDiversity = rule.sourceDiversity || rule.source_diversity || rule.diversity;
  return {
    kind,
    activityKeys: cleanedActivityKeys.length ? [...new Set(cleanedActivityKeys)] : undefined,
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
  const day = slot
    ? context.conferenceDays.find((candidate) => candidate.id === slot.day && candidate.published)
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
    const context = await this.context();
    const existing = input.id ? this.requireDefinition("achievement", input.id, context) as GamificationAchievementRecord : undefined;
    await this.assertConfigurationOperationAvailable(GAMIFICATION_COLLECTIONS.achievements, existing?.id, input.operationId);
    if (existing?.status !== undefined && existing.status !== "draft") {
      throw new Error("Only draft Achievements can be edited. Retire used definitions and create successors.");
    }
    if (existing && await this.definitionHasAccounting("achievement", existing.id, context)) {
      throw new Error("This Achievement has Badge history. Retire it and create an audited successor instead.");
    }
    await this.validateSuccessor(input.successorOf, "achievement", context);
    if (context.achievements.some((achievement) => achievement.key === key && achievement.id !== existing?.id)) {
      throw new Error("Achievement key is already in use.");
    }
    const record = existing
      ? await this.store.update<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, existing.id, this.achievementBody(input, key, "draft"))
      : await this.store.create<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, this.achievementBody(input, key, "draft"));
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
    if (!key || !slug) throw new Error("Mission key and slug are required.");
    if (input.category === "easter_egg" || key.startsWith("easter_egg.")) {
      throw new Error("Configure Easter Egg Missions through the dedicated Easter Egg Mission operation.");
    }
    if (!isCategory(input.category) || !cleanText(input.title) || !cleanText(input.summary)) {
      throw new Error("Mission category, title, and summary are required.");
    }
    if (!Number.isInteger(input.sortOrder)) throw new Error("Mission sort order must be a whole number.");
    const context = await this.context();
    const existing = input.id ? this.requireDefinition("mission", input.id, context) as GamificationMissionRecord : undefined;
    if (existing?.category === "community" || key.startsWith("community.")) {
      throw new Error("Configure Community Partner programmes through the dedicated Community Partner operation.");
    }
    if (existing && configuredEventReference(existing.event_ref)) {
      throw new Error("Configured event Missions may only be changed through the dedicated event operation.");
    }
    await this.assertConfigurationOperationAvailable(GAMIFICATION_COLLECTIONS.missions, existing?.id, input.operationId);
    if (existing?.status !== undefined && existing.status !== "draft") {
      throw new Error("Only draft Missions can be edited. Retire used definitions and create successors.");
    }
    if (existing && await this.definitionHasAccounting("mission", existing.id, context)) {
      throw new Error("This Mission has accepted evidence. Retire it and create an audited successor instead.");
    }
    await this.validateSuccessor(input.successorOf, "mission", context);
    if (context.missions.some((mission) => mission.key === key && mission.id !== existing?.id)) {
      throw new Error("Mission key is already in use.");
    }
    if (context.missions.some((mission) => mission.slug === slug && mission.id !== existing?.id)) {
      throw new Error("Mission slug is already in use.");
    }
    const record = existing
      ? await this.store.update<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, existing.id, this.missionBody(input, key, slug, "draft"))
      : await this.store.create<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, this.missionBody(input, key, slug, "draft"));
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
    const key = cleanKey(input.key);
    if (!key || !isCategory(input.category) || !isActivityKind(input.kind) || !isEvidenceMode(input.evidenceMode)) {
      throw new Error("Activity key, category, kind, and evidence mode are required.");
    }
    if (!cleanText(input.outcomeKey) || !isPositiveInteger(input.perUserClaimLimit)) {
      throw new Error("Activity outcome and per-User claim limit are required.");
    }
    const context = await this.context();
    const existing = input.id ? this.requireDefinition("activity", input.id, context) as GamificationActivityRecord : undefined;
    await this.assertConfigurationOperationAvailable(GAMIFICATION_COLLECTIONS.activities, existing?.id, input.operationId);
    if (existing?.status !== undefined && existing.status !== "draft") {
      throw new Error("Only draft Activities can be edited. Retire used definitions and create successors.");
    }
    if (existing && await this.definitionHasAccounting("activity", existing.id, context)) {
      throw new Error("This Activity has accepted evidence. Retire it and create an audited successor instead.");
    }
    await this.validateSuccessor(input.successorOf, "activity", context);
    if (context.activities.some((activity) => activity.key === key && activity.id !== existing?.id)) {
      throw new Error("Activity key is already in use.");
    }
    const record = existing
      ? await this.store.update<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, existing.id, this.activityBody(input, key, "draft"))
      : await this.store.create<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, this.activityBody(input, key, "draft"));
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
    const sessionId = cleanText(input.sessionId);
    const sessionKey = cleanKey(input.sessionKey);
    const missionKey = `session.${sessionKey}`;
    const activityKey = `${missionKey}.attendance`;
    const missionTitle = cleanText(input.title);
    const missionSummary = cleanText(input.summary);
    const deploymentLabel = safeOperationalLabel(input.deploymentLabel);
    if (!sessionId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sessionKey)) {
      throw new Error("Choose a Session and provide an immutable lowercase Session key.");
    }
    if (!missionTitle || !missionSummary) {
      throw new Error("Session Mission title and summary are required.");
    }
    assertNoSecretText(missionTitle, "Session Mission title");
    assertNoSecretText(missionSummary, "Session Mission summary");
    if (!["public", "hidden_until_unlocked", "admin_only"].includes(input.visibility)) {
      throw new Error("Choose a valid Session Mission visibility.");
    }
    if (!isEvidenceChannel(input.evidenceChannel)) {
      throw new Error("Session Missions require a WTS-controlled deployment artifact and channel.");
    }
    if (!validDate(input.activeFrom) || !validDate(input.activeUntil) || Date.parse(input.activeFrom) >= Date.parse(input.activeUntil)) {
      throw new Error("Session Mission evidence requires a valid independent active window.");
    }
    if (input.perUserClaimLimit !== 1 || !isPositiveInteger(input.maxClaims)) {
      throw new Error("Session attendance supports one claim per User and requires a positive global claim limit.");
    }
    if (!isISODate(input.scoreDay)) throw new Error("Session scoring requires a configured conference score day.");
    if (!Number.isInteger(input.sortOrder)) throw new Error("Session Mission sort order must be a whole number.");

    const context = await this.context();
    const session = context.sessions.find((candidate) => candidate.id === sessionId);
    if (!session?.published) throw new Error("Choose an existing published Session.");
    const slug = `session-${sessionKey}`;
    const schedule = context.schedules.find((candidate) => candidate.id === cleanText(input.scoreScheduleId));
    if (!schedule || schedule.status !== "draft") throw new Error("Choose a draft score schedule for the Session policy.");
    const achievementId = cleanText(input.achievementId);
    if (achievementId) {
      const achievement = context.achievements.find((candidate) => candidate.id === achievementId);
      const rule = achievement && safeUnlockRule(achievement.unlock_rule);
      if (
        !achievement ||
        achievement.category !== "session" ||
        rule?.kind !== "activity_claim" ||
        ((rule.activityKeys?.length || 0) > 0 && !rule.activityKeys?.includes(activityKey))
      ) {
        throw new Error("A direct Session Badge must use a Session Activity-claim rule for this immutable Activity key.");
      }
    }

    const auditSummary = {
      definition: "session_attendance",
      sessionId,
      sessionKey,
      missionKey,
      activityKey,
      title: missionTitle,
      summary: missionSummary,
      visibility: input.visibility,
      evidenceChannel: input.evidenceChannel,
      deploymentLabel,
      activeFrom: input.activeFrom,
      activeUntil: input.activeUntil,
      maxClaims: input.maxClaims,
      achievementId: achievementId || undefined,
      metaEligible: Boolean(input.metaEligible),
      scoreScheduleId: schedule.id,
      scoreDay: input.scoreDay,
      sortOrder: input.sortOrder,
    };
    // The immutable Activity key is the durable operation target before an ID exists.
    const audit = await this.beginAudit(
      actor,
      "configuration_change",
      GAMIFICATION_COLLECTIONS.activities,
      activityKey,
      input.operationId,
      safeReason(input.reason),
      auditSummary,
    );
    const existingMission = context.missions.find((mission) => mission.key === missionKey);
    const existingActivity = context.activities.find((activity) => activity.key === activityKey);
    if (audit.replayed) {
      if (!existingMission || !existingActivity) throw new Error("The prior Session Mission configuration is incomplete. Contact an administrator.");
      return { mission: safeMission(existingMission), activity: safeActivity(existingActivity, context) };
    }
    if (audit.failed) await this.resumeAudit(audit.record.id);
    if (!audit.existing && (existingMission || existingActivity)) {
      await this.failAudit(audit.record.id);
      throw new Error("This immutable Session Mission key is already configured.");
    }
    if (
      (existingMission && (existingMission.session !== sessionId || existingMission.slug !== slug)) ||
      (existingActivity && (existingActivity.session !== sessionId || existingActivity.session_key !== sessionKey))
    ) {
      await this.failAudit(audit.record.id);
      throw new Error("The interrupted Session Mission configuration does not match this immutable Session source.");
    }
    if (context.activities.some((activity) =>
      activity.id !== existingActivity?.id &&
      activity.kind === "session" &&
      activity.session === sessionId &&
      activity.status !== "retired",
    )) {
      await this.failAudit(audit.record.id);
      throw new Error("This Session already has a configured attendance Activity. Retire it before creating an audited successor.");
    }
    if (context.missions.some((mission) => mission.id !== existingMission?.id && mission.slug === slug)) {
      await this.failAudit(audit.record.id);
      throw new Error("This Session Mission slug is already in use.");
    }

    try {
      const mission = existingMission || await this.store.create<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, {
        key: missionKey,
        slug,
        title: missionTitle,
        summary: missionSummary,
        category: "session",
        visibility: input.visibility,
        status: "draft",
        starts_at: input.activeFrom,
        ends_at: input.activeUntil,
        primary_achievement: achievementId,
        session: sessionId,
        suggested: input.visibility === "public",
        sort_order: input.sortOrder,
        metadata: { session_key: sessionKey },
      });
      const activity = existingActivity || await this.store.create<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, {
        key: activityKey,
        mission: mission.id,
        kind: "session",
        category: "session",
        outcome_key: "attendance",
        evidence_mode: "single_code",
        evidence_channel: input.evidenceChannel,
        deployment_label: deploymentLabel,
        achievement: achievementId,
        session: sessionId,
        session_key: sessionKey,
        session_display_snapshot: sessionDisplaySnapshot(session),
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
        scheduleId: schedule.id,
        policyKey: activityKey,
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
      await this.completeAudit(audit.record.id);
      const completedContext = await this.context();
      return { mission: safeMission(mission), activity: safeActivity(activity, completedContext) };
    } catch (error) {
      await this.failAudit(audit.record.id);
      throw error;
    }
  }

  /** Creates the canonical local-code inventory for one configured non-Session event. */
  async saveConfiguredEventMissionDraft(
    input: AdminConfiguredEventMissionDraftInput,
    actor: AdminOperationActor,
  ): Promise<{ mission: AdminMissionDto; activities: AdminActivityDto[] }> {
    assertNoSecretInput(input, "Event Mission configuration");
    const eventKey = cleanKey(input.eventKey);
    const title = cleanText(input.title);
    const missionTitle = cleanText(input.missionTitle);
    const summary = cleanText(input.summary);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eventKey) || !isConfiguredEventKind(input.kind)) {
      throw new Error("Provide an immutable lowercase event key and supported event kind.");
    }
    if (!title || !missionTitle || !summary) throw new Error("Event title, Mission title, and summary are required.");
    assertNoSecretText(title, "Event title");
    assertNoSecretText(missionTitle, "Event Mission title");
    assertNoSecretText(summary, "Event Mission summary");
    if (!["public", "hidden_until_unlocked", "admin_only"].includes(input.visibility)) {
      throw new Error("Choose a valid event Mission visibility.");
    }
    if (input.flow !== "one_code" && input.flow !== "two_code") throw new Error("Choose one-code attendance or two-code completion.");
    if (input.flow === "two_code" && input.kind !== "workshop" && !input.relatedEventTwoCodeApproved) {
      throw new Error("Two-code completion outside workshops requires explicit organizer approval.");
    }
    if (!isEvidenceChannel(input.evidenceChannel)) {
      throw new Error("Configured events require a WTS-controlled QR, link, or manual-code artifact.");
    }
    const attendanceDeploymentLabel = safeOperationalLabel(input.attendanceDeploymentLabel);
    const finishDeploymentLabel = input.flow === "two_code" ? safeOperationalLabel(input.finishDeploymentLabel) : undefined;
    if (!validDate(input.activeFrom) || !validDate(input.activeUntil) || Date.parse(input.activeFrom) >= Date.parse(input.activeUntil)) {
      throw new Error("Configured events require a valid independent operating window.");
    }
    if (input.perUserClaimLimit !== 1 || !isPositiveInteger(input.maxClaims)) {
      throw new Error("Configured events support one claim per Activity and require a positive global claim limit.");
    }
    if (!isISODate(input.scoreDay)) throw new Error("Configured event scoring requires a score day.");
    if (!Number.isInteger(input.sortOrder)) throw new Error("Event Mission sort order must be a whole number.");

    const context = await this.context();
    const schedule = context.schedules.find((candidate) => candidate.id === cleanText(input.scoreScheduleId));
    if (!schedule || schedule.status !== "draft") throw new Error("Choose a draft score schedule for the configured event.");
    const hostPartnerId = cleanText(input.hostPartnerId);
    if (hostPartnerId && !context.partners.some((partner) => partner.id === hostPartnerId)) {
      throw new Error("Choose an existing host partner or leave host attribution empty for a WTS-run event.");
    }
    const missionKey = configuredEventMissionKey(input.kind, eventKey);
    const capGroupKey = cleanKey(input.capGroupKey);
    if (!capGroupKey) throw new Error("Configured events require an organizer-supplied cap group key.");
    const slug = `${input.kind}-${eventKey}`;
    const attendanceKey = `${missionKey}.${input.flow === "one_code" ? "attendance" : "start"}`;
    const finishKey = `${missionKey}.finish`;
    const completionKey = `${missionKey}.completion`;
    const category = configuredEventCategory(input.kind);
    const activityKind = configuredEventActivityKind(input.kind);
    const attendanceAchievement = cleanText(input.attendanceAchievementId)
      ? context.achievements.find((achievement) => achievement.id === cleanText(input.attendanceAchievementId))
      : undefined;
    if (cleanText(input.attendanceAchievementId) && !attendanceAchievement) throw new Error("Choose an existing attendance Badge.");
    if (attendanceAchievement) {
      const rule = safeUnlockRule(attendanceAchievement.unlock_rule);
      if (
        attendanceAchievement.category !== category ||
        rule.kind !== "activity_claim" ||
        ((rule.activityKeys?.length || 0) > 0 && !rule.activityKeys?.includes(attendanceKey))
      ) {
        throw new Error("The attendance Badge must use this event's direct Activity-claim rule.");
      }
    }
    const completionAchievement = input.flow === "two_code" && cleanText(input.completionAchievementId)
      ? context.achievements.find((achievement) => achievement.id === cleanText(input.completionAchievementId))
      : undefined;
    if (input.flow === "two_code") {
      const rule = completionAchievement && safeUnlockRule(completionAchievement.unlock_rule);
      if (
        !completionAchievement ||
        completionAchievement.category !== category ||
        rule?.kind !== "claim_set" ||
        JSON.stringify([...(rule.activityKeys || [])].sort()) !== JSON.stringify([finishKey, attendanceKey].sort())
      ) {
        throw new Error("Two-code completion requires a Badge with the exact configured start-and-finish claim set.");
      }
    }

    const eventRef: ConfiguredEventReference = {
      eventKey,
      kind: input.kind,
      title,
      startsAt: input.activeFrom,
      endsAt: input.activeUntil,
      visibility: input.visibility,
      locationLabel: cleanOptionalText(input.locationLabel),
    };
    const activityKeys = input.flow === "one_code"
      ? [attendanceKey]
      : [attendanceKey, finishKey, completionKey];
    const audit = await this.beginAudit(
      actor,
      "configuration_change",
      GAMIFICATION_COLLECTIONS.activities,
      missionKey,
      input.operationId,
      safeReason(input.reason),
      {
        definition: "configured_event",
        eventRef,
        missionKey,
        activityKeys,
        flow: input.flow,
        hostPartnerId: hostPartnerId || undefined,
        capGroupKey,
        metaEligible: Boolean(input.metaEligible),
        scoreScheduleId: schedule.id,
        scoreDay: input.scoreDay,
        request: {
          title,
          missionTitle,
          summary,
          visibility: input.visibility,
          locationLabel: cleanOptionalText(input.locationLabel),
          hostPartnerId: hostPartnerId || undefined,
          relatedEventTwoCodeApproved: Boolean(input.relatedEventTwoCodeApproved),
          suggested: Boolean(input.suggested),
          evidenceChannel: input.evidenceChannel,
          attendanceDeploymentLabel,
          finishDeploymentLabel: finishDeploymentLabel || undefined,
          activeFrom: input.activeFrom,
          activeUntil: input.activeUntil,
          perUserClaimLimit: input.perUserClaimLimit,
          maxClaims: input.maxClaims,
          attendanceAchievementId: attendanceAchievement?.id,
          completionAchievementId: completionAchievement?.id,
          sortOrder: input.sortOrder,
        },
      },
    );
    const existingMission = context.missions.find((mission) => mission.key === missionKey);
    const existingActivities = context.activities.filter((activity) => activityKeys.includes(activity.key));
    if (audit.replayed) {
      if (!existingMission || existingActivities.length !== activityKeys.length) {
        throw new Error("The prior configured event operation is incomplete. Contact an administrator.");
      }
      return {
        mission: safeMission(existingMission),
        activities: existingActivities.map((activity) => safeActivity(activity, context)),
      };
    }
    if (audit.failed) await this.resumeAudit(audit.record.id);
    if (!audit.existing && (existingMission || existingActivities.length > 0)) {
      await this.failAudit(audit.record.id);
      throw new Error("This immutable event key is already configured.");
    }
    if (
      (existingMission && (!sameConfiguredEventReference(existingMission.event_ref, eventRef) || existingMission.slug !== slug)) ||
      existingActivities.some((activity) => !sameConfiguredEventReference(activity.event_ref, eventRef))
    ) {
      await this.failAudit(audit.record.id);
      throw new Error("The interrupted event configuration does not match this immutable event reference.");
    }

    try {
      const mission = existingMission || await this.store.create<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, {
        key: missionKey,
        slug,
        title: missionTitle,
        summary,
        category,
        visibility: input.visibility,
        status: "draft",
        starts_at: input.activeFrom,
        ends_at: input.activeUntil,
        primary_achievement: "",
        partner: hostPartnerId,
        partner_key: "",
        event_ref: eventRef,
        suggested: input.visibility === "public" && Boolean(input.suggested),
        sort_order: input.sortOrder,
        metadata: {
          cap_group_key: capGroupKey,
          related_event_two_code_approved: input.kind !== "workshop" && input.flow === "two_code",
        },
      });
      const definitions = input.flow === "one_code"
        ? [{
            key: attendanceKey,
            outcome: "attendance",
            evidenceMode: "single_code" as EvidenceMode,
            deploymentLabel: attendanceDeploymentLabel,
            achievement: attendanceAchievement?.id,
            metaEligible: Boolean(input.metaEligible),
            score: { totalXp: 30, leaderboardXp: 25 },
          }]
        : [
            {
              key: attendanceKey,
              outcome: "attendance",
              evidenceMode: "two_code_start" as EvidenceMode,
              deploymentLabel: attendanceDeploymentLabel,
              achievement: attendanceAchievement?.id,
              metaEligible: false,
              score: { totalXp: 10, leaderboardXp: 5 },
            },
            {
              key: finishKey,
              outcome: "completion",
              evidenceMode: "two_code_finish" as EvidenceMode,
              deploymentLabel: finishDeploymentLabel,
              achievement: undefined,
              metaEligible: false,
              score: { totalXp: 0, leaderboardXp: 0 },
            },
            {
              key: completionKey,
              outcome: "completion",
              evidenceMode: "derived_claim_set" as EvidenceMode,
              deploymentLabel: undefined,
              achievement: completionAchievement?.id,
              metaEligible: Boolean(input.metaEligible),
              score: { totalXp: 30, leaderboardXp: 25 },
            },
          ];
      const activities: GamificationActivityRecord[] = [];
      for (const definition of definitions) {
        const existing = existingActivities.find((activity) => activity.key === definition.key);
        const activity = existing || await this.store.create<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, {
          key: definition.key,
          mission: mission.id,
          kind: activityKind,
          category,
          outcome_key: definition.outcome,
          evidence_mode: definition.evidenceMode,
          evidence_channel: definition.evidenceMode === "derived_claim_set" ? "" : input.evidenceChannel,
          deployment_label: definition.deploymentLabel || "",
          achievement: definition.achievement || "",
          partner: hostPartnerId,
          partner_kind: hostPartnerId ? "workshop_host" : "",
          event_ref: eventRef,
          event_meta_eligible: definition.metaEligible,
          per_user_claim_limit: 1,
          max_claims: input.maxClaims,
          active_from: input.activeFrom,
          active_until: input.activeUntil,
          status: "draft",
          enabled: true,
          metadata: { cap_group_key: capGroupKey },
        });
        activities.push(activity);
        await this.saveScorePolicy(activity, {
          scheduleId: schedule.id,
          policyKey: definition.key,
          enabled: true,
          totalXp: definition.score.totalXp,
          leaderboardXp: definition.score.leaderboardXp,
          capMembership: [
            { dimension: "activity", key: activity.id },
            { dimension: "related_group", key: capGroupKey },
            { dimension: "category", key: category },
            { dimension: "conference_day", key: input.scoreDay },
            { dimension: "conference", key: "conference" },
          ],
          capCeilingOverrides: {
            related_group: {
              total_xp_ceiling: input.flow === "one_code" ? 30 : 40,
              leaderboard_xp_ceiling: input.flow === "one_code" ? 25 : 30,
            },
          },
          scoreDay: input.scoreDay,
        }, context);
      }
      await this.completeAudit(audit.record.id);
      const completedContext = await this.context();
      return {
        mission: safeMission(mission),
        activities: activities.map((activity) => safeActivity(activity, completedContext)),
      };
    } catch (error) {
      await this.failAudit(audit.record.id);
      throw error;
    }
  }

  /** Creates one canonical Community Partner programme without deriving classification from public partner data. */
  async saveCommunityPartnerMissionDraft(
    input: AdminCommunityPartnerMissionDraftInput,
    actor: AdminOperationActor,
  ): Promise<{ mission: AdminMissionDto; activities: AdminActivityDto[] }> {
    assertNoSecretInput(input, "Community Partner Mission configuration");
    const partnerId = cleanText(input.partnerId);
    const partnerKey = cleanKey(input.partnerKey);
    const programmeKey = cleanKey(input.activityKey);
    if (
      !partnerId ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(partnerKey) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(programmeKey)
    ) {
      throw new Error("Choose an existing partner and provide immutable lowercase partner and programme keys.");
    }
    const missionTitle = cleanText(input.missionTitle);
    const summary = cleanText(input.summary);
    if (!missionTitle || !summary) throw new Error("Community Partner Mission title and summary are required.");
    assertNoSecretText(missionTitle, "Community Partner Mission title");
    assertNoSecretText(summary, "Community Partner Mission summary");
    if (!["public", "hidden_until_unlocked", "admin_only"].includes(input.visibility)) {
      throw new Error("Choose a valid Community Partner Mission visibility.");
    }
    if (input.flow !== "one_code" && input.flow !== "two_code") throw new Error("Choose a one-code or explicitly approved two-code programme.");
    const selectedOutcomes = input.flow === "one_code" && Array.isArray(input.outcomes) ? input.outcomes : [];
    if (
      input.flow === "one_code" &&
      (selectedOutcomes.length < 1 || selectedOutcomes.length > 3 ||
        selectedOutcomes.some((definition) => !isCommunityPartnerOutcome(definition.outcome)) ||
        !uniqueKeys(selectedOutcomes.map((definition) => definition.outcome)))
    ) {
      throw new Error("Choose each Community Partner attendance, participation, or completion outcome at most once.");
    }
    if (selectedOutcomes.filter((definition) => definition.metaEligible).length > 1) {
      throw new Error("At most one qualifying Activity per Community Partner programme may register with Meta rules.");
    }
    if (selectedOutcomes.some((definition) => definition.partnerFollowUp.enabled && !cleanText(definition.partnerFollowUp.noticeVersion))) {
      throw new Error("Enabled Community Partner follow-up requires a notice version.");
    }
    if (input.flow === "two_code" && !input.communityTwoCodeApproved) {
      throw new Error("Community Partner two-code completion requires explicit organizer approval.");
    }
    if (!isEvidenceChannel(input.evidenceChannel)) {
      throw new Error("Community Partner Activities require a WTS-controlled QR, link, manual, or static-code artifact.");
    }
    const primaryDeploymentLabel = input.flow === "two_code" ? safeOperationalLabel(input.primaryDeploymentLabel) : undefined;
    const outcomeDeploymentLabels = new Map(selectedOutcomes.map((definition) => [definition.outcome, safeOperationalLabel(definition.deploymentLabel)]));
    const finishDeploymentLabel = input.flow === "two_code" ? safeOperationalLabel(input.finishDeploymentLabel) : undefined;
    if (!validDate(input.activeFrom) || !validDate(input.activeUntil) || Date.parse(input.activeFrom) >= Date.parse(input.activeUntil)) {
      throw new Error("Community Partner programmes require a valid independent operating window.");
    }
    if (input.perUserClaimLimit !== 1 || !isPositiveInteger(input.maxClaims)) {
      throw new Error("Community Partner Activities support one claim per User and require a positive global claim limit.");
    }
    if (!isISODate(input.scoreDay)) throw new Error("Community Partner scoring requires a score day.");
    if (!Number.isInteger(input.sortOrder)) throw new Error("Community Partner Mission sort order must be a whole number.");
    if (input.flow === "two_code" && input.partnerFollowUp.enabled && !cleanText(input.partnerFollowUp.noticeVersion)) {
      throw new Error("Enabled Community Partner follow-up requires a notice version.");
    }

    const context = await this.context();
    // Public partner type/tier is intentionally not consulted here.
    if (!context.partners.some((partner) => partner.id === partnerId)) throw new Error("Choose an existing Community Partner record.");
    const schedule = context.schedules.find((candidate) => candidate.id === cleanText(input.scoreScheduleId));
    if (!schedule || schedule.status !== "draft") throw new Error("Choose a draft score schedule for the Community Partner programme.");
    const missionKey = communityPartnerMissionKey(partnerKey, programmeKey);
    const slug = `community-${partnerKey}-${programmeKey}`;
    const directKey = communityPartnerActivityKey(missionKey, "start");
    const finishKey = communityPartnerActivityKey(missionKey, "finish");
    const completionKey = communityPartnerActivityKey(missionKey, "completion");
    const directAchievement = input.flow === "two_code" && cleanText(input.directAchievementId)
      ? context.achievements.find((achievement) => achievement.id === cleanText(input.directAchievementId))
      : undefined;
    if (input.flow === "two_code" && (!directAchievement || directAchievement.category !== "community")) {
      throw new Error("Community Partner programmes require a distinct Community Badge for their direct Activity.");
    }
    const directRule = directAchievement && safeUnlockRule(directAchievement.unlock_rule);
    if (input.flow === "two_code" && (directRule?.kind !== "activity_claim" || ((directRule.activityKeys?.length || 0) > 0 && !directRule.activityKeys?.includes(directKey)))) {
      throw new Error("The direct Community Badge must use this programme's Activity-claim rule.");
    }
    const oneCodeDefinitions = selectedOutcomes.map((definition) => {
      const key = communityPartnerActivityKey(missionKey, definition.outcome);
      const achievement = context.achievements.find((candidate) => candidate.id === cleanText(definition.achievementId));
      const rule = achievement && safeUnlockRule(achievement.unlock_rule);
      if (
        !achievement ||
        achievement.category !== "community" ||
        rule?.kind !== "activity_claim" ||
        ((rule.activityKeys?.length || 0) > 0 && !rule.activityKeys?.includes(key))
      ) {
        throw new Error(`The ${definition.outcome} Community Badge must use that outcome's direct Activity-claim rule.`);
      }
      return { ...definition, key, achievement };
    });
    const completionAchievement = input.flow === "two_code" && cleanText(input.completionAchievementId)
      ? context.achievements.find((achievement) => achievement.id === cleanText(input.completionAchievementId))
      : undefined;
    if (input.flow === "two_code") {
      const rule = completionAchievement && safeUnlockRule(completionAchievement.unlock_rule);
      if (
        !completionAchievement ||
        completionAchievement.category !== "community" ||
        rule?.kind !== "claim_set" ||
        JSON.stringify([...(rule.activityKeys || [])].sort()) !== JSON.stringify([directKey, finishKey].sort())
      ) {
        throw new Error("Community Partner two-code completion requires a distinct Badge with the exact start-and-finish claim set.");
      }
    }
    const activityKeys = input.flow === "one_code" ? oneCodeDefinitions.map((definition) => definition.key) : [directKey, finishKey, completionKey];
    const audit = await this.beginAudit(
      actor,
      "configuration_change",
      GAMIFICATION_COLLECTIONS.activities,
      missionKey,
      input.operationId,
      safeReason(input.reason),
      {
        definition: "community_partner_programme",
        partnerId,
        partnerKey,
        missionKey,
        activityKeys,
        flow: input.flow,
        outcomes: input.flow === "one_code" ? oneCodeDefinitions.map((definition) => definition.outcome) : ["completion"],
        metaEligible: input.flow === "one_code" ? oneCodeDefinitions.some((definition) => definition.metaEligible) : Boolean(input.metaEligible),
        scoreScheduleId: schedule.id,
        scoreDay: input.scoreDay,
        request: {
          missionTitle,
          summary,
          visibility: input.visibility,
          suggested: Boolean(input.suggested),
          communityTwoCodeApproved: Boolean(input.communityTwoCodeApproved),
          evidenceChannel: input.evidenceChannel,
          primaryDeploymentLabel: primaryDeploymentLabel || undefined,
          finishDeploymentLabel: finishDeploymentLabel || undefined,
          activeFrom: input.activeFrom,
          activeUntil: input.activeUntil,
          perUserClaimLimit: input.perUserClaimLimit,
          maxClaims: input.maxClaims,
          directAchievementId: directAchievement?.id,
          completionAchievementId: completionAchievement?.id,
          partnerFollowUp: input.partnerFollowUp,
          outcomes: oneCodeDefinitions.map((definition) => ({
            outcome: definition.outcome,
            deploymentLabel: cleanText(definition.deploymentLabel),
            achievementId: definition.achievement.id,
            metaEligible: Boolean(definition.metaEligible),
            partnerFollowUp: definition.partnerFollowUp,
          })),
          sortOrder: input.sortOrder,
        },
      },
    );
    const existingMission = context.missions.find((mission) => mission.key === missionKey);
    const existingActivities = context.activities.filter((activity) => activityKeys.includes(activity.key));
    if (audit.replayed) {
      if (!existingMission || existingActivities.length !== activityKeys.length) {
        throw new Error("The prior Community Partner configuration is incomplete. Contact an administrator.");
      }
      return { mission: safeMission(existingMission), activities: existingActivities.map((activity) => safeActivity(activity, context)) };
    }
    if (audit.failed) await this.resumeAudit(audit.record.id);
    if (!audit.existing && (existingMission || existingActivities.length > 0)) {
      await this.failAudit(audit.record.id);
      throw new Error("This immutable Community Partner programme key is already configured.");
    }
    if (
      (existingMission && (existingMission.partner !== partnerId || existingMission.partner_key !== partnerKey || existingMission.slug !== slug)) ||
      existingActivities.some((activity) => activity.partner !== partnerId || activity.mission !== existingMission?.id)
    ) {
      await this.failAudit(audit.record.id);
      throw new Error("The interrupted Community Partner configuration does not match this immutable partner programme.");
    }

    try {
      const mission = existingMission || await this.store.create<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, {
        key: missionKey,
        slug,
        title: missionTitle,
        summary,
        category: "community",
        visibility: input.visibility,
        status: "draft",
        starts_at: input.activeFrom,
        ends_at: input.activeUntil,
        primary_achievement: "",
        partner: partnerId,
        partner_key: partnerKey,
        suggested: input.visibility === "public" && Boolean(input.suggested),
        sort_order: input.sortOrder,
        metadata: {
          community_programme: true,
          community_two_code_approved: input.flow === "two_code",
          cap_group_key: missionKey,
        },
      });
      const oneCodeCeiling = oneCodeDefinitions.reduce(
        (ceiling, definition) => ({
          totalXp: Math.max(ceiling.totalXp, COMMUNITY_PARTNER_SCORE_BANDS[definition.outcome].totalXp),
          leaderboardXp: Math.max(ceiling.leaderboardXp, COMMUNITY_PARTNER_SCORE_BANDS[definition.outcome].leaderboardXp),
        }),
        { totalXp: 0, leaderboardXp: 0 },
      );
      const definitions = input.flow === "one_code"
        ? oneCodeDefinitions.map((definition) => ({
            key: definition.key,
            outcome: definition.outcome,
            evidenceMode: "single_code" as EvidenceMode,
            deploymentLabel: outcomeDeploymentLabels.get(definition.outcome),
            achievement: definition.achievement.id,
            metaEligible: Boolean(definition.metaEligible),
            followUp: definition.partnerFollowUp,
            score: COMMUNITY_PARTNER_SCORE_BANDS[definition.outcome],
          }))
        : [
            {
              key: directKey,
              outcome: "attendance",
              evidenceMode: "two_code_start" as EvidenceMode,
              deploymentLabel: primaryDeploymentLabel,
              achievement: directAchievement!.id,
              metaEligible: false,
              followUp: { enabled: false },
              score: { totalXp: 10, leaderboardXp: 5 },
            },
            {
              key: finishKey,
              outcome: "completion",
              evidenceMode: "two_code_finish" as EvidenceMode,
              deploymentLabel: finishDeploymentLabel,
              achievement: undefined,
              metaEligible: false,
              followUp: { enabled: false },
              score: { totalXp: 0, leaderboardXp: 0 },
            },
            {
              key: completionKey,
              outcome: "completion",
              evidenceMode: "derived_claim_set" as EvidenceMode,
              deploymentLabel: undefined,
              achievement: completionAchievement!.id,
              metaEligible: Boolean(input.metaEligible),
              followUp: input.partnerFollowUp,
              score: COMMUNITY_PARTNER_SCORE_BANDS.completion,
            },
          ];
      const activities: GamificationActivityRecord[] = [];
      for (const definition of definitions) {
        const existing = existingActivities.find((activity) => activity.key === definition.key);
        const activity = existing || await this.store.create<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, {
          key: definition.key,
          mission: mission.id,
          kind: "community_partner",
          category: "community",
          outcome_key: definition.outcome,
          evidence_mode: definition.evidenceMode,
          evidence_channel: definition.evidenceMode === "derived_claim_set" ? "" : input.evidenceChannel,
          deployment_label: definition.deploymentLabel || "",
          achievement: definition.achievement || "",
          partner: partnerId,
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
          metadata: {
            community_programme: true,
            community_two_code_approved: input.flow === "two_code",
            cap_group_key: missionKey,
          },
        });
        activities.push(activity);
        await this.saveScorePolicy(activity, {
          scheduleId: schedule.id,
          policyKey: definition.key,
          enabled: true,
          totalXp: definition.score.totalXp,
          leaderboardXp: definition.score.leaderboardXp,
          capMembership: [
            { dimension: "activity", key: activity.id },
            { dimension: "related_group", key: missionKey },
            { dimension: "partner", key: partnerId },
            { dimension: "category", key: "community" },
            { dimension: "conference_day", key: input.scoreDay },
            { dimension: "conference", key: "conference" },
          ],
          capCeilingOverrides: {
            related_group: {
              total_xp_ceiling: input.flow === "two_code" ? 40 : oneCodeCeiling.totalXp,
              leaderboard_xp_ceiling: input.flow === "two_code" ? 30 : oneCodeCeiling.leaderboardXp,
            },
          },
          scoreDay: input.scoreDay,
        }, await this.context());
      }
      await this.completeAudit(audit.record.id);
      const completedContext = await this.context();
      return { mission: safeMission(mission), activities: activities.map((activity) => safeActivity(activity, completedContext)) };
    } catch (error) {
      await this.failAudit(audit.record.id);
      throw error;
    }
  }

  /** Creates the only supported September easter-egg inventory shape. */
  async saveEasterEggMissionDraft(
    input: AdminEasterEggMissionDraftInput,
    actor: AdminOperationActor,
  ): Promise<{ achievement: AdminAchievementDto; mission: AdminMissionDto; activity: AdminActivityDto }> {
    const eggKey = cleanKey(input.eggKey);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eggKey)) {
      throw new Error("Provide an immutable lowercase easter egg key without discovery details.");
    }
    const missionKey = `easter_egg.${eggKey}`;
    const activityKey = `${missionKey}.discovery`;
    const missionTitle = cleanText(input.missionTitle);
    const missionSummary = cleanText(input.missionSummary);
    const badgeName = cleanText(input.badgeName);
    const badgeDescription = cleanText(input.badgeDescription);
    if (!missionTitle || !missionSummary || !badgeName || !badgeDescription) {
      throw new Error("Easter egg Mission and spoiler-safe post-unlock Badge copy are required.");
    }
    assertNoSecretText(missionTitle, "Easter egg Mission titles");
    assertNoSecretText(missionSummary, "Easter egg Mission summaries");
    assertNoSecretText(badgeName, "Easter egg Badge names");
    assertNoSecretText(badgeDescription, "Easter egg Badge descriptions");
    assertNoSecretText(cleanText(input.badgeIcon), "Easter egg Badge icons");
    if (!(["common", "uncommon", "rare", "epic", "legendary"] as string[]).includes(input.badgeRarity)) {
      throw new Error("Choose a valid Easter Egg Badge rarity.");
    }
    if (!(["wts_qr", "wts_link", "wts_manual_code"] as string[]).includes(input.evidenceChannel)) {
      throw new Error("Easter egg discovery requires a WTS-controlled static QR, fragment link, or manually entered code.");
    }
    const deploymentNote = safeDiscoveryDeploymentNote(input.deploymentNote);
    if (!validDate(input.activeFrom) || !validDate(input.activeUntil) || Date.parse(input.activeFrom) >= Date.parse(input.activeUntil)) {
      throw new Error("Easter egg discovery requires a valid active start and end window.");
    }
    if (!isPositiveInteger(input.maxClaims)) {
      throw new Error("Easter egg discovery requires a positive global claim limit.");
    }
    if (!Number.isInteger(input.sortOrder)) throw new Error("Easter egg Mission sort order must be a whole number.");

    const context = await this.context();
    const schedule = context.schedules.find((candidate) => candidate.id === cleanText(input.scoreScheduleId));
    if (!schedule || schedule.status !== "draft") throw new Error("Choose a draft score schedule for the Easter Egg discovery policy.");
    const existingAchievement = context.achievements.find((achievement) => achievement.key === missionKey);
    const existingMission = context.missions.find((mission) => mission.key === missionKey);
    const existingActivity = context.activities.find((activity) => activity.key === activityKey);
    const audit = await this.beginAudit(
      actor,
      "configuration_change",
      GAMIFICATION_COLLECTIONS.activities,
      activityKey,
      input.operationId,
      safeReason(input.reason),
      {
        definition: "easter_egg_discovery",
        missionKey,
        activityKey,
        missionTitle,
        missionSummary,
        badgeName,
        badgeDescription,
        badgeIcon: cleanOptionalText(input.badgeIcon),
        badgeRarity: input.badgeRarity,
        evidenceChannel: input.evidenceChannel,
        deploymentNote,
        activeFrom: input.activeFrom,
        activeUntil: input.activeUntil,
        maxClaims: input.maxClaims,
        scoreScheduleId: schedule.id,
        sortOrder: input.sortOrder,
      },
    );
    if (audit.replayed) {
      if (!existingAchievement || !existingMission || !existingActivity) {
        throw new Error("The prior Easter Egg Mission configuration is incomplete. Contact an administrator.");
      }
      return {
        achievement: safeAchievement(existingAchievement),
        mission: safeMission(existingMission),
        activity: safeActivity(existingActivity, context),
      };
    }
    if (audit.failed) await this.resumeAudit(audit.record.id);
    if (!audit.existing && (existingAchievement || existingMission || existingActivity)) {
      await this.failAudit(audit.record.id);
      throw new Error("This immutable Easter Egg Mission key is already configured.");
    }
    if (
      (existingAchievement && (
        existingAchievement.category !== "easter_egg" ||
        existingAchievement.visibility !== "hidden_until_unlocked" ||
        safeUnlockRule(existingAchievement.unlock_rule).kind !== "activity_claim"
      )) ||
      (existingMission && (
        existingMission.category !== "easter_egg" ||
        existingMission.visibility !== "hidden_until_unlocked" ||
        existingMission.suggested ||
        existingMission.partner ||
        existingMission.session ||
        safeEventRef(existingMission.event_ref)
      )) ||
      (existingActivity && (
        existingActivity.kind !== "easter_egg" ||
        existingActivity.category !== "easter_egg" ||
        existingActivity.outcome_key !== "static_discovery" ||
        existingActivity.evidence_mode !== "static_puzzle_code"
      ))
    ) {
      await this.failAudit(audit.record.id);
      throw new Error("The interrupted Easter Egg configuration does not match the canonical hidden static-discovery shape.");
    }

    try {
      const achievement = existingAchievement || await this.store.create<GamificationAchievementRecord>(GAMIFICATION_COLLECTIONS.achievements, {
        key: missionKey,
        badge_name: badgeName,
        badge_description: badgeDescription,
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
      const mission = existingMission || await this.store.create<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, {
        key: missionKey,
        slug: `easter-egg-${eggKey}`,
        title: missionTitle,
        summary: missionSummary,
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
      const activity = existingActivity || await this.store.create<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, {
        key: activityKey,
        mission: mission.id,
        kind: "easter_egg",
        category: "easter_egg",
        outcome_key: "static_discovery",
        evidence_mode: "static_puzzle_code",
        evidence_channel: input.evidenceChannel,
        deployment_label: deploymentNote,
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
        policyKey: activityKey,
        enabled: true,
        totalXp: 10,
        leaderboardXp: 0,
        capMembership: [
          { dimension: "activity", key: activity.id },
          { dimension: "category", key: "easter_egg" },
          { dimension: "conference", key: "conference" },
        ],
      }, await this.context());
      await this.completeAudit(audit.record.id);
      const completedContext = await this.context();
      return {
        achievement: safeAchievement(achievement),
        mission: safeMission(mission),
        activity: safeActivity(activity, completedContext),
      };
    } catch (error) {
      await this.failAudit(audit.record.id);
      throw error;
    }
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
      const policies = this.activePoliciesForSchedule(schedule.id, context);
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

  async generateCodes(input: AdminCodeGenerationInput, actor: AdminOperationActor): Promise<AdminCodeBatchResult> {
    return withGamificationLocks(this.store, [`code-operation:${operationId(input.operationId)}`], () =>
      this.generateCodesNow(input, actor)
    );
  }

  private async generateCodesNow(input: AdminCodeGenerationInput, actor: AdminOperationActor): Promise<AdminCodeBatchResult> {
    const config = this.validateCodeGenerationInput(input);
    const context = await this.context();
    const activity = context.activities.find((candidate) => candidate.id === config.activityId);
    if (!activity || activity.status !== "active" || !activity.enabled) throw new Error("Choose an active enabled Activity.");
    if (isConfiguredEventActivityKind(activity.kind) && configuredEventReference(activity.event_ref)) {
      const mission = activity.mission ? context.missions.find((candidate) => candidate.id === activity.mission) : undefined;
      if (!mission || mission.status !== "active") {
        throw new Error("Activate the configured event Mission before generating its codes.");
      }
      const eventActivities = context.activities.filter((candidate) =>
        candidate.mission === activity.mission && isConfiguredEventActivityKind(candidate.kind) && candidate.status !== "retired",
      );
      if (eventActivities.some((candidate) => candidate.status !== "active" || !candidate.enabled)) {
        throw new Error("Activate every Activity in the configured event flow before generating its codes.");
      }
      const linkedAchievements = eventActivities
        .flatMap((candidate) => candidate.achievement ? [context.achievements.find((achievement) => achievement.id === candidate.achievement)] : [])
        .filter((achievement): achievement is GamificationAchievementRecord => Boolean(achievement));
      if (linkedAchievements.some((achievement) => achievement.status !== "active")) {
        throw new Error("Activate every linked configured event Badge before generating its codes.");
      }
      const scorePolicy = context.policies.find((policy) => policy.activity === activity.id && policy.active);
      const scoreSchedule = scorePolicy
        ? context.schedules.find((schedule) => schedule.id === scorePolicy.schedule)
        : undefined;
      if (!scorePolicy || scoreSchedule?.status !== "active" || Date.parse(scoreSchedule.effective_at) > Date.parse(config.startsAt)) {
        throw new Error("Activate an applicable configured event score schedule before generating codes.");
      }
    }
    if (activity.kind === "community_partner") {
      const mission = activity.mission ? context.missions.find((candidate) => candidate.id === activity.mission) : undefined;
      if (!mission || mission.status !== "active") {
        throw new Error("Activate the Community Partner Mission before generating its codes.");
      }
      const programmeActivities = context.activities.filter((candidate) =>
        candidate.mission === mission.id && candidate.kind === "community_partner" && candidate.status !== "retired",
      );
      if (programmeActivities.some((candidate) => candidate.status !== "active" || !candidate.enabled)) {
        throw new Error("Activate every Activity in the Community Partner programme before generating its codes.");
      }
      const linkedAchievements = programmeActivities
        .flatMap((candidate) => candidate.achievement ? [context.achievements.find((achievement) => achievement.id === candidate.achievement)] : [])
        .filter((achievement): achievement is GamificationAchievementRecord => Boolean(achievement));
      if (linkedAchievements.some((achievement) => achievement.status !== "active")) {
        throw new Error("Activate every linked Community Partner Badge before generating its codes.");
      }
      const scorePolicy = context.policies.find((policy) => policy.activity === activity.id && policy.active);
      const scoreSchedule = scorePolicy ? context.schedules.find((schedule) => schedule.id === scorePolicy.schedule) : undefined;
      if (!scorePolicy || scoreSchedule?.status !== "active" || Date.parse(scoreSchedule.effective_at) > Date.parse(config.startsAt)) {
        throw new Error("Activate an applicable Community Partner score schedule before generating codes.");
      }
    }
    if (activity.kind === "easter_egg" || activity.category === "easter_egg") {
      const mission = activity.mission ? context.missions.find((candidate) => candidate.id === activity.mission) : undefined;
      const achievement = activity.achievement ? context.achievements.find((candidate) => candidate.id === activity.achievement) : undefined;
      const validationErrors = this.validateEasterEggActivity(activity, mission, context);
      if (validationErrors.length > 0 || mission?.status !== "active" || achievement?.status !== "active") {
        throw new Error(validationErrors.join(" ") || "Activate the canonical hidden Easter Egg Mission and Badge before generating codes.");
      }
      const scorePolicy = context.policies.find((policy) => policy.activity === activity.id && policy.active);
      const scoreSchedule = scorePolicy ? context.schedules.find((schedule) => schedule.id === scorePolicy.schedule) : undefined;
      if (!scorePolicy || scoreSchedule?.status !== "active" || Date.parse(scoreSchedule.effective_at) > Date.parse(config.startsAt)) {
        throw new Error("Activate an applicable Easter Egg score schedule before generating codes.");
      }
    }
    const effectivePolicy = context.policies.find((policy) =>
      policy.activity === activity.id &&
      policy.active &&
      context.schedules.some((schedule) =>
        schedule.id === policy.schedule &&
        schedule.status === "active" &&
        Date.parse(schedule.effective_at) <= Date.parse(config.startsAt)
      )
    );
    if (!effectivePolicy) {
      throw new Error("Activate an applicable score schedule before generating codes for this Activity.");
    }
    if (expectedCodeRole(activity.evidence_mode) !== config.evidenceRole) {
      throw new Error("Code evidence role must match the configured Activity evidence mode.");
    }
    this.assertCodeWindowInsideActivity(config.startsAt, config.endsAt, activity);
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
    return withGamificationLocks(this.store, [`code:${cleanText(input.codeId)}`], () =>
      this.reissueCodeNow(input, actor)
    );
  }

  private async reissueCodeNow(input: AdminCodeReissueInput, actor: AdminOperationActor): Promise<AdminCodeBatchResult> {
    this.requireConfirmation(input.confirmation, "Code reissue");
    const reason = requiredReason(input.reason);
    const context = await this.context();
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
    try {
      const generated = createMissionCodeGeneration(this.codePepper);
      const record = await this.store.create<GamificationCodeRecord>(GAMIFICATION_COLLECTIONS.codes, {
        key: `code-${randomUUID()}`,
        batch_id: input.operationId,
        label,
        activity: activity.id,
        lookup_prefix: generated.definition.lookupPrefix,
        code_hash: generated.definition.codeHash,
        hash_version: generated.definition.hashVersion,
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
      });
      try {
        await this.completeAudit(audit.record.id);
      } catch {
        // The replacement exists but its one-time secret cannot be recovered after an interrupted response.
        return this.committedLostBatch(input.operationId, record.label, activity.id);
      }
      const redemptionUrl = `/missions/redeem#code=${generated.rawCode}`;
      const oneTimeCode = { id: record.id, label: record.label, rawCode: generated.rawCode, redemptionUrl, qrLink: redemptionUrl };
      return {
        batch: { id: input.operationId, label: record.label, activityId: activity.id, quantity: 1, committed: true, secretsAvailable: true },
        codes: [oneTimeCode],
        csvExport: this.codeCsv([oneTimeCode]),
      };
    } catch (error) {
      await this.failAudit(audit.record.id);
      throw error;
    }
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
    if (activity.kind === "meta") {
      const achievement = context.achievements.find((candidate) => candidate.id === activity.achievement);
      const expectedBand = achievement ? metaScoreBandForRule(achievement.unlock_rule) : undefined;
      if (!expectedBand) throw new Error("Meta Activities require an Achievement rule with at least two qualifying source entities.");
      if (input.totalXp !== expectedBand.totalXp || input.leaderboardXp !== expectedBand.leaderboardXp) {
        throw new Error(`This Meta Activity requires the ${expectedBand.totalXp}/${expectedBand.leaderboardXp} total/Leaderboard XP band.`);
      }
    }
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
    const outcome = isBoothOutcome(activity.outcome_key) ? activity.outcome_key : undefined;
    const expected = outcome ? BOOTH_SCORE_BANDS[outcome] : undefined;
    if (!expected || input.totalXp !== expected.totalXp || input.leaderboardXp !== expected.leaderboardXp) {
      throw new Error("Booth visit, participation, completion, win, and high-score policies require fixed 5/5, 10/10, 20/15, 30/25, and 35/25 total/Leaderboard XP bands.");
    }
    if (!activity.partner) throw new Error("Booth score policies require a sponsor partner.");
    const mission = activity.mission ? context.missions.find((candidate) => candidate.id === activity.mission) : undefined;
    if (!mission || !isBoothMissionKey(mission.key) || !cleanText(mission.partner_key) || !mission.key.startsWith(`booth.${mission.partner_key}.`)) {
      throw new Error("Booth score policies require a canonical Mission matching its immutable sponsor key.");
    }
    const memberships = Array.isArray(input.capMembership) ? input.capMembership : [];
    const hasMembership = (dimension: GamificationCapMembership["dimension"], key: string) =>
      memberships.some((membership) => membership.dimension === dimension && membership.key === key);
    if (
      !hasMembership("activity", activity.id) ||
      !hasMembership("related_group", boothCapGroupKey(mission.key)) ||
      !hasMembership("partner", activity.partner) ||
      !hasMembership("category", "booth") ||
      !hasMembership("conference_day", input.scoreDay || "") ||
      !hasMembership("conference", "conference")
    ) {
      throw new Error("Booth score policies require Activity, booth-group, sponsor partner, category, day, and conference cap membership.");
    }
    if (!isISODate(input.scoreDay)) {
      throw new Error("Booth score policies require a conference day; category, day, and conference caps are then derived from the configured membership.");
    }
    for (const override of Object.values(input.capCeilingOverrides || {})) {
      if (override && (override.total_xp_ceiling > BOOTH_CAP.totalXp || override.leaderboard_xp_ceiling > BOOTH_CAP.leaderboardXp)) {
        throw new Error("Booth cap ceilings cannot exceed 35 total XP or 25 Leaderboard XP.");
      }
    }
  }

  private assertCommunityPartnerScorePolicy(
    activity: GamificationActivityRecord,
    input: AdminScorePolicyInput,
    context: GamificationContext,
  ): void {
    if (activity.kind !== "community_partner") return;
    const mission = activity.mission ? context.missions.find((candidate) => candidate.id === activity.mission) : undefined;
    const approvedTwoCode = mission?.metadata?.community_two_code_approved === true &&
      activity.metadata?.community_two_code_approved === true;
    const directBand = isCommunityPartnerOutcome(activity.outcome_key)
      ? COMMUNITY_PARTNER_SCORE_BANDS[activity.outcome_key]
      : undefined;
    const expected = approvedTwoCode
      ? activity.evidence_mode === "two_code_start"
        ? { totalXp: 10, leaderboardXp: 5, groupTotal: 40, groupLeaderboard: 30 }
        : activity.evidence_mode === "two_code_finish"
        ? { totalXp: 0, leaderboardXp: 0, groupTotal: 40, groupLeaderboard: 30 }
        : activity.evidence_mode === "derived_claim_set"
        ? { totalXp: 30, leaderboardXp: 25, groupTotal: 40, groupLeaderboard: 30 }
        : undefined
      : activity.evidence_mode === "single_code" && directBand
      ? { ...directBand, groupTotal: directBand.totalXp, groupLeaderboard: directBand.leaderboardXp }
      : undefined;
    if (!expected || input.totalXp !== expected.totalXp || input.leaderboardXp !== expected.leaderboardXp) {
      throw new Error("Community Partner policies require fixed 20/15 attendance, 25/20 participation, 30/25 completion, or approved shared two-code score bands.");
    }
    if (
      !activity.partner ||
      activity.partner_kind !== "community_partner" ||
      !mission ||
      mission.category !== "community" ||
      mission.partner !== activity.partner ||
      !cleanText(mission.partner_key) ||
      !mission.key.startsWith(`community.${mission.partner_key}.`)
    ) {
      throw new Error("Community Partner score policies require a canonical Mission and explicit gamification partner classification.");
    }
    const memberships = Array.isArray(input.capMembership) ? input.capMembership : [];
    const hasMembership = (dimension: GamificationCapMembership["dimension"], key: string) =>
      memberships.some((membership) => membership.dimension === dimension && membership.key === key);
    if (
      !hasMembership("activity", activity.id) ||
      !hasMembership("related_group", mission.key) ||
      !hasMembership("partner", activity.partner) ||
      !hasMembership("category", "community") ||
      !hasMembership("conference_day", input.scoreDay || "") ||
      !hasMembership("conference", "conference") ||
      !isISODate(input.scoreDay)
    ) {
      throw new Error("Community Partner score policies require Activity, programme, partner, category, day, and conference cap membership.");
    }
    const relatedOverride = input.capCeilingOverrides?.related_group;
    const validOneCodeCeiling = !approvedTwoCode && relatedOverride &&
      Object.values(COMMUNITY_PARTNER_SCORE_BANDS).some((band) =>
        band.totalXp === relatedOverride.total_xp_ceiling && band.leaderboardXp === relatedOverride.leaderboard_xp_ceiling
      ) &&
      relatedOverride.total_xp_ceiling >= expected.totalXp &&
      relatedOverride.leaderboard_xp_ceiling >= expected.leaderboardXp;
    if (
      !relatedOverride ||
      (approvedTwoCode
        ? relatedOverride.total_xp_ceiling !== 40 || relatedOverride.leaderboard_xp_ceiling !== 30
        : !validOneCodeCeiling)
    ) {
      throw new Error(`Community Partner programme scoring requires a valid shared related-group ceiling for its highest configured outcome.`);
    }
  }

  private assertSessionScorePolicy(activity: GamificationActivityRecord, input: AdminScorePolicyInput): void {
    if (activity.kind !== "session") return;
    const memberships = Array.isArray(input.capMembership) ? input.capMembership : [];
    const hasMembership = (dimension: GamificationCapMembership["dimension"], key: string) =>
      memberships.some((membership) => membership.dimension === dimension && membership.key === key);
    if (input.totalXp !== 20 || input.leaderboardXp !== 15) {
      throw new Error("Session attendance policies require the fixed 20/15 total/Leaderboard XP band.");
    }
    if (
      !hasMembership("activity", activity.id) ||
      !hasMembership("category", "session") ||
      !hasMembership("conference_day", input.scoreDay || "") ||
      !hasMembership("conference", "conference") ||
      !isISODate(input.scoreDay)
    ) {
      throw new Error("Session attendance policies require Activity, session category, day, and conference cap membership.");
    }
  }

  private assertConfiguredEventScorePolicy(activity: GamificationActivityRecord, input: AdminScorePolicyInput): void {
    if (!isConfiguredEventActivityKind(activity.kind) || !configuredEventReference(activity.event_ref)) return;
    const expected = activity.evidence_mode === "single_code"
      ? { totalXp: 30, leaderboardXp: 25, groupTotal: 30, groupLeaderboard: 25 }
      : activity.evidence_mode === "two_code_start"
      ? { totalXp: 10, leaderboardXp: 5, groupTotal: 40, groupLeaderboard: 30 }
      : activity.evidence_mode === "two_code_finish"
      ? { totalXp: 0, leaderboardXp: 0, groupTotal: 40, groupLeaderboard: 30 }
      : activity.evidence_mode === "derived_claim_set"
      ? { totalXp: 30, leaderboardXp: 25, groupTotal: 40, groupLeaderboard: 30 }
      : undefined;
    if (!expected || input.totalXp !== expected.totalXp || input.leaderboardXp !== expected.leaderboardXp) {
      throw new Error("Configured event policies require fixed 30/25 attendance, 10/5 start, 0/0 finish, and 30/25 derived completion bands.");
    }
    const eventRef = configuredEventReference(activity.event_ref)!;
    const capGroupKey = cleanKey(activity.metadata?.cap_group_key);
    const memberships = Array.isArray(input.capMembership) ? input.capMembership : [];
    const hasMembership = (dimension: GamificationCapMembership["dimension"], key: string) =>
      memberships.some((membership) => membership.dimension === dimension && membership.key === key);
    if (
      !hasMembership("activity", activity.id) ||
      !capGroupKey ||
      !hasMembership("related_group", capGroupKey) ||
      !hasMembership("category", activity.category) ||
      !hasMembership("conference_day", input.scoreDay || "") ||
      !hasMembership("conference", "conference") ||
      !isISODate(input.scoreDay)
    ) {
      throw new Error("Configured event policies require Activity, related-event, category, day, and conference cap membership.");
    }
    if (memberships.some((membership) => membership.dimension === "partner")) {
      throw new Error("Optional event host attribution must not create Partner Activity scoring.");
    }
    const relatedOverride = input.capCeilingOverrides?.related_group;
    if (
      !relatedOverride ||
      relatedOverride.total_xp_ceiling !== expected.groupTotal ||
      relatedOverride.leaderboard_xp_ceiling !== expected.groupLeaderboard
    ) {
      throw new Error(`Configured event related-group scoring requires the ${expected.groupTotal}/${expected.groupLeaderboard} ceiling.`);
    }
  }

  private assertEasterEggScorePolicy(activity: GamificationActivityRecord, input: AdminScorePolicyInput): void {
    if (activity.kind !== "easter_egg" && activity.category !== "easter_egg") return;
    if (input.totalXp !== 10 || input.leaderboardXp !== 0) {
      throw new Error("Easter egg discovery policies require the fixed 10/0 total/Leaderboard XP band.");
    }
    const memberships = Array.isArray(input.capMembership) ? input.capMembership : [];
    const expected = new Set([
      `activity:${activity.id}`,
      "category:easter_egg",
      "conference:conference",
    ]);
    const actual = new Set(memberships.map((membership) => `${membership.dimension}:${membership.key}`));
    if (actual.size !== expected.size || [...expected].some((membership) => !actual.has(membership))) {
      throw new Error("Easter egg discovery policies require only Activity, easter-egg category, and conference cap membership.");
    }
    if (input.scoreDay || Object.keys(input.capCeilingOverrides || {}).length > 0) {
      throw new Error("Easter egg category and conference ceilings are derived from active discoveries without day caps or overrides.");
    }
  }

  private validateMetaAchievement(achievement: GamificationAchievementRecord, context: GamificationContext): string[] {
    const errors: string[] = [];
    const rule = achievement.unlock_rule;
    const sourceKeys = metaRuleActivityKeys(rule);
    if (rule.kind !== "claim_set" && rule.kind !== "claim_count") {
      errors.push("Meta Achievements support only claim-set or selected-source claim-count rules.");
      return errors;
    }
    if (sourceKeys.length === 0) errors.push("Meta Achievements require selected qualifying source Activities.");
    const breadth = metaRuleSourceBreadth(rule);
    if (!breadth || breadth < 2) errors.push("Meta Achievements require at least two qualifying source entities.");
    if (rule.kind === "claim_set" && sourceKeys.length !== breadth) {
      errors.push("Meta claim sets must name each exact qualifying Activity once.");
    }
    if (rule.kind === "claim_count" && (!isPositiveInteger(rule.count) || rule.count! > sourceKeys.length)) {
      errors.push("Meta claim counts require a positive count within the selected source Activities.");
    }
    const selectedSources = selectedMetaSourceActivities(rule, context.activities);
    if (selectedSources.length !== sourceKeys.length) errors.push("Every Meta source Activity must be configured exactly once.");
    const diversity = metaRuleDiversity(rule);
    const requiredDiversity = selectedSources.length >= 2 && selectedSources.every((activity) => activity.kind === "session")
      ? "session"
      : selectedSources.length >= 2 && selectedSources.every((activity) => activity.kind === "booth")
      ? "booth"
      : selectedSources.length >= 2 && selectedSources.every((activity) => activity.kind === "community_partner")
      ? "community"
      : undefined;
    if (requiredDiversity && diversity !== requiredDiversity) {
      errors.push(`Cross-${requiredDiversity} Meta Achievements require explicit ${requiredDiversity} source diversity.`);
    }
    if (diversity) {
      const entityKeys = selectedSources.map((activity) => metaSourceEntityKey(activity, diversity));
      if (entityKeys.some((key) => !key)) {
        errors.push(`Meta ${diversity} diversity sources require the matching configured source reference.`);
      } else if (new Set(entityKeys).size !== entityKeys.length) {
        errors.push(`Meta ${diversity} diversity cannot count multiple Activities from one source entity.`);
      }
    }
    if (context.missions.some((mission) => mission.primary_achievement === achievement.id)) {
      errors.push("Meta Achievements cannot be attached to a redeemable Mission.");
    }
    const linkedActivities = context.activities.filter((activity) => activity.achievement === achievement.id);
    const metaActivities = linkedActivities.filter((activity) => activity.kind === "meta");
    if (linkedActivities.length !== 1 || metaActivities.length !== 1) {
      errors.push("Meta Achievements require exactly one linked Meta Activity and no direct source Activity.");
      return errors;
    }
    const metaActivity = metaActivities[0];
    if (metaActivity.key !== `meta.${achievement.key}`) {
      errors.push("Meta Activity key must be the canonical meta.{achievementKey} value.");
    }
    if (
      metaActivity.category !== "meta" ||
      metaActivity.outcome_key !== "meta" ||
      metaActivity.evidence_mode !== "meta_rule" ||
      metaActivity.mission ||
      metaActivity.per_user_claim_limit !== 1 ||
      metaActivity.status !== "active" ||
      !metaActivity.enabled
    ) {
      errors.push("The linked Meta Activity must be active, missionless, one-per-User, meta-rule evidence.");
    }
    const expectedBand = metaScoreBandForRule(rule);
    const policies = context.policies.filter((policy) => policy.activity === metaActivity.id && policy.active);
    if (!expectedBand || policies.length === 0) {
      errors.push("Meta Achievements require an active fixed-band score policy.");
    } else if (policies.some((policy) =>
      policy.total_xp !== expectedBand.totalXp || policy.leaderboard_xp !== expectedBand.leaderboardXp,
    )) {
      errors.push(`Meta source breadth requires the ${expectedBand.totalXp}/${expectedBand.leaderboardXp} total/Leaderboard XP band.`);
    }
    return errors;
  }

  private validateConfiguredEventActivity(
    activity: GamificationActivityRecord,
    mission: GamificationMissionRecord | undefined,
    context: GamificationContext,
  ): string[] {
    const errors: string[] = [];
    const eventRef = configuredEventReference(activity.event_ref);
    if (!eventRef) return ["Configured event Activities require a complete immutable event reference."];
    const expectedKind = configuredEventActivityKind(eventRef.kind);
    const expectedCategory = configuredEventCategory(eventRef.kind);
    const missionKey = configuredEventMissionKey(eventRef.kind, eventRef.eventKey);
    if (
      activity.kind !== expectedKind ||
      activity.category !== expectedCategory ||
      !mission ||
      mission.key !== missionKey ||
      mission.category !== expectedCategory ||
      !sameConfiguredEventReference(mission.event_ref, eventRef)
    ) {
      errors.push("Configured event Mission and Activity references, kinds, and categories must match.");
    }
    if (
      activity.active_from !== eventRef.startsAt ||
      activity.active_until !== eventRef.endsAt ||
      mission?.starts_at !== eventRef.startsAt ||
      mission?.ends_at !== eventRef.endsAt ||
      mission?.visibility !== eventRef.visibility
    ) {
      errors.push("Configured event operating windows and visibility must match the immutable event reference.");
    }
    const capGroupKey = cleanKey(activity.metadata?.cap_group_key);
    if (!capGroupKey || capGroupKey !== cleanKey(mission?.metadata?.cap_group_key)) {
      errors.push("Configured event Mission and Activities require one matching immutable cap group key.");
    }
    if (typeof activity.event_meta_eligible !== "boolean") {
      errors.push("Configured event Activities must explicitly register Meta eligibility.");
    }
    if (activity.partner || mission?.partner) {
      if (
        !activity.partner ||
        activity.partner !== mission?.partner ||
        activity.partner_kind !== "workshop_host" ||
        !context.partners.some((partner) => partner.id === activity.partner)
      ) {
        errors.push("Optional event host attribution must use the same existing host partner on the Mission and Activities.");
      }
    } else if (activity.partner_kind) {
      errors.push("WTS-run events must not have a partner kind without a host relation.");
    }
    const eventActivities = context.activities.filter((candidate) =>
      candidate.mission === activity.mission &&
      candidate.status !== "retired" &&
      isConfiguredEventActivityKind(candidate.kind),
    );
    const oneCode = eventActivities.length === 1 && eventActivities[0].evidence_mode === "single_code";
    const start = eventActivities.find((candidate) => candidate.evidence_mode === "two_code_start");
    const finish = eventActivities.find((candidate) => candidate.evidence_mode === "two_code_finish");
    const completion = eventActivities.find((candidate) => candidate.evidence_mode === "derived_claim_set");
    const twoCode = eventActivities.length === 3 && Boolean(start && finish && completion);
    if (!oneCode && !twoCode) errors.push("Configured events require either one attendance Activity or one start, finish, and derived completion Activity.");
    if (twoCode && eventRef.kind !== "workshop" && mission?.metadata?.related_event_two_code_approved !== true) {
      errors.push("Two-code completion outside workshops requires recorded explicit organizer approval.");
    }
    const expectedKey = activity.evidence_mode === "single_code"
      ? `${missionKey}.attendance`
      : activity.evidence_mode === "two_code_start"
      ? `${missionKey}.start`
      : activity.evidence_mode === "two_code_finish"
      ? `${missionKey}.finish`
      : activity.evidence_mode === "derived_claim_set" ? `${missionKey}.completion` : "";
    if (!expectedKey || activity.key !== expectedKey) errors.push("Configured event Activity key does not match its immutable event outcome.");
    if (activity.evidence_mode === "single_code" || activity.evidence_mode === "two_code_start" || activity.evidence_mode === "two_code_finish") {
      if (!isEvidenceChannel(activity.evidence_channel) || !cleanText(activity.deployment_label)) {
        errors.push("Configured event code Activities require a WTS-controlled evidence channel and deployment artifact.");
      }
    } else if (activity.evidence_mode === "derived_claim_set") {
      if (activity.evidence_channel || cleanText(activity.deployment_label)) {
        errors.push("Derived event completion must not have a redeemable artifact.");
      }
    }
    if (oneCode && activity.event_meta_eligible !== true && eventActivities.some((candidate) => candidate.event_meta_eligible)) {
      errors.push("One-code events may register only their attendance Activity for Meta.");
    }
    if (twoCode) {
      if (start?.event_meta_eligible || finish?.event_meta_eligible || typeof completion?.event_meta_eligible !== "boolean") {
        errors.push("Two-code events may register only their derived completion Activity for Meta.");
      }
      const achievement = completion?.achievement
        ? context.achievements.find((candidate) => candidate.id === completion.achievement)
        : undefined;
      const rule = achievement && safeUnlockRule(achievement.unlock_rule);
      if (
        !achievement ||
        rule?.kind !== "claim_set" ||
        JSON.stringify([...(rule.activityKeys || [])].sort()) !== JSON.stringify([start?.key, finish?.key].sort())
      ) {
        errors.push("Derived event completion requires the exact start-and-finish Achievement claim set.");
      }
    }
    const directActivity = oneCode ? eventActivities[0] : start;
    if (directActivity?.achievement) {
      const achievement = context.achievements.find((candidate) => candidate.id === directActivity.achievement);
      const rule = achievement && safeUnlockRule(achievement.unlock_rule);
      if (
        !achievement ||
        rule?.kind !== "activity_claim" ||
        ((rule.activityKeys?.length || 0) > 0 && !rule.activityKeys?.includes(directActivity.key))
      ) {
        errors.push("Configured event attendance Badges require the direct attendance/start Activity-claim rule.");
      }
    }
    const policies = context.policies.filter((policy) => policy.activity === activity.id && policy.active);
    if (policies.length === 0) errors.push("Configured event Activities require an active score policy.");
    for (const policy of policies) {
      try {
        this.assertConfiguredEventScorePolicy(activity, {
          scheduleId: policy.schedule,
          policyKey: policy.policy_key,
          enabled: policy.active,
          totalXp: policy.total_xp,
          leaderboardXp: policy.leaderboard_xp,
          capMembership: policy.cap_membership,
          capCeilingOverrides: policy.cap_ceiling_overrides,
          scoreDay: policy.score_day,
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Configured event score policy is invalid.");
      }
    }
    return errors;
  }

  private validateCommunityPartnerActivity(
    activity: GamificationActivityRecord,
    mission: GamificationMissionRecord | undefined,
    context: GamificationContext,
  ): string[] {
    const errors: string[] = [];
    const partnerKey = cleanKey(mission?.partner_key);
    if (
      activity.category !== "community" ||
      activity.partner_kind !== "community_partner" ||
      !activity.partner ||
      !context.partners.some((partner) => partner.id === activity.partner) ||
      !mission ||
      mission.category !== "community" ||
      mission.partner !== activity.partner ||
      !partnerKey ||
      !mission.key.startsWith(`community.${partnerKey}.`)
    ) {
      errors.push("Community Partner Activities require a canonical Community Mission and explicit gamification partner classification.");
      return errors;
    }
    if (mission.visibility !== "public" && mission.suggested) {
      errors.push("Only explicitly public Community Partner Missions may be suggested.");
    }
    if (typeof activity.community_meta_eligible !== "boolean") {
      errors.push("Community Partner Activities must explicitly register Meta eligibility.");
    }
    const programmeActivities = context.activities.filter((candidate) =>
      candidate.mission === mission.id && candidate.kind === "community_partner" && candidate.status !== "retired",
    );
    const oneCode = programmeActivities.length >= 1 && programmeActivities.length <= 3 &&
      programmeActivities.every((candidate) => candidate.evidence_mode === "single_code") &&
      programmeActivities.every((candidate) => isCommunityPartnerOutcome(candidate.outcome_key)) &&
      uniqueKeys(programmeActivities.map((candidate) => candidate.outcome_key));
    const start = programmeActivities.find((candidate) => candidate.evidence_mode === "two_code_start");
    const finish = programmeActivities.find((candidate) => candidate.evidence_mode === "two_code_finish");
    const completion = programmeActivities.find((candidate) => candidate.evidence_mode === "derived_claim_set");
    const twoCode = programmeActivities.length === 3 && Boolean(start && finish && completion);
    if (!oneCode && !twoCode) {
      errors.push("Community Partner programmes require one selected outcome or one approved start, finish, and derived completion flow.");
    }
    if (twoCode && mission.metadata?.community_two_code_approved !== true) {
      errors.push("Community Partner two-code completion requires recorded explicit organizer approval.");
    }
    if (oneCode && !isCommunityPartnerOutcome(activity.outcome_key)) {
      errors.push("Community Partner one-code Activities support attendance, participation, or completion only.");
    }
    const expectedKey = oneCode && isCommunityPartnerOutcome(activity.outcome_key)
      ? communityPartnerActivityKey(mission.key, activity.outcome_key)
      : activity.evidence_mode === "two_code_start"
      ? communityPartnerActivityKey(mission.key, "start")
      : activity.evidence_mode === "two_code_finish"
      ? communityPartnerActivityKey(mission.key, "finish")
      : activity.evidence_mode === "derived_claim_set" ? communityPartnerActivityKey(mission.key, "completion") : "";
    if (!expectedKey || activity.key !== expectedKey) errors.push("Community Partner Activity key does not match its immutable programme outcome.");
    if (["single_code", "two_code_start", "two_code_finish"].includes(activity.evidence_mode)) {
      if (!isEvidenceChannel(activity.evidence_channel) || !cleanText(activity.deployment_label)) {
        errors.push("Community Partner code Activities require a WTS-controlled evidence channel and deployment artifact.");
      }
    } else if (activity.evidence_mode === "derived_claim_set" && (activity.evidence_channel || cleanText(activity.deployment_label))) {
      errors.push("Derived Community Partner completion must not have a redeemable artifact.");
    }
    const metaActivities = programmeActivities.filter((candidate) => candidate.community_meta_eligible === true);
    if (metaActivities.length > 1 || (twoCode && metaActivities.some((candidate) => candidate.id !== completion?.id))) {
      errors.push("At most one designated qualifying Activity per Community Partner programme may register with Meta rules.");
    }
    if (twoCode && (start?.community_meta_eligible || finish?.community_meta_eligible || typeof completion?.community_meta_eligible !== "boolean")) {
      errors.push("Community Partner two-code programmes may register only derived completion with Meta rules.");
    }
    if (twoCode) {
      const achievement = completion?.achievement
        ? context.achievements.find((candidate) => candidate.id === completion.achievement)
        : undefined;
      const rule = achievement && safeUnlockRule(achievement.unlock_rule);
      if (
        !achievement ||
        achievement.category !== "community" ||
        rule?.kind !== "claim_set" ||
        JSON.stringify([...(rule.activityKeys || [])].sort()) !== JSON.stringify([start?.key, finish?.key].sort())
      ) {
        errors.push("Derived Community Partner completion requires the exact start-and-finish Community Badge claim set.");
      }
    }
    const directActivities = oneCode ? programmeActivities : start ? [start] : [];
    for (const directActivity of directActivities) {
      const directAchievement = directActivity.achievement
        ? context.achievements.find((candidate) => candidate.id === directActivity.achievement)
        : undefined;
      const directRule = directAchievement && safeUnlockRule(directAchievement.unlock_rule);
      if (
        !directAchievement ||
        directAchievement.category !== "community" ||
        directRule?.kind !== "activity_claim" ||
        ((directRule.activityKeys?.length || 0) > 0 && !directRule.activityKeys?.includes(directActivity.key))
      ) {
        errors.push("Community Partner direct Activities require distinct Community Activity-claim Badges.");
      }
    }
    const followUpActivities = programmeActivities.filter((candidate) => candidate.partner_follow_up_enabled);
    if (
      (!oneCode && followUpActivities.some((candidate) => candidate.id !== completion?.id)) ||
      followUpActivities.some((candidate) => !cleanText(candidate.partner_follow_up_notice_version))
    ) {
      errors.push("Community Partner follow-up may be configured only on the programme's qualifying outcome with a notice version.");
    }
    if (oneCode) {
      const ceiling = programmeActivities.reduce((current, candidate) => {
        const band = isCommunityPartnerOutcome(candidate.outcome_key) ? COMMUNITY_PARTNER_SCORE_BANDS[candidate.outcome_key] : undefined;
        return band && band.totalXp > current.totalXp ? band : current;
      }, { totalXp: 0, leaderboardXp: 0 });
      const programmePolicies = context.policies.filter((policy) =>
        programmeActivities.some((candidate) => candidate.id === policy.activity) && policy.active
      );
      if (programmePolicies.some((policy) =>
        policy.cap_ceiling_overrides?.related_group?.total_xp_ceiling !== ceiling.totalXp ||
        policy.cap_ceiling_overrides?.related_group?.leaderboard_xp_ceiling !== ceiling.leaderboardXp
      )) {
        errors.push("Every Community Partner programme policy must share its highest active outcome ceiling.");
      }
    }
    const policies = context.policies.filter((policy) => policy.activity === activity.id && policy.active);
    if (policies.length === 0) errors.push("Community Partner Activities require an active direct score policy.");
    for (const policy of policies) {
      try {
        this.assertCommunityPartnerScorePolicy(activity, {
          scheduleId: policy.schedule,
          policyKey: policy.policy_key,
          enabled: policy.active,
          totalXp: policy.total_xp,
          leaderboardXp: policy.leaderboard_xp,
          capMembership: policy.cap_membership,
          capCeilingOverrides: policy.cap_ceiling_overrides,
          scoreDay: policy.score_day,
        }, context);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Community Partner score policy is invalid.");
      }
    }
    return errors;
  }

  private validateEasterEggActivity(
    activity: GamificationActivityRecord,
    mission: GamificationMissionRecord | undefined,
    context: GamificationContext,
  ): string[] {
    const errors: string[] = [];
    const match = /^easter_egg\.([a-z0-9]+(?:-[a-z0-9]+)*)\.discovery$/.exec(activity.key);
    const expectedMissionKey = match ? `easter_egg.${match[1]}` : "";
    const achievement = activity.achievement
      ? context.achievements.find((candidate) => candidate.id === activity.achievement)
      : undefined;
    if (
      activity.kind !== "easter_egg" ||
      activity.category !== "easter_egg" ||
      activity.outcome_key !== "static_discovery" ||
      activity.evidence_mode !== "static_puzzle_code" ||
      !match
    ) {
      errors.push("Easter egg Activities require the canonical easter_egg.{eggKey}.discovery static-discovery shape.");
    }
    if (
      !mission ||
      mission.key !== expectedMissionKey ||
      mission.category !== "easter_egg" ||
      mission.visibility !== "hidden_until_unlocked" ||
      mission.suggested ||
      mission.primary_achievement !== activity.achievement ||
      mission.partner ||
      cleanText(mission.partner_key) ||
      mission.session ||
      safeEventRef(mission.event_ref)
    ) {
      errors.push("Easter egg discovery requires one hidden, unsuggested, relation-free canonical Mission.");
    }
    const missionActivities = mission ? context.activities.filter((candidate) =>
      candidate.mission === mission.id && candidate.status !== "retired"
    ) : [];
    if (missionActivities.length !== 1 || missionActivities[0]?.id !== activity.id) {
      errors.push("Each Easter Egg Mission requires exactly one non-retired discovery Activity.");
    }
    const rule = achievement && safeUnlockRule(achievement.unlock_rule);
    if (
      !achievement ||
      achievement.key !== expectedMissionKey ||
      achievement.category !== "easter_egg" ||
      achievement.visibility !== "hidden_until_unlocked" ||
      cleanText(achievement.locked_teaser) ||
      rule?.kind !== "activity_claim"
    ) {
      errors.push("Easter egg discovery requires its hidden-until-unlocked direct Activity-claim Badge without locked teaser copy.");
    }
    if (
      !(["wts_qr", "wts_link", "wts_manual_code"] as string[]).includes(activity.evidence_channel || "") ||
      !cleanText(activity.deployment_label)
    ) {
      errors.push("Easter egg discovery requires a WTS-controlled static QR, fragment link, or manual-code surface and private deployment note.");
    }
    if (activity.partner || activity.partner_kind || activity.session || safeEventRef(activity.event_ref)) {
      errors.push("Easter egg discovery must not carry partner, staff, Session, or event privileges or relations.");
    }
    if (
      mission && (
        mission.starts_at !== activity.active_from ||
        mission.ends_at !== activity.active_until ||
        achievement && (achievement.active_from !== activity.active_from || achievement.active_until !== activity.active_until)
      )
    ) {
      errors.push("Easter egg Mission, discovery Activity, and Badge must share one active window.");
    }
    const policies = context.policies.filter((policy) => policy.activity === activity.id && policy.active);
    if (policies.length === 0) errors.push("Easter egg discovery requires an active fixed score policy.");
    for (const policy of policies) {
      try {
        this.assertEasterEggScorePolicy(activity, {
          scheduleId: policy.schedule,
          policyKey: policy.policy_key,
          enabled: policy.active,
          totalXp: policy.total_xp,
          leaderboardXp: policy.leaderboard_xp,
          capMembership: policy.cap_membership,
          capCeilingOverrides: policy.cap_ceiling_overrides,
          scoreDay: policy.score_day,
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Easter egg score policy is invalid.");
      }
    }
    return errors;
  }

  private validateForActivation(kind: GamificationDefinitionKind, id: string, context: GamificationContext): string[] {
    const errors: string[] = [];
    if (kind === "achievement") {
      const achievement = context.achievements.find((candidate) => candidate.id === id)!;
      if (!cleanText(achievement.badge_name) || !cleanText(achievement.badge_description)) errors.push("Badge presentation is incomplete.");
      hasRequiredWindow(achievement.active_from, achievement.active_until, "Achievement", errors);
      const rule = safeUnlockRule(achievement.unlock_rule);
      if (!isUnlockRuleKind(rule.kind)) errors.push("Achievement unlock rule is invalid.");
      const activityKeys = rule.activityKeys || [];
      if (!uniqueKeys(activityKeys)) errors.push("Achievement unlock rule repeats an Activity.");
      if (achievement.category === "meta") {
        errors.push(...this.validateMetaAchievement(achievement, context));
      } else if (achievement.category === "easter_egg" || achievement.key.startsWith("easter_egg.")) {
        const mission = context.missions.find((candidate) => candidate.primary_achievement === achievement.id && candidate.status !== "retired");
        const activity = context.activities.find((candidate) => candidate.achievement === achievement.id && candidate.status !== "retired");
        if (
          !/^easter_egg\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(achievement.key) ||
          achievement.visibility !== "hidden_until_unlocked" ||
          cleanText(achievement.locked_teaser) ||
          rule.kind !== "activity_claim" ||
          !mission ||
          !activity ||
          mission.key !== achievement.key ||
          activity.key !== `${achievement.key}.discovery`
        ) {
          errors.push("Easter egg Badges require one matching hidden Mission and direct static-discovery Activity with spoiler-safe post-unlock copy.");
        }
      } else {
        if (rule.kind === "claim_set" && activityKeys.length < 2) errors.push("Claim-set Achievements require at least two Activities.");
        if (rule.kind === "claim_count" && (!isPositiveInteger(rule.count) || (!rule.category && activityKeys.length === 0))) {
          errors.push("Claim-count Achievements require a positive count and qualifying Activities or category.");
        }
      }
      for (const activityKey of activityKeys) {
        const activity = context.activities.find((candidate) => candidate.id === activityKey || candidate.key === activityKey);
        if (!activity || activity.status !== "active" || !activity.enabled) {
          errors.push(`Achievement dependency ${activityKey} is not active.`);
        }
      }
      return errors;
    }
    if (kind === "mission") {
      const mission = context.missions.find((candidate) => candidate.id === id)!;
      if (!cleanText(mission.title) || !cleanText(mission.summary)) errors.push("Mission title and summary are required.");
      hasRequiredWindow(mission.starts_at, mission.ends_at, "Mission", errors);
      if (mission.primary_achievement) {
        const achievement = context.achievements.find((candidate) => candidate.id === mission.primary_achievement);
        if (!achievement || achievement.status !== "active") errors.push("Mission primary Achievement must be active.");
        if (achievement && achievement.category !== mission.category) errors.push("Mission and primary Achievement categories must match.");
      }
      const eventRef = configuredEventReference(mission.event_ref);
      if (eventRef) {
        if (
          mission.key !== configuredEventMissionKey(eventRef.kind, eventRef.eventKey) ||
          mission.category !== configuredEventCategory(eventRef.kind) ||
          mission.starts_at !== eventRef.startsAt ||
          mission.ends_at !== eventRef.endsAt ||
          mission.visibility !== eventRef.visibility
        ) {
          errors.push("Configured event Mission must match its immutable reference, window, and visibility.");
        }
        if (mission.visibility !== "public" && mission.suggested) {
          errors.push("Internal or unannounced event Missions cannot be public suggestions.");
        }
      }
      if (mission.category === "community" || mission.key.startsWith("community.")) {
        if (
          mission.category !== "community" ||
          !mission.partner ||
          !context.partners.some((partner) => partner.id === mission.partner) ||
          !cleanText(mission.partner_key) ||
          !mission.key.startsWith(`community.${mission.partner_key}.`)
        ) {
          errors.push("Community Partner Missions require an existing partner and immutable community.{partnerKey}.{activityKey} key.");
        }
        if (mission.visibility !== "public" && mission.suggested) {
          errors.push("Only explicitly public Community Partner Missions may be suggested.");
        }
      }
      if (mission.category === "easter_egg" || mission.key.startsWith("easter_egg.")) {
        const activity = context.activities.find((candidate) => candidate.mission === mission.id && candidate.status !== "retired");
        const missionActivities = context.activities.filter((candidate) => candidate.mission === mission.id && candidate.status !== "retired");
        if (
          !/^easter_egg\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mission.key) ||
          mission.category !== "easter_egg" ||
          mission.visibility !== "hidden_until_unlocked" ||
          mission.suggested ||
          mission.partner ||
          cleanText(mission.partner_key) ||
          mission.session ||
          safeEventRef(mission.event_ref) ||
          missionActivities.length !== 1 ||
          activity?.key !== `${mission.key}.discovery`
        ) {
          errors.push("Easter egg Missions require one hidden, unsuggested, relation-free canonical discovery Activity.");
        }
      }
      return errors;
    }
    const activity = context.activities.find((candidate) => candidate.id === id)!;
    if (!cleanText(activity.outcome_key)) errors.push("Activity outcome is required.");
    if (activity.per_user_claim_limit !== 1) errors.push("September Activities must have a per-User claim limit of one.");
    if (!isPositiveInteger(Number(activity.max_claims))) errors.push("Activity global claim limit is required.");
    hasRequiredWindow(activity.active_from, activity.active_until, "Activity", errors);
    const hieventsEvidence = activity.evidence_mode === "hievents_ticket" || activity.evidence_mode === "hievents_checkin";
    if (hieventsEvidence && activity.kind !== "hievents") errors.push("Only Hi.Events Activities may use Hi.Events evidence.");
    if (activity.kind === "hievents" && !hieventsEvidence) errors.push("Hi.Events Activities require ticket or check-in evidence.");
    if (expectedCodeRole(activity.evidence_mode) && ["hievents", "admin_manual", "meta"].includes(activity.kind)) {
      errors.push("This Activity kind cannot use redeemable code evidence.");
    }
    const mission = activity.mission ? context.missions.find((candidate) => candidate.id === activity.mission) : undefined;
    if (activity.evidence_mode.includes("code") && (!mission || mission.status !== "active")) {
      errors.push("Code Activities require an active Mission.");
    }
    if (mission && mission.status !== "active") errors.push("Related Mission must be active.");
    if (mission && mission.category !== activity.category) errors.push("Activity and Mission categories must match.");
    if (activity.achievement) {
      const achievement = context.achievements.find((candidate) => candidate.id === activity.achievement);
      if (!achievement || (
        activity.kind === "meta" || activity.kind === "community_partner" || isConfiguredEventActivityKind(activity.kind)
          ? !["draft", "active"].includes(achievement.status)
          : achievement.status !== "active"
      )) {
        errors.push("Related Achievement must be active.");
      }
      if (achievement && achievement.category !== activity.category) errors.push("Activity and Achievement categories must match.");
    }
    if (activity.kind === "session") {
      const session = context.sessions.find((candidate) => candidate.id === activity.session);
      if (!session?.published) errors.push("Session Activities require a published Session reference.");
      const sessionKey = cleanOptionalText(activity.session_key);
      const snapshot = safeSessionDisplaySnapshot(activity.session_display_snapshot);
      if (!sessionKey || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sessionKey)) {
        errors.push("Session Activities require an immutable Session key.");
      }
      if (!snapshot) errors.push("Session Activities require a safe Session display snapshot.");
      if (typeof activity.session_meta_eligible !== "boolean") {
        errors.push("Session Activities must explicitly configure Meta eligibility.");
      }
      const expectedMissionKey = sessionKey ? `session.${sessionKey}` : "";
      const expectedActivityKey = expectedMissionKey ? `${expectedMissionKey}.attendance` : "";
      if (
        activity.category !== "session" ||
        activity.outcome_key !== "attendance" ||
        activity.evidence_mode !== "single_code" ||
        !isEvidenceChannel(activity.evidence_channel) ||
        !cleanText(activity.deployment_label)
      ) {
        errors.push("Session Activities require Session attendance, WTS-controlled single-code evidence, and a deployment artifact.");
      }
      if (!mission || mission.session !== activity.session || mission.key !== expectedMissionKey || activity.key !== expectedActivityKey) {
        errors.push("Session Mission and Activity keys must use the immutable session.{sessionKey}.attendance form.");
      }
      if (context.activities.some((candidate) =>
        candidate.id !== activity.id &&
        candidate.kind === "session" &&
        candidate.session === activity.session &&
        candidate.status !== "retired",
      )) {
        errors.push("Only one non-retired Session attendance Activity may be configured for a Session.");
      }
      const directAchievement = activity.achievement
        ? context.achievements.find((candidate) => candidate.id === activity.achievement)
        : undefined;
      const directRule = directAchievement && safeUnlockRule(directAchievement.unlock_rule);
      if (
        directAchievement &&
        (directRule?.kind !== "activity_claim" ||
          ((directRule.activityKeys?.length || 0) > 0 && !directRule.activityKeys?.includes(activity.key)))
      ) {
        errors.push("A direct Session Badge must use this Activity's direct Activity-claim rule.");
      }
      const policies = context.policies.filter((policy) => policy.activity === activity.id && policy.active);
      if (policies.length === 0) errors.push("Session Activities require an active direct score policy.");
      for (const policy of policies) {
        const memberships = Array.isArray(policy.cap_membership) ? policy.cap_membership : [];
        const hasMembership = (dimension: GamificationCapMembership["dimension"], key: string) =>
          memberships.some((membership) => membership.dimension === dimension && membership.key === key);
        if (policy.total_xp !== 20 || policy.leaderboard_xp !== 15) {
          errors.push("Session direct score policies must use the fixed 20/15 total/Leaderboard XP band.");
        }
        if (
          !hasMembership("activity", activity.id) ||
          !hasMembership("category", "session") ||
          !hasMembership("conference_day", policy.score_day || "") ||
          !hasMembership("conference", "conference") ||
          !isISODate(policy.score_day)
        ) {
          errors.push("Session direct score policies require Activity, session category, day, and conference caps.");
        }
      }
    }
    if (["booth", "community_partner"].includes(activity.kind)) {
      if (!activity.partner || !context.partners.some((partner) => partner.id === activity.partner) || !activity.partner_kind) {
        errors.push("Partner Activities require an existing partner and partner kind.");
      }
    }
    if (activity.kind === "booth") {
      const partner = context.partners.find((candidate) => candidate.id === activity.partner);
      const outcome = isBoothOutcome(activity.outcome_key) ? activity.outcome_key : undefined;
      if (activity.category !== "booth" || !outcome) {
        errors.push("Booth Activities support only the booth category and visit, participation, completion, win, or high_score outcomes.");
      }
      if (!partner || partner.type !== "sponsor" || activity.partner_kind !== "sponsor") {
        errors.push("Booth Activities require an existing sponsor partner with partner kind sponsor.");
      }
      if (activity.evidence_mode !== "single_code" || !isEvidenceChannel(activity.evidence_channel)) {
        errors.push("Booth Activities require a WTS-controlled single-code evidence channel.");
      }
      if (!cleanText(activity.deployment_label)) {
        errors.push("Booth Activities require a WTS artifact deployment label before activation.");
      }
      if (partner && outcome) {
        const expectedKey = mission ? boothActivityKey(mission.key, outcome) : "";
        if (!mission || !isBoothMissionKey(mission.key) || !cleanText(mission.partner_key) || !mission.key.startsWith(`booth.${mission.partner_key}.`)) {
          errors.push("Booth Mission key must use the immutable booth.{partnerKey}.{activityKey} form.");
        }
        if (activity.key !== expectedKey) {
          errors.push(`Booth Activity key must be the immutable ${expectedKey} value.`);
        }
        if (!mission || mission.partner !== partner.id) {
          errors.push("Booth Mission must reference the same sponsor partner.");
        }
        if (mission && context.missions.some((candidate) =>
          candidate.id !== mission.id &&
          candidate.partner === partner.id &&
          cleanText(candidate.partner_key) &&
          candidate.partner_key !== mission.partner_key,
        )) {
          errors.push("Booth Missions for one sponsor must use the same immutable sponsor key.");
        }
      }
      if (context.activities.some((candidate) =>
        candidate.id !== activity.id &&
        candidate.kind === "booth" &&
        candidate.mission === activity.mission &&
        candidate.outcome_key === activity.outcome_key &&
        candidate.status !== "retired",
      )) {
        errors.push("Only one non-retired Booth Activity may be configured for each sponsor outcome.");
      }
      const achievement = activity.achievement ? context.achievements.find((candidate) => candidate.id === activity.achievement) : undefined;
      const directRule = achievement && safeUnlockRule(achievement.unlock_rule);
      if (!achievement || directRule?.kind !== "activity_claim" || ((directRule.activityKeys?.length || 0) > 0 && !directRule.activityKeys?.includes(activity.key))) {
        errors.push("Booth Activities require an active direct Activity-claim Achievement rule.");
      }
      if (activity.partner_follow_up_enabled && !cleanText(activity.partner_follow_up_notice_version)) {
        errors.push("Enabled partner follow-up requires a notice version.");
      }
      const policies = context.policies.filter((policy) => policy.activity === activity.id && policy.active);
      if (policies.length === 0) {
        errors.push("Booth Activities require an active direct score policy.");
      }
      for (const policy of policies) {
        const expected = outcome ? BOOTH_SCORE_BANDS[outcome] : undefined;
        const memberships = Array.isArray(policy.cap_membership) ? policy.cap_membership : [];
        const hasMembership = (dimension: GamificationCapMembership["dimension"], key: string) =>
          memberships.some((membership) => membership.dimension === dimension && membership.key === key);
        if (!expected || policy.total_xp !== expected.totalXp || policy.leaderboard_xp !== expected.leaderboardXp) {
          errors.push("Booth direct score policy does not match its fixed outcome band.");
        }
        if (
          !activity.partner ||
          !hasMembership("activity", activity.id) ||
          !hasMembership("related_group", mission ? boothCapGroupKey(mission.key) : "") ||
          !hasMembership("partner", activity.partner) ||
          !hasMembership("category", "booth") ||
          !hasMembership("conference_day", policy.score_day || "") ||
          !hasMembership("conference", "conference")
        ) {
          errors.push("Booth direct score policy must include Activity, booth-group, sponsor partner, category, day, and conference caps.");
        }
        if (!isISODate(policy.score_day)) errors.push("Booth direct score policy requires a conference day for derived category/day/conference caps.");
        for (const override of Object.values(policy.cap_ceiling_overrides || {})) {
          if (override && (override.total_xp_ceiling > BOOTH_CAP.totalXp || override.leaderboard_xp_ceiling > BOOTH_CAP.leaderboardXp)) {
            errors.push("Booth cap ceilings cannot exceed 35 total XP or 25 Leaderboard XP.");
            break;
          }
        }
      }
    } else if (activity.kind === "community_partner") {
      errors.push(...this.validateCommunityPartnerActivity(activity, mission, context));
    } else if (activity.partner_follow_up_enabled || cleanText(activity.partner_follow_up_notice_version)) {
      errors.push("Partner follow-up consent may only be configured for sponsor Booth or Community Partner Activities.");
    }
    if (isConfiguredEventActivityKind(activity.kind)) {
      errors.push(...this.validateConfiguredEventActivity(activity, mission, context));
    } else if (activity.kind === "hievents") {
      const eventRef = safeEventRef(activity.event_ref);
      if (!eventRef?.eventKey && !eventRef?.eventId) errors.push("This Activity requires an event source reference.");
    }
    if (activity.kind === "easter_egg" || activity.category === "easter_egg" || activity.key.startsWith("easter_egg.")) {
      errors.push(...this.validateEasterEggActivity(activity, mission, context));
    }
    if (activity.kind === "meta" && activity.evidence_mode !== "meta_rule") errors.push("Meta Activities require meta-rule evidence.");
    if (activity.kind !== "meta" && activity.evidence_mode === "meta_rule") errors.push("Only Meta Activities may use meta-rule evidence.");
    if (activity.kind === "meta") {
      if (activity.category !== "meta" || activity.outcome_key !== "meta") errors.push("Meta Activities require the meta category and outcome.");
      if (activity.mission) errors.push("Meta Activities cannot belong to a redeemable Mission.");
      const achievement = context.achievements.find((candidate) => candidate.id === activity.achievement);
      if (!achievement || achievement.category !== "meta") errors.push("Meta Activities require a linked Meta Achievement.");
      if (achievement && achievement.unlock_rule.kind !== "claim_set" && achievement.unlock_rule.kind !== "claim_count") {
        errors.push("Meta Activities require a claim-set or selected-source claim-count Achievement rule.");
      }
    }
    return errors;
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
      const groupKey = policy.capMembership.find((membership) => membership.dimension === "related_group")?.key;
      const activeGroup = policies.filter((candidate) =>
        candidate.kind === "community_partner" &&
        candidate.capMembership.some((membership) => membership.dimension === "related_group" && membership.key === groupKey)
      );
      const ceiling = activeGroup.reduce((current, candidate) =>
        candidate.totalXp > current.totalXp
          ? { totalXp: candidate.totalXp, leaderboardXp: candidate.leaderboardXp }
          : current,
      { totalXp: 0, leaderboardXp: 0 });
      policy.capCeilingOverrides = {
        ...policy.capCeilingOverrides,
        related_group: { totalXpCeiling: ceiling.totalXp, leaderboardXpCeiling: ceiling.leaderboardXp },
      };
    }
    return policies;
  }

  private validatePolicies(policies: SeptemberScorePolicy[], context: GamificationContext): string[] {
    const errors: string[] = [];
    const activitiesById = new Map(context.activities.map((activity) => [activity.id, activity]));
    if (!uniqueKeys(policies.map((policy) => policy.key))) errors.push("Score policy keys must be unique.");
    for (const policy of policies) {
      const activity = activitiesById.get(policy.activityId);
      if (!activity || activity.status !== "active" || !activity.enabled) errors.push(`Score policy ${policy.key} has an inactive Activity.`);
      if (!finiteNonNegative(policy.totalXp) || !finiteNonNegative(policy.leaderboardXp) || policy.leaderboardXp > policy.totalXp) {
        errors.push(`Score policy ${policy.key} has incompatible total and Leaderboard XP.`);
      }
      if (activity?.kind === "meta") {
        const achievement = context.achievements.find((candidate) => candidate.id === activity.achievement);
        const expectedBand = achievement ? metaScoreBandForRule(achievement.unlock_rule) : undefined;
        if (!expectedBand || policy.totalXp !== expectedBand.totalXp || policy.leaderboardXp !== expectedBand.leaderboardXp) {
          errors.push(`Meta score policy ${policy.key} does not match its required fixed score band.`);
        }
        const memberships = policy.capMembership || [];
        const hasMembership = (dimension: GamificationCapMembership["dimension"], key: string) =>
          memberships.some((membership) => membership.dimension === dimension && membership.key === key);
        if (
          !hasMembership("category", "meta") ||
          !hasMembership("conference_day", policy.scoreDay || "") ||
          !hasMembership("conference", "conference") ||
          !policy.scoreDay
        ) {
          errors.push(`Meta score policy ${policy.key} must include meta category, day, and conference caps.`);
        }
      }
      if (activity?.kind === "booth" && isEvidenceChannel(activity.evidence_channel)) {
        const outcome = isBoothOutcome(activity.outcome_key) ? activity.outcome_key : undefined;
        const expected = outcome ? BOOTH_SCORE_BANDS[outcome] : undefined;
        if (!expected || policy.totalXp !== expected.totalXp || policy.leaderboardXp !== expected.leaderboardXp) {
          errors.push(`Booth score policy ${policy.key} does not match its fixed outcome band.`);
        }
        const memberships = policy.capMembership || [];
        const hasMembership = (dimension: GamificationCapMembership["dimension"], key: string) =>
          memberships.some((membership) => membership.dimension === dimension && membership.key === key);
        if (
          !activity.partner ||
          !hasMembership("related_group", activity.mission ? boothCapGroupKey(context.missions.find((candidate) => candidate.id === activity.mission)?.key || "") : "") ||
          !hasMembership("partner", activity.partner) ||
          !hasMembership("category", "booth") ||
          !hasMembership("conference_day", policy.scoreDay || "") ||
          !hasMembership("conference", "conference")
        ) {
          errors.push(`Booth score policy ${policy.key} must include booth-group, partner, category, day, and conference caps.`);
        }
        if (!policy.scoreDay) errors.push(`Booth score policy ${policy.key} requires a conference day.`);
      }
      if (activity?.kind === "community_partner") {
        const mission = activity.mission ? context.missions.find((candidate) => candidate.id === activity.mission) : undefined;
        const approvedTwoCode = mission?.metadata?.community_two_code_approved === true;
        const directBand = isCommunityPartnerOutcome(activity.outcome_key)
          ? COMMUNITY_PARTNER_SCORE_BANDS[activity.outcome_key]
          : undefined;
        const relatedGroupKey = policy.capMembership.find((membership) => membership.dimension === "related_group")?.key;
        const activeProgrammePolicies = policies.filter((candidate) =>
          candidate.kind === "community_partner" &&
          candidate.capMembership.some((membership) => membership.dimension === "related_group" && membership.key === relatedGroupKey)
        );
        const programmeCeiling = approvedTwoCode
          ? { totalXp: 40, leaderboardXp: 30 }
          : activeProgrammePolicies.reduce((current, candidate) =>
            candidate.totalXp > current.totalXp
              ? { totalXp: candidate.totalXp, leaderboardXp: candidate.leaderboardXp }
              : current,
          { totalXp: 0, leaderboardXp: 0 });
        const expected = approvedTwoCode
          ? activity.evidence_mode === "two_code_start"
            ? { totalXp: 10, leaderboardXp: 5 }
            : activity.evidence_mode === "derived_claim_set"
            ? { totalXp: 30, leaderboardXp: 25 }
            : undefined
          : activity.evidence_mode === "single_code" && directBand
          ? directBand
          : undefined;
        if (!expected || policy.totalXp !== expected.totalXp || policy.leaderboardXp !== expected.leaderboardXp) {
          errors.push(`Community Partner score policy ${policy.key} does not match its fixed outcome band.`);
        }
        const memberships = policy.capMembership || [];
        const hasMembership = (dimension: GamificationCapMembership["dimension"], key: string) =>
          memberships.some((membership) => membership.dimension === dimension && membership.key === key);
        if (
          !mission ||
          !activity.partner ||
          !hasMembership("related_group", mission.key) ||
          !hasMembership("partner", activity.partner) ||
          !hasMembership("category", "community") ||
          !hasMembership("conference_day", policy.scoreDay || "") ||
          !hasMembership("conference", "conference") ||
          !policy.scoreDay
        ) {
          errors.push(`Community Partner score policy ${policy.key} must include programme, partner, category, day, and conference caps.`);
        }
        const relatedOverride = policy.capCeilingOverrides?.related_group;
        if (
          expected &&
          (!relatedOverride || relatedOverride.totalXpCeiling !== programmeCeiling.totalXp || relatedOverride.leaderboardXpCeiling !== programmeCeiling.leaderboardXp)
        ) {
          errors.push(`Community Partner score policy ${policy.key} has an invalid programme ceiling.`);
        }
      }
      if (activity?.kind === "session") {
        const memberships = policy.capMembership || [];
        const hasMembership = (dimension: GamificationCapMembership["dimension"], key: string) =>
          memberships.some((membership) => membership.dimension === dimension && membership.key === key);
        if (policy.totalXp !== 20 || policy.leaderboardXp !== 15) {
          errors.push(`Session score policy ${policy.key} does not match the fixed 20/15 score band.`);
        }
        if (
          !hasMembership("category", "session") ||
          !hasMembership("conference_day", policy.scoreDay || "") ||
          !hasMembership("conference", "conference") ||
          !policy.scoreDay
        ) {
          errors.push(`Session score policy ${policy.key} must include session category, day, and conference caps.`);
        }
      }
      if (activity?.kind === "easter_egg" || activity?.category === "easter_egg") {
        try {
          this.assertEasterEggScorePolicy(activity, {
            scheduleId: "",
            policyKey: policy.key,
            enabled: policy.active,
            totalXp: policy.totalXp,
            leaderboardXp: policy.leaderboardXp,
            capMembership: policy.capMembership,
            capCeilingOverrides: Object.fromEntries(Object.entries(policy.capCeilingOverrides || {}).map(([dimension, ceiling]) => [dimension, {
              total_xp_ceiling: ceiling.totalXpCeiling,
              leaderboard_xp_ceiling: ceiling.leaderboardXpCeiling,
            }])) as GamificationScoreSchedulePolicyRecord["cap_ceiling_overrides"],
            scoreDay: policy.scoreDay,
          });
        } catch (error) {
          errors.push(error instanceof Error ? `Easter egg score policy ${policy.key} is invalid: ${error.message}` : `Easter egg score policy ${policy.key} is invalid.`);
        }
      }
      if (policy.scoreDay && !isISODate(policy.scoreDay)) errors.push(`Score policy ${policy.key} has an invalid score day.`);
      const memberships = policy.capMembership || [];
      if (!memberships.some((membership) => membership.dimension === "activity" && membership.key === policy.activityId)) {
        errors.push(`Score policy ${policy.key} must include its Activity cap membership.`);
      }
      if (!uniqueKeys(memberships.map((membership) => `${membership.dimension}:${membership.key}`))) {
        errors.push(`Score policy ${policy.key} repeats a cap membership.`);
      }
      for (const membership of memberships) {
        if (!(CAP_DIMENSIONS as readonly string[]).includes(membership.dimension) || !cleanText(membership.key)) {
          errors.push(`Score policy ${policy.key} has an invalid cap membership.`);
        }
        if (!["activity", "related_group", "partner", "category", "conference_day", "conference"].includes(membership.dimension)) {
          errors.push(`Score policy ${policy.key} has an unsupported cap membership.`);
        }
        if (membership.dimension === "partner" && activity?.partner !== membership.key) {
          errors.push(`Score policy ${policy.key} partner cap must match the Activity partner.`);
        }
        if (membership.dimension === "category" && activity?.category !== membership.key) {
          errors.push(`Score policy ${policy.key} category cap must match the Activity category.`);
        }
        if (membership.dimension === "conference_day" && policy.scoreDay !== membership.key) {
          errors.push(`Score policy ${policy.key} conference-day cap must match its score day.`);
        }
        if (membership.dimension === "conference" && membership.key !== "conference") {
          errors.push(`Score policy ${policy.key} conference cap must use the conference key.`);
        }
      }
    }
    return errors;
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
      if (JSON.stringify(existing.after_summary || {}) !== JSON.stringify(afterSummary)) {
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
        JSON.stringify(existing.after_summary || {}) !== JSON.stringify(afterSummary)
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
}
