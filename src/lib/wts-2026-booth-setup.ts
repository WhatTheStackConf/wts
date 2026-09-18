import { createHash } from "node:crypto";
import { z } from "zod";
import { GAMIFICATION_COLLECTIONS as C, withGamificationLocks, type GamificationAccountingStore } from "~/lib/gamification-accounting";
import { BOOTH_SETUP_LOCK, type AdminOperationActor } from "~/lib/gamification-operations";
import { MissionQuestionAdminService } from "~/lib/mission-question-admin";
import { QUESTION_COLLECTIONS as Q } from "~/lib/mission-question-records";
import { samePersistedJson } from "~/lib/persisted-json";
import { boothAchievementKey, boothQuestionnaire, WTS_2026_BOOTH_ACHIEVEMENTS } from "~/lib/wts-2026-booth-achievements";

const inputSchema = z.strictObject({
  scheduleId: z.string().regex(/^[a-z0-9]{15}$/),
  fullXp: z.number().int().min(2).max(1000).refine(value => value % 2 === 0, "Use even XP so half credit is exact."),
  startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), operationId: z.uuid(),
}).refine(value => Date.parse(value.endsAt) > Date.parse(value.startsAt), "End must follow start.");
export type BoothSetupInput = z.infer<typeof inputSchema>;
export interface BoothSetupReceipt { key: string; booth: string; name: string; printedLabel: string; lookupPrefix: string; achievementId: string; missionId: string; activityId: string }

type Row = { id: string; [field: string]: unknown };
function assertMatches(row: Row, expected: Record<string, unknown>, label: string): void {
  for (const [key, value] of Object.entries(expected)) {
    const same = /(_at|_from|_until)$/.test(key) && typeof value === "string" && value
      ? Date.parse(String(row[key])) === Date.parse(value)
      : samePersistedJson(row[key], value);
    if (!same) throw new Error(`${label} conflicts with the booth catalogue (${key}). Nothing is overwritten; review the existing draft.`);
  }
}
function stepId(operationId: string, step: string): string {
  const h = createHash("sha256").update(`${operationId}:${step}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Create-only preparation. Never activates, rewrites definitions, or disables another policy. */
export async function prepareBoothAchievements(store: GamificationAccountingStore, pepper: string, raw: BoothSetupInput, actor: AdminOperationActor): Promise<BoothSetupReceipt[]> {
  if (actor.role !== "admin") throw new Error("Admin required.");
  const input = inputSchema.parse(raw);
  const questions = new MissionQuestionAdminService(store, pepper);
  const reason = "Prepare WTS 2026 booth achievement catalogue.";
  const operation = (step: string) => stepId(input.operationId, step);
  return withGamificationLocks(store, [BOOTH_SETUP_LOCK, "configuration:score-schedule"], async () => {
    const schedule = await store.getById<Row>(C.scoreSchedules, input.scheduleId);
    if (schedule.status !== "draft") throw new Error("Choose a draft score schedule. No live scoring is changed.");
    if (Date.parse(String(schedule.effective_at)) > Date.parse(input.startsAt)) throw new Error("The score schedule must take effect no later than the booth opening time.");
    for (const collection of [C.achievements, C.missions, C.activities]) {
      for (const entry of WTS_2026_BOOTH_ACHIEVEMENTS) {
        const row = await store.findOne<Row>(collection, { key: boothAchievementKey(entry) });
        if (row && row.status !== "draft") throw new Error("This booth catalogue contains published definitions. Review it in Catalog; no live changes are permitted.");
      }
    }
    // Match and reuse existing rows without sending any update. If a create response
    // was lost, its stored origin repairs the original audit, not a new command.
    async function ensureRow(collection: string, match: Record<string, unknown>, body: Record<string, unknown>, label: string): Promise<Row> {
      let row = await store.findOne<Row>(collection, match);
      if (!row) {
        const created = await store.create<Row>(collection, { ...body, metadata: { booth_setup_actor: actor.id, booth_setup_operation: input.operationId } });
        row = await store.getById<Row>(collection, created.id);
      }
      assertMatches(row, body, label);
      const origin = row.metadata as { booth_setup_actor?: string; booth_setup_operation?: string } | undefined;
      if (origin?.booth_setup_actor && origin.booth_setup_operation) {
        const auditKey = `booth-setup:v1:${collection}:${row.id}`;
        if (!await store.findOne(C.adminActions, { idempotency_key: auditKey })) {
          await store.create(C.adminActions, {
            actor: origin.booth_setup_actor, actor_role: "admin", action: "configuration_change", status: "applied", reason,
            correlation_id: origin.booth_setup_operation, idempotency_key: auditKey,
            related_collection: collection, related_record_id: row.id,
            after_summary: { catalogue: "wts26-booths", key: body.key || body.policy_key, record_id: row.id },
          });
        }
      }
      return row;
    }
    const receipts: BoothSetupReceipt[] = [];
    for (const [sortOrder, entry] of WTS_2026_BOOTH_ACHIEVEMENTS.entries()) {
      const key = boothAchievementKey(entry);
      const description = `Visit ${entry.booth} and answer its question. Correct: full XP; incorrect: half XP. One award per person.`;
      const achievement = await ensureRow(C.achievements, { key }, {
        key, badge_name: entry.name, badge_description: description, category: "booth", rarity: "common", visibility: "public", status: "draft",
        unlock_rule: { kind: "activity_claim" }, active_from: input.startsAt, active_until: input.endsAt, sort_order: sortOrder,
      }, entry.name);
      const mission = await ensureRow(C.missions, { key }, {
        key, slug: `wts26-booth-${entry.key}`, title: entry.name, summary: description, category: "booth", visibility: "public", status: "draft",
        primary_achievement: achievement.id, starts_at: input.startsAt, ends_at: input.endsAt, suggested: true, sort_order: sortOrder,
      }, entry.name);
      const activity = await ensureRow(C.activities, { key }, {
        key, mission: mission.id, achievement: achievement.id, kind: "qr", category: "booth", outcome_key: "completion", evidence_mode: "single_code", evidence_channel: "wts_qr",
        deployment_label: `${entry.booth} (${entry.printedLabel})`, per_user_claim_limit: 1, max_claims: 10000, active_from: input.startsAt, active_until: input.endsAt,
        enabled: true, status: "draft", partner_follow_up_enabled: false,
      }, entry.name);
      await ensureRow(C.scoreSchedulePolicies, { schedule: input.scheduleId, activity: activity.id }, {
        schedule: input.scheduleId, activity: activity.id, policy_key: key, active: true, total_xp: input.fullXp, leaderboard_xp: input.fullXp,
        cap_membership: [{ dimension: "activity", key: activity.id }, { dimension: "category", key: "booth" }, { dimension: "conference", key: "conference" }],
      }, entry.name);
      const definition = boothQuestionnaire(entry);
      const existing = await store.findOne<Row>(Q.definitions, { activity: activity.id });
      if (existing) assertMatches(existing, { definition }, entry.name);
      // Replay the persisted initial command to repair its audit after response loss.
      // An unrelated existing matching questionnaire remains untouched.
      if (!existing || existing.reason === reason) {
        await questions.save({ activityId: activity.id, expectedVersion: "", operationId: existing ? String(existing.operation_id) : operation(`${key}:questions`), reason, definition }, existing ? { id: String(existing.updated_by), role: "admin" } : actor);
      }
      const saved = await store.findOne<Row>(Q.definitions, { activity: activity.id });
      if (!saved) throw new Error("Questionnaire was not persisted. Retry the same request.");
      assertMatches(saved, { definition }, entry.name);
      receipts.push({ key, booth: entry.booth, name: entry.name, printedLabel: entry.printedLabel, lookupPrefix: entry.lookupPrefix, achievementId: achievement.id, missionId: mission.id, activityId: activity.id });
    }
    return receipts;
  });
}
