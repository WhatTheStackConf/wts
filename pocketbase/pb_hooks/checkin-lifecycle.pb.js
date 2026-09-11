/// <reference path="../pb_data/types.d.ts" />
routerAdd("POST", "/api/wts/checkin-lifecycle", (e) => {
  const domain = require(__hooks + "/checkin-lifecycle.js");
  const b = e.requestInfo().body;
  let result;
  e.app.runInTransaction((app) => {
    const actor = app.findRecordById("users", String(b.actorUserId || ""));
    if (!actor.getBool("verified") || actor.getString("role") !== "admin") throw new ForbiddenError("Admin required.");
    const now = Date.now();
    if (b.operation === "status") result = domain.status(app, now);
    else if (b.operation === "close") result = domain.close(app, actor.id, b.command, now);
    else if (b.operation === "approve_restore") result = domain.approve(app, actor.id, b.command, now);
    else throw new BadRequestError("Invalid lifecycle command.");
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

// Trusted worker seam. Never forward arbitrary operations/clock from a browser
// or agent; the coordinator must authenticate and bind purge acknowledgements.
routerAdd("POST", "/api/wts/checkin-lifecycle-worker", (e) => {
  const d = require(__hooks + "/checkin-lifecycle.js");
  const b = e.requestInfo().body;
  const now = Number.isSafeInteger(b.nowMs) ? b.nowMs : Date.now();
  let result;
  if (b.operation === "compact") {
    const s = d.state(e.app);
    if (!s.getString("central_deleted_at")) throw new BadRequestError("Delete at deadline before compaction.");
    e.app.db().newQuery("PRAGMA wal_checkpoint(TRUNCATE)").execute();
    e.app.db().newQuery("VACUUM").execute();
    e.app.db().newQuery("PRAGMA wal_checkpoint(TRUNCATE)").execute();
    s.set("central_compacted_at", new Date(now).toISOString()); e.app.save(s);
    return e.json(200, d.status(e.app, now));
  }
  e.app.runInTransaction((app) => {
    const s = d.state(app);
    if (b.operation === "tick") { result = d.purge(app, now); return; }
    if (b.operation === "reconcile_restore") {
      if (!s.getBool("restore_required") || b.generation !== s.getInt("restore_generation") || !/^[a-f0-9]{64}$/.test(b.evidenceDigest || "") || b.identitiesReconciled !== true || b.hiEventsReconciled !== true || b.unresolved !== 0 || s.getString("closed_at")) throw new BadRequestError("Restore evidence incomplete.");
      // Evidence must be produced by the supervised read-only reconciliation
      // worker, not browser checkboxes. Unknown journals never count as matching.
      d.set(s, { reconciled_at: new Date(now).toISOString(), reconciliation_digest: b.evidenceDigest }); app.save(s);
      d.audit(app, "restore_reconciled", "", "", now, b.generation); result = d.status(app, now); return;
    }
    if (b.operation !== "device_policy" && b.operation !== "device_complete") throw new BadRequestError("Invalid worker command.");
    if (!s.getString("closed_at")) throw new BadRequestError("Edition is not closed.");
    const agent = app.findFirstRecordByFilter("checkin_agents", "credential_hash = {:hash}", { hash: b.credentialHash || "" });
    const device = app.findFirstRecordByFilter("checkin_lifecycle_devices", "station_id = {:station} && journal_identity = {:journal}", { station: agent.getString("station"), journal: agent.getString("journal_identity") });
    if (b.stationId !== agent.getString("station")) throw new ForbiddenError("Foreign station.");
    device.set("last_seen_at", new Date(now).toISOString());
    if (b.operation === "device_complete") {
      if (now < Date.parse(s.getString("purge_deadline")) || b.purgeToken !== device.getString("purge_token") || b.journalIdentity !== device.getString("journal_identity") || b.method !== "retired_and_compacted") throw new BadRequestError("Invalid retirement acknowledgement.");
      if (!device.getString("completed_at")) { d.set(device, { completed_at: new Date(now).toISOString(), method: b.method }); d.audit(app, "device_retired", "", "", now, s.getInt("restore_generation")); }
    }
    app.save(device);
    result = { edition: "WTS2026", mode: "purge_only", purgeDeadline: s.getString("purge_deadline"), purgeToken: device.getString("purge_token"), stationId: agent.getString("station"), journalIdentity: device.getString("journal_identity"), completed: !!device.getString("completed_at") };
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

$app.onServe().bindFunc((e) => { require(__hooks + "/checkin-lifecycle.js").boot(e.app, Date.now()); return e.next(); });
onRecordUpdate((e) => {
  if (e.record.getBool("enabled")) require(__hooks + "/checkin-lifecycle.js").assertNewWork(e.app);
  return e.next();
}, "checkin_system", "checkin_stations", "checkin_events");
onRecordCreate((e) => { require(__hooks + "/checkin-lifecycle.js").assertNewWork(e.app); return e.next(); }, "checkin_lookup_commands", "checkin_arrival_commands", "checkin_arrival_workflows", "checkin_arrival_attempts", "checkin_print_attempts", "checkin_agent_attempts", "checkin_agent_authorizations");
onRecordUpdate((e) => {
  const s = require(__hooks + "/checkin-lifecycle.js").state(e.app);
  if (s.getString("central_deleted_at")) throw new ForbiddenError("Edition purged.");
  if (e.record.collection().name === "checkin_agent_authorizations" && !e.record.original().getString("started_at") && e.record.getString("started_at")) require(__hooks + "/checkin-lifecycle.js").assertNewWork(e.app);
  return e.next();
}, "checkin_arrival_workflows", "checkin_arrival_commands", "checkin_arrival_attempts", "checkin_print_attempts", "checkin_agent_authorizations");
// Purge is terminal for attendee-capable audit envelopes, including rollback
// reservations and generic-ledger operations targeting check-in collections.
function guardRetiredAudit(e) {
  const records = [e.record, e.record.original()];
  const checkin = e.record.collection().name === "checkin_audit_events" || records.some((r) => r.getString("operation_kind").startsWith("checkin.") || r.getString("target_collection").startsWith("checkin_"));
  if (checkin && require(__hooks + "/checkin-lifecycle.js").state(e.app).getString("central_deleted_at")) throw new ForbiddenError("Edition purged.");
  return e.next();
}
onRecordCreate(guardRetiredAudit, "checkin_audit_events", "admin_actions");
onRecordUpdate(guardRetiredAudit, "checkin_audit_events", "admin_actions");
onRecordCreateRequest(() => { throw new ForbiddenError("Use lifecycle commands."); }, "checkin_lifecycle", "checkin_lifecycle_devices", "checkin_lifecycle_audit");
onRecordUpdateRequest(() => { throw new ForbiddenError("Use lifecycle commands."); }, "checkin_lifecycle", "checkin_lifecycle_devices", "checkin_lifecycle_audit");
onRecordDelete(() => { throw new ForbiddenError("Lifecycle retirement evidence is immutable."); }, "checkin_lifecycle", "checkin_lifecycle_devices", "checkin_lifecycle_audit");
onRecordUpdate(() => { throw new ForbiddenError("Lifecycle audit is immutable."); }, "checkin_lifecycle_audit");
