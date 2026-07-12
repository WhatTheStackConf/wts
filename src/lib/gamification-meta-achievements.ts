import type {
  GamificationAchievementRecord,
  GamificationActivityClaimRecord,
  GamificationActivityRecord,
  GamificationMetaSourceDiversity,
  GamificationUnlockRule,
} from "~/lib/pocketbase-types";
import { isConfiguredEventActivityKind } from "~/lib/gamification-event-missions";

export interface MetaScoreBand {
  totalXp: 20 | 30 | 40;
  leaderboardXp: 15 | 25 | 30;
}

export interface MetaAchievementCandidate {
  achievement: GamificationAchievementRecord;
  activity: GamificationActivityRecord;
  rule: GamificationUnlockRule;
  sourceClaims: GamificationActivityClaimRecord[];
}

export interface MetaAchievementEvaluationInput {
  achievements: GamificationAchievementRecord[];
  activities: GamificationActivityRecord[];
  claims: GamificationActivityClaimRecord[];
  evaluatedAt: string;
  /** Source-void reconciliation must check retained historical definitions too. */
  includeInactiveMeta?: boolean;
}

const META_RULE_KINDS = new Set(["claim_set", "claim_count"]);
const DIVERSITY_VALUES = new Set<GamificationMetaSourceDiversity>(["session", "booth", "community"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isActiveAt(record: { active_from?: string; active_until?: string }, evaluatedAt: string): boolean {
  const timestamp = Date.parse(evaluatedAt);
  if (!Number.isFinite(timestamp)) return false;
  return (!record.active_from || timestamp >= Date.parse(record.active_from)) &&
    (!record.active_until || timestamp <= Date.parse(record.active_until));
}

export function metaRuleActivityKeys(rule: Pick<GamificationUnlockRule, "activityKeys" | "activity_keys">): string[] {
  const values = Array.isArray(rule.activityKeys) ? rule.activityKeys : Array.isArray(rule.activity_keys) ? rule.activity_keys : [];
  return [...new Set(values.map(text).filter(Boolean))];
}

export function metaRuleDiversity(rule: GamificationUnlockRule): GamificationMetaSourceDiversity | undefined {
  const value = rule.diversity || rule.sourceDiversity || rule.source_diversity;
  return typeof value === "string" && DIVERSITY_VALUES.has(value as GamificationMetaSourceDiversity)
    ? value as GamificationMetaSourceDiversity
    : undefined;
}

export function metaRuleSourceBreadth(rule: GamificationUnlockRule): number | undefined {
  if (rule.kind === "claim_set") return metaRuleActivityKeys(rule).length;
  if (rule.kind === "claim_count" && Number.isInteger(rule.count) && Number(rule.count) > 0) return Number(rule.count);
  return undefined;
}

export function metaScoreBandForRule(rule: GamificationUnlockRule): MetaScoreBand | undefined {
  const breadth = metaRuleSourceBreadth(rule);
  if (!breadth || breadth < 2) return undefined;
  if (breadth <= 3) return { totalXp: 20, leaderboardXp: 15 };
  if (breadth === 4) return { totalXp: 30, leaderboardXp: 25 };
  return { totalXp: 40, leaderboardXp: 30 };
}

/** Returns the source entity used to prevent tier-stacking in diversity rules. */
export function metaSourceEntityKey(
  activity: GamificationActivityRecord,
  diversity: GamificationMetaSourceDiversity,
): string | undefined {
  if (diversity === "session") return activity.session ? `session:${activity.session}` : undefined;
  if (diversity === "booth") return activity.kind === "booth" && activity.partner ? `booth:${activity.partner}` : undefined;
  if (diversity === "community") {
    if (activity.kind !== "community_partner" || !activity.partner || !activity.mission) return undefined;
    // A community programme is a Mission-level inventory item, not its parent organization alone.
    return `community:${activity.mission}`;
  }
  return undefined;
}

export function selectedMetaSourceActivities(
  rule: GamificationUnlockRule,
  activities: GamificationActivityRecord[],
): GamificationActivityRecord[] {
  const keys = new Set(metaRuleActivityKeys(rule));
  return activities.filter((activity) =>
    activity.kind !== "meta" &&
    // Session Missions opt in to Meta source selection during their audited configuration.
    (activity.kind !== "session" || activity.session_meta_eligible !== false) &&
    // Configured events explicitly register one attendance or completion outcome.
    (!isConfiguredEventActivityKind(activity.kind) || activity.event_meta_eligible === true) &&
    // Community programmes explicitly designate at most one qualifying outcome.
    (activity.kind !== "community_partner" || activity.community_meta_eligible === true) &&
    (keys.has(activity.id) || keys.has(activity.key)),
  );
}

function effectiveDiversity(
  rule: GamificationUnlockRule,
  activities: GamificationActivityRecord[],
): GamificationMetaSourceDiversity | undefined {
  const configured = metaRuleDiversity(rule);
  if (configured) return configured;
  if (activities.length < 2) return undefined;
  if (activities.every((activity) => activity.kind === "session" && metaSourceEntityKey(activity, "session"))) return "session";
  if (activities.every((activity) => activity.kind === "booth" && metaSourceEntityKey(activity, "booth"))) return "booth";
  if (activities.every((activity) => activity.kind === "community_partner" && metaSourceEntityKey(activity, "community"))) return "community";
  return undefined;
}

function firstClaimByActivity(claims: GamificationActivityClaimRecord[]): Map<string, GamificationActivityClaimRecord> {
  const sorted = [...claims].sort((left, right) =>
    Date.parse(left.occurred_at) - Date.parse(right.occurred_at) || left.id.localeCompare(right.id),
  );
  const byActivity = new Map<string, GamificationActivityClaimRecord>();
  for (const claim of sorted) {
    if (!byActivity.has(claim.activity)) byActivity.set(claim.activity, claim);
  }
  return byActivity;
}

function satisfiesClaimSet(
  rule: GamificationUnlockRule,
  selectedActivities: GamificationActivityRecord[],
  claimsByActivity: Map<string, GamificationActivityClaimRecord>,
): GamificationActivityClaimRecord[] | undefined {
  const keys = metaRuleActivityKeys(rule);
  if (keys.length < 2 || selectedActivities.length !== keys.length) return undefined;
  const claims = selectedActivities.map((activity) => claimsByActivity.get(activity.id));
  if (claims.some((claim) => !claim)) return undefined;
  const diversity = effectiveDiversity(rule, selectedActivities);
  if (diversity) {
    const entities = selectedActivities.map((activity) => metaSourceEntityKey(activity, diversity));
    if (entities.some((entity) => !entity) || new Set(entities).size !== entities.length) return undefined;
  }
  return claims as GamificationActivityClaimRecord[];
}

function satisfiesClaimCount(
  rule: GamificationUnlockRule,
  selectedActivities: GamificationActivityRecord[],
  claimsByActivity: Map<string, GamificationActivityClaimRecord>,
): GamificationActivityClaimRecord[] | undefined {
  const requiredCount = metaRuleSourceBreadth(rule);
  if (!requiredCount || selectedActivities.length === 0) return undefined;
  const qualifying = selectedActivities
    .filter((activity) => !rule.category || activity.category === rule.category)
    .map((activity) => ({ activity, claim: claimsByActivity.get(activity.id) }))
    .filter((candidate): candidate is { activity: GamificationActivityRecord; claim: GamificationActivityClaimRecord } => Boolean(candidate.claim));
  const diversity = effectiveDiversity(rule, selectedActivities);
  const oneClaimPerSource = new Map<string, GamificationActivityClaimRecord>();
  for (const candidate of qualifying) {
    const sourceKey = diversity ? metaSourceEntityKey(candidate.activity, diversity) : `activity:${candidate.activity.id}`;
    if (sourceKey && !oneClaimPerSource.has(sourceKey)) oneClaimPerSource.set(sourceKey, candidate.claim);
  }
  const claims = [...oneClaimPerSource.values()];
  return claims.length >= requiredCount ? claims : undefined;
}

/**
 * Evaluates only the two resolved Meta rule forms. It is deliberately pure so every
 * evidence source can share the same rule semantics through accounting.
 */
export function evaluateMetaAchievements(input: MetaAchievementEvaluationInput): MetaAchievementCandidate[] {
  const acceptedSourceClaims = input.claims.filter((claim) => claim.status === "accepted" && claim.source_type !== "system_meta");
  const claimsByActivity = firstClaimByActivity(acceptedSourceClaims);
  const candidates: MetaAchievementCandidate[] = [];
  for (const achievement of input.achievements) {
    const rule = achievement.unlock_rule;
    if (
      achievement.category !== "meta" ||
      (!input.includeInactiveMeta && (achievement.status !== "active" || !isActiveAt(achievement, input.evaluatedAt))) ||
      !META_RULE_KINDS.has(rule.kind)
    ) {
      continue;
    }
    const metaActivities = input.activities.filter((activity) =>
      activity.achievement === achievement.id &&
      activity.kind === "meta" &&
      activity.category === "meta" &&
      activity.outcome_key === "meta" &&
      activity.evidence_mode === "meta_rule" &&
      (input.includeInactiveMeta || (activity.status === "active" && activity.enabled && isActiveAt(activity, input.evaluatedAt))),
    );
    if (metaActivities.length !== 1) continue;
    const selectedActivities = selectedMetaSourceActivities(rule, input.activities);
    const sourceClaims = rule.kind === "claim_set"
      ? satisfiesClaimSet(rule, selectedActivities, claimsByActivity)
      : satisfiesClaimCount(rule, selectedActivities, claimsByActivity);
    if (!sourceClaims) continue;
    candidates.push({ achievement, activity: metaActivities[0], rule, sourceClaims });
  }
  return candidates.sort((left, right) => left.achievement.key.localeCompare(right.achievement.key));
}
