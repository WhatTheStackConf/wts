// Shared print construction and replacement fences; callers own the transaction.
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}
function replacementState(app, w, previous) {
  const R = require(__hooks + "/checkin-recovery.js");
  if (!R.permitted(app, w)) return "needs_review";
  if (!previous || previous.getString("workflow_id") !== w.id) return "needs_review";
  if (R.isolated(app, previous.getString("station_id")) || R.blocked(app, previous)) return "needs_review";
  const state = previous.getString("state");
  if (["queued", "dispatched"].includes(state)) return "in_progress";
  if (!["completed", "uncertain"].includes(state)) return "needs_review";
  const attempt = R.find(app, "checkin_agent_attempts", "print_attempt_id = {:id}", { id: previous.id });
  const auth = attempt && R.find(app, "checkin_agent_authorizations", "attempt_id = {:id}", { id: attempt.id });
  if (!auth || !["protocol_complete", "output_uncertain"].includes(auth.getString("outcome"))) return "uncertain";
  if ((state === "uncertain" || auth.getString("outcome") === "output_uncertain") && !R.find(app, "checkin_recovery_observations", "print_id = {:id} && agent_attempt_id = {:attempt}", { id: previous.id, attempt: attempt.id })) return "uncertain";
  return "ready";
}
function create(app, w, options) {
  const { stationId, profile, purpose, name, affiliation, predecessorId } = options;
  if (!profile || profile.stationId !== stationId || !["initial", "replacement"].includes(purpose) || (purpose === "replacement" && !predecessorId)) throw new Error("Invalid print intent snapshot.");
  const payload = { purpose, text: { name, affiliation }, profile, rendererVersion: profile.config.rendererVersion, fontVersion: profile.config.fontVersion };
  const print = new Record(app.findCollectionByNameOrId("checkin_print_attempts"));
  const values = { workflow_id: w.id, station_id: stationId, purpose, state: "queued", profile_id: profile.id, profile_config: profile.config, profile_snapshot: profile, name, affiliation, payload_hash: $security.sha256(canonical({ profileId: profile.id, payload })), predecessor_attempt_id: purpose === "replacement" ? predecessorId : "" };
  for (const key in values) print.set(key, values[key]);
  app.save(print);
  return print;
}
module.exports = { replacementState, create };
