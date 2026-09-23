/// <reference path="../pb_data/types.d.ts" />
// PocketBase's REST update can load a record BEFORE a competing submission
// commits, then overwrite unchanged fields from that stale snapshot. Rebase
// privileged invitation edits inside the same write transaction as submission;
// apply only explicitly supplied, known fields to the current record.
onRecordUpdateRequest((e) => {
  const body = e.requestInfo().body;
  const fields = ["survey", "source_key", "email", "token_hash", "used", "revoked", "expires_at"];
  if (Object.keys(body).some(k => !fields.includes(k))) throw new BadRequestError("Invalid invitation update.");
  e.app.runInTransaction((tx) => {
    const supplied = e.record;
    const current = tx.findRecordById("feedback_invitations", supplied.id);
    for (const key of Object.keys(body)) current.set(key, supplied.get(key));
    e.app = tx;
    e.record = current;
    e.next();
  });
}, "feedback_invitations");

onRecordValidate((e) => {
  const r = e.record, old = r.original();
  const validation = require(`${__hooks}/feedback-validation.js`);
  const sessions = JSON.parse(r.getString("sessions") || "null");
  if (!Array.isArray(sessions) || sessions.length > 200) throw new BadRequestError("Invalid frozen session catalogue.");
  const ids = [];
  for (const session of sessions) {
    if (!validation.object(session, ["id", "title"]) || typeof session.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(session.id) || ids.includes(session.id) || typeof session.title !== "string" || !session.title.trim() || session.title.length > 300) throw new BadRequestError("Invalid frozen session catalogue.");
    ids.push(session.id);
  }
  const opens = Date.parse(r.getString("opens_at")), closes = Date.parse(r.getString("closes_at"));
  if (!Number.isFinite(opens) || !Number.isFinite(closes) || opens >= closes) throw new BadRequestError("Invalid survey window.");
  if (old.id && ["key", "version", "sessions"].some(k => r.getString(k) !== old.getString(k))) {
    for (const collection of ["feedback_invitations", "feedback_responses"]) {
      if (e.app.findRecordsByFilter(collection, "survey = {:survey}", "", 1, 0, { survey: r.id }).length) throw new BadRequestError("Issued survey semantics are frozen.");
    }
  }
  return e.next();
}, "feedback_surveys");

onRecordValidate((e) => {
  const r = e.record, old = r.original();
  if (old.id) {
    if (["survey", "source_key"].some(k => r.getString(k) !== old.getString(k))) throw new BadRequestError("Invitation allowance identity is immutable.");
    if (old.getBool("used") && !r.getBool("used")) throw new BadRequestError("A used invitation cannot be reset.");
  }
  return e.next();
}, "feedback_invitations");
