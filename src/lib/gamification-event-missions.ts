import type {
  GamificationAchievementRecord,
  GamificationActivityClaimRecord,
  GamificationActivityRecord,
  GamificationMissionRecord,
  GamificationUnlockRule,
} from "~/lib/pocketbase-types";
import { evaluateTwoCodeCompletions, type TwoCodeCompletionInput, type TwoCodeProgramme } from "~/lib/gamification-two-code-completions";

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

const CONFIGURED_EVENT_VISIBILITIES: readonly string[] = ["public", "hidden_until_unlocked", "admin_only"];

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

function aliasedText(record: Record<string, unknown>, camelKey: string, snakeKey: string): string | undefined {
  return text(record[camelKey] || record[snakeKey]);
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
  const eventKey = aliasedText(record, "eventKey", "event_key");
  const kind = record.kind;
  const title = text(record.title);
  const startsAt = aliasedText(record, "startsAt", "starts_at");
  const endsAt = aliasedText(record, "endsAt", "ends_at");
  const visibility = record.visibility;
  if (
    !eventKey ||
    !isConfiguredEventKind(kind) ||
    !title ||
    !startsAt ||
    !endsAt ||
    !CONFIGURED_EVENT_VISIBILITIES.includes(String(visibility))
  ) {
    return undefined;
  }
  const locationLabel = aliasedText(record, "locationLabel", "location_label");
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

const CONFIGURED_EVENT_TWO_CODE_PROGRAMME: TwoCodeProgramme = {
  isCompletionActivity: (activity) =>
    isConfiguredEventActivityKind(activity.kind) && configuredEventReference(activity.event_ref) !== undefined,
  isProgrammeAchievement: (achievement, completion) => achievement.category === completion.category,
  activityKeys,
  isMatchingSource: (source, completion) => sameConfiguredEventReference(source.event_ref, completion.event_ref),
};

/** Resolves ordinary event completion claims; cross-event circuits remain owned by the shared Meta evaluator. */
export function evaluateConfiguredEventCompletions(input: TwoCodeCompletionInput): ConfiguredEventCompletionCandidate[] {
  return evaluateTwoCodeCompletions(input, CONFIGURED_EVENT_TWO_CODE_PROGRAMME);
}
