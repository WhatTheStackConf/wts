import type {
  GamificationAchievementRecord,
  GamificationActivityClaimRecord,
  GamificationActivityRecord,
  GamificationMissionRecord,
} from "~/lib/pocketbase-types";
import { evaluateTwoCodeCompletions, type TwoCodeCompletionInput, type TwoCodeProgramme } from "~/lib/gamification-two-code-completions";

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

function scoreBandTotalXp(activity: GamificationActivityRecord): number {
  return COMMUNITY_PARTNER_SCORE_BANDS[activity.outcome_key as CommunityPartnerOutcome]?.totalXp || 0;
}

/** The Meta-eligible programme Activity, else the highest-scoring one. */
function presentationActivity(
  mission: GamificationMissionRecord,
  activities: GamificationActivityRecord[],
): GamificationActivityRecord | undefined {
  const programmeActivities = activities.filter((activity) =>
    activity.mission === mission.id &&
    activity.kind === "community_partner" &&
    activity.status === "active" &&
    activity.enabled
  );
  return programmeActivities.find((activity) => activity.community_meta_eligible) ||
    [...programmeActivities].sort((left, right) => scoreBandTotalXp(right) - scoreBandTotalXp(left))[0];
}

function approvedBadge(achievement: GamificationAchievementRecord | undefined): CommunityPartnerMissionPresentation["badge"] {
  if (!achievement || achievement.status !== "active") return undefined;
  const locked = achievement.visibility === "locked_teaser";
  if (!locked && achievement.visibility !== "public") return undefined;
  const description = locked ? achievement.locked_teaser : achievement.badge_description;
  if (!description) return undefined;
  return {
    name: locked ? "Locked Badge" : achievement.badge_name,
    description,
    icon: achievement.icon || undefined,
    rarity: achievement.rarity,
  };
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
      const activity = presentationActivity(mission, input.activities);
      const achievement = activity?.achievement
        ? input.achievements.find((candidate) => candidate.id === activity.achievement)
        : undefined;
      return {
        title: mission.title,
        summary: mission.summary,
        visibility: "public" as const,
        badge: approvedBadge(achievement),
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

function activityKeys(rule: GamificationAchievementRecord["unlock_rule"]): string[] {
  const values = Array.isArray(rule.activityKeys) ? rule.activityKeys : Array.isArray(rule.activity_keys) ? rule.activity_keys : [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && Boolean(value.trim())))];
}

function isApprovedTwoCodeActivity(activity: GamificationActivityRecord): boolean {
  return activity.kind === "community_partner" && activity.metadata?.community_two_code_approved === true;
}

const COMMUNITY_PARTNER_TWO_CODE_PROGRAMME: TwoCodeProgramme = {
  isCompletionActivity: isApprovedTwoCodeActivity,
  isProgrammeAchievement: (achievement) => achievement.category === "community",
  activityKeys,
  isMatchingSource: (source, completion) =>
    isApprovedTwoCodeActivity(source) &&
    source.mission === completion.mission &&
    source.partner === completion.partner &&
    source.partner_kind === "community_partner",
};

/** Resolves the approved community start/finish model through the shared derived-claim accounting path. */
export function evaluateCommunityPartnerCompletions(input: TwoCodeCompletionInput): CommunityPartnerCompletionCandidate[] {
  return evaluateTwoCodeCompletions(input, COMMUNITY_PARTNER_TWO_CODE_PROGRAMME);
}
