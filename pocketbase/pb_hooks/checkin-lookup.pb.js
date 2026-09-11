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
  let result;
  e.app.runInTransaction(app => {
    const actor = typeof b.actorUserId === "string" && find(app, "users", "id = {:id}", { id: b.actorUserId });
    if (!actor || !actor.getBool("verified") || !["admin", "checkin_operator"].includes(actor.getString("role"))) fail("forbidden", 403);
    const binding = hash(b.identityHash) && find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: b.identityHash });
    if (!binding) fail("invalid_binding", 403);
    if (binding.getBool("revoked")) fail("revoked_binding", 403);
    const station = app.findRecordById("checkin_stations", binding.getString("station"));
    if (!["bind", "get", "recover"].includes(b.operation) || !uuid(b.operationId) || !hash(b.sourceKey)) fail("invalid_input", 400);
    let row = find(app, "checkin_lookup_commands", "operation_id = {:id}", { id: b.operationId });
    const c = b.operation === "bind" ? b.command : row && { operationId: row.getString("operation_id"), context: json(row, "context"), attendeeId: row.getString("attendee_id"), qrHash: row.getString("qr_hash"), affiliationChoice: row.getString("affiliation_choice"), priorOperationId: row.getString("prior_operation_id") };
    if (!c) fail("forbidden", 403);
    if (Object.keys(c).length !== 6 || c.operationId !== b.operationId || !c.context || !/^[1-9][0-9]{0,15}$/.test(c.attendeeId) || !hash(c.qrHash) || !["fetch", "blank"].includes(c.affiliationChoice) || !(c.priorOperationId === "" || uuid(c.priorOperationId))) fail("invalid_input", 400);
    const context = c.context;
    if (context.bindingId !== binding.id || context.bindingVersion !== binding.getInt("version") || context.stationId !== station.id) fail(row && b.operation !== "bind" ? "forbidden" : "conflict", row && b.operation !== "bind" ? 403 : 409);
    const fingerprint = $security.sha256(canonical({ command: c, sourceKey: b.sourceKey }));
    if (row && (row.getString("payload_hash") !== fingerprint || row.getString("station_id") !== station.id)) fail("conflict");
    const event = find(app, "checkin_events", "id = {:id}", { id: context.eventId });
    const system = app.findRecordById("checkin_system", "wts2026system00");
    const current = event && { protocolVersion: 1, edition: "WTS2026", eventId: event.id, eventGeneration: event.getInt("generation"), bindingId: binding.id, bindingVersion: binding.getInt("version"), selectionVersion: binding.getInt("selection_version"), stationId: station.id, stationGeneration: station.getInt("generation"), systemGeneration: system.getInt("generation") };
    const life = require(__hooks + "/checkin-lifecycle.js").state(app);
    const unchanged = event && canonical(context) === canonical(current) && binding.getString("selected_event") === event.id && binding.getInt("selected_event_generation") === event.getInt("generation") && binding.getInt("selected_binding_version") === binding.getInt("version") && event.getString("source_key") === b.sourceKey && event.getString("edition") === "WTS2026" && event.getBool("member") && event.getBool("enabled") && !!event.getString("list_id") && station.getBool("enabled") && system.getBool("enabled") && !life.getString("closed_at") && !life.getBool("restore_required");
    function base(id) { return find(app, "checkin_arrival_commands", "operation_id = {:id}", { id }); }
    function save(command, snapshot) {
      if (base(command.operationId)) fail("conflict"); // Never adopt an unbound legacy UUID.
      const r = new Record(app.findCollectionByNameOrId("checkin_lookup_commands"));
      const fields = { operation_id: command.operationId, payload_hash: $security.sha256(canonical({ command, sourceKey: b.sourceKey })), attendee_id: command.attendeeId, qr_hash: command.qrHash, source_key: b.sourceKey, affiliation_choice: command.affiliationChoice, prior_operation_id: command.priorOperationId, station_id: station.id, context: command.context, snapshot };
      for (const key in fields) r.set(key, fields[key]); app.save(r); return r;
    }
    if (!row) {
      if (!unchanged) fail("conflict");
      if (c.priorOperationId) {
        const prior = find(app, "checkin_lookup_commands", "operation_id = {:id}", { id: c.priorOperationId });
        const previous = base(c.priorOperationId);
        if (!prior || prior.getString("attendee_id") !== c.attendeeId || prior.getString("qr_hash") !== c.qrHash || prior.getString("source_key") !== b.sourceKey || canonical(json(prior, "context")) !== canonical(context) || !previous || previous.getString("status") !== "final" || previous.getString("workflow_id") || !["dependency_unavailable", "needs_affiliation_choice"].includes((json(previous, "result") || {}).state) || (c.affiliationChoice === "blank" && json(previous, "result").state !== "needs_affiliation_choice") || find(app, "checkin_lookup_commands", "prior_operation_id = {:id}", { id: c.priorOperationId })) fail("conflict");
      } else if (c.affiliationChoice === "blank") fail("invalid_input", 400);
      row = save(c, { context, sourceKey: b.sourceKey, upstreamEventId: event.getString("upstream_event_id"), upstreamListId: event.getString("list_id"), affiliation: json(event, "affiliation"), actor: { userId: actor.id, role: actor.getString("role") } });
    }
    const arrival = base(c.operationId);
    const final = arrival && arrival.getString("status") === "final";
    const state = final ? (json(arrival, "result") || {}).state : "pending";
    const hasWork = arrival && (arrival.getString("workflow_id") || arrival.getString("admission_attempt_id")) || find(app, "checkin_arrival_commands", "source_key = {:source} && event_id = {:event} && qr_hash = {:qr} && workflow_id != ''", { source: b.sourceKey, event: context.eventId, qr: c.qrHash });
    const child = find(app, "checkin_lookup_commands", "prior_operation_id = {:id}", { id: c.operationId }) || find(app, "checkin_arrival_commands", "prior_operation_id = {:id}", { id: c.operationId });
    let actions = unchanged ? ["replay"] : [];
    if (unchanged && final && !hasWork && !child) {
      if (state === "dependency_unavailable") actions.push("retry");
      if (state === "needs_affiliation_choice") actions.push("retry", "blank");
    }
    if (unchanged && !final && hasWork) actions = [];
    result = { command: c, snapshot: json(row, "snapshot"), final: !!final, recovery: { operationId: c.operationId, context, attendeeId: c.attendeeId, state, recovery: !unchanged ? "context_changed" : actions.length ? "available" : "read_only", actions } };
    if (b.operation !== "recover") return;
    if (!unchanged || !["replay", "retry", "blank"].includes(b.action)) fail("conflict");
    if (b.action === "replay") { if (b.nextOperationId || !actions.includes("replay")) fail("conflict"); return; }
    if (!uuid(b.nextOperationId) || b.nextOperationId === c.operationId) fail("invalid_input", 400);
    const nextCommand = { ...c, operationId: b.nextOperationId, priorOperationId: c.operationId, affiliationChoice: b.action === "blank" ? "blank" : "fetch" };
    let next = find(app, "checkin_lookup_commands", "operation_id = {:id}", { id: b.nextOperationId });
    if (next) { if (next.getString("payload_hash") !== $security.sha256(canonical({ command: nextCommand, sourceKey: b.sourceKey }))) fail("conflict"); }
    else { if (!actions.includes(b.action)) fail("conflict"); next = save(nextCommand, json(row, "snapshot")); }
    result.command = nextCommand; result.snapshot = json(next, "snapshot"); result.final = !!base(nextCommand.operationId) && base(nextCommand.operationId).getString("status") === "final";
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());
onRecordCreateRequest(() => { throw new ForbiddenError("Use lookup commands."); }, "checkin_lookup_commands");
onRecordUpdate(() => { throw new ForbiddenError("Lookup command identity is immutable."); }, "checkin_lookup_commands");
onRecordDelete(() => { throw new ForbiddenError("Use lifecycle purge."); }, "checkin_lookup_commands");
