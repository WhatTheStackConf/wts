/// <reference path="../pb_data/types.d.ts" />
// Selected identity binding is separate from the legacy QR fingerprint.
routerAdd("POST", "/api/wts/checkin-lookup-commands", e => {
  const b = e.requestInfo().body;
  function fail(code, status = 409) { throw new ApiError(status, "Lookup command unavailable.", { code: new ValidationError(code, "Lookup command unavailable.") }); }
  function find(app, name, filter, params) { const rows = app.findRecordsByFilter(name, filter, "", 1, 0, params); return rows.length ? rows[0] : null; }
  function json(r, k) { return JSON.parse(r.getString(k) || "null"); }
  function canonical(v) { if (v === null || typeof v !== "object") return JSON.stringify(v); if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]"; return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}"; }
  function uuid(v) { return typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v); }
  function hash(v) { return typeof v === "string" && /^[a-f0-9]{64}$/.test(v); }
  function assertOperator(app) {
    const actor = typeof b.actorUserId === "string" && find(app, "users", "id = {:id}", { id: b.actorUserId });
    if (!actor || !actor.getBool("verified") || !["admin", "checkin_operator"].includes(actor.getString("role"))) fail("forbidden", 403);
    return actor;
  }
  function activeBinding(app) {
    const binding = hash(b.identityHash) && find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: b.identityHash });
    if (!binding) fail("invalid_binding", 403);
    if (binding.getBool("revoked")) fail("revoked_binding", 403);
    return binding;
  }
  function storedCommand(row) { return { operationId: row.getString("operation_id"), context: json(row, "context"), attendeeId: row.getString("attendee_id"), qrHash: row.getString("qr_hash"), affiliationChoice: row.getString("affiliation_choice"), priorOperationId: row.getString("prior_operation_id") }; }
  function validCommand(c) { return Object.keys(c).length === 6 && c.operationId === b.operationId && !!c.context && /^[1-9][0-9]{0,15}$/.test(c.attendeeId) && hash(c.qrHash) && ["fetch", "blank"].includes(c.affiliationChoice) && (c.priorOperationId === "" || uuid(c.priorOperationId)); }
  function fingerprintOf(command) { return $security.sha256(canonical({ command, sourceKey: b.sourceKey })); }
  function assertContext(context, binding, station, row) {
    if (context.bindingId === binding.id && context.bindingVersion === binding.getInt("version") && context.stationId === station.id) return;
    const stored = row && b.operation !== "bind";
    fail(stored ? "forbidden" : "conflict", stored ? 403 : 409);
  }
  function assertStoredRow(row, c, station) {
    const fingerprint = fingerprintOf(c);
    if (row && (row.getString("payload_hash") !== fingerprint || row.getString("station_id") !== station.id)) fail("conflict");
  }
  function requestedCommand(app, binding, station) {
    if (!["bind", "get", "recover"].includes(b.operation) || !uuid(b.operationId) || !hash(b.sourceKey)) fail("invalid_input", 400);
    const row = find(app, "checkin_lookup_commands", "operation_id = {:id}", { id: b.operationId });
    const c = b.operation === "bind" ? b.command : row && storedCommand(row);
    if (!c) fail("forbidden", 403);
    if (!validCommand(c)) fail("invalid_input", 400);
    assertContext(c.context, binding, station, row);
    assertStoredRow(row, c, station);
    return { row, c };
  }
  function currentContext(event, binding, station, system) {
    return { protocolVersion: 1, edition: "WTS2026", eventId: event.id, eventGeneration: event.getInt("generation"), bindingId: binding.id, bindingVersion: binding.getInt("version"), selectionVersion: binding.getInt("selection_version"), stationId: station.id, stationGeneration: station.getInt("generation"), systemGeneration: system.getInt("generation") };
  }
  function selectionCurrent(binding, event) { return binding.getString("selected_event") === event.id && binding.getInt("selected_event_generation") === event.getInt("generation") && binding.getInt("selected_binding_version") === binding.getInt("version"); }
  function operational(event, station, system) { return event.getString("source_key") === b.sourceKey && event.getString("edition") === "WTS2026" && event.getBool("member") && event.getBool("enabled") && !!event.getString("list_id") && station.getBool("enabled") && system.getBool("enabled"); }
  function unchangedContext(context, event, binding, station, system, life) {
    return canonical(context) === canonical(currentContext(event, binding, station, system)) && selectionCurrent(binding, event) && operational(event, station, system) && !life.getString("closed_at") && !life.getBool("restore_required");
  }
  function base(app, id) { return find(app, "checkin_arrival_commands", "operation_id = {:id}", { id }); }
  function save(app, station, command, snapshot) {
    if (base(app, command.operationId)) fail("conflict"); // Never adopt an unbound legacy UUID.
    const r = new Record(app.findCollectionByNameOrId("checkin_lookup_commands"));
    const fields = { operation_id: command.operationId, payload_hash: fingerprintOf(command), attendee_id: command.attendeeId, qr_hash: command.qrHash, source_key: b.sourceKey, affiliation_choice: command.affiliationChoice, prior_operation_id: command.priorOperationId, station_id: station.id, context: command.context, snapshot };
    for (const key in fields) r.set(key, fields[key]); app.save(r); return r;
  }
  function samePriorLookup(prior, c, context) { return !!prior && prior.getString("attendee_id") === c.attendeeId && prior.getString("qr_hash") === c.qrHash && prior.getString("source_key") === b.sourceKey && canonical(json(prior, "context")) === canonical(context); }
  function retryableArrival(previous, c) {
    if (!previous || previous.getString("status") !== "final" || previous.getString("workflow_id")) return false;
    const state = (json(previous, "result") || {}).state;
    return ["dependency_unavailable", "needs_affiliation_choice"].includes(state) && !(c.affiliationChoice === "blank" && state !== "needs_affiliation_choice");
  }
  function assertRetryable(app, c, context) {
    const prior = find(app, "checkin_lookup_commands", "operation_id = {:id}", { id: c.priorOperationId });
    const previous = base(app, c.priorOperationId);
    if (!samePriorLookup(prior, c, context) || !retryableArrival(previous, c) || find(app, "checkin_lookup_commands", "prior_operation_id = {:id}", { id: c.priorOperationId })) fail("conflict");
  }
  function intake(app, actor, station, c, event, unchanged) {
    if (!unchanged) fail("conflict");
    if (c.priorOperationId) assertRetryable(app, c, c.context);
    else if (c.affiliationChoice === "blank") fail("invalid_input", 400);
    return save(app, station, c, { context: c.context, sourceKey: b.sourceKey, upstreamEventId: event.getString("upstream_event_id"), upstreamListId: event.getString("list_id"), affiliation: json(event, "affiliation"), actor: { userId: actor.id, role: actor.getString("role") } });
  }
  function arrivalWork(app, arrival, c) {
    return arrival && (arrival.getString("workflow_id") || arrival.getString("admission_attempt_id")) || find(app, "checkin_arrival_commands", "source_key = {:source} && event_id = {:event} && qr_hash = {:qr} && workflow_id != ''", { source: b.sourceKey, event: c.context.eventId, qr: c.qrHash });
  }
  function childOf(app, id) { return find(app, "checkin_lookup_commands", "prior_operation_id = {:id}", { id }) || find(app, "checkin_arrival_commands", "prior_operation_id = {:id}", { id }); }
  function lookupActions(unchanged, final, hasWork, child, state) {
    if (!unchanged || (!final && hasWork)) return [];
    if (!final || hasWork || child) return ["replay"];
    if (state === "dependency_unavailable") return ["replay", "retry"];
    if (state === "needs_affiliation_choice") return ["replay", "retry", "blank"];
    return ["replay"];
  }
  function recoveryLabel(unchanged, actions) { return !unchanged ? "context_changed" : actions.length ? "available" : "read_only"; }
  function continuation(app, station, c, row, actions) {
    if (!uuid(b.nextOperationId) || b.nextOperationId === c.operationId) fail("invalid_input", 400);
    const nextCommand = { ...c, operationId: b.nextOperationId, priorOperationId: c.operationId, affiliationChoice: b.action === "blank" ? "blank" : "fetch" };
    let next = find(app, "checkin_lookup_commands", "operation_id = {:id}", { id: b.nextOperationId });
    if (next) { if (next.getString("payload_hash") !== fingerprintOf(nextCommand)) fail("conflict"); }
    else { if (!actions.includes(b.action)) fail("conflict"); next = save(app, station, nextCommand, json(row, "snapshot")); }
    result.command = nextCommand; result.snapshot = json(next, "snapshot"); result.final = !!base(app, nextCommand.operationId) && base(app, nextCommand.operationId).getString("status") === "final";
  }
  function recover(app, station, c, row, unchanged, actions) {
    if (!unchanged || !["replay", "retry", "blank"].includes(b.action)) fail("conflict");
    if (b.action !== "replay") continuation(app, station, c, row, actions);
    else if (b.nextOperationId || !actions.includes("replay")) fail("conflict");
  }
  let result;
  e.app.runInTransaction(app => {
    const actor = assertOperator(app);
    const binding = activeBinding(app);
    const station = app.findRecordById("checkin_stations", binding.getString("station"));
    const requested = requestedCommand(app, binding, station);
    const c = requested.c;
    const event = find(app, "checkin_events", "id = {:id}", { id: c.context.eventId });
    const system = app.findRecordById("checkin_system", "wts2026system00");
    const life = require(__hooks + "/checkin-lifecycle.js").state(app);
    const unchanged = event && unchangedContext(c.context, event, binding, station, system, life);
    const row = requested.row || intake(app, actor, station, c, event, unchanged);
    const arrival = base(app, c.operationId);
    const final = arrival && arrival.getString("status") === "final";
    const state = final ? (json(arrival, "result") || {}).state : "pending";
    const hasWork = arrivalWork(app, arrival, c);
    const child = childOf(app, c.operationId);
    const actions = lookupActions(unchanged, final, hasWork, child, state);
    result = { command: c, snapshot: json(row, "snapshot"), final: !!final, recovery: { operationId: c.operationId, context: c.context, attendeeId: c.attendeeId, state, recovery: recoveryLabel(unchanged, actions), actions } };
    if (b.operation === "recover") recover(app, station, c, row, unchanged, actions);
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());
onRecordCreateRequest(() => { throw new ForbiddenError("Use lookup commands."); }, "checkin_lookup_commands");
onRecordUpdate(() => { throw new ForbiddenError("Lookup command identity is immutable."); }, "checkin_lookup_commands");
onRecordDelete(() => { throw new ForbiddenError("Use lifecycle purge."); }, "checkin_lookup_commands");
