import type {
  GamificationAchievementRecord,
  GamificationActivityRecord,
  GamificationActivityKind,
  GamificationCapMembership,
  GamificationMissionRecord,
  GamificationProfileRecord,
  GamificationUserAchievementRecord,
  GamificationXpEventRecord,
} from "~/lib/pocketbase-types";
import { containsMissionCode } from "~/lib/mission-code-crypto";

export const ACCESS_LEVEL_PERCENTAGES = [0, 5, 15, 30, 50, 75, 100] as const;

export interface SeptemberScorePolicy {
  key: string;
  activityId: string;
  kind?: GamificationActivityKind;
  active: boolean;
  totalXp: number;
  leaderboardXp: number;
  category: string;
  scoreDay?: string;
  capMembership: GamificationCapMembership[];
  capCeilingOverrides?: Partial<Record<GamificationCapMembership["dimension"], {
    totalXpCeiling: number;
    leaderboardXpCeiling: number;
  }>>;
}

export interface CalculatedScoreCap {
  dimension: GamificationCapMembership["dimension"];
  key: string;
  memberPolicyKeys: string[];
  totalXpCeiling: number;
  leaderboardXpCeiling: number;
}

export interface CalculatedSeptemberSchedule {
  policies: SeptemberScorePolicy[];
  caps: CalculatedScoreCap[];
  totalXpCeiling: number;
  leaderboardXpCeiling: number;
  accessLevelThresholds: Record<string, number>;
}

export interface AccessLevelProgress {
  accessLevel: number;
  accessLevelThreshold: number;
  nextLevelThreshold: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  progressPercent: number;
}

export interface RebuiltGamificationProfile {
  totalXp: number;
  leaderboardXp: number;
  accessLevel: number;
  accessLevelThreshold: number;
  nextLevelThreshold: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  unlockedBadgeCount: number;
}

export interface GamificationProfileSummary {
  totalXp: number;
  leaderboardXp: number;
  accessLevel: number;
  accessLevelLabel: string;
  xpIntoLevel: number;
  xpToNextLevel: number;
  progressPercent: number;
  progressAvailable: boolean;
  repair: {
    state: "current" | "rebuild_pending";
    supportReference?: string;
  };
  opsBoard: {
    visible: boolean;
    displayName: string;
    publicBadgesVisible: boolean;
  };
  revokedBadgeCount: number;
  badges: Array<{
    id: string;
    name: string;
    description: string;
    icon?: string;
    category: string;
    rarity: string;
    retired: boolean;
    publicVisible: boolean;
    unlockedAt: string;
  }>;
  lockedBadges: Array<{
    name: string;
    teaser: string;
    category: string;
    rarity: string;
  }>;
  suggestedMissions: Array<{
    title: string;
    summary: string;
    redemptionPath: "/missions/redeem";
  }>;
}

/** The only public representation of an ops-board row. */
export interface GamificationPublicOpsBoardRow {
  rank: number;
  displayName: string;
  accessLevel: number;
  leaderboardXp: number;
  publicBadgeCount: number;
  badges: Array<{
    name: string;
    icon?: string;
    category: string;
    rarity: string;
  }>;
}

export interface GamificationPublicOpsBoardPage {
  items: GamificationPublicOpsBoardRow[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  resultLimitReached: boolean;
}

const PUBLIC_OPS_BOARD_BADGE_CATEGORIES = new Set(["onboarding", "meta"]);

function membershipKey(policy: SeptemberScorePolicy, dimension: GamificationCapMembership["dimension"]): string | undefined {
  return policy.capMembership.find((membership) => membership.dimension === dimension)?.key;
}

function ceilingFromPolicies(
  dimension: CalculatedScoreCap["dimension"],
  key: string,
  policies: SeptemberScorePolicy[],
): CalculatedScoreCap {
  const overrides = policies
    .map((policy) => policy.capCeilingOverrides?.[dimension])
    .filter((override): override is { totalXpCeiling: number; leaderboardXpCeiling: number } => Boolean(override));
  return {
    dimension,
    key,
    memberPolicyKeys: policies.map((policy) => policy.key).sort(),
    totalXpCeiling: Math.max(0, ...policies.map((policy) => policy.totalXp), ...overrides.map((override) => override.totalXpCeiling)),
    leaderboardXpCeiling: Math.max(0, ...policies.map((policy) => policy.leaderboardXp), ...overrides.map((override) => override.leaderboardXpCeiling)),
  };
}

function groupedCaps(
  dimension: CalculatedScoreCap["dimension"],
  policies: SeptemberScorePolicy[],
  keyFor: (policy: SeptemberScorePolicy) => string | undefined,
): CalculatedScoreCap[] {
  const groups = new Map<string, SeptemberScorePolicy[]>();
  for (const policy of policies) {
    const key = keyFor(policy);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(policy);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, members]) => ceilingFromPolicies(dimension, key, members));
}

function sumCaps(
  dimension: CalculatedScoreCap["dimension"],
  key: string,
  caps: CalculatedScoreCap[],
): CalculatedScoreCap {
  return {
    dimension,
    key,
    memberPolicyKeys: caps.flatMap((cap) => cap.memberPolicyKeys).sort(),
    totalXpCeiling: caps.reduce((total, cap) => total + cap.totalXpCeiling, 0),
    leaderboardXpCeiling: caps.reduce((total, cap) => total + cap.leaderboardXpCeiling, 0),
  };
}

function includeCeilings(cap: CalculatedScoreCap, inheritedCaps: CalculatedScoreCap[]): CalculatedScoreCap {
  return {
    ...cap,
    totalXpCeiling: Math.max(cap.totalXpCeiling, ...inheritedCaps.map((inherited) => inherited.totalXpCeiling)),
    leaderboardXpCeiling: Math.max(cap.leaderboardXpCeiling, ...inheritedCaps.map((inherited) => inherited.leaderboardXpCeiling)),
  };
}

function categoryUnitKey(policy: SeptemberScorePolicy): string {
  return membershipKey(policy, "partner") ||
    membershipKey(policy, "related_group") ||
    membershipKey(policy, "activity") ||
    `activity:${policy.activityId}`;
}

/**
 * Snapshots active direct policies into the September dynamic-cap model.
 * Activity values are never duplicated for a Badge unlock; each policy has one direct ceiling.
 */
export function calculateSeptemberScoreSchedule(policies: SeptemberScorePolicy[]): CalculatedSeptemberSchedule {
  const activePolicies = policies.filter(
    (policy) => policy.active && (policy.totalXp !== 0 || policy.leaderboardXp !== 0),
  );
  const activityCaps = activePolicies.map((policy) => ({
    dimension: "activity" as const,
    key: membershipKey(policy, "activity") || `activity:${policy.activityId}`,
    memberPolicyKeys: [policy.key],
    totalXpCeiling: policy.totalXp,
    leaderboardXpCeiling: policy.leaderboardXp,
  }));
  const relatedGroupCaps = groupedCaps("related_group", activePolicies, (policy) => membershipKey(policy, "related_group"));
  const relatedGroupCapsByKey = new Map(relatedGroupCaps.map((cap) => [cap.key, cap]));
  const partnerCaps = groupedCaps("partner", activePolicies, (policy) => membershipKey(policy, "partner"))
    .map((cap) => {
      const memberPolicies = activePolicies.filter((policy) => cap.memberPolicyKeys.includes(policy.key));
      const partnerGroupPolicies = memberPolicies.filter((policy) =>
        (policy.kind === "booth" || policy.kind === "community_partner" ||
          (policy.kind === undefined && (policy.category === "booth" || policy.category === "community"))) &&
        Boolean(membershipKey(policy, "related_group")),
      );
      const ceilingPolicies = partnerGroupPolicies.length > 0 ? partnerGroupPolicies : memberPolicies;
      const partnerCap = {
        ...ceilingFromPolicies("partner", cap.key, ceilingPolicies),
        // One partner cap remains the authority for every policy using this key.
        memberPolicyKeys: cap.memberPolicyKeys,
      };
      return includeCeilings(
        partnerCap,
        partnerGroupPolicies
          .map((policy) => membershipKey(policy, "related_group"))
          .flatMap((key) => key ? [relatedGroupCapsByKey.get(key)] : [])
          .filter((relatedCap): relatedCap is CalculatedScoreCap => Boolean(relatedCap)),
      );
    });
  const partnerCapsByKey = new Map(partnerCaps.map((cap) => [cap.key, cap]));
  const inheritedPartnerCaps = (policies: SeptemberScorePolicy[]) => policies
    .flatMap((policy) => {
      const partnerCap = membershipKey(policy, "partner");
      if (partnerCap) return [partnerCapsByKey.get(partnerCap)];
      const groupCap = membershipKey(policy, "related_group");
      return groupCap ? [relatedGroupCapsByKey.get(groupCap)] : [];
    })
    .filter((cap): cap is CalculatedScoreCap => Boolean(cap));

  const categoryUnits = new Map<string, SeptemberScorePolicy[]>();
  for (const policy of activePolicies) {
    const categoryKey = `${policy.category}:${categoryUnitKey(policy)}`;
    const unit = categoryUnits.get(categoryKey) || [];
    unit.push(policy);
    categoryUnits.set(categoryKey, unit);
  }
  const categoryCaps = new Map<string, CalculatedScoreCap[]>();
  for (const [key, unitPolicies] of categoryUnits) {
    const category = key.split(":", 1)[0];
    const cap = includeCeilings(ceilingFromPolicies("category", key, unitPolicies), inheritedPartnerCaps(unitPolicies));
    const caps = categoryCaps.get(category) || [];
    caps.push(cap);
    categoryCaps.set(category, caps);
  }
  const resolvedCategoryCaps = [...categoryCaps.entries()].map(([key, caps]) => sumCaps("category", key, caps));

  const dayUnits = new Map<string, SeptemberScorePolicy[]>();
  for (const policy of activePolicies) {
    if (!policy.scoreDay) continue;
    const key = `${policy.scoreDay}:${categoryUnitKey(policy)}`;
    const unit = dayUnits.get(key) || [];
    unit.push(policy);
    dayUnits.set(key, unit);
  }
  const dayCaps = new Map<string, CalculatedScoreCap[]>();
  for (const [key, unitPolicies] of dayUnits) {
    const day = key.split(":", 1)[0];
    const caps = dayCaps.get(day) || [];
    caps.push(includeCeilings(ceilingFromPolicies("conference_day", key, unitPolicies), inheritedPartnerCaps(unitPolicies)));
    dayCaps.set(day, caps);
  }
  const resolvedDayCaps = [...dayCaps.entries()].map(([key, caps]) => sumCaps("conference_day", key, caps));
  const conferenceCap = sumCaps("conference", "conference", resolvedCategoryCaps);
  const thresholds = Object.fromEntries(
    ACCESS_LEVEL_PERCENTAGES.map((percentage, index) => [
      String(index + 1),
      Math.ceil(conferenceCap.totalXpCeiling * percentage / 100),
    ]),
  );

  return {
    policies: activePolicies,
    caps: [
      ...activityCaps,
      ...relatedGroupCaps,
      ...partnerCaps,
      ...resolvedCategoryCaps,
      ...resolvedDayCaps,
      conferenceCap,
    ],
    totalXpCeiling: conferenceCap.totalXpCeiling,
    leaderboardXpCeiling: conferenceCap.leaderboardXpCeiling,
    accessLevelThresholds: thresholds,
  };
}

function thresholdFor(level: number, thresholds: Record<string, number>): number {
  const threshold = Number(thresholds[String(level)]);
  return Number.isFinite(threshold) ? Math.max(0, threshold) : 0;
}

/** Returns Access Level 1 while no score-bearing schedule has a positive ceiling. */
export function accessLevelForTotalXp(totalXp: number, thresholds: Record<string, number>): number {
  if (thresholdFor(7, thresholds) <= 0) return 1;
  let level = 1;
  for (let candidate = 2; candidate <= 7; candidate += 1) {
    if (totalXp >= thresholdFor(candidate, thresholds)) level = candidate;
  }
  return level;
}

export function accessLevelProgress(
  totalXp: number,
  accessLevel: number,
  thresholds: Record<string, number>,
): AccessLevelProgress {
  const accessLevelThreshold = thresholdFor(accessLevel, thresholds);
  const nextLevelThreshold = accessLevel >= 7 ? accessLevelThreshold : thresholdFor(accessLevel + 1, thresholds);
  const xpIntoLevel = Math.max(0, totalXp - accessLevelThreshold);
  const xpToNextLevel = accessLevel >= 7 ? 0 : Math.max(0, nextLevelThreshold - totalXp);
  const levelSpan = nextLevelThreshold - accessLevelThreshold;
  const progressPercent = accessLevel >= 7
    ? 100
    : levelSpan > 0
    ? Math.min(100, Math.max(0, Math.round(xpIntoLevel / levelSpan * 100)))
    : 0;
  return {
    accessLevel,
    accessLevelThreshold,
    nextLevelThreshold,
    xpIntoLevel,
    xpToNextLevel,
    progressPercent,
  };
}

/** Rebuilds cache fields from authoritative non-voided ledger events and non-revoked Badges. */
export function rebuildGamificationProfile(
  existingProfile: Pick<GamificationProfileRecord, "access_level"> | undefined,
  xpEvents: GamificationXpEventRecord[],
  userAchievements: GamificationUserAchievementRecord[],
  thresholds: Record<string, number>,
): RebuiltGamificationProfile {
  const activeEvents = xpEvents.filter((event) => !event.voided);
  const totalXp = activeEvents.reduce((total, event) => total + Number(event.amount), 0);
  const leaderboardXp = activeEvents.reduce((total, event) => total + Number(event.leaderboard_amount), 0);
  const calculatedLevel = accessLevelForTotalXp(totalXp, thresholds);
  // A successor schedule may expand the ceiling but cannot lower an earned Access Level.
  const accessLevel = Math.max(existingProfile?.access_level || 1, calculatedLevel);
  const progress = accessLevelProgress(totalXp, accessLevel, thresholds);
  return {
    totalXp,
    leaderboardXp,
    accessLevel,
    accessLevelThreshold: progress.accessLevelThreshold,
    nextLevelThreshold: progress.nextLevelThreshold,
    xpIntoLevel: progress.xpIntoLevel,
    xpToNextLevel: progress.xpToNextLevel,
    unlockedBadgeCount: userAchievements.filter((achievement) => achievement.status === "unlocked").length,
  };
}

/** Uses only a safe User name or a non-email generated handle for ops-board display. */
export function defaultGamificationDisplayName(user: Pick<{ id: string; name?: string; email?: string }, "id" | "name" | "email">): string {
  try {
    return validateGamificationDisplayName(user.name);
  } catch {
    // An account name can be absent or an email address, neither of which belongs on the ops board.
  }
  return `Agent ${user.id.slice(-6).toUpperCase()}`;
}

/** Validates the User-controlled label that can be shown on the public ops board. */
export function validateGamificationDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Ops-board display name is required.");
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error("Ops-board display name cannot contain control characters.");
  }
  const displayName = value.trim().replace(/\s+/g, " ");
  if (!displayName) throw new Error("Ops-board display name is required.");
  if (containsMissionCode(displayName)) throw new Error("Ops-board display name cannot contain a Mission code.");
  if (displayName.length > 80) throw new Error("Ops-board display name must be 80 characters or fewer.");
  if (displayName.includes("@")) throw new Error("Ops-board display name cannot be an email address.");
  return displayName;
}

function safeGamificationDisplayName(value: unknown, userId: string): string {
  try {
    return validateGamificationDisplayName(value);
  } catch {
    return defaultGamificationDisplayName({ id: userId });
  }
}

/** Maps only allowlisted Badge presentation and cached progress into the current-User DTO. */
export function buildGamificationProfileSummary(
  profile: GamificationProfileRecord,
  userAchievements: GamificationUserAchievementRecord[],
  achievements: GamificationAchievementRecord[],
  missions: GamificationMissionRecord[] = [],
): GamificationProfileSummary {
  const achievementsById = new Map(achievements.map((achievement) => [achievement.id, achievement]));
  const badges = userAchievements
    .filter((userAchievement) => userAchievement.status === "unlocked")
    .flatMap((userAchievement) => {
      const achievement = achievementsById.get(userAchievement.achievement);
      return achievement ? [{
        id: userAchievement.id,
        name: achievement.badge_name,
        description: achievement.badge_description,
        icon: achievement.icon || undefined,
        category: achievement.category,
        rarity: achievement.rarity,
        retired: achievement.status === "retired" || achievement.visibility === "retired",
        publicVisible: userAchievement.public_visible,
        unlockedAt: userAchievement.unlocked_at,
      }] : [];
    })
    .sort((left, right) => Date.parse(right.unlockedAt) - Date.parse(left.unlockedAt));
  const progress = accessLevelProgress(profile.total_xp, profile.access_level, {
    [String(profile.access_level)]: profile.access_level_threshold,
    [String(profile.access_level + 1)]: profile.next_level_threshold,
  });
  const unlockedAchievementIds = new Set(
    userAchievements
      .filter((userAchievement) => userAchievement.status === "unlocked")
      .map((userAchievement) => userAchievement.achievement),
  );
  const revokedAchievementIds = new Set(
    userAchievements
      .filter((userAchievement) => userAchievement.status === "revoked")
      .map((userAchievement) => userAchievement.achievement),
  );
  const lockedBadges = achievements
    .filter((achievement) =>
      achievement.status === "active" &&
      !unlockedAchievementIds.has(achievement.id) &&
      !revokedAchievementIds.has(achievement.id) &&
      (achievement.visibility === "public" || achievement.visibility === "locked_teaser")
    )
    .map((achievement) => ({
      name: achievement.visibility === "locked_teaser" ? "Locked Badge" : achievement.badge_name,
      teaser: achievement.visibility === "locked_teaser"
        ? achievement.locked_teaser || "Complete its Mission to reveal this Badge."
        : achievement.locked_teaser || "Complete its Mission to unlock this Badge.",
      category: achievement.category,
      rarity: achievement.rarity,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const suggestedMissions = missions
    .filter((mission) => mission.status === "active" && mission.visibility === "public" && mission.suggested)
    .map((mission) => ({
      title: mission.title,
      summary: mission.summary,
      redemptionPath: "/missions/redeem" as const,
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
  return {
    totalXp: profile.total_xp,
    leaderboardXp: profile.leaderboard_xp,
    accessLevel: profile.access_level,
    accessLevelLabel: `Access Level ${profile.access_level}`,
    xpIntoLevel: profile.xp_into_level,
    xpToNextLevel: profile.xp_to_next_level,
    progressPercent: progress.progressPercent,
    progressAvailable: Boolean(profile.access_level_schedule),
    repair: {
      state: profile.rebuild_pending ? "rebuild_pending" : "current",
      supportReference: profile.rebuild_pending && profile.rebuild_support_reference
        ? profile.rebuild_support_reference
        : undefined,
    },
    opsBoard: {
      visible: profile.ops_board_visible,
      displayName: safeGamificationDisplayName(profile.ops_board_display_name, profile.user),
      publicBadgesVisible: profile.public_badges_visible,
    },
    revokedBadgeCount: userAchievements.filter((userAchievement) =>
      userAchievement.status === "revoked" &&
      !userAchievements.some((candidate) =>
        candidate.achievement === userAchievement.achievement && candidate.status === "unlocked"
      )
    ).length,
    badges,
    lockedBadges,
    suggestedMissions,
  };
}

/**
 * Maps profile-cache rows into public ops-board data. Claims, Meta composition,
 * cap outcomes, total XP, and every private Badge attribute remain server-only.
 */
export function buildGamificationPublicOpsBoardRows(
  profiles: GamificationProfileRecord[],
  userAchievements: GamificationUserAchievementRecord[],
  achievements: GamificationAchievementRecord[],
  activities: GamificationActivityRecord[] = [],
): GamificationPublicOpsBoardRow[] {
  const achievementsById = new Map(achievements.map((achievement) => [achievement.id, achievement]));
  const privateSourceActivities = new Set(activities
    .filter((activity) =>
      activity.kind === "hievents" ||
      activity.kind === "session" ||
      activity.kind === "booth" ||
      activity.kind === "community_partner" ||
      Boolean(activity.partner) ||
      activity.evidence_mode === "hievents_ticket" ||
      activity.evidence_mode === "hievents_checkin" ||
      activity.outcome_key === "ticket_present" ||
      activity.outcome_key === "checked_in"
    ));
  const privateSourceKeys = new Set([...privateSourceActivities].flatMap((activity) => [activity.id, activity.key]));
  const privateAchievementIds = new Set([
    ...[...privateSourceActivities].flatMap((activity) => activity.achievement ? [activity.achievement] : []),
    ...achievements
      .filter((achievement) => achievement.category === "meta")
      .filter((achievement) => {
        const sourceKeys = achievement.unlock_rule.activityKeys || achievement.unlock_rule.activity_keys || [];
        return sourceKeys.some((key) => privateSourceKeys.has(key));
      })
      .map((achievement) => achievement.id),
  ]);
  const badgesByUser = new Map<string, GamificationUserAchievementRecord[]>();
  for (const badge of userAchievements) {
    if (badge.status !== "unlocked" || !badge.public_visible) continue;
    const badges = badgesByUser.get(badge.user) || [];
    badges.push(badge);
    badgesByUser.set(badge.user, badges);
  }
  const visibleProfiles = profiles
    .filter((profile) => profile.ops_board_visible)
    .sort((left, right) => right.leaderboard_xp - left.leaderboard_xp || left.id.localeCompare(right.id));
  let previousXp: number | undefined;
  let rank = 0;
  return visibleProfiles.map((profile, index) => {
    if (previousXp === undefined || profile.leaderboard_xp !== previousXp) rank = index + 1;
    previousXp = profile.leaderboard_xp;
    const publicBadges = profile.public_badges_visible
      ? (badgesByUser.get(profile.user) || [])
        .map((badge) => achievementsById.get(badge.achievement))
        .filter((achievement): achievement is GamificationAchievementRecord =>
          Boolean(
            achievement &&
            (achievement.status === "active" || achievement.status === "retired") &&
            achievement.visibility === "public" &&
            !privateAchievementIds.has(achievement.id) &&
            // Source-bearing Badges can reveal ticket, attendance, Session, event,
            // partner, or hidden-discovery history through presentation copy alone.
            PUBLIC_OPS_BOARD_BADGE_CATEGORIES.has(achievement.category),
          ),
        )
        .map((achievement) => ({
          name: achievement.badge_name,
          icon: achievement.icon || undefined,
          category: achievement.category,
          rarity: achievement.rarity,
        }))
      : [];
    return {
      rank,
      displayName: safeGamificationDisplayName(profile.ops_board_display_name, profile.user),
      accessLevel: profile.access_level,
      leaderboardXp: profile.leaderboard_xp,
      publicBadgeCount: publicBadges.length,
      badges: publicBadges.slice(0, 3),
    };
  });
}
