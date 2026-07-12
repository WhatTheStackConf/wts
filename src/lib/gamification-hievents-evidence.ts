import { createHash } from "node:crypto";
import {
  activityClaimIdempotencyKey,
  GAMIFICATION_COLLECTIONS,
  GamificationAccountingService,
  type AccountingUser,
  type GamificationAccountingStore,
} from "~/lib/gamification-accounting";
import {
  fetchHiEventsAttendeeSnapshot,
  normalizeHiEventsEmail,
  type HiEventsAttendeeSnapshot,
  type HiEventsSourceAttendee,
} from "~/lib/hievents";
import type {
  GamificationActivityClaimRecord,
  GamificationActivityRecord,
  GamificationAdminActionRecord,
  GamificationHiEventsSyncRunRecord,
  GamificationMissionRecord,
  HiEventsEvidenceState,
  UserRecord,
} from "~/lib/pocketbase-types";
import { containsMissionCode } from "~/lib/mission-code-crypto";

const TICKET_ACTIVITY_KEY = "conference.main.ticket_present";
const CHECKIN_ACTIVITY_KEY = "conference.main.checked_in";
const STALE_AFTER_MS = Number(process.env.HIEVENTS_STATUS_STALE_MS) || 6 * 60 * 60 * 1000;

export interface HiEventsProfileStatusDto {
  state: HiEventsEvidenceState;
  lastSuccessfulSyncAt?: string;
  lastAttemptAt?: string;
  ticketPresent: boolean;
  checkedIn: boolean;
  message: string;
}

export interface AdminHiEventsReconciliationDto {
  eventId?: string;
  state: "complete" | "partial" | "unavailable" | "not_configured";
  fetchedAt?: string;
  sourceUpdatedAt?: string;
  snapshotFingerprint?: string;
  pagination: {
    requestedPages: number;
    completedPages: number;
    totalPages?: number;
    complete: boolean;
  };
  matchCounts: {
    eligibleAttendees: number;
    matchedUsers: number;
    ambiguousMatches: number;
  };
  proposed: {
    ticketClaims: number;
    checkinClaims: number;
    corrections: number;
  };
  applied?: {
    ticketClaims: number;
    checkinClaims: number;
    corrections: number;
  };
}

interface ConferenceConfiguration {
  eventId: string;
  ticketActivity: GamificationActivityRecord;
  checkinActivity: GamificationActivityRecord;
}

interface EvidencePlan {
  configuration: ConferenceConfiguration;
  snapshot: Extract<HiEventsAttendeeSnapshot, { state: "success" }>;
  matched: Map<string, HiEventsSourceAttendee[]>;
  ambiguousUserIds: Set<string>;
  correctedClaims: GamificationActivityClaimRecord[];
  dto: AdminHiEventsReconciliationDto;
}

interface AwardOutcome {
  ticketClaims: number;
  checkinClaims: number;
  state: HiEventsEvidenceState;
  matchedCount: number;
  ambiguityCount: number;
  sourceStableId?: string;
  checkinId?: string;
  checkedInAt?: string;
}

export interface GamificationHiEventsEvidenceOptions {
  fetchSnapshot?: () => Promise<HiEventsAttendeeSnapshot>;
  clock?: () => string;
  staleAfterMs?: number;
}

function now(): string {
  return new Date().toISOString();
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function eventRefId(activity: GamificationActivityRecord): string | undefined {
  const eventRef = activity.event_ref;
  if (!eventRef || typeof eventRef !== "object" || Array.isArray(eventRef)) return undefined;
  return text(eventRef.eventId) || text(eventRef.event_id) || text(eventRef.eventKey) || text(eventRef.event_key);
}

function latest<T extends { fetched_at: string }>(runs: T[]): T | undefined {
  return runs.reduce<T | undefined>((current, candidate) =>
    !current || Date.parse(candidate.fetched_at) >= Date.parse(current.fetched_at) ? candidate : current,
  undefined);
}

function profileMessage(state: HiEventsEvidenceState): string {
  switch (state) {
    case "checked_in": return "Venue check-in is recorded. Your attendance progress is up to date.";
    case "ticket_present": return "Ticket confirmed. Refresh after venue check-in to record attendance progress.";
    case "not_checked_in": return "Ticket confirmed. Check-in has not been recorded yet; refresh after arrival.";
    case "no_ticket": return "No eligible conference ticket was found for this profile email. If you used another email, contact support.";
    case "ambiguous": return "Your ticket could not be linked automatically. Contact support and include your WTS profile email.";
    case "source_corrected": return "Ticket progress was updated from a complete conference source sync. Contact support if this looks unexpected.";
    case "unavailable": return "Ticket status is temporarily unavailable. Existing progress is preserved; please try again later.";
    case "stale": return "Ticket status has not been checked recently. Refresh to update conference progress.";
  }
}

function safeStatus(state: HiEventsEvidenceState, run?: GamificationHiEventsSyncRunRecord): HiEventsProfileStatusDto {
  return {
    state,
    lastSuccessfulSyncAt: run?.last_success_at,
    lastAttemptAt: run?.fetched_at,
    ticketPresent: state === "ticket_present" || state === "not_checked_in" || state === "checked_in",
    checkedIn: state === "checked_in",
    message: profileMessage(state),
  };
}

function emailHash(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

function sourceRecordId(eventId: string, attendee: HiEventsSourceAttendee): string {
  return `${eventId}:${attendee.stableId}`;
}

function ticketFingerprint(eventId: string, attendee: HiEventsSourceAttendee): string {
  return `hievents-ticket:v1:${eventId}:${attendee.stableId}`;
}

function checkinFingerprint(eventId: string, attendee: HiEventsSourceAttendee): string {
  const checkinId = attendee.checkInStableId || createHash("sha256").update(attendee.checkedInAt || "").digest("hex");
  return `hievents-checkin:v1:${eventId}:${attendee.stableId}:${checkinId}`;
}

function snapshotFingerprint(snapshot: Extract<HiEventsAttendeeSnapshot, { state: "success" }>): string {
  const source = snapshot.attendees
    .map((attendee) => [
      attendee.stableId,
      emailHash(attendee.normalizedEmail),
      attendee.eligibility,
      attendee.checkedIn ? "checked" : "not_checked_in",
      attendee.checkInStableId || "",
      attendee.checkedInAt || "",
    ].join(":"))
    .sort()
    .join("|");
  return createHash("sha256").update(`${snapshot.eventId}:${source}`).digest("hex");
}

function claimEventId(claim: GamificationActivityClaimRecord): string | undefined {
  const metadata = claim.metadata?.hievents;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return text((metadata as Record<string, unknown>).eventId);
  }
  return text(claim.source_record_id)?.split(":", 1)[0];
}

/**
 * Server-only mapper from complete Hi.Events source facts into accounting. The
 * adapter never receives this store and can therefore never write progress.
 */
export class GamificationHiEventsEvidenceService {
  private readonly accounting: GamificationAccountingService;
  private readonly fetchSnapshot: () => Promise<HiEventsAttendeeSnapshot>;
  private readonly clock: () => string;
  private readonly staleAfterMs: number;

  constructor(
    private readonly store: GamificationAccountingStore,
    options: GamificationHiEventsEvidenceOptions = {},
  ) {
    this.accounting = new GamificationAccountingService(store, options.clock || now);
    this.fetchSnapshot = options.fetchSnapshot || fetchHiEventsAttendeeSnapshot;
    this.clock = options.clock || now;
    this.staleAfterMs = options.staleAfterMs || STALE_AFTER_MS;
  }

  async statusForUser(user: AccountingUser): Promise<HiEventsProfileStatusDto> {
    const eventId = process.env.HIEVENTS_EVENT_ID;
    if (!eventId) return safeStatus("unavailable");
    const eventRuns = await this.store.list<GamificationHiEventsSyncRunRecord>(
      GAMIFICATION_COLLECTIONS.hiEventsSyncRuns,
      { user: user.id, event_id: eventId },
      { sort: "-fetched_at,id", limit: 50 },
    );
    const lastRun = latest(eventRuns);
    const lastSuccess = latest(eventRuns.filter((run) => run.result_state === "success"));
    if (!lastRun) return safeStatus("stale");
    if (lastRun.result_state !== "success") {
      return safeStatus("unavailable", { ...lastRun, last_success_at: lastSuccess?.last_success_at || lastSuccess?.fetched_at });
    }
    const status = lastRun.user_status || "stale";
    if (Date.parse(this.clock()) - Date.parse(lastRun.fetched_at) > this.staleAfterMs) {
      return safeStatus("stale", { ...lastRun, last_success_at: lastSuccess?.last_success_at || lastSuccess?.fetched_at });
    }
    return safeStatus(status, { ...lastRun, last_success_at: lastSuccess?.last_success_at || lastSuccess?.fetched_at });
  }

  async refreshCurrentUser(user: AccountingUser): Promise<HiEventsProfileStatusDto> {
    let configuration: ConferenceConfiguration;
    try {
      configuration = await this.configuration();
    } catch {
      return safeStatus("unavailable");
    }
    const snapshot = await this.fetchSnapshot();
    if (snapshot.state !== "success" || !snapshot.pagination.complete) {
      await this.recordRun({
        userId: user.id,
        eventId: configuration.eventId,
        scope: "current_user",
        resultState: snapshot.state === "success" ? "partial" : snapshot.state,
        fetchedAt: snapshot.fetchedAt,
        pagination: snapshot.pagination,
        userStatus: "unavailable",
      });
      return this.statusForUser(user);
    }

    const normalized = normalizeHiEventsEmail(user.email);
    const matchingUsers = normalized
      ? await this.store.list<UserRecord>("users", { email: normalized }, { limit: 3 })
      : [];
    const candidates = snapshot.attendees.filter((attendee) => attendee.normalizedEmail === normalized);
    const sourceRecordIds = candidates.map((attendee) => sourceRecordId(configuration.eventId, attendee));
    const acceptedClaims = sourceRecordIds.length
      ? await this.store.list<GamificationActivityClaimRecord>(
        GAMIFICATION_COLLECTIONS.activityClaims,
        { status: "accepted", source_record_id: sourceRecordIds },
        { limit: sourceRecordIds.length * 4 },
      )
      : [];
    const acceptedSourceUsers = new Map<string, Set<string>>();
    for (const claim of acceptedClaims) {
      if (!claim.source_record_id || claimEventId(claim) !== configuration.eventId) continue;
      const sourceUsers = acceptedSourceUsers.get(claim.source_record_id) || new Set<string>();
      sourceUsers.add(claim.user);
      acceptedSourceUsers.set(claim.source_record_id, sourceUsers);
    }
    const crossUserCollision = candidates.some((attendee) =>
      [...(acceptedSourceUsers.get(sourceRecordId(configuration.eventId, attendee)) || [])]
        .some((userId) => userId !== user.id)
    );
    if (!normalized || matchingUsers.length !== 1 || crossUserCollision) {
      await this.recordRun({
        userId: user.id,
        eventId: configuration.eventId,
        scope: "current_user",
        resultState: "success",
        fetchedAt: snapshot.fetchedAt,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        pagination: snapshot.pagination,
        userStatus: "ambiguous",
        matchedCount: candidates.length,
        ambiguityCount: 1,
      });
      return this.statusForUser(user);
    }
    const outcome = await this.awardCandidateEvidence(user, configuration, candidates);
    await this.recordRun({
      userId: user.id,
      eventId: configuration.eventId,
      scope: "current_user",
      resultState: "success",
      fetchedAt: snapshot.fetchedAt,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      pagination: snapshot.pagination,
      userStatus: outcome.state,
      matchedCount: outcome.matchedCount,
      ambiguityCount: outcome.ambiguityCount,
      createdClaimCount: outcome.ticketClaims + outcome.checkinClaims,
      sourceStableId: outcome.sourceStableId,
      checkinId: outcome.checkinId,
      checkedInAt: outcome.checkedInAt,
    });
    return this.statusForUser(user);
  }

  async previewAdminReconciliation(): Promise<AdminHiEventsReconciliationDto> {
    let configuration: ConferenceConfiguration;
    try {
      configuration = await this.configuration();
    } catch {
      return this.emptyAdminDto("not_configured");
    }
    const snapshot = await this.fetchSnapshot();
    if (snapshot.state !== "success" || !snapshot.pagination.complete) {
      return snapshot.state === "success"
        ? this.snapshotAdminDto({ ...snapshot, state: "partial", reason: "malformed_pagination" })
        : this.snapshotAdminDto(snapshot);
    }
    return (await this.plan(configuration, snapshot)).dto;
  }

  async applyAdminReconciliation(
    actor: { id: string; name?: string; email?: string },
    expectedSnapshotFingerprint: string,
    operationId: string,
  ): Promise<AdminHiEventsReconciliationDto> {
    const stableOperationId = text(operationId);
    if (!stableOperationId || stableOperationId.length > 200) {
      throw new Error("Hi.Events reconciliation requires a stable operation ID.");
    }
    if (containsMissionCode(stableOperationId)) {
      throw new Error("Hi.Events reconciliation operation IDs must not contain Mission codes.");
    }
    const configuration = await this.configuration();
    const snapshot = await this.fetchSnapshot();
    if (snapshot.state !== "success" || !snapshot.pagination.complete) {
      await this.recordRun({
        actorId: actor.id,
        eventId: configuration.eventId,
        scope: "admin_reconciliation",
        resultState: snapshot.state === "success" ? "partial" : snapshot.state,
        fetchedAt: snapshot.fetchedAt,
        pagination: snapshot.pagination,
      });
      return snapshot.state === "success"
        ? this.snapshotAdminDto({ ...snapshot, state: "partial", reason: "malformed_pagination" })
        : this.snapshotAdminDto(snapshot);
    }
    const plan = await this.plan(configuration, snapshot);
    if (!expectedSnapshotFingerprint || plan.dto.snapshotFingerprint !== expectedSnapshotFingerprint) {
      throw new Error("Hi.Events changed after the preview. Review a new complete snapshot before applying it.");
    }
    const auditKey = `admin-action:v1:hievents_reconciliation:${stableOperationId}`;
    let audit = await this.store.findOne<GamificationAdminActionRecord>(
      GAMIFICATION_COLLECTIONS.adminActions,
      { idempotency_key: auditKey },
    );
    if (audit) {
      if (audit.actor !== actor.id || audit.after_summary?.snapshotFingerprint !== expectedSnapshotFingerprint) {
        throw new Error("This reconciliation operation ID is already bound to another request.");
      }
      if (audit.status === "applied") {
        return {
          ...plan.dto,
          applied: {
            ticketClaims: Number(audit.after_summary?.ticketClaims || 0),
            checkinClaims: Number(audit.after_summary?.checkinClaims || 0),
            corrections: Number(audit.after_summary?.corrections || 0),
          },
        };
      }
      if (audit.status === "failed") {
        audit = await this.store.update<GamificationAdminActionRecord>(GAMIFICATION_COLLECTIONS.adminActions, audit.id, {
          status: "rebuild_pending",
        });
      }
    } else {
      audit = await this.store.create<GamificationAdminActionRecord>(GAMIFICATION_COLLECTIONS.adminActions, {
        actor: actor.id,
        actor_role: "admin",
        action: "hievents_reconciliation",
        status: "rebuild_pending",
        reason: "Applied a reviewed complete Hi.Events reconciliation snapshot.",
        correlation_id: stableOperationId,
        idempotency_key: auditKey,
        related_collection: GAMIFICATION_COLLECTIONS.hiEventsSyncRuns,
        related_record_id: configuration.eventId,
        after_summary: {
          snapshotFingerprint: expectedSnapshotFingerprint,
          eventId: configuration.eventId,
          ticketClaims: plan.dto.proposed.ticketClaims,
          checkinClaims: plan.dto.proposed.checkinClaims,
          corrections: plan.dto.proposed.corrections,
        },
      });
    }
    const operationPrefix = `hievents-sync:${stableOperationId}`;
    let ticketClaims = 0;
    let checkinClaims = 0;
    const statuses = new Map<string, AwardOutcome>();
    const correctedClaimsByUser = new Map<string, number>();
    for (const claim of plan.correctedClaims) {
      correctedClaimsByUser.set(claim.user, (correctedClaimsByUser.get(claim.user) || 0) + 1);
    }
    try {
      for (const userId of plan.ambiguousUserIds) {
        statuses.set(userId, { ticketClaims: 0, checkinClaims: 0, state: "ambiguous", matchedCount: 0, ambiguityCount: 1 });
      }
      const users = await this.usersForReconciliation();
      for (const user of users) {
        if (!plan.matched.has(user.id) && !plan.ambiguousUserIds.has(user.id)) {
          statuses.set(user.id, { ticketClaims: 0, checkinClaims: 0, state: "no_ticket", matchedCount: 0, ambiguityCount: 0 });
        }
      }
      let corrections = 0;
      for (const claim of plan.correctedClaims) {
        await this.accounting.voidActivityClaim(claim.id, {
          actor: actor.id,
          actorRole: "admin",
          targetUser: claim.user,
          reason: "Hi.Events complete source sync no longer supports this evidence.",
          operationId: `${operationPrefix}:${claim.id}`,
        });
        corrections += 1;
        statuses.set(claim.user, {
          ticketClaims: 0,
          checkinClaims: 0,
          state: "source_corrected",
          matchedCount: 0,
          ambiguityCount: 0,
        });
      }
      for (const [userId, candidates] of plan.matched) {
        if (plan.ambiguousUserIds.has(userId)) continue;
        const user = users.find((candidate) => candidate.id === userId);
        if (!user) continue;
        const outcome = await this.awardCandidateEvidence(user, configuration, candidates);
        ticketClaims += outcome.ticketClaims;
        checkinClaims += outcome.checkinClaims;
        statuses.set(userId, outcome);
      }
      await this.recordRun({
        actorId: actor.id,
        adminActionId: audit.id,
        eventId: configuration.eventId,
        scope: "admin_reconciliation",
        resultState: "success",
        fetchedAt: snapshot.fetchedAt,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        pagination: snapshot.pagination,
        matchedCount: plan.dto.matchCounts.matchedUsers,
        ambiguityCount: plan.dto.matchCounts.ambiguousMatches,
        createdClaimCount: ticketClaims + checkinClaims,
        correctedClaimCount: corrections,
      });
      for (const [userId, status] of statuses) {
        await this.recordRun({
          userId,
          actorId: actor.id,
          adminActionId: audit.id,
          eventId: configuration.eventId,
          scope: "admin_reconciliation",
          resultState: "success",
          fetchedAt: snapshot.fetchedAt,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          pagination: snapshot.pagination,
          userStatus: status.state,
          matchedCount: status.matchedCount,
          ambiguityCount: status.ambiguityCount,
          createdClaimCount: status.ticketClaims + status.checkinClaims,
          correctedClaimCount: correctedClaimsByUser.get(userId) || 0,
          sourceStableId: status.sourceStableId,
          checkinId: status.checkinId,
          checkedInAt: status.checkedInAt,
        });
      }
      await this.store.update(GAMIFICATION_COLLECTIONS.adminActions, audit.id, { status: "applied" });
      return {
        ...plan.dto,
        applied: { ticketClaims, checkinClaims, corrections },
      };
    } catch (error) {
      await this.store.update(GAMIFICATION_COLLECTIONS.adminActions, audit.id, { status: "failed" });
      throw error;
    }
  }

  private async configuration(): Promise<ConferenceConfiguration> {
    const eventId = text(process.env.HIEVENTS_EVENT_ID);
    if (!eventId) throw new Error("Hi.Events event configuration is missing.");
    const mission = await this.store.findOne<GamificationMissionRecord>(
      GAMIFICATION_COLLECTIONS.missions,
      { key: "conference.main", status: "active" },
    );
    if (!mission) throw new Error("The active conference.main Mission is required.");
    const missionActivities = await this.store.list<GamificationActivityRecord>(
      GAMIFICATION_COLLECTIONS.activities,
      { mission: mission.id },
      { sort: "key", limit: 3 },
    );
    if (missionActivities.length !== 2) throw new Error("conference.main must contain exactly the two Hi.Events Activities.");
    const ticketActivity = missionActivities.find((activity) => activity.key === TICKET_ACTIVITY_KEY);
    const checkinActivity = missionActivities.find((activity) => activity.key === CHECKIN_ACTIVITY_KEY);
    if (!ticketActivity || !checkinActivity) throw new Error("conference.main Hi.Events Activities are incomplete.");
    const valid = (activity: GamificationActivityRecord, evidenceMode: "hievents_ticket" | "hievents_checkin", outcome: "ticket_present" | "checked_in") =>
      activity.kind === "hievents" && activity.category === "attendance" && activity.evidence_mode === evidenceMode &&
      activity.outcome_key === outcome && activity.per_user_claim_limit === 1 && activity.status === "active" && activity.enabled &&
      eventRefId(activity) === eventId;
    if (!valid(ticketActivity, "hievents_ticket", "ticket_present") || !valid(checkinActivity, "hievents_checkin", "checked_in")) {
      throw new Error("conference.main Hi.Events Activities do not match the configured event.");
    }
    return { eventId, ticketActivity, checkinActivity };
  }

  private async plan(
    configuration: ConferenceConfiguration,
    snapshot: Extract<HiEventsAttendeeSnapshot, { state: "success" }>,
  ): Promise<EvidencePlan> {
    if (!snapshot.pagination.complete) throw new Error("Hi.Events reconciliation requires a complete source snapshot.");
    const [users, claims] = await Promise.all([
      this.usersForReconciliation(),
      this.store.list<GamificationActivityClaimRecord>(
        GAMIFICATION_COLLECTIONS.activityClaims,
        { activity: [configuration.ticketActivity.id, configuration.checkinActivity.id] },
        { sort: "claimed_at,id", limit: 10001 },
      ),
    ]);
    if (claims.length > 10000) throw new Error("Hi.Events evidence exceeds the safe reconciliation limit. Escalate before applying changes.");
    const usersByEmail = new Map<string, UserRecord[]>();
    for (const user of users) {
      const email = normalizeHiEventsEmail(user.email);
      if (!email) continue;
      const matches = usersByEmail.get(email) || [];
      matches.push(user);
      usersByEmail.set(email, matches);
    }
    const matched = new Map<string, HiEventsSourceAttendee[]>();
    const ambiguousUserIds = new Set<string>();
    const sourceEmails = new Map<string, Set<string>>();
    for (const attendee of snapshot.attendees.filter((candidate) => candidate.eligibility === "eligible")) {
      const sourceId = sourceRecordId(configuration.eventId, attendee);
      const emails = sourceEmails.get(sourceId) || new Set<string>();
      emails.add(attendee.normalizedEmail || "");
      sourceEmails.set(sourceId, emails);
    }
    const ambiguousSourceIds = new Set(
      [...sourceEmails].filter(([, emails]) => emails.size !== 1 || emails.has("")).map(([sourceId]) => sourceId),
    );
    let ambiguousMatches = ambiguousSourceIds.size;
    for (const sourceId of ambiguousSourceIds) {
      for (const email of sourceEmails.get(sourceId) || []) {
        for (const user of usersByEmail.get(email) || []) ambiguousUserIds.add(user.id);
      }
    }
    const acceptedClaims = claims.filter((claim) =>
      claim.status === "accepted" && claimEventId(claim) === configuration.eventId &&
      [configuration.ticketActivity.id, configuration.checkinActivity.id].includes(claim.activity),
    );
    const attendeesBySourceId = new Map(snapshot.attendees.map((attendee) => [
      sourceRecordId(configuration.eventId, attendee),
      attendee,
    ]));
    const acceptedClaimsBySourceId = new Map<string, GamificationActivityClaimRecord[]>();
    for (const claim of acceptedClaims) {
      if (!claim.source_record_id) continue;
      const sourceClaims = acceptedClaimsBySourceId.get(claim.source_record_id) || [];
      sourceClaims.push(claim);
      acceptedClaimsBySourceId.set(claim.source_record_id, sourceClaims);
    }
    const correctedClaims = acceptedClaims.filter((claim) => {
      const source = claim.source_record_id ? attendeesBySourceId.get(claim.source_record_id) : undefined;
      // Only source absence or an explicit ineligible fact is negative evidence.
      // An unrecognized status is retained for support and must not revoke progress.
      if (!source || source.eligibility === "ineligible") return true;
      if (source.eligibility === "unknown") return false;
      if (claim.source_record_id && ambiguousSourceIds.has(claim.source_record_id)) return false;
      const sourceUsers = source.normalizedEmail ? usersByEmail.get(source.normalizedEmail) || [] : [];
      if (sourceUsers.length !== 1 || sourceUsers[0].id !== claim.user) return true;
      return claim.activity === configuration.ticketActivity.id
        ? false
        : !source.checkedIn;
    });
    const correctedClaimIds = new Set(correctedClaims.map((claim) => claim.id));
    for (const attendee of snapshot.attendees.filter((candidate) => candidate.eligibility === "eligible" && candidate.normalizedEmail)) {
      if (ambiguousSourceIds.has(sourceRecordId(configuration.eventId, attendee))) continue;
      const usersForEmail = usersByEmail.get(attendee.normalizedEmail) || [];
      if (usersForEmail.length !== 1) {
        if (usersForEmail.length > 1) {
          ambiguousMatches += 1;
          usersForEmail.forEach((user) => ambiguousUserIds.add(user.id));
        }
        continue;
      }
      const user = usersForEmail[0];
      const linkedElsewhere = (acceptedClaimsBySourceId.get(sourceRecordId(configuration.eventId, attendee)) || [])
        .some((claim) => claim.user !== user.id && !correctedClaimIds.has(claim.id));
      if (linkedElsewhere) {
        ambiguousMatches += 1;
        ambiguousUserIds.add(user.id);
        continue;
      }
      const candidates = matched.get(user.id) || [];
      candidates.push(attendee);
      matched.set(user.id, candidates);
    }
    const acceptedByUserActivity = new Set(acceptedClaims
      .filter((claim) => !correctedClaimIds.has(claim.id))
      .map((claim) => `${claim.user}:${claim.activity}`));
    let ticketClaims = 0;
    let checkinClaims = 0;
    for (const [userId, candidates] of matched) {
      if (ambiguousUserIds.has(userId)) continue;
      if (!acceptedByUserActivity.has(`${userId}:${configuration.ticketActivity.id}`)) ticketClaims += 1;
      if (candidates.some((candidate) => candidate.checkedIn) && !acceptedByUserActivity.has(`${userId}:${configuration.checkinActivity.id}`)) {
        checkinClaims += 1;
      }
    }
    return {
      configuration,
      snapshot,
      matched,
      ambiguousUserIds,
      correctedClaims,
      dto: {
        eventId: configuration.eventId,
        state: "complete",
        fetchedAt: snapshot.fetchedAt,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        snapshotFingerprint: snapshotFingerprint(snapshot),
        pagination: snapshot.pagination,
        matchCounts: {
          eligibleAttendees: snapshot.attendees.filter((attendee) => attendee.eligibility === "eligible").length,
          matchedUsers: matched.size,
          ambiguousMatches,
        },
        proposed: { ticketClaims, checkinClaims, corrections: correctedClaims.length },
      },
    };
  }

  private async awardCandidateEvidence(
    user: AccountingUser,
    configuration: ConferenceConfiguration,
    candidates: HiEventsSourceAttendee[],
  ): Promise<AwardOutcome> {
    const eligible = candidates.filter((candidate) => candidate.eligibility === "eligible");
    if (eligible.length === 0) return { ticketClaims: 0, checkinClaims: 0, state: "no_ticket", matchedCount: candidates.length, ambiguityCount: 0 };
    const ticketCandidate = [...eligible].sort((left, right) => left.stableId.localeCompare(right.stableId))[0];
    const checkinCandidate = eligible.filter((candidate) => candidate.checkedIn)
      .sort((left, right) => left.stableId.localeCompare(right.stableId))[0];
    const ticketClaims = await this.award(user, configuration, configuration.ticketActivity, ticketCandidate, "ticket");
    const checkinClaims = checkinCandidate
      ? await this.award(user, configuration, configuration.checkinActivity, checkinCandidate, "checkin")
      : 0;
    return {
      ticketClaims,
      checkinClaims,
      state: checkinCandidate ? "checked_in" : "not_checked_in",
      matchedCount: eligible.length,
      ambiguityCount: 0,
      sourceStableId: ticketCandidate.stableId,
      checkinId: checkinCandidate?.checkInStableId,
      checkedInAt: checkinCandidate?.checkedInAt,
    };
  }

  private async usersForReconciliation(): Promise<UserRecord[]> {
    const users = await this.store.list<UserRecord>("users", undefined, { sort: "id", limit: 10001 });
    if (users.length > 10000) {
      throw new Error("User volume exceeds the safe Hi.Events reconciliation limit. Escalate before applying changes.");
    }
    return users;
  }

  private async award(
    user: AccountingUser,
    configuration: ConferenceConfiguration,
    activity: GamificationActivityRecord,
    attendee: HiEventsSourceAttendee,
    kind: "ticket" | "checkin",
  ): Promise<number> {
    const occurredAt = kind === "checkin" ? attendee.checkedInAt || this.clock() : this.clock();
    const sourceType = kind === "ticket" ? "hievents_ticket" as const : "hievents_checkin" as const;
    const fingerprint = kind === "ticket" ? ticketFingerprint(configuration.eventId, attendee) : checkinFingerprint(configuration.eventId, attendee);
    const expected = kind === "ticket" ? { totalXp: 10, leaderboardXp: 0 } : { totalXp: 20, leaderboardXp: 10 };
    const claimInput = {
      user: user.id,
      activity: activity.id,
      sourceType,
      sourceCollection: "hievents",
      sourceRecordId: sourceRecordId(configuration.eventId, attendee),
      outcomeKey: kind === "ticket" ? "ticket_present" : "checked_in",
      occurredAt,
      evidenceFingerprint: fingerprint,
      idempotencyKey: activityClaimIdempotencyKey(user.id, activity.key, sourceType, `${configuration.eventId}:${attendee.stableId}`),
      metadata: {
        hievents: {
          eventId: configuration.eventId,
          attendeeStableId: attendee.stableId,
          productId: attendee.productId,
          eligibility: attendee.sourceStatus || "listed",
          matchedBy: "normalized_email",
          normalizedEmailHash: emailHash(attendee.normalizedEmail),
          candidateCount: 1,
          fetchedAt: this.clock(),
          sourceUpdatedAt: attendee.sourceUpdatedAt,
          checkInId: kind === "checkin" ? attendee.checkInStableId : undefined,
          checkedInAt: kind === "checkin" ? attendee.checkedInAt : undefined,
          adapterVersion: "v1",
        },
      },
    };
    const alreadyAccepted = await this.store.findOne<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, {
      user: user.id,
      activity: activity.id,
      status: "accepted",
    });
    if (!alreadyAccepted) {
      const score = await this.accounting.previewActivityScore(claimInput);
      if (score.totalXp !== expected.totalXp || score.leaderboardXp !== expected.leaderboardXp) {
        throw new Error(`${activity.key} must use the fixed ${expected.totalXp}/${expected.leaderboardXp} Hi.Events score.`);
      }
    }
    await this.accounting.recordActivityAward({ claim: claimInput });
    return alreadyAccepted ? 0 : 1;
  }

  private emptyAdminDto(state: "not_configured"): AdminHiEventsReconciliationDto {
    return {
      state,
      pagination: { requestedPages: 0, completedPages: 0, complete: false },
      matchCounts: { eligibleAttendees: 0, matchedUsers: 0, ambiguousMatches: 0 },
      proposed: { ticketClaims: 0, checkinClaims: 0, corrections: 0 },
    };
  }

  private snapshotAdminDto(snapshot: Exclude<HiEventsAttendeeSnapshot, { state: "success" }>): AdminHiEventsReconciliationDto {
    return {
      eventId: snapshot.eventId,
      state: snapshot.state,
      fetchedAt: snapshot.fetchedAt,
      pagination: snapshot.pagination,
      matchCounts: { eligibleAttendees: 0, matchedUsers: 0, ambiguousMatches: 0 },
      proposed: { ticketClaims: 0, checkinClaims: 0, corrections: 0 },
    };
  }

  private async recordRun(input: {
    userId?: string;
    actorId?: string;
    adminActionId?: string;
    eventId: string;
    scope: "current_user" | "admin_reconciliation";
    resultState: "success" | "partial" | "unavailable";
    fetchedAt: string;
    sourceUpdatedAt?: string;
    pagination: { requestedPages: number; completedPages: number; totalPages?: number; complete: boolean };
    userStatus?: HiEventsEvidenceState;
    matchedCount?: number;
    ambiguityCount?: number;
    createdClaimCount?: number;
    correctedClaimCount?: number;
    sourceStableId?: string;
    checkinId?: string;
    checkedInAt?: string;
  }): Promise<void> {
    await this.store.create(GAMIFICATION_COLLECTIONS.hiEventsSyncRuns, {
      user: input.userId || "",
      actor: input.actorId || "",
      admin_action: input.adminActionId || "",
      event_id: input.eventId,
      scope: input.scope,
      result_state: input.resultState,
      user_status: input.userStatus || "",
      fetched_at: input.fetchedAt,
      last_success_at: input.resultState === "success" ? input.fetchedAt : "",
      source_updated_at: input.sourceUpdatedAt || "",
      requested_pages: input.pagination.requestedPages,
      completed_pages: input.pagination.completedPages,
      complete: input.pagination.complete,
      matched_count: input.matchedCount || 0,
      ambiguous_count: input.ambiguityCount || 0,
      created_claim_count: input.createdClaimCount || 0,
      corrected_claim_count: input.correctedClaimCount || 0,
      source_stable_id: input.sourceStableId || "",
      checkin_id: input.checkinId || "",
      checked_in_at: input.checkedInAt || "",
    });
  }
}
