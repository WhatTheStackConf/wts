import type {
  GamificationAchievementRecord,
  GamificationActivityClaimRecord,
  GamificationActivityRecord,
  GamificationMissionRecord,
  GamificationUnlockRule,
} from "~/lib/pocketbase-types";

export const CONFIGURED_EVENT_KINDS = ["workshop", "warmup", "satellite", "social"] as const;
export type ConfiguredEventKind = (typeof CONFIGURED_EVENT_KINDS)[number];

export interface ConfiguredEventReference {
  eventKey: string;
  kind: ConfiguredEventKind;
  title: string;
  startsAt: string;
  endsAt: string;
  visibility: GamificationMissionRecord["visibility"];
  locationLabel?: string;
}

export interface ConfiguredEventCompletionCandidate {
  achievement: GamificationAchievementRecord;
  activity: GamificationActivityRecord;
  sourceClaims: GamificationActivityClaimRecord[];
  occurredAt: string;
}

const ACTIVITY_KIND_BY_EVENT_KIND = {
  workshop: "workshop",
  warmup: "warmup_event",
  satellite: "satellite_event",
  social: "social",
} as const satisfies Record<ConfiguredEventKind, GamificationActivityRecord["kind"]>;

const CONFIGURED_EVENT_ACTIVITY_KINDS = new Set<GamificationActivityRecord["kind"]>(
  Object.values(ACTIVITY_KIND_BY_EVENT_KIND),
);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function activityKeys(rule: GamificationUnlockRule): string[] {
  const values = Array.isArray(rule.activityKeys) ? rule.activityKeys : Array.isArray(rule.activity_keys) ? rule.activity_keys : [];
  return [...new Set(values.map(text).filter((value): value is string => Boolean(value)))];
}

function activeAt(record: { active_from?: string; active_until?: string }, occurredAt: string): boolean {
  const timestamp = Date.parse(occurredAt);
  return Number.isFinite(timestamp) &&
    (!record.active_from || timestamp >= Date.parse(record.active_from)) &&
    (!record.active_until || timestamp <= Date.parse(record.active_until));
}

export function configuredEventActivityKind(kind: ConfiguredEventKind): GamificationActivityRecord["kind"] {
  return ACTIVITY_KIND_BY_EVENT_KIND[kind];
}

export function configuredEventCategory(kind: ConfiguredEventKind): GamificationActivityRecord["category"] {
  return ACTIVITY_KIND_BY_EVENT_KIND[kind];
}

export function configuredEventMissionKey(kind: ConfiguredEventKind, eventKey: string): string {
  return `${kind}.${eventKey}`;
}

export function isConfiguredEventKind(value: unknown): value is ConfiguredEventKind {
  return typeof value === "string" && (CONFIGURED_EVENT_KINDS as readonly string[]).includes(value);
}

export function isConfiguredEventActivityKind(value: unknown): value is GamificationActivityRecord["kind"] {
  return typeof value === "string" && CONFIGURED_EVENT_ACTIVITY_KINDS.has(value as GamificationActivityRecord["kind"]);
}

export function configuredEventReference(value: unknown): ConfiguredEventReference | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const eventKey = text(record.eventKey || record.event_key);
  const kind = record.kind;
  const title = text(record.title);
  const startsAt = text(record.startsAt || record.starts_at);
  const endsAt = text(record.endsAt || record.ends_at);
  const visibility = record.visibility;
  if (
    !eventKey ||
    !isConfiguredEventKind(kind) ||
    !title ||
    !startsAt ||
    !endsAt ||
    !["public", "hidden_until_unlocked", "admin_only"].includes(String(visibility))
  ) {
    return undefined;
  }
  const locationLabel = text(record.locationLabel || record.location_label);
  return {
    eventKey,
    kind,
    title,
    startsAt,
    endsAt,
    visibility: visibility as ConfiguredEventReference["visibility"],
    locationLabel,
  };
}

export function sameConfiguredEventReference(left: unknown, right: unknown): boolean {
  const leftRef = configuredEventReference(left);
  const rightRef = configuredEventReference(right);
  return Boolean(leftRef && rightRef && JSON.stringify(leftRef) === JSON.stringify(rightRef));
}

/** Resolves ordinary event completion claims; cross-event circuits remain owned by the shared Meta evaluator. */
export function evaluateConfiguredEventCompletions(input: {
  achievements: GamificationAchievementRecord[];
  activities: GamificationActivityRecord[];
  claims: GamificationActivityClaimRecord[];
  includeInactive?: boolean;
}): ConfiguredEventCompletionCandidate[] {
  const acceptedClaims = input.claims.filter((claim) => claim.status === "accepted" && claim.source_type !== "system_derived");
  const firstClaimByActivity = new Map<string, GamificationActivityClaimRecord>();
  for (const claim of [...acceptedClaims].sort((left, right) =>
    Date.parse(left.occurred_at) - Date.parse(right.occurred_at) || left.id.localeCompare(right.id),
  )) {
    if (!firstClaimByActivity.has(claim.activity)) firstClaimByActivity.set(claim.activity, claim);
  }
  const candidates: ConfiguredEventCompletionCandidate[] = [];
  for (const completionActivity of input.activities) {
    if (
      !isConfiguredEventActivityKind(completionActivity.kind) ||
      completionActivity.evidence_mode !== "derived_claim_set" ||
      completionActivity.outcome_key !== "completion" ||
      (!input.includeInactive && (completionActivity.status !== "active" || !completionActivity.enabled))
    ) {
      continue;
    }
    const eventRef = configuredEventReference(completionActivity.event_ref);
    const achievement = input.achievements.find((candidate) => candidate.id === completionActivity.achievement);
    if (!eventRef || !achievement || achievement.category !== completionActivity.category || achievement.unlock_rule.kind !== "claim_set") continue;
    const keys = activityKeys(achievement.unlock_rule);
    if (keys.length !== 2) continue;
    const sources = keys.map((key) => input.activities.find((activity) => activity.id === key || activity.key === key));
    if (sources.some((source) => !source)) continue;
    const sourceActivities = sources as GamificationActivityRecord[];
    if (
      sourceActivities.filter((activity) => activity.evidence_mode === "two_code_start").length !== 1 ||
      sourceActivities.filter((activity) => activity.evidence_mode === "two_code_finish").length !== 1 ||
      sourceActivities.some((activity) => !sameConfiguredEventReference(activity.event_ref, eventRef))
    ) {
      continue;
    }
    const sourceClaims = sourceActivities.map((activity) => firstClaimByActivity.get(activity.id));
    if (sourceClaims.some((claim) => !claim)) continue;
    const claims = sourceClaims as GamificationActivityClaimRecord[];
    const occurredAt = [...claims].sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at))[0].occurred_at;
    if (!input.includeInactive && (achievement.status !== "active" || !activeAt(achievement, occurredAt) || !activeAt(completionActivity, occurredAt))) continue;
    candidates.push({ achievement, activity: completionActivity, sourceClaims: claims, occurredAt });
  }
  return candidates.sort((left, right) => left.activity.key.localeCompare(right.activity.key));
}
