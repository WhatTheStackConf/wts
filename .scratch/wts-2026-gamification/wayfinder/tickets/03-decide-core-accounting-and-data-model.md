# Decide Core Accounting And Data Model

Status: closed
Assignee: OpenCode
Labels: wayfinder:prototype
Type: HITL
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

What concrete domain/data model should support the September conference release without overfitting to nonessential later gamification ideas?

Produce a rough schema/interface prototype covering achievements, User achievements, activity claims, XP events, Gamification Profiles, code definitions, code redemptions, automated partner activity evidence if in scope, and cached totals. Decide which records are authoritative, which are cached, what idempotency keys look like, how voiding works, and which writes must only happen server-side.

## Blocked by

- `.scratch/wts-2026-gamification/wayfinder/tickets/01-define-gamification-language-and-destination.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/02-decide-september-conference-release-scope.md`

## Resolution

Use a small accounting core with configurable definitions and server-created evidence. The September release should not add Partner/staff verifier accounts, routine scanner awarding, attendee-to-attendee scans, team/faction records, or server-side puzzle answer validation. Those ideas either remain out of scope or are represented as automated evidence, static codes, or audited admin corrections.

### Authoritative collections

- `gamification_achievements`: authoritative **Achievement** catalog and Badge presentation config.
- `gamification_missions`: user-facing **Mission** definitions and display grouping.
- `gamification_activities`: configured activity/outcome definitions that normalize booth, workshop, Session, Hi.Events, Community Partner, static easter egg, meta, and admin/manual cases.
- `gamification_codes`: hashed QR/link/manual/static-puzzle code definitions.
- `gamification_code_redemptions`: per-**User** valid code redemption history for duplicate handling and code limits.
- `gamification_activity_claims`: authoritative accepted **Activity Claim** evidence.
- `gamification_user_achievements`: authoritative per-**User** Badge unlock state.
- `gamification_xp_events`: authoritative append-only-style XP ledger with voiding fields.
- `gamification_profiles`: rebuildable **Gamification Profile** cache for fast profile and ops-board reads.
- `gamification_admin_actions`: audited admin/support actions for manual awards, revocations, voids, code invalidation, and cache rebuilds.
- `partner_contact_consents` or equivalent separate consent collection: not part of XP accounting; keeps lead/contact sharing separate from **Partner Activity** evidence.

No September collection is needed for `verifiers`, `factions`, `teams`, peer scans, or puzzle-answer validators.

### Interface prototype

```ts
type GamificationCategory =
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

type EvidenceMode =
  | "single_code"
  | "two_code_start"
  | "two_code_finish"
  | "hievents_ticket"
  | "hievents_checkin"
  | "static_puzzle_code"
  | "admin_manual"
  | "meta_rule";

type ActivityKind =
  | "session"
  | "partner_activity"
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

interface Achievement {
  id: string;
  key: string;
  badgeName: string;
  badgeDescription: string;
  lockedTeaser?: string;
  icon?: string;
  category: GamificationCategory;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  visibility: "public" | "locked_teaser" | "hidden_until_unlocked" | "retired";
  status: "draft" | "active" | "retired";
  baseXp: number;
  leaderboardXpPolicy: "same_as_total" | "zero" | "custom";
  leaderboardXp?: number;
  unlockRule: {
    kind: "activity_claim" | "claim_count" | "claim_set" | "manual_only";
    activityKeys?: string[];
    category?: GamificationCategory;
    count?: number;
  };
  activeFrom?: string;
  activeUntil?: string;
  sortOrder: number;
  metadata?: Record<string, unknown>;
}

interface MissionDefinition {
  id: string;
  key: string;
  slug: string;
  title: string;
  summary: string;
  category: GamificationCategory;
  visibility: "public" | "hidden_until_unlocked" | "admin_only";
  status: "draft" | "active" | "retired";
  startsAt?: string;
  endsAt?: string;
  primaryAchievement?: string;
  partner?: string;
  session?: string;
  eventRef?: { kind: "workshop" | "warmup" | "satellite" | "social"; idOrSlug: string };
  suggested: boolean;
  sortOrder: number;
  metadata?: Record<string, unknown>;
}

interface ActivityDefinition {
  id: string;
  key: string;
  mission?: string;
  kind: ActivityKind;
  category: GamificationCategory;
  outcomeKey:
    | "visit"
    | "participation"
    | "completion"
    | "win"
    | "high_score"
    | "attendance"
    | "ticket_present"
    | "checked_in"
    | "static_discovery"
    | "manual_award"
    | "meta";
  evidenceMode: EvidenceMode;
  achievement?: string;
  partner?: string;
  partnerKind?: "sponsor" | "community_partner" | "organizer" | "workshop_host";
  session?: string;
  eventRef?: MissionDefinition["eventRef"];
  perUserClaimLimit: number;
  maxClaims?: number;
  activeFrom?: string;
  activeUntil?: string;
  enabled: boolean;
  capKey?: string;
  metadata?: Record<string, unknown>;
}

interface CodeDefinition {
  id: string;
  key: string;
  label: string;
  activity: string;
  codeHash: string;
  lookupPrefix: string;
  evidenceRole: "single" | "start" | "finish" | "static_puzzle";
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
  maxRedemptions?: number;
  perUserLimit: number;
  totalRedemptionsCached: number;
  createdBy: string;
  invalidatedAt?: string;
  invalidatedBy?: string;
  invalidatedReason?: string;
  metadata?: Record<string, unknown>;
}

interface CodeRedemption {
  id: string;
  user: string;
  code: string;
  activity: string;
  activityClaim?: string;
  status:
    | "accepted"
    | "rejected_disabled"
    | "rejected_expired"
    | "rejected_global_limit"
    | "rejected_user_limit";
  redeemedAt: string;
  idempotencyKey: string;
  requestFingerprint?: string;
  metadata?: Record<string, unknown>;
}

interface ActivityClaim {
  id: string;
  user: string;
  activity: string;
  sourceType:
    | "code_redemption"
    | "hievents_ticket"
    | "hievents_checkin"
    | "admin_manual"
    | "static_puzzle_code"
    | "system_meta";
  sourceCollection?: string;
  sourceRecordId?: string;
  outcomeKey: ActivityDefinition["outcomeKey"];
  status: "accepted" | "voided";
  occurredAt: string;
  claimedAt: string;
  evidenceFingerprint: string;
  idempotencyKey: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  metadata?: Record<string, unknown>;
}

interface UserAchievement {
  id: string;
  user: string;
  achievement: string;
  status: "unlocked" | "revoked";
  unlockedAt: string;
  sourceClaim?: string;
  sourceAdminAction?: string;
  idempotencyKey: string;
  publicVisible: boolean;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  metadata?: Record<string, unknown>;
}

interface XPEvent {
  id: string;
  user: string;
  amount: number;
  leaderboardAmount: number;
  category: GamificationCategory;
  reason: string;
  sourceType: "achievement_unlock" | "activity_claim" | "admin_correction";
  sourceClaim?: string;
  userAchievement?: string;
  adminAction?: string;
  idempotencyKey: string;
  occurredAt: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  voidAdminAction?: string;
  metadata?: Record<string, unknown>;
}

interface GamificationProfile {
  id: string;
  user: string;
  totalXp: number;
  leaderboardXp: number;
  level: number;
  levelName: string;
  xpIntoLevel: number;
  xpToNextLevel: number;
  unlockedAchievementCount: number;
  recentUserAchievements: string[];
  opsBoardVisible: boolean;
  opsBoardDisplayName: string;
  publicBadgesVisible: boolean;
  totalsVersion: number;
  totalsRecalculatedAt: string;
}

interface GamificationAdminAction {
  id: string;
  actor: string;
  targetUser?: string;
  action:
    | "manual_award"
    | "revoke_user_achievement"
    | "void_xp_event"
    | "invalidate_code"
    | "rebuild_profile_cache";
  reason: string;
  relatedCollection?: string;
  relatedRecordId?: string;
  createdRecords?: Array<{ collection: string; id: string }>;
  metadata?: Record<string, unknown>;
  created: string;
}
```

### Authority and caching

- **Activity Claim** records are the authoritative evidence that a **User** completed an activity. They should be created only after server validation of a code, Hi.Events state, admin action, or meta rule.
- `gamification_user_achievements` is the authoritative Badge unlock table. It is unique by `user + achievement`. Revocation is an audited state change, not deletion.
- `gamification_xp_events` is the authoritative XP ledger. `amount` drives total XP; `leaderboardAmount` drives **Leaderboard XP**. The ledger is never recalculated from Achievements alone.
- `gamification_profiles` is a cache/read model. It is rebuilt from non-voided XP events and non-revoked User Achievements. It should be updated after awards, revocations, voiding, and admin rebuilds.
- `CodeDefinition.totalRedemptionsCached` is a convenience counter for limits and admin views. The authoritative redemption history is `gamification_code_redemptions`.

### Idempotency and uniqueness

Use stable string keys with a version prefix and no raw secrets or emails.

- `activity_claims.idempotency_key`: `activity-claim:v1:{userId}:{activityKey}:{sourceType}:{evidenceFingerprint}`.
- `code_redemptions.idempotency_key`: `code-redemption:v1:{userId}:{codeId}`.
- `user_achievements.idempotency_key`: `user-achievement:v1:{userId}:{achievementKey}`.
- `xp_events.idempotency_key`: `xp-event:v1:{userId}:{sourceCollection}:{sourceRecordId}:{reasonKey}`.
- Hi.Events ticket claim key: `hievents:v1:{eventId}:{attendeeIdOrEmailHash}:ticket:{userId}`.
- Hi.Events check-in claim key: `hievents:v1:{eventId}:{attendeeIdOrEmailHash}:checkin:{userId}`.
- Admin manual award key: `admin-award:v1:{adminActionId}:{targetUserId}:{achievementKey}`.
- Admin void key: `admin-void:v1:{adminActionId}:{xpEventId}`.

Minimum unique constraints to plan for: `Achievement.key`, `MissionDefinition.key`, `ActivityDefinition.key`, `CodeDefinition.key`, `CodeRedemption.idempotencyKey`, `ActivityClaim.idempotencyKey`, `UserAchievement.user + UserAchievement.achievement`, `XPEvent.idempotencyKey`, and `GamificationProfile.user`.

### Code redemption model

`gamification_codes` stores definitions, not redemptions. Raw codes are generated server-side, shown/downloaded to admins once, and stored only as hashes plus a non-secret lookup prefix. A valid code redemption creates or reuses one `CodeRedemption`, then creates or reuses the corresponding `ActivityClaim`, `UserAchievement`, `XPEvent`, and `GamificationProfile` update. Invalid raw codes should not be persisted with their raw value.

Two-code workshop/event flows use two `ActivityDefinition` records or two `CodeDefinition.evidenceRole` values (`start` and `finish`). Completion Achievements use an `Achievement.unlockRule` that requires the relevant accepted claims.

Static easter egg Missions use `EvidenceMode = "static_puzzle_code"`, but September does not validate puzzle answers server-side. The server only redeems a discovered static code/link/QR through the same hashed-code path.

### Partner Activity evidence

Automated **Partner Activity** evidence is represented by `ActivityDefinition.kind = "partner_activity" | "booth" | "community_partner"` plus a relation to the existing `partners` record and `partnerKind`. Each partner outcome is a distinct activity/outcome definition, such as booth visit, participation, completion, win, high score, or cross-partner meta.

For September, partners and staff do not get verifier accounts or scanner awarding. They receive WTS-admin generated QR/link/code/static evidence per outcome, and support exceptions go through audited admin manual awards. Contact sharing is not implied by earning XP; it belongs in a separate consent collection and can reference the partner/activity when needed.

### Hi.Events evidence hooks

Hi.Events does not need a separate core evidence collection for September. Server functions should fetch or sync Hi.Events data, match the authenticated **User** by normalized email, and normalize ticket/check-in facts into `ActivityClaim` records with `sourceType = "hievents_ticket"` or `"hievents_checkin"`.

The claim metadata should keep only audit-safe fields needed for support, such as `eventId`, `attendeeId`, `productId`, `ticketTitle`, `checkedInAt`, `matchedBy`, and `fetchedAt`. If Hi.Events is unavailable, create no claim and return an unavailable state; do not confuse unavailable with no ticket.

### Admin awards, corrections, and voiding

Manual admin awards are normal accounting events with an audit wrapper: create `GamificationAdminAction(action = "manual_award")`, then an `ActivityClaim(sourceType = "admin_manual")`, then the `UserAchievement` and `XPEvent` records. Manual awards can use `leaderboardAmount = 0` by policy while still increasing total XP if scoring later decides that.

Admin corrections should preserve history:

- Voiding XP sets `XPEvent.voidedAt`, `voidedBy`, `voidReason`, and `voidAdminAction`; it never deletes the event.
- Revoking a Badge sets `UserAchievement.status = "revoked"` with revocation fields; it does not delete the unlock record.
- Voiding XP does not automatically revoke the Badge. Admin tools should let the organizer choose XP-only correction, Badge revocation, or both.
- Negative or positive XP adjustments can be represented as `XPEvent(sourceType = "admin_correction")` linked to a `GamificationAdminAction`.
- Every correction triggers a profile cache rebuild for the affected **User**.

### Server-only writes and public-read boundaries

All writes to Achievement, Mission, ActivityDefinition, CodeDefinition, CodeRedemption, ActivityClaim, UserAchievement, XPEvent, GamificationProfile totals, AdminAction, and partner consent records should go through SolidStart server functions and server-side PocketBase admin access. The server derives the **User** from `requireAuth()` or the admin target from `requireAdmin()`; clients never submit an arbitrary user id to receive a Badge or XP.

Browser/public reads should be DTOs, not raw collection access:

- Public Achievement catalog DTO: active public Achievements and safe locked/hidden teaser fields only.
- Authenticated profile DTO: the current **User**'s Gamification Profile, visible User Achievements, recent XP reasons, and suggested Missions.
- Public ops-board DTO: only profiles with `opsBoardVisible = true`, using safe `opsBoardDisplayName`, rank, level, **Leaderboard XP**, and non-hidden Badge snippets. This is opt-out by default for September.
- Admin DTOs: full history/debug views through `requireAdmin()` only.

The public PocketBase client must not be able to create or directly read raw code hashes, raw Activity Claims, Code Redemptions, XP Events, admin audit records, partner consent records, or non-whitelisted Hi.Events metadata.
