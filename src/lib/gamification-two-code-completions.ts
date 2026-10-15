import type {
  GamificationAchievementRecord,
  GamificationActivityClaimRecord,
  GamificationActivityRecord,
  GamificationUnlockRule,
} from "~/lib/pocketbase-types";

export interface TwoCodeCompletionCandidate {
  achievement: GamificationAchievementRecord;
  activity: GamificationActivityRecord;
  sourceClaims: GamificationActivityClaimRecord[];
  occurredAt: string;
}

export interface TwoCodeCompletionInput {
  achievements: GamificationAchievementRecord[];
  activities: GamificationActivityRecord[];
  claims: GamificationActivityClaimRecord[];
  includeInactive?: boolean;
}

/** The programme-specific rules around the shared start/finish derived-claim model. */
export interface TwoCodeProgramme {
  isCompletionActivity(activity: GamificationActivityRecord): boolean;
  isProgrammeAchievement(achievement: GamificationAchievementRecord, completion: GamificationActivityRecord): boolean;
  activityKeys(rule: GamificationUnlockRule): string[];
  isMatchingSource(source: GamificationActivityRecord, completion: GamificationActivityRecord): boolean;
}

function activeAt(record: { active_from?: string; active_until?: string }, occurredAt: string): boolean {
  const timestamp = Date.parse(occurredAt);
  return Number.isFinite(timestamp) &&
    (!record.active_from || timestamp >= Date.parse(record.active_from)) &&
    (!record.active_until || timestamp <= Date.parse(record.active_until));
}

function firstAcceptedClaimByActivity(claims: GamificationActivityClaimRecord[]): Map<string, GamificationActivityClaimRecord> {
  const firstClaimByActivity = new Map<string, GamificationActivityClaimRecord>();
  for (const claim of claims
    .filter((candidate) => candidate.status === "accepted" && candidate.source_type !== "system_derived")
    .sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at) || left.id.localeCompare(right.id))) {
    if (!firstClaimByActivity.has(claim.activity)) firstClaimByActivity.set(claim.activity, claim);
  }
  return firstClaimByActivity;
}

function isLiveDerivedCompletion(completion: GamificationActivityRecord, includeInactive: boolean | undefined): boolean {
  return completion.evidence_mode === "derived_claim_set" &&
    completion.outcome_key === "completion" &&
    (includeInactive || (completion.status === "active" && completion.enabled));
}

/** Exactly one start and one finish Activity, resolved by id or key. */
function startAndFinishSources(keys: string[], activities: GamificationActivityRecord[]): GamificationActivityRecord[] | undefined {
  if (keys.length !== 2) return undefined;
  const sources = keys.map((key) => activities.find((activity) => activity.id === key || activity.key === key));
  if (sources.some((source) => !source)) return undefined;
  const sourceActivities = sources as GamificationActivityRecord[];
  const starts = sourceActivities.filter((activity) => activity.evidence_mode === "two_code_start").length;
  const finishes = sourceActivities.filter((activity) => activity.evidence_mode === "two_code_finish").length;
  return starts === 1 && finishes === 1 ? sourceActivities : undefined;
}

function firstSourceClaims(
  sourceActivities: GamificationActivityRecord[],
  firstClaimByActivity: Map<string, GamificationActivityClaimRecord>,
): GamificationActivityClaimRecord[] | undefined {
  const sourceClaims = sourceActivities.map((activity) => firstClaimByActivity.get(activity.id));
  return sourceClaims.some((claim) => !claim) ? undefined : sourceClaims as GamificationActivityClaimRecord[];
}

function liveAt(
  achievement: GamificationAchievementRecord,
  completion: GamificationActivityRecord,
  occurredAt: string,
  includeInactive: boolean | undefined,
): boolean {
  return Boolean(includeInactive) ||
    (achievement.status === "active" && activeAt(achievement, occurredAt) && activeAt(completion, occurredAt));
}

function twoCodeCandidate(
  completion: GamificationActivityRecord,
  input: TwoCodeCompletionInput,
  programme: TwoCodeProgramme,
  firstClaimByActivity: Map<string, GamificationActivityClaimRecord>,
): TwoCodeCompletionCandidate | undefined {
  if (!programme.isCompletionActivity(completion) || !isLiveDerivedCompletion(completion, input.includeInactive)) return undefined;
  const achievement = input.achievements.find((candidate) => candidate.id === completion.achievement);
  if (!achievement || !programme.isProgrammeAchievement(achievement, completion) || achievement.unlock_rule.kind !== "claim_set") return undefined;
  const sourceActivities = startAndFinishSources(programme.activityKeys(achievement.unlock_rule), input.activities);
  if (!sourceActivities || !sourceActivities.every((activity) => programme.isMatchingSource(activity, completion))) return undefined;
  const claims = firstSourceClaims(sourceActivities, firstClaimByActivity);
  if (!claims) return undefined;
  const occurredAt = [...claims].sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at))[0].occurred_at;
  if (!liveAt(achievement, completion, occurredAt, input.includeInactive)) return undefined;
  return { achievement, activity: completion, sourceClaims: claims, occurredAt };
}

/** Resolves start/finish completion claims for one programme through the shared derived-claim accounting path. */
export function evaluateTwoCodeCompletions(input: TwoCodeCompletionInput, programme: TwoCodeProgramme): TwoCodeCompletionCandidate[] {
  const firstClaimByActivity = firstAcceptedClaimByActivity(input.claims);
  return input.activities
    .flatMap((completion) => {
      const candidate = twoCodeCandidate(completion, input, programme, firstClaimByActivity);
      return candidate ? [candidate] : [];
    })
    .sort((left, right) => left.activity.key.localeCompare(right.activity.key));
}
