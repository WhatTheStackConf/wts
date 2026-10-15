/// <reference path="../pb_data/types.d.ts" />
// Additive only. No real question content or answer keys are seeded.
migrate((app) => {
  const locked = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
  const relation = (name, collection) => ({ name, type: "relation", required: true, collectionId: app.findCollectionByNameOrId(collection).id, maxSelect: 1, cascadeDelete: false });
  const text = (name, required = true) => ({ name, type: "text", required, max: 1000 });
  const activities = app.findCollectionByNameOrId("gamification_activities");
  const kind = activities.fields.getByName("kind");
  kind.values = [...kind.values, "qr"];
  app.save(activities);
  const definitions = new Collection({ name: "gamification_questionnaires", type: "base", ...locked, fields: [
    relation("activity", "gamification_activities"), text("version"),
    { name: "definition", type: "json", required: true, maxSize: 64000 },
    text("operation_id"), text("input_hash"), relation("updated_by", "users"), text("reason"),
  ] });
  definitions.addIndex("idx_questionnaire_activity", true, "activity", "");
  definitions.addIndex("idx_questionnaire_operation", true, "operation_id", "");
  app.save(definitions);
  const attempts = new Collection({ name: "gamification_question_attempts", type: "base", ...locked, fields: [
    text("challenge_id"), relation("user", "users"), relation("code", "gamification_codes"),
    relation("activity", "gamification_activities"), relation("questionnaire", "gamification_questionnaires"), text("version"),
    { name: "opened_at", type: "date", required: true }, { name: "expires_at", type: "date", required: true },
    { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "passed", "incorrect", "incomplete", "malformed"] },
    text("operation_id", false), text("answer_hash", false), { name: "passed_at", type: "date" },
  ] });
  attempts.addIndex("idx_question_challenge", true, "challenge_id", "");
  attempts.addIndex("idx_question_command", true, "user, operation_id", "operation_id != ''");
  attempts.addIndex("idx_question_evidence", false, "user, code, status, expires_at", "");
  app.save(attempts);
}, (app) => {
  // Do not silently delete private completion evidence on rollback.
  throw new Error("Question evidence is retained. Use an explicit reviewed forward migration.");
});