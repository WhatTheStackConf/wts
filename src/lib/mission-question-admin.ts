import { createHmac, randomUUID } from "node:crypto";
import { GAMIFICATION_COLLECTIONS, withGamificationLocks, type GamificationAccountingStore } from "~/lib/gamification-accounting";
import { parseQuestionnaire, type QuestionnaireDefinition } from "~/lib/mission-questions";
import { QUESTION_COLLECTIONS, type MissionQuestionnaireRecord } from "~/lib/mission-question-records";
import type { GamificationActivityRecord } from "~/lib/pocketbase-types";
import { containsMissionCode } from "~/lib/mission-code-format";

export interface SaveMissionQuestionnaireInput { activityId: string; expectedVersion: string; operationId: string; reason: string; definition: QuestionnaireDefinition }
export interface AdminQuestionnaireStatus { activityId: string; version: string; policy: QuestionnaireDefinition["policy"]; questionCount: number }
export class MissionQuestionAdminService {
  constructor(private readonly store: GamificationAccountingStore, private readonly pepper: string) {}
  async list(): Promise<AdminQuestionnaireStatus[]> {
    return (await this.store.list<MissionQuestionnaireRecord>(QUESTION_COLLECTIONS.definitions)).map(row => this.status(row));
  }
  async read(activityId: string) {
    const row = await this.store.findOne<MissionQuestionnaireRecord>(QUESTION_COLLECTIONS.definitions, { activity: activityId });
    return row ? { ...this.status(row), definition: parseQuestionnaire(row.definition) } : null;
  }
  async save(input: SaveMissionQuestionnaireInput, actor: { id: string; role: string }): Promise<AdminQuestionnaireStatus> {
    if (actor.role !== "admin") throw new Error("Admin required.");
    if (!input || typeof input.activityId !== "string" || !/^[a-z0-9]{15}$/.test(input.activityId) || typeof input.expectedVersion !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.operationId) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500 || containsMissionCode(input.reason)) throw new Error("A valid Activity, operation ID and code-free reason (up to 500 characters) are required.");
    const definition = parseQuestionnaire(input.definition);
    const hash = createHmac("sha256", this.pepper).update(JSON.stringify([actor.id, input.activityId, input.expectedVersion, input.reason, definition])).digest("hex");
    return withGamificationLocks(this.store, ["configuration:gamification", `award:activity:${input.activityId}`], async () => {
      const existing = await this.store.findOne<MissionQuestionnaireRecord>(QUESTION_COLLECTIONS.definitions, { activity: input.activityId });
      const auditKey = `questionnaire:${input.operationId}`;
      const audit = await this.store.findOne<{ id: string; metadata?: { input_hash?: string } }>(GAMIFICATION_COLLECTIONS.adminActions, { idempotency_key: auditKey });
      if (audit && audit.metadata?.input_hash !== hash) throw new Error("Questionnaire operation changed; use the original command.");
      if (audit && existing?.operation_id !== input.operationId) throw new Error("This command was already applied and superseded. Reload the questionnaire.");
      let record: MissionQuestionnaireRecord;
      if (existing?.operation_id === input.operationId) {
        if (existing.input_hash !== hash || existing.updated_by !== actor.id) throw new Error("Questionnaire operation changed; use the original command.");
        record = existing;
      } else {
        const activity = await this.store.getById<GamificationActivityRecord>(GAMIFICATION_COLLECTIONS.activities, input.activityId);
        if (activity.status !== "draft" || activity.kind !== "qr" || activity.evidence_mode !== "single_code" || activity.outcome_key !== "completion") throw new Error("Choose a draft QR completion Activity with single-code evidence.");
        for (const collection of [GAMIFICATION_COLLECTIONS.codes, GAMIFICATION_COLLECTIONS.activityClaims, QUESTION_COLLECTIONS.attempts]) {
          if (await this.store.findOne(collection, { activity: activity.id })) throw new Error("Questions are locked after codes or claims exist. Create a successor Activity.");
        }
        if ((existing?.version || "") !== input.expectedVersion) throw new Error("Questionnaire changed. Reload before editing.");
        const body = { activity: activity.id, version: randomUUID(), definition, operation_id: input.operationId, input_hash: hash, updated_by: actor.id, reason: input.reason.trim() };
        record = existing ? await this.store.update(QUESTION_COLLECTIONS.definitions, existing.id, body) : await this.store.create(QUESTION_COLLECTIONS.definitions, body);
      }
      // A write that lost its response reuses the stored command and repairs only this safe audit.
      if (!audit) await this.store.create(GAMIFICATION_COLLECTIONS.adminActions, {
        actor: actor.id, actor_role: "admin", action: "configuration_change", status: "applied", reason: input.reason.trim(),
        correlation_id: input.operationId, idempotency_key: auditKey, related_collection: QUESTION_COLLECTIONS.definitions, related_record_id: record.id,
        after_summary: this.status(record), metadata: { input_hash: hash },
      });
      return this.status(record);
    });
  }
  private status(row: MissionQuestionnaireRecord): AdminQuestionnaireStatus { return { activityId: row.activity, version: row.version, policy: row.definition.policy, questionCount: row.definition.questions.length }; }
}