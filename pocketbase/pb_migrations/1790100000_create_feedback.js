/// <reference path="../pb_data/types.d.ts" />
/** Ops contract (no seeded survey, dates, recipients or sends):
 * feedback_surveys: key (unique), title, version, open, opens_at, closes_at,
 *   sessions (frozen JSON array [{id,title}]).
 * feedback_invitations: survey, source_key (unique within survey), email,
 *   token_hash (unique SHA256 hex of a random 32-byte base64url token),
 *   used, revoked, expires_at. No redemption timestamp or response reference.
 * feedback_responses: independent random id, survey, version, answers ONLY.
 * All five API rules locked on all three collections. No created/updated fields.
 * Retention/delivery policy belongs to approved operations, not invented defaults.
 */
migrate((app) => {
  const locked = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
  const text = (name, max) => ({ name, type: "text", required: true, max });
  const survey = new Collection({ name: "feedback_surveys", type: "base", ...locked, fields: [
    text("key", 100), text("title", 300), text("version", 80),
    { name: "open", type: "bool" },
    { name: "opens_at", type: "date", required: true },
    { name: "closes_at", type: "date", required: true },
    { name: "sessions", type: "json", required: true, maxSize: 100000 },
  ] });
  survey.addIndex("idx_feedback_survey_key", true, "key", "");
  app.save(survey);
  const relation = () => ({ name: "survey", type: "relation", required: true, collectionId: survey.id, maxSelect: 1, cascadeDelete: false });
  const invitations = new Collection({ name: "feedback_invitations", type: "base", ...locked, fields: [
    relation(), text("source_key", 300), { name: "email", type: "email", required: true },
    { name: "token_hash", type: "text", required: true, min: 64, max: 64, pattern: "^[a-f0-9]{64}$" },
    { name: "used", type: "bool" }, { name: "revoked", type: "bool" },
    { name: "expires_at", type: "date", required: true },
  ] });
  invitations.addIndex("idx_feedback_invitation_source", true, "survey, source_key", "");
  invitations.addIndex("idx_feedback_invitation_token", true, "token_hash", "");
  app.save(invitations);
  app.save(new Collection({ name: "feedback_responses", type: "base", ...locked, fields: [
    relation(), text("version", 80), { name: "answers", type: "json", required: true, maxSize: 4194304 },
  ] }));
}, () => {
  throw new Error("Feedback requires an explicit, reviewed retention/deletion operation, not automatic rollback.");
});
