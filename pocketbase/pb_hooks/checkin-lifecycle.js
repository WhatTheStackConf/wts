// PocketBase 0.30.4/0.34-compatible CJS domain. Clock is supplied only by the
// privileged worker seam; browser commands always use the server clock.
const ID = "wts2026life0000";
function state(app) { return app.findRecordById("checkin_lifecycle", ID); }
function set(r, values) { for (const k in values) r.set(k, values[k]); }
function all(app, name, filter = "", params = {}) { return app.findRecordsByFilter(name, filter, "id", 0, 0, params); }
function fail(message) { throw new BadRequestError(message); }
function audit(app, operation, actor, operationId, now, generation) {
  const r = new Record(app.findCollectionByNameOrId("checkin_lifecycle_audit"));
  set(r, { operation, actor_user_id: actor || "", operation_id: operationId || "", at: new Date(now).toISOString(), generation }); app.save(r);
}
function disable(app) {
  for (const name of ["checkin_system", "checkin_stations"]) for (const r of all(app, name)) {
    set(r, { enabled: false, generation: r.getInt("generation") + 1, version: r.getInt("version") + 1 }); app.save(r);
  }
  const c = app.findRecordById("checkin_coordinator", "wts2026coord000");
  set(c, { owner: "", last_seen_at: "", generation: c.getInt("generation") + 1 }); app.save(c);
  // Started authorizations deliberately remain intact: original secrets can report
  // outcomes until deletion. No started/outcome data is rewritten on closure.
}
function inventoryDevices(app) {
  for (const station of all(app, "checkin_stations")) {
    const agents = all(app, "checkin_agents", "station = {:station}", { station: station.id });
    const identities = agents.map((a) => a.getString("journal_identity"));
    if (!identities.length) identities.push("");
    for (const journal of identities) {
      if (all(app, "checkin_lifecycle_devices", "station_id = {:station}", { station: station.id }).some((d) => d.getString("journal_identity") === journal)) continue;
      const d = new Record(app.findCollectionByNameOrId("checkin_lifecycle_devices"));
      set(d, { station_id: station.id, journal_identity: journal, purge_token: $security.randomString(48), completed_at: "", method: "", last_seen_at: "" }); app.save(d);
    }
  }
}
function status(app, now) {
  const s = state(app);
  return { edition: "WTS2026", closedAt: s.getString("closed_at") || null, purgeDeadline: s.getString("purge_deadline") || null,
    centralDeletedAt: s.getString("central_deleted_at") || null, centralCompactedAt: s.getString("central_compacted_at") || null,
    totals: s.getString("central_deleted_at") ? { workflows: s.getInt("workflow_total"), prints: s.getInt("print_total") } : null,
    restoreRequired: s.getBool("restore_required"), restoreGeneration: s.getInt("restore_generation"), reconciledAt: s.getString("reconciled_at") || null, approvedAt: s.getString("approved_at") || null,
    devices: all(app, "checkin_lifecycle_devices").map((d) => {
      const seen = all(app, "checkin_agents", "station = {:station} && journal_identity = {:journal}", { station: d.getString("station_id"), journal: d.getString("journal_identity") }).map((a) => Date.parse(a.getString("last_heartbeat_at")));
      const t = Math.max(Date.parse(d.getString("last_seen_at")) || 0, ...seen.filter(Number.isFinite));
      return { id: d.id, stationId: d.getString("station_id"), journalIdentity: d.getString("journal_identity"), completedAt: d.getString("completed_at") || null, method: d.getString("method") || null, unreachable: !t || now < t || now - t >= 15000 };
    }) };
}
function close(app, actor, command, now) {
  if (!command || command.confirmEdition !== "WTS2026" || !/^[a-f0-9-]{36}$/.test(command.operationId || "") || Object.keys(command).length !== 2) fail("Confirm WTS2026 closure.");
  const s = state(app);
  if (!s.getString("closed_at")) {
    set(s, { closed_at: new Date(now).toISOString(), purge_deadline: new Date(now + 2592000000).toISOString() }); app.save(s);
    disable(app); inventoryDevices(app); audit(app, "close", actor, command.operationId, now, s.getInt("restore_generation"));
  }
  return status(app, now);
}
// Actual baseline inventory, intentionally no imagined collections. Raw SQL is
// restricted to this closed-edition transaction to bypass append-only guards.
// WTS2026 is the sole supported edition. No Hi.Events adapter is imported/called.
const PURGE_TABLES = ["checkin_agent_authorizations", "checkin_agent_attempts", "checkin_print_attempts", "checkin_arrival_attempts", "checkin_arrival_commands", "checkin_arrival_workflows", "checkin_audit_events"];
// Optional additive slices, explicit allowlist; never derive DELETE targets from input.
const OPTIONAL_PURGE_TABLES = ["checkin_lookup_commands", "checkin_recovery_resets", "checkin_recovery_isolations", "checkin_recovery_cancellations", "checkin_recovery_observations", "checkin_recovery_reads", "checkin_recovery_audit", "checkin_recovery_commands", "checkin_recovery_workflows", "checkin_monitoring_audit", "checkin_monitoring_commands", "checkin_monitoring_deliveries", "checkin_monitoring_incidents"];
function purge(app, now) {
  const s = state(app); const deadline = Date.parse(s.getString("purge_deadline"));
  if (!Number.isFinite(deadline) || now < deadline) return status(app, now);
  if (!s.getString("central_deleted_at")) {
    inventoryDevices(app);
    set(s, { workflow_total: app.countRecords("checkin_arrival_workflows"), print_total: app.countRecords("checkin_print_attempts") });
    for (const table of OPTIONAL_PURGE_TABLES) {
      let present = false; try { app.findCollectionByNameOrId(table); present = true; } catch { /* slice not installed */ }
      if (present) app.db().newQuery("DELETE FROM " + table).execute();
    }
    for (const table of PURGE_TABLES) app.db().newQuery("DELETE FROM " + table).execute();
    app.db().newQuery("UPDATE checkin_lifecycle_audit SET actor_user_id='', operation_id=''").execute();
    // These generic audit envelopes include target IDs, snapshots and free text.
    app.db().newQuery("DELETE FROM admin_actions WHERE operation_kind LIKE 'checkin.%' OR target_collection LIKE 'checkin_%'").execute();
    // Digest watermarks can link a restored label payload; retire them, but retain
    // machine credential hashes for purge-only authentication of offline devices.
    app.db().newQuery("UPDATE checkin_agents SET journal_digest='', journal_sequence=0, quarantined=true, compatibility='retired'").execute();
    s.set("central_deleted_at", new Date(now).toISOString()); app.save(s);
    audit(app, "central_delete", "", "", now, s.getInt("restore_generation"));
  }
  return status(app, now);
}
function boot(app, now) {
  app.runInTransaction((tx) => {
    const s = state(tx);
    if (s.getBool("boot_seen")) {
      set(s, { restore_required: true, restore_generation: s.getInt("restore_generation") + 1, reconciled_at: "", reconciliation_digest: "", approved_at: "" }); tx.save(s);
      disable(tx); audit(tx, "disabled_boot", "", "", now, s.getInt("restore_generation"));
    } else { s.set("boot_seen", true); tx.save(s); }
    purge(tx, now);
  });
}
function assertNewWork(app) {
  const s = state(app);
  if (s.getString("closed_at") || s.getBool("restore_required")) throw new ForbiddenError("Edition closed or restore reconciliation required.");
}
function assertOutcome(app, now) {
  const s = state(app);
  if (s.getString("central_deleted_at") || (s.getString("purge_deadline") && now >= Date.parse(s.getString("purge_deadline")))) throw new ForbiddenError("Edition retention ended.");
}
function approve(app, actor, command, now) {
  const s = state(app);
  if (!command || command.confirmEdition !== "WTS2026" || !Number.isSafeInteger(command.generation) || command.generation !== s.getInt("restore_generation") || !s.getString("reconciled_at") || s.getString("closed_at")) fail("Reconcile this disabled generation before approval. Closed editions cannot reopen.");
  if (!s.getBool("restore_required") && s.getString("approved_at")) return status(app, now);
  if (!s.getBool("restore_required")) fail("Restore approval is not pending.");
  set(s, { restore_required: false, approved_at: new Date(now).toISOString() }); app.save(s);
  audit(app, "approve_restore", actor, "", now, command.generation);
  // Approval does NOT enable system/stations or dispatch historical work.
  return status(app, now);
}
module.exports = { state, set, all, audit, status, close, purge, boot, assertNewWork, assertOutcome, approve, PURGE_TABLES, OPTIONAL_PURGE_TABLES };
