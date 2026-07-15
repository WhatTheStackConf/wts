import { RecordModel } from "pocketbase";

// User collection type
export interface UserRecord extends RecordModel {
  id: string;
  email: string;
  emailVisibility: boolean;
  username: string;
  name: string;
  avatar: string;
  created: string;
  updated: string;
  role: "user" | "reviewer" | "admin";
  verified?: boolean;
}

// CFP Applicant collection type
export interface CfpApplicantRecord extends RecordModel {
  id: string;
  affiliation: string;
  bio: string;
  social_handles?: any; // JSON field
  preferred_contact_method: string;
  previous_talks?: string;
  user: string; // relation to users collection
  created: string;
  updated: string;
}

// CFP Submission collection type
export interface CfpSubmissionRecord extends RecordModel {
  id: string;
  session_title: string;
  abstract: string;
  key_takeaways: string;
  technical_requirements?: string;
  notes?: string;
  applicant: string; // relation to cfp_applicants collection
  created: string;
  updated: string;
  status?: "pending" | "accepted" | "rejected";
  meta?: any; // JSON field containing expenses, notes, etc.
}

// Speaker collection type (public conference persona)
export interface SpeakerRecord extends RecordModel {
  id: string;
  slug: string;
  published: boolean;
  origin: "cfp" | "invite";
  display_name?: string;
  user?: string;
  cfp_applicant?: string;
  photo?: string;
  affiliation?: string;
  bio?: string;
  social_handles?: unknown;
  /** Optional promo page overrides: statusMessage, roleLine, stack[], ctaHref, ctaLabel, footerText, footerLinks[] */
  promo?: unknown;
  created: string;
  updated: string;
}

// Session collection type (public programme item)
export interface SessionRecord extends RecordModel {
  id: string;
  slug: string;
  published: boolean;
  title: string;
  abstract: string;
  format?: string;
  /** Legacy migration data. Canonical schedule data lives on agenda_slots. */
  starts_at?: string;
  /** Legacy migration data. Canonical schedule data lives on agenda_slots. */
  track?: string;
  /** Legacy migration data. Canonical schedule data lives on agenda_slots. */
  room?: string;
  speakers?: string[];
  cfp_submission?: string;
  created: string;
  updated: string;
}

export interface ConferenceDayRecord extends RecordModel {
  id: string;
  key: string;
  local_date: string;
  title: string;
  display_order: number;
  published: boolean;
  created: string;
  updated: string;
}

export interface AgendaTrackRecord extends RecordModel {
  id: string;
  day: string;
  key: string;
  name: string;
  location_label?: string;
  display_order: number;
  created: string;
  updated: string;
}

export type AgendaSlotKind =
  | "session"
  | "break"
  | "meal"
  | "networking"
  | "opening"
  | "closing"
  | "other";

export interface AgendaSlotRecord extends RecordModel {
  id: string;
  day: string;
  track?: string;
  start_at: string;
  end_at: string;
  kind: AgendaSlotKind;
  published: boolean;
  display_order: number;
  location_label?: string;
  session?: string;
  title?: string;
  summary?: string;
  created: string;
  updated: string;
}

export type GamificationCategory =
  | "onboarding"
  | "ticketing"
  | "attendance"
  | "session"
  | "partner"
  | "booth"
  | "workshop"
  | "satellite_event"
  | "warmup_event"
  | "community"
  | "social"
  | "easter_egg"
  | "meta"
  | "admin_manual";

export type GamificationAchievementVisibility =
  | "public"
  | "locked_teaser"
  | "hidden_until_unlocked"
  | "retired";

export type GamificationDefinitionStatus = "draft" | "active" | "retired";

/** Meta rules can require qualifying evidence from distinct source entities. */
export type GamificationMetaSourceDiversity = "session" | "booth" | "community";

export interface GamificationUnlockRule {
  kind: "activity_claim" | "claim_count" | "claim_set" | "manual_only";
  activityKeys?: string[];
  activity_keys?: string[];
  category?: GamificationCategory;
  count?: number;
  diversity?: GamificationMetaSourceDiversity;
  sourceDiversity?: GamificationMetaSourceDiversity;
  source_diversity?: GamificationMetaSourceDiversity;
  [key: string]: unknown;
}

export interface GamificationAchievementRecord extends RecordModel {
  id: string;
  key: string;
  badge_name: string;
  badge_description: string;
  locked_teaser?: string;
  icon?: string;
  category: GamificationCategory;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  visibility: GamificationAchievementVisibility;
  status: GamificationDefinitionStatus;
  unlock_rule: GamificationUnlockRule;
  active_from?: string;
  active_until?: string;
  sort_order: number;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export interface GamificationMissionRecord extends RecordModel {
  id: string;
  key: string;
  slug: string;
  title: string;
  summary: string;
  category: GamificationCategory;
  visibility: "public" | "hidden_until_unlocked" | "admin_only";
  status: GamificationDefinitionStatus;
  starts_at?: string;
  ends_at?: string;
  primary_achievement?: string;
  partner?: string;
  partner_key?: string;
  session?: string;
  event_ref?: Record<string, unknown>;
  suggested: boolean;
  sort_order: number;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export type GamificationActivityKind =
  | "session"
  | "booth"
  | "workshop"
  | "warmup_event"
  | "satellite_event"
  | "community_partner"
  | "social"
  | "easter_egg"
  | "hievents"
  | "admin_manual"
  | "meta";

export type GamificationEvidenceMode =
  | "single_code"
  | "two_code_start"
  | "two_code_finish"
  | "hievents_ticket"
  | "hievents_checkin"
  | "static_puzzle_code"
  | "admin_manual"
  | "derived_claim_set"
  | "meta_rule";

export type GamificationEvidenceChannel = "wts_qr" | "wts_link" | "wts_manual_code" | "wts_static_code";

/** Immutable, schedule-free presentation captured when a Session Mission is configured. */
export interface GamificationSessionDisplaySnapshot {
  title: string;
  slug: string;
  format?: string;
}

export interface GamificationActivityRecord extends RecordModel {
  id: string;
  key: string;
  mission?: string;
  kind: GamificationActivityKind;
  category: GamificationCategory;
  outcome_key: string;
  evidence_mode: GamificationEvidenceMode;
  evidence_channel?: GamificationEvidenceChannel;
  deployment_label?: string;
  achievement?: string;
  partner?: string;
  partner_kind?: "sponsor" | "community_partner" | "organizer" | "workshop_host";
  session?: string;
  session_key?: string;
  session_display_snapshot?: GamificationSessionDisplaySnapshot;
  session_meta_eligible?: boolean;
  event_ref?: Record<string, unknown>;
  event_meta_eligible?: boolean;
  community_meta_eligible?: boolean;
  per_user_claim_limit: number;
  max_claims?: number;
  active_from?: string;
  active_until?: string;
  status: GamificationDefinitionStatus;
  enabled: boolean;
  partner_follow_up_enabled?: boolean;
  partner_follow_up_notice_version?: string;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export type GamificationCodeEvidenceRole = "single" | "start" | "finish" | "static_puzzle";

export type GamificationCodeStatus = "active" | "disabled";

/** Private server-only definition. code_hash is never sent to browser clients. */
export interface GamificationCodeRecord extends RecordModel {
  id: string;
  key: string;
  label: string;
  activity: string;
  lookup_prefix: string;
  code_hash: string;
  hash_version: "hmac-sha256-v1";
  evidence_role: GamificationCodeEvidenceRole;
  status: GamificationCodeStatus;
  enabled: boolean;
  starts_at?: string;
  ends_at?: string;
  max_redemptions?: number;
  per_user_limit: number;
  total_redemptions_cached: number;
  created_by: string;
  /** Non-secret operation identifier for a one-time code batch. */
  batch_id?: string;
  /** Reissued replacements retain a non-secret link to their disabled predecessor. */
  reissued_from?: string;
  invalidated_at?: string;
  invalidated_by?: string;
  invalidated_reason?: string;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export type GamificationCodeRedemptionStatus =
  | "accepted"
  | "rejected_not_yet_active"
  | "rejected_expired"
  | "rejected_disabled"
  | "rejected_global_limit"
  | "rejected_user_limit";

/** Private server-only redemption and support audit history. */
export interface GamificationCodeRedemptionRecord extends RecordModel {
  id: string;
  user: string;
  code: string;
  activity: string;
  activity_claim?: string;
  status: GamificationCodeRedemptionStatus;
  redeemed_at: string;
  idempotency_key: string;
  source_hint?: string;
  request_fingerprint?: string;
  lookup_prefix?: string;
  hash_version?: string;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export interface GamificationCapMembership {
  dimension: "activity" | "related_group" | "partner" | "category" | "conference_day" | "conference";
  key: string;
}

export interface GamificationScoreScheduleRecord extends RecordModel {
  id: string;
  key: string;
  status: "draft" | "active" | "superseded";
  effective_at: string;
  superseded_at?: string;
  total_xp_ceiling: number;
  leaderboard_xp_ceiling: number;
  access_level_thresholds: Record<string, number>;
  activation_reason?: string;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export interface GamificationScoreSchedulePolicyRecord extends RecordModel {
  id: string;
  schedule: string;
  activity: string;
  policy_key: string;
  active: boolean;
  total_xp: number;
  leaderboard_xp: number;
  cap_membership: GamificationCapMembership[];
  cap_ceiling_overrides?: Partial<Record<GamificationCapMembership["dimension"], {
    total_xp_ceiling: number;
    leaderboard_xp_ceiling: number;
  }>>;
  score_day?: string;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export interface GamificationScoreScheduleCapRecord extends RecordModel {
  id: string;
  schedule: string;
  dimension: GamificationCapMembership["dimension"];
  cap_key: string;
  member_policy_keys: string[];
  total_xp_ceiling: number;
  leaderboard_xp_ceiling: number;
  created: string;
  updated: string;
}

export interface GamificationActivityClaimRecord extends RecordModel {
  id: string;
  user: string;
  activity: string;
  source_type: "code_redemption" | "hievents_ticket" | "hievents_checkin" | "admin_manual" | "static_puzzle_code" | "system_meta" | "system_derived";
  source_collection?: string;
  source_record_id?: string;
  outcome_key: string;
  status: "accepted" | "voided";
  occurred_at: string;
  claimed_at: string;
  evidence_fingerprint: string;
  idempotency_key: string;
  voided_at?: string;
  voided_by?: string;
  void_reason?: string;
  void_admin_action?: string;
  cap_outcome?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export interface GamificationUserAchievementRecord extends RecordModel {
  id: string;
  user: string;
  achievement: string;
  status: "unlocked" | "revoked";
  unlocked_at: string;
  source_claim?: string;
  source_admin_action?: string;
  idempotency_key: string;
  public_visible: boolean;
  revoked_at?: string;
  revoked_by?: string;
  revoked_reason?: string;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export interface GamificationXpEventRecord extends RecordModel {
  id: string;
  user: string;
  amount: number;
  leaderboard_amount: number;
  category: GamificationCategory;
  reason: string;
  source_type: "activity_claim" | "admin_correction";
  source_claim?: string;
  user_achievement?: string;
  source_id?: string;
  idempotency_key: string;
  occurred_at: string;
  voided: boolean;
  voided_at?: string;
  voided_by?: string;
  void_reason?: string;
  void_admin_action?: string;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export interface GamificationProfileRecord extends RecordModel {
  id: string;
  user: string;
  total_xp: number;
  leaderboard_xp: number;
  access_level: number;
  access_level_schedule?: string;
  access_level_threshold: number;
  next_level_threshold: number;
  xp_into_level: number;
  xp_to_next_level: number;
  unlocked_badge_count: number;
  ops_board_visible: boolean;
  ops_board_display_name: string;
  public_badges_visible: boolean;
  totals_version: number;
  totals_recalculated_at: string;
  rebuild_pending?: boolean;
  rebuild_support_reference?: string;
  created: string;
  updated: string;
}

export type HiEventsEvidenceState =
  | "ticket_present"
  | "checked_in"
  | "no_ticket"
  | "not_checked_in"
  | "unavailable"
  | "stale"
  | "ambiguous"
  | "source_corrected";

/** Private source-status history. It deliberately stores no attendee identity or ticket details. */
export interface GamificationHiEventsSyncRunRecord extends RecordModel {
  id: string;
  user?: string;
  actor?: string;
  admin_action?: string;
  event_id: string;
  scope: "current_user" | "admin_reconciliation";
  result_state: "success" | "partial" | "unavailable";
  user_status?: HiEventsEvidenceState;
  fetched_at: string;
  last_success_at?: string;
  source_updated_at?: string;
  requested_pages: number;
  completed_pages: number;
  complete: boolean;
  matched_count: number;
  ambiguous_count: number;
  created_claim_count: number;
  corrected_claim_count: number;
  source_stable_id?: string;
  checkin_id?: string;
  checked_in_at?: string;
  created: string;
  updated: string;
}

export interface GamificationAdminActionRecord extends RecordModel {
  id: string;
  actor: string;
  actor_role: "user" | "reviewer" | "admin";
  target_user?: string;
  action: "manual_award" | "revoke_user_achievement" | "void_xp_event" | "void_activity_claim" | "admin_correction" | "rebuild_profile_cache" | "configuration_change" | "schedule_activation" | "hievents_reconciliation" | "code_generation" | "code_invalidation" | "code_reissue";
  status: "applied" | "rebuild_pending" | "failed";
  reason: string;
  correlation_id?: string;
  idempotency_key: string;
  related_collection?: string;
  related_record_id?: string;
  before_summary?: Record<string, unknown>;
  after_summary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created: string;
  updated: string;
}

export type PartnerContactConsentPurpose = "partner_follow_up";
export type PartnerContactConsentState = "granted" | "withdrawn";

/** Private consent ledger. It stores field names, never a copied name or email. */
export interface PartnerContactConsentRecord extends RecordModel {
  id: string;
  user: string;
  partner: string;
  activity: string;
  purpose: PartnerContactConsentPurpose;
  notice_version: string;
  approved_fields: Array<"name" | "email">;
  state: PartnerContactConsentState;
  granted_at: string;
  withdrawn_at?: string;
  created: string;
  updated: string;
}

/** Private audit of a manual, one-time partner contact handoff. No contact values are retained. */
export interface PartnerContactDisclosureRecord extends RecordModel {
  id: string;
  consent: string;
  user: string;
  partner: string;
  activity: string;
  actor: string;
  purpose: PartnerContactConsentPurpose;
  approved_fields: Array<"name" | "email">;
  disclosed_at: string;
  created: string;
  updated: string;
}

// Partner/sponsor collection type (public conference organizations)
export interface PartnerRecord extends RecordModel {
  id: string;
  name: string;
  published: boolean;
  type:
    | "organizer"
    | "sponsor"
    | "supporter"
    | "community_partner"
    | "media"
    | "catering"
    | "other";
  tier?: "platinum" | "gold" | "silver" | "bronze";
  logo?: string;
  url?: string;
  notes?: string;
  normalized_name: string;
  canonical_url?: string;
  mutation_token: string;
  logo_uploaded_by_human: boolean;
  note_agent_visible: boolean;
  created: string;
  updated: string;
}

export interface AdminActionRecord extends RecordModel {
  id: string;
  actor_user: string;
  mcp_token?: string;
  source: "admin_ui" | "mcp";
  operation_kind: string;
  target_collection: string;
  target_id?: string;
  operation_id: string;
  input_fingerprint: string;
  idempotency_key: string;
  status: "pending" | "applied" | "failed";
  before_summary?: unknown;
  after_summary?: unknown;
  replay_result?: unknown;
  failure_code?: string;
  failure_message?: string;
  failure_metadata?: unknown;
  attempt_count: number;
  attempt_token: string;
  lease_expires_at?: string;
  completed_at?: string;
  created: string;
  updated: string;
}

// MCP token collection type (admin-created remote MCP access tokens)
export interface McpTokenRecord extends RecordModel {
  id: string;
  name: string;
  token_id: string;
  token_prefix: string;
  secret_hash: string;
  scopes?: string[];
  created_by: string;
  expires_at?: string;
  revoked_at?: string;
  revoked_by?: string;
  revocation_reason?: string;
  last_used_at?: string;
  created: string;
  updated: string;
}

// CFP Review collection type
export interface CfpReviewRecord extends RecordModel {
  id: string;
  submission: string; // relation to cfp_submissions
  reviewer: string;   // relation to users
  score_relevance: number;   // 1-5
  score_originality: number; // 1-5
  score_depth: number;       // 1-5
  score_clarity: number;     // 1-5
  score_takeaways: number;   // 1-5
  score_engagement: number;  // 1-5
  notes?: string;
  is_llm_suspected: boolean;
  created: string;
  updated: string;
}

export interface CfpWeightVoteRecord extends RecordModel {
  id: string;
  user: string;
  relevance: number;
  originality: number;
  depth: number;
  clarity: number;
  takeaways: number;
  engagement: number;
  created: string;
  updated: string;
}

// Type for authentication data
export interface AuthData {
  record: UserRecord;
  token: string;
}

// Union type for all possible collections
export type CollectionRecord =
  | UserRecord
  | CfpApplicantRecord
  | CfpSubmissionRecord
  | CfpReviewRecord
  | CfpWeightVoteRecord
  | SpeakerRecord
  | SessionRecord
  | ConferenceDayRecord
  | AgendaTrackRecord
  | AgendaSlotRecord
  | GamificationAchievementRecord
  | GamificationMissionRecord
  | GamificationActivityRecord
  | GamificationCodeRecord
  | GamificationCodeRedemptionRecord
  | GamificationScoreScheduleRecord
  | GamificationScoreSchedulePolicyRecord
  | GamificationScoreScheduleCapRecord
  | GamificationActivityClaimRecord
  | GamificationUserAchievementRecord
  | GamificationXpEventRecord
  | GamificationProfileRecord
  | GamificationHiEventsSyncRunRecord
  | GamificationAdminActionRecord
  | PartnerContactConsentRecord
  | PartnerContactDisclosureRecord
  | PartnerRecord
  | AdminActionRecord
  | McpTokenRecord;

// Type guard functions
export function isUserRecord(record: CollectionRecord): record is UserRecord {
  return (
    (record as any).collectionId === "users" ||
    (record as any).collectionName === "users"
  );
}

export function isCfpApplicantRecord(
  record: CollectionRecord,
): record is CfpApplicantRecord {
  return (record as any).collectionName === "cfp_applicants";
}

export function isCfpSubmissionRecord(
  record: CollectionRecord,
): record is CfpSubmissionRecord {
  return (record as any).collectionName === "cfp_submissions";
}

export function isCfpReviewRecord(
  record: CollectionRecord,
): record is CfpReviewRecord {
  return (record as any).collectionName === "cfp_reviews";
}

export function isSpeakerRecord(
  record: CollectionRecord,
): record is SpeakerRecord {
  return (record as any).collectionName === "speakers";
}

export function isSessionRecord(
  record: CollectionRecord,
): record is SessionRecord {
  return (record as any).collectionName === "sessions";
}

export function isConferenceDayRecord(
  record: CollectionRecord,
): record is ConferenceDayRecord {
  return (record as any).collectionName === "conference_days";
}

export function isAgendaTrackRecord(
  record: CollectionRecord,
): record is AgendaTrackRecord {
  return (record as any).collectionName === "agenda_tracks";
}

export function isAgendaSlotRecord(
  record: CollectionRecord,
): record is AgendaSlotRecord {
  return (record as any).collectionName === "agenda_slots";
}

export function isPartnerRecord(
  record: CollectionRecord,
): record is PartnerRecord {
  return (record as any).collectionName === "partners";
}

export function isMcpTokenRecord(
  record: CollectionRecord,
): record is McpTokenRecord {
  return (record as any).collectionName === "mcp_tokens";
}
