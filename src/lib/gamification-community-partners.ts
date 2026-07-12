import type {
  GamificationAchievementRecord,
  GamificationActivityClaimRecord,
  GamificationActivityRecord,
  GamificationMissionRecord,
} from "~/lib/pocketbase-types";

export const COMMUNITY_PARTNER_OUTCOMES = ["attendance", "participation", "completion"] as const;
export type CommunityPartnerOutcome = (typeof COMMUNITY_PARTNER_OUTCOMES)[number];

export const COMMUNITY_PARTNER_SCORE_BANDS = {
  attendance: { totalXp: 20, leaderboardXp: 15 },
  participation: { totalXp: 25, leaderboardXp: 20 },
  completion: { totalXp: 30, leaderboardXp: 25 },
} as const satisfies Record<CommunityPartnerOutcome, { totalXp: number; leaderboardXp: number }>;

export interface CommunityPartnerCompletionCandidate {
  achievement: GamificationAchievementRecord;
  activity: GamificationActivityRecord;
  sourceClaims: GamificationActivityClaimRecord[];
  occurredAt: string;
}

export interface CommunityPartnerMissionPresentation {
  title: string;
  summary: string;
  visibility: "public";
  badge?: {
    name: string;
    description: string;
    icon?: string;
    rarity: GamificationAchievementRecord["rarity"];
  };
}

export function isCommunityPartnerOutcome(value: unknown): value is CommunityPartnerOutcome {
  return typeof value === "string" && (COMMUNITY_PARTNER_OUTCOMES as readonly string[]).includes(value);
}

export function communityPartnerMissionKey(partnerKey: string, activityKey: string): string {
  return `community.${partnerKey}.${activityKey}`;
}

export function communityPartnerActivityKey(missionKey: string, outcome: CommunityPartnerOutcome | "start" | "finish"): string {
  return `${missionKey}.${outcome}`;
}

/** Projects only organizer-approved Community Mission and Badge presentation. */
export function buildCommunityPartnerMissionPresentations(input: {
  missions: GamificationMissionRecord[];
  activities: GamificationActivityRecord[];
  achievements: GamificationAchievementRecord[];
}): CommunityPartnerMissionPresentation[] {
  return input.missions
    .filter((mission) =>
      mission.category === "community" &&
      mission.status === "active" &&
      mission.visibility === "public"
    )
    .map((mission) => {
      const programmeActivities = input.activities.filter((activity) =>
        activity.mission === mission.id &&
        activity.kind === "community_partner" &&
        activity.status === "active" &&
        activity.enabled
      );
      const presentationActivity = programmeActivities.find((activity) => activity.community_meta_eligible) ||
        [...programmeActivities].sort((left, right) =>
          (COMMUNITY_PARTNER_SCORE_BANDS[right.outcome_key as CommunityPartnerOutcome]?.totalXp || 0) -
          (COMMUNITY_PARTNER_SCORE_BANDS[left.outcome_key as CommunityPartnerOutcome]?.totalXp || 0)
        )[0];
      const achievement = presentationActivity?.achievement
        ? input.achievements.find((candidate) => candidate.id === presentationActivity.achievement)
        : undefined;
      const badgeApproved = achievement &&
        achievement.status === "active" &&
        (achievement.visibility === "public" || achievement.visibility === "locked_teaser");
      const badgeDescription = achievement?.visibility === "locked_teaser"
        ? achievement.locked_teaser
        : achievement?.badge_description;
      return {
        title: mission.title,
        summary: mission.summary,
        visibility: "public" as const,
        badge: badgeApproved && badgeDescription ? {
          name: achievement.badge_name,
          description: badgeDescription,
          icon: achievement.icon || undefined,
          rarity: achievement.rarity,
        } : undefined,
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

function activityKeys(rule: GamificationAchievementRecord["unlock_rule"]): string[] {
  const values = Array.isArray(rule.activityKeys) ? rule.activityKeys : Array.isArray(rule.activity_keys) ? rule.activity_keys : [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && Boolean(value.trim())))];
}

function activeAt(record: { active_from?: string; active_until?: string }, occurredAt: string): boolean {
  const timestamp = Date.parse(occurredAt);
  return Number.isFinite(timestamp) &&
    (!record.active_from || timestamp >= Date.parse(record.active_from)) &&
    (!record.active_until || timestamp <= Date.parse(record.active_until));
}

/** Resolves the approved community start/finish model through the shared derived-claim accounting path. */
export function evaluateCommunityPartnerCompletions(input: {
  achievements: GamificationAchievementRecord[];
  activities: GamificationActivityRecord[];
  claims: GamificationActivityClaimRecord[];
  includeInactive?: boolean;
}): CommunityPartnerCompletionCandidate[] {
  const firstClaimByActivity = new Map<string, GamificationActivityClaimRecord>();
  for (const claim of [...input.claims]
    .filter((candidate) => candidate.status === "accepted" && candidate.source_type !== "system_derived")
    .sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at) || left.id.localeCompare(right.id))) {
    if (!firstClaimByActivity.has(claim.activity)) firstClaimByActivity.set(claim.activity, claim);
  }

  const candidates: CommunityPartnerCompletionCandidate[] = [];
  for (const completion of input.activities) {
    if (
      completion.kind !== "community_partner" ||
      completion.evidence_mode !== "derived_claim_set" ||
      completion.outcome_key !== "completion" ||
      completion.metadata?.community_two_code_approved !== true ||
      (!input.includeInactive && (completion.status !== "active" || !completion.enabled))
    ) {
      continue;
    }
    const achievement = input.achievements.find((candidate) => candidate.id === completion.achievement);
    if (!achievement || achievement.category !== "community" || achievement.unlock_rule.kind !== "claim_set") continue;
    const keys = activityKeys(achievement.unlock_rule);
    if (keys.length !== 2) continue;
    const sources = keys.map((key) => input.activities.find((activity) => activity.id === key || activity.key === key));
    if (sources.some((source) => !source)) continue;
    const sourceActivities = sources as GamificationActivityRecord[];
    if (
      sourceActivities.filter((activity) => activity.evidence_mode === "two_code_start").length !== 1 ||
      sourceActivities.filter((activity) => activity.evidence_mode === "two_code_finish").length !== 1 ||
      sourceActivities.some((activity) =>
        activity.kind !== "community_partner" ||
        activity.mission !== completion.mission ||
        activity.partner !== completion.partner ||
        activity.partner_kind !== "community_partner" ||
        activity.metadata?.community_two_code_approved !== true
      )
    ) {
      continue;
    }
    const sourceClaims = sourceActivities.map((activity) => firstClaimByActivity.get(activity.id));
    if (sourceClaims.some((claim) => !claim)) continue;
    const claims = sourceClaims as GamificationActivityClaimRecord[];
    const occurredAt = [...claims].sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at))[0].occurred_at;
    if (!input.includeInactive && (achievement.status !== "active" || !activeAt(achievement, occurredAt) || !activeAt(completion, occurredAt))) continue;
    candidates.push({ achievement, activity: completion, sourceClaims: claims, occurredAt });
  }
  return candidates.sort((left, right) => left.activity.key.localeCompare(right.activity.key));
}
