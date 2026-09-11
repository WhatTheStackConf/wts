/// <reference path="../pb_data/types.d.ts" />
// Read-only reacquisition: QR hashes enter only from the authenticated web service.
// No command creation, admission reset, printing or context rebasing here.
routerAdd("POST", "/api/wts/checkin-arrival-resume", (e) => {
  const b = e.requestInfo().body;
  function fail(code, status = 409) { throw new ApiError(status, "Arrival recovery unavailable.", { code: new ValidationError(code, "Arrival recovery unavailable.") }); }
  function find(app, name, filter, params) { const rows = app.findRecordsByFilter(name, filter, "", 1, 0, params); return rows.length ? rows[0] : null; }
  function json(r, key) { return JSON.parse(r.getString(key) || "null"); }
  function uuid(v) { return typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v); }
  function hash(v) { return typeof v === "string" && /^[a-f0-9]{64}$/.test(v); }
  function canonical(v) { if (v === null || typeof v !== "object") return JSON.stringify(v); return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}"; }
  let result;
  e.app.runInTransaction(app => {
    const actor = typeof b.actorUserId === "string" && find(app, "users", "id = {:id}", { id: b.actorUserId });
    if (!actor || !actor.getBool("verified") || !["admin", "checkin_operator"].includes(actor.getString("role"))) fail("forbidden", 403);
    const binding = hash(b.identityHash) && find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: b.identityHash });
    if (!binding) fail("invalid_binding", 403);
    if (binding.getBool("revoked")) fail("revoked_binding", 403);
    const station = app.findRecordById("checkin_stations", binding.getString("station"));
    if (!["get", "resume"].includes(b.operation) || !uuid(b.operationId) || !hash(b.sourceKey)) fail("invalid_input", 400);
    const command = find(app, "checkin_arrival_commands", "operation_id = {:id}", { id: b.operationId });
    // Missing and foreign references are indistinguishable; login handoff is allowed.
    if (!command) fail("forbidden", 403);
    const context = json(command, "context");
    if (!context || context.bindingId !== binding.id || context.stationId !== station.id || command.getString("station_id") !== station.id) fail("forbidden", 403);
    const event = find(app, "checkin_events", "id = {:id}", { id: context.eventId });
    const system = app.findRecordById("checkin_system", "wts2026system00");
    const current = event && { protocolVersion: 1, edition: "WTS2026", eventId: event.id, eventGeneration: event.getInt("generation"), bindingId: binding.id, bindingVersion: binding.getInt("version"), selectionVersion: binding.getInt("selection_version"), stationId: station.id, stationGeneration: station.getInt("generation"), systemGeneration: system.getInt("generation") };
    const unchanged = event && canonical(context) === canonical(current) && binding.getString("selected_event") === event.id && binding.getInt("selected_event_generation") === event.getInt("generation") && binding.getInt("selected_binding_version") === binding.getInt("version") && command.getString("source_key") === b.sourceKey && event.getString("source_key") === b.sourceKey && event.getString("edition") === "WTS2026" && event.getBool("member") && event.getBool("enabled") && !!event.getString("list_id") && station.getBool("enabled") && system.getBool("enabled");
    const status = command.getString("status");
    const state = status === "pending" ? "pending" : (json(command, "result") || {}).state;
    const hasWork = !!command.getString("workflow_id") || !!command.getString("admission_attempt_id") || !!find(app, "checkin_arrival_commands", "source_key = {:source} && event_id = {:event} && qr_hash = {:qr} && workflow_id != ''", { source: command.getString("source_key"), event: context.eventId, qr: command.getString("qr_hash") });
    const child = find(app, "checkin_arrival_commands", "prior_operation_id = {:id}", { id: b.operationId });
    let actions = [];
    if (unchanged && !hasWork && !child) {
      if (status === "pending") actions = ["replay"];
      else if (status === "final" && state === "needs_affiliation_choice") actions = ["retry", "blank"];
      else if (status === "final" && state === "dependency_unavailable") actions = ["retry"];
    }
    result = { operationId: b.operationId, context, status, state, affiliationChoice: command.getString("affiliation_choice"), recovery: !unchanged ? "context_changed" : actions.length ? "available" : "read_only", actions, operationsEnabled: false };
    if (command.getString("prior_operation_id")) result.priorOperationId = command.getString("prior_operation_id");
    if (b.operation === "get") return;
    if (!hash(b.qrHash) || b.qrHash !== command.getString("qr_hash")) fail("conflict");
    if (!unchanged || !["replay", "retry", "blank"].includes(b.action)) fail("conflict");
    if (b.action === "replay") {
      // Exact final replay is harmless, including a lost reservation response.
      if (b.nextOperationId || (status !== "final" && !actions.includes("replay"))) fail("conflict");
      return;
    }
    if (!uuid(b.nextOperationId) || b.nextOperationId === b.operationId) fail("invalid_input", 400);
    const next = find(app, "checkin_arrival_commands", "operation_id = {:id}", { id: b.nextOperationId });
    if (next) {
      // Lost continuation response: exact same UUID/input only, never a fresh intake.
      if (next.getString("prior_operation_id") !== b.operationId || next.getString("qr_hash") !== b.qrHash || next.getString("source_key") !== b.sourceKey || canonical(json(next, "context")) !== canonical(context) || next.getString("affiliation_choice") !== (b.action === "blank" ? "blank" : "fetch")) fail("conflict");
      return;
    }
    if (!actions.includes(b.action)) fail("conflict");
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());
