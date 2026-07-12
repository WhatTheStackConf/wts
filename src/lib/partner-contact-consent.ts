import { GAMIFICATION_COLLECTIONS, type AccountingUser, type GamificationAccountingStore } from "~/lib/gamification-accounting";
import type {
  GamificationActivityClaimRecord,
  GamificationActivityRecord,
  GamificationMissionRecord,
  PartnerContactConsentRecord,
  PartnerContactDisclosureRecord,
  PartnerRecord,
  UserRecord,
} from "~/lib/pocketbase-types";

const PARTNER_FOLLOW_UP_FIELDS = ["name", "email"] as const;

export interface PartnerContactConsentSummary {
  consentId?: string;
  activityId: string;
  activityLabel: string;
  partner: { id: string; name: string };
  purpose: "partner_follow_up";
  noticeVersion: string;
  fields: Array<"name" | "email">;
  state: "available" | "granted" | "withdrawn";
  grantedAt?: string;
  withdrawnAt?: string;
  handoffState: "not_handed_off" | "handed_off";
  handedOffAt?: string;
}

export interface PartnerContactDisclosureHandoff {
  partner: { id: string; name: string };
  activityKey: string;
  purpose: "partner_follow_up";
  fields: Array<"name" | "email">;
  disclosedAt: string;
  contact: { name: string; email: string };
}

function now(): string {
  return new Date().toISOString();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function timestamp(value?: string): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function approvedFields(value: unknown): Array<"name" | "email"> {
  if (!Array.isArray(value)) return [];
  return value.filter((field): field is "name" | "email" => field === "name" || field === "email");
}

/**
 * Private consent ledger. It is intentionally separate from redemption and
 * accounting so consent never changes a Claim, Badge, or score.
 */
export class PartnerContactConsentService {
  constructor(
    private readonly store: GamificationAccountingStore,
    private readonly clock: () => string = now,
  ) {}

  async summariesForUser(userId: string, onlyActivityId?: string): Promise<PartnerContactConsentSummary[]> {
    const activityMatch = onlyActivityId ? { user: userId, activity: onlyActivityId } : { user: userId };
    const [consents, disclosures, claims] = await Promise.all([
      this.store.list<PartnerContactConsentRecord>(GAMIFICATION_COLLECTIONS.partnerContactConsents, activityMatch),
      this.store.list<PartnerContactDisclosureRecord>(GAMIFICATION_COLLECTIONS.partnerContactDisclosures, { user: userId }),
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, activityMatch),
    ]);
    const activityIds = [...new Set([
      ...claims.filter((claim) => claim.status === "accepted").map((claim) => claim.activity),
      ...consents.map((consent) => consent.activity),
    ])];
    if (activityIds.length === 0) return [];
    const activities = await this.store.list<GamificationActivityRecord>(
      GAMIFICATION_COLLECTIONS.activities,
      { id: activityIds },
      { limit: activityIds.length },
    );
    const missionIds = [...new Set(activities.flatMap((activity) => activity.mission ? [activity.mission] : []))];
    const partnerIds = [...new Set(activities.flatMap((activity) => activity.partner ? [activity.partner] : []))];
    const [missions, partners] = await Promise.all([
      missionIds.length
        ? this.store.list<GamificationMissionRecord>(GAMIFICATION_COLLECTIONS.missions, { id: missionIds }, { limit: missionIds.length })
        : Promise.resolve([]),
      partnerIds.length
        ? this.store.list<PartnerRecord>("partners", { id: partnerIds }, { limit: partnerIds.length })
        : Promise.resolve([]),
    ]);
    const activitiesById = new Map(activities.map((activity) => [activity.id, activity]));
    const missionsById = new Map(missions.map((mission) => [mission.id, mission]));
    const partnersById = new Map(partners.map((partner) => [partner.id, partner]));
    const disclosedByConsent = new Map(disclosures.map((disclosure) => [disclosure.consent, disclosure]));
    const consentByActivity = new Map<string, PartnerContactConsentRecord>();
    for (const consent of consents) {
      const existing = consentByActivity.get(consent.activity);
      if (!existing || timestamp(consent.granted_at) >= timestamp(existing.granted_at)) {
        consentByActivity.set(consent.activity, consent);
      }
    }
    const claimedActivityIds = new Set(claims.filter((claim) => claim.status === "accepted").map((claim) => claim.activity));
    const relevantActivityIds = new Set([...claimedActivityIds, ...consentByActivity.keys()]);

    return [...relevantActivityIds]
      .map((activityId): PartnerContactConsentSummary | undefined => {
        const activity = activitiesById.get(activityId);
        const consent = consentByActivity.get(activityId);
        const partner = activity?.partner ? partnersById.get(activity.partner) : undefined;
        if (!activity || !partner || (!this.isPartnerFollowUpActivity(activity) && !consent)) return undefined;
        if (!consent && !this.canOffer(activity)) return undefined;
        if (consent && consent.partner !== partner.id) return undefined;
        const disclosure = consent ? disclosedByConsent.get(consent.id) : undefined;
        return {
          ...(consent ? { consentId: consent.id } : {}),
          activityId: activity.id,
          activityLabel: (activity.mission && missionsById.get(activity.mission)?.title) || "Partner Activity",
          partner: { id: partner.id, name: partner.name },
          purpose: "partner_follow_up" as const,
          noticeVersion: consent?.notice_version || text(activity.partner_follow_up_notice_version),
          fields: consent ? approvedFields(consent.approved_fields) : [...PARTNER_FOLLOW_UP_FIELDS],
          state: consent?.state || "available",
          grantedAt: consent?.granted_at,
          withdrawnAt: consent?.withdrawn_at || undefined,
          handoffState: disclosure ? "handed_off" as const : "not_handed_off" as const,
          handedOffAt: disclosure?.disclosed_at,
        };
      })
      .filter((summary): summary is PartnerContactConsentSummary => Boolean(summary))
      .sort((left, right) => left.partner.name.localeCompare(right.partner.name) || left.activityLabel.localeCompare(right.activityLabel));
  }

  async summaryForActivity(userId: string, activityId: string): Promise<PartnerContactConsentSummary | undefined> {
    return (await this.summariesForUser(userId, activityId))[0];
  }

  async grant(user: AccountingUser, activityId: string): Promise<PartnerContactConsentSummary> {
    const [activity, claims] = await Promise.all([
      this.store.getById<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, activityId),
      this.store.list<GamificationActivityClaimRecord>(GAMIFICATION_COLLECTIONS.activityClaims, { user: user.id, activity: activityId }),
    ]);
    const partner = activity.partner
      ? await this.store.getById<PartnerRecord>("partners", activity.partner).catch(() => undefined)
      : undefined;
    if (!partner || !this.canOffer(activity)) {
      throw new Error("Partner follow-up is not available for this Activity.");
    }
    if (!claims.some((claim) => claim.status === "accepted")) {
      throw new Error("Record the Activity before opting in to partner follow-up.");
    }
    const noticeVersion = text(activity.partner_follow_up_notice_version);
    const priorDisclosure = await this.store.findOne<PartnerContactDisclosureRecord>(GAMIFICATION_COLLECTIONS.partnerContactDisclosures, {
      user: user.id,
      partner: partner.id,
      activity: activity.id,
      purpose: "partner_follow_up",
    });
    if (priorDisclosure) throw new Error("This one-time partner follow-up handoff has already been completed.");
    const existing = await this.store.findOne<PartnerContactConsentRecord>(GAMIFICATION_COLLECTIONS.partnerContactConsents, {
      user: user.id,
      partner: partner.id,
      activity: activity.id,
      purpose: "partner_follow_up",
      notice_version: noticeVersion,
      state: "granted",
    });
    if (!existing) {
      await this.store.create<PartnerContactConsentRecord>(GAMIFICATION_COLLECTIONS.partnerContactConsents, {
        user: user.id,
        partner: partner.id,
        activity: activity.id,
        purpose: "partner_follow_up",
        notice_version: noticeVersion,
        approved_fields: [...PARTNER_FOLLOW_UP_FIELDS],
        state: "granted",
        granted_at: this.clock(),
      });
    }
    const summary = await this.summaryForActivity(user.id, activity.id);
    if (!summary) throw new Error("Partner follow-up consent could not be recorded.");
    return summary;
  }

  async withdraw(userId: string, consentId: string): Promise<PartnerContactConsentSummary> {
    const consent = await this.store.getById<PartnerContactConsentRecord>(GAMIFICATION_COLLECTIONS.partnerContactConsents, consentId);
    if (consent.user !== userId) throw new Error("You can only withdraw your own partner follow-up consent.");
    if (consent.state === "granted") {
      await this.store.update<PartnerContactConsentRecord>(GAMIFICATION_COLLECTIONS.partnerContactConsents, consent.id, {
        state: "withdrawn",
        withdrawn_at: this.clock(),
      });
    }
    const summary = await this.summaryForActivity(userId, consent.activity);
    if (!summary) throw new Error("Partner follow-up consent could not be loaded.");
    return summary;
  }

  /** Admin-only callers receive the current name/email once; the disclosure record stores fields, not values. */
  async handoff(consentId: string, actorId: string): Promise<PartnerContactDisclosureHandoff> {
    const consent = await this.store.getById<PartnerContactConsentRecord>(GAMIFICATION_COLLECTIONS.partnerContactConsents, consentId);
    if (consent.state !== "granted") throw new Error("Withdrawn partner follow-up consent cannot be handed off.");
    const existing = await this.store.findOne<PartnerContactDisclosureRecord>(GAMIFICATION_COLLECTIONS.partnerContactDisclosures, {
      user: consent.user,
      partner: consent.partner,
      activity: consent.activity,
      purpose: "partner_follow_up",
    });
    if (existing) throw new Error("This consent has already been handed off.");
    const [user, partner, activity] = await Promise.all([
      this.store.getById<UserRecord>("users", consent.user),
      this.store.getById<PartnerRecord>("partners", consent.partner),
      this.store.getById<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, consent.activity),
    ]);
    const name = text(user.name);
    const email = text(user.email);
    if (!name || !email) throw new Error("The User does not have a current name and email available for this handoff.");
    const fields = approvedFields(consent.approved_fields);
    if (fields.length !== PARTNER_FOLLOW_UP_FIELDS.length || !PARTNER_FOLLOW_UP_FIELDS.every((field) => fields.includes(field))) {
      throw new Error("This consent does not approve the required name and email fields.");
    }
    const disclosedAt = this.clock();
    try {
      await this.store.create<PartnerContactDisclosureRecord>(GAMIFICATION_COLLECTIONS.partnerContactDisclosures, {
        consent: consent.id,
        user: user.id,
        partner: partner.id,
        activity: activity.id,
        actor: actorId,
        purpose: "partner_follow_up",
        approved_fields: fields,
        disclosed_at: disclosedAt,
      });
    } catch {
      throw new Error("This one-time partner follow-up handoff has already been completed or withdrawn.");
    }
    return {
      partner: { id: partner.id, name: partner.name },
      activityKey: activity.key,
      purpose: "partner_follow_up",
      fields,
      disclosedAt,
      contact: { name, email },
    };
  }

  private canOffer(activity: GamificationActivityRecord): boolean {
    return this.isPartnerFollowUpActivity(activity) &&
      Boolean(activity.partner) &&
      activity.status === "active" &&
      Boolean(activity.enabled) &&
      Boolean(activity.partner_follow_up_enabled) &&
      Boolean(text(activity.partner_follow_up_notice_version));
  }

  private isPartnerFollowUpActivity(activity: GamificationActivityRecord): boolean {
    return (activity.kind === "booth" && activity.category === "booth" && activity.partner_kind === "sponsor") ||
      (activity.kind === "community_partner" && activity.category === "community" && activity.partner_kind === "community_partner");
  }
}
