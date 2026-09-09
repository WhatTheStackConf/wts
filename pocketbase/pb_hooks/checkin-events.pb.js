/// <reference path="../pb_data/types.d.ts" />
// No upstream I/O in the transaction. Only the authenticated WTS server can
// supply discovered references; the live human role is checked again here.
routerAdd("POST", "/api/wts/checkin-events", (e) => {
  const body = e.requestInfo().body;
  function fail(code, status = 400) { throw new ApiError(status, "Event request rejected.", { code: new ValidationError(code, "Event request rejected.") }); }
  function find(app, collection, filter, params) { const records = app.findRecordsByFilter(collection, filter, "", 1, 0, params || {}); return records.length ? records[0] : null; }
  function upstreamId(value) { return typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value)); }
  function sensitive(value) { return /@|:\/\/|www\.|[a-f0-9]{64}|wts_mcp_|bearer\s|password|secret|token\s*[:=]|\/dev\//i.test(value); }
  function text(value, max, required) {
    if (typeof value !== "string" || value.length > max || /[\x00-\x1f\x7f]/.test(value) || sensitive(value)) fail("invalid_input");
    value = value.trim(); if (required && !value) fail("invalid_input"); return value;
  }
  function affiliation(record) { return JSON.parse(record.getString("affiliation") || "null"); }
  // requestInfo().body contains Go maps; nested object iteration order is not
  // stable across requests, even after assigning a JS object back into a map.
  function canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  function configDTO(record) { return { id: record.id, upstreamEventId: record.getString("upstream_event_id"), title: record.getString("title"), member: record.getBool("member"), enabled: record.getBool("enabled"), listId: record.getString("list_id"), affiliation: affiliation(record), generation: record.getInt("generation") }; }
  let result;
  e.app.runInTransaction((app) => {
    const actorId = body.actorUserId;
    if (typeof actorId !== "string" || !/^[a-z0-9]{15}$/.test(actorId)) fail("forbidden", 403);
    const actor = find(app, "users", "id = {:id}", { id: actorId });
    if (!actor || !actor.getBool("verified") || !["admin", "checkin_operator"].includes(actor.getString("role"))) fail("forbidden", 403);
    const operation = body.operation;
    if (typeof operation !== "string") fail("invalid_input");
    if (operation.startsWith("admin_") && actor.getString("role") !== "admin") fail("forbidden", 403);
    const sourceKey = body.sourceKey;
    if (typeof sourceKey !== "string" || !/^[a-f0-9]{64}$/.test(sourceKey)) fail("unavailable", 503);
    const configs = app.findRecordsByFilter("checkin_events", "edition = 'WTS2026'", "created,id", 1001, 0);
    if (configs.length > 1000) fail("unavailable", 503);
    const mismatch = configs.some((record) => record.getString("source_key") !== sourceKey);
    if (operation === "admin_catalogue") {
      result = { configurations: configs.filter((record) => record.getString("source_key") === sourceKey).map(configDTO), sourceMismatch: mismatch }; return;
    }
    if (mismatch) fail("unavailable", 503);
    const now = new Date().toISOString();
    function audit(op, eventId, binding, before, after, command, actionId) {
      const audit = new Record(app.findCollectionByNameOrId("checkin_audit_events"));
      const name = actor.getString("name").trim();
      const values = { actor_user_id: actor.id, actor_name: !name || sensitive(name) || /[\x00-\x1f\x7f]/.test(name) ? "Authorized User" : name.slice(0, 80), actor_role: actor.getString("role"), operation: op, event_id: eventId, station_id: binding ? binding.getString("station") : "", binding_id: binding ? binding.id : "", admin_action_id: actionId || "", reason: command ? command.reason : "", note: command ? command.note : "", outcome: "applied", state: { before, after } };
      for (const key in values) audit.set(key, values[key]); app.save(audit);
    }
    if (operation === "admin_replay" || operation === "admin_configure") {
      const command = body.command;
      const allowed = ["operationId", "expectedGeneration", "upstreamEventId", "member", "enabled", "listId", "affiliation", "reason", "note"];
      if (!command || Object.keys(command).some((key) => !allowed.includes(key)) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(command.operationId || "") || !Number.isInteger(command.expectedGeneration) || command.expectedGeneration < 0 || !upstreamId(command.upstreamEventId) || typeof command.member !== "boolean" || typeof command.enabled !== "boolean" || (command.listId !== "" && !upstreamId(command.listId)) || !["security", "device_replacement", "maintenance", "incident", "configuration", "operations_restored"].includes(command.reason)) fail("invalid_input");
      if (command.enabled && (!command.member || !command.listId)) fail("invalid_input");
      command.note = text(command.note === undefined ? "" : command.note, 240, false);
      const mapping = command.affiliation;
      if (mapping !== null) {
        if (!mapping || Object.keys(mapping).some((key) => !["questionId", "productIds"].includes(key)) || !upstreamId(mapping.questionId) || !Array.isArray(mapping.productIds) || mapping.productIds.length > 50 || mapping.productIds.some((id) => !upstreamId(id)) || new Set(mapping.productIds).size !== mapping.productIds.length) fail("invalid_input");
        command.affiliation = { questionId: mapping.questionId, productIds: mapping.productIds.slice().sort() };
      }
      const normalized = { operation: "configure_event", sourceKey };
      Object.keys(command).sort().forEach((key) => { normalized[key] = command[key]; });
      const fingerprint = $security.sha256(canonical(normalized));
      const key = $security.sha256("wts2026:checkin:admin_ui:" + actor.id + ":" + command.operationId);
      const prior = find(app, "admin_actions", "idempotency_key = {:key}", { key });
      if (prior) {
        if (prior.getString("input_fingerprint") !== fingerprint || prior.getString("status") !== "applied") fail("conflict", 409);
        result = JSON.parse(prior.getString("replay_result")); result.replayed = true; return;
      }
      if (operation === "admin_replay") { result = null; return; }
      let target = find(app, "checkin_events", "source_key = {:key} && upstream_event_id = {:id}", { key: sourceKey, id: command.upstreamEventId });
      if ((target ? target.getInt("generation") : 0) !== command.expectedGeneration) fail("conflict", 409);
      const before = target ? configDTO(target) : null;
      if (!target) {
        target = new Record(app.findCollectionByNameOrId("checkin_events"));
        target.set("id", $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"));
        target.set("edition", "WTS2026"); target.set("source_key", sourceKey); target.set("upstream_event_id", command.upstreamEventId);
      }
      target.set("title", text(body.title, 200, true)); target.set("member", command.member); target.set("enabled", command.enabled);
      target.set("list_id", command.listId); target.set("affiliation", command.affiliation); target.set("generation", command.expectedGeneration + 1);
      const after = configDTO(target);
      const action = new Record(app.findCollectionByNameOrId("admin_actions"));
      const values = { actor_user: actor.id, mcp_token: "", source: "admin_ui", operation_kind: "checkin.configure_event", target_collection: "checkin_events", target_id: target.id, operation_id: command.operationId, input_fingerprint: fingerprint, idempotency_key: key, status: "pending", before_summary: before, after_summary: after, attempt_count: 1, attempt_token: $security.randomString(32), lease_expires_at: "", completed_at: now };
      for (const field in values) action.set(field, values[field]); app.save(action);
      app.save(target);
      result = { actionId: action.id, replayed: false, configuration: after };
      action.set("status", "applied"); action.set("replay_result", result); app.save(action);
      audit("configure_event", target.id, null, before, after, command, action.id); return;
    }
    if (["catalogue", "select", "context", "inspect"].includes(operation)) {
      if (typeof body.identityHash !== "string" || !/^[a-f0-9]{64}$/.test(body.identityHash)) fail("invalid_binding", 403);
      const binding = find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: body.identityHash });
      if (!binding) fail("invalid_binding", 403);
      if (binding.getBool("revoked")) fail("revoked_binding", 403);
      if (operation === "inspect") { result = configs.map(configDTO); return; }
      const station = app.findRecordById("checkin_stations", binding.getString("station"));
      const system = app.findRecordById("checkin_system", "wts2026system00");
      const enabled = station.getBool("enabled") && system.getBool("enabled");
      function eventDTO(record) {
        let availability = "available";
        if (!record.getString("list_id")) availability = "unconfigured";
        else if (!record.getBool("member") || !record.getBool("enabled") || !enabled) availability = "disabled";
        else if (!Array.isArray(body.verifiedMappings) || !body.verifiedMappings.some((mapping) => mapping.eventId === record.id && mapping.generation === record.getInt("generation") && mapping.listId === record.getString("list_id"))) availability = "upstream_unavailable";
        return { id: record.id, title: record.getString("title"), generation: record.getInt("generation"), availability };
      }
      function selectedRecord() { return configs.find((record) => record.id === binding.getString("selected_event")) || null; }
      function context(record) {
        return { protocolVersion: 1, edition: "WTS2026", eventId: record.id, eventGeneration: record.getInt("generation"), bindingId: binding.id, bindingVersion: binding.getInt("version"), selectionVersion: binding.getInt("selection_version"), stationId: station.id, stationGeneration: station.getInt("generation"), systemGeneration: system.getInt("generation") };
      }
      function stale(record) { return record.getInt("generation") !== binding.getInt("selected_event_generation") || binding.getInt("version") !== binding.getInt("selected_binding_version"); }
      function catalogue() {
        const record = selectedRecord();
        const selected = record ? eventDTO(record) : null;
        if (selected && stale(record)) selected.availability = "stale";
        return { state: ["complete", "partial", "unavailable"].includes(body.upstreamState) ? body.upstreamState : "unavailable", events: configs.filter((record) => record.getBool("member")).map(eventDTO), selected, context: selected && selected.availability === "available" ? context(record) : null, fence: { bindingVersion: binding.getInt("version"), selectionVersion: binding.getInt("selection_version"), stationGeneration: station.getInt("generation"), systemGeneration: system.getInt("generation") }, operationsEnabled: false };
      }
      if (operation === "catalogue") { result = catalogue(); return; }
      if (!enabled) fail("disabled", 409);
      if (operation === "context") {
        const record = selectedRecord();
        if (!record || stale(record) || canonical(body.context) !== canonical(context(record))) fail("conflict", 409);
        if (!record.getBool("member") || !record.getBool("enabled") || !record.getString("list_id")) fail("disabled", 409);
        result = { context: context(record), sourceKey, upstreamEventId: record.getString("upstream_event_id"), upstreamListId: record.getString("list_id"), affiliation: affiliation(record), actor: { userId: actor.id, role: actor.getString("role") } }; return;
      }
      const selection = body.selection;
      const fields = ["eventId", "eventGeneration", "bindingVersion", "selectionVersion", "stationGeneration", "systemGeneration"];
      if (!selection || Object.keys(selection).some((key) => !fields.includes(key)) || typeof selection.eventId !== "string" || !/^[a-z0-9]{15}$/.test(selection.eventId) || fields.slice(1).some((key) => !Number.isInteger(selection[key]) || selection[key] < (key === "selectionVersion" ? 0 : 1))) fail("invalid_input");
      if (selection.bindingVersion !== binding.getInt("version") || selection.systemGeneration !== system.getInt("generation") || selection.stationGeneration !== station.getInt("generation")) fail("conflict", 409);
      const target = configs.find((record) => record.id === selection.eventId);
      if (!target || !target.getBool("member")) fail("invalid_input");
      if (selection.eventGeneration !== target.getInt("generation")) fail("conflict", 409);
      if (eventDTO(target).availability !== "available") fail("disabled", 409);
      // Transport replay converges only immediately after this exact selection.
      const replay = binding.getString("selected_event") === target.id && !stale(target) && binding.getInt("selection_version") === selection.selectionVersion + 1;
      if (!replay && binding.getInt("selection_version") !== selection.selectionVersion) fail("conflict", 409);
      if (!replay) {
        const before = { eventId: binding.getString("selected_event"), generation: binding.getInt("selected_event_generation"), selectionVersion: binding.getInt("selection_version") };
        binding.set("selected_event", target.id); binding.set("selected_event_generation", target.getInt("generation"));
        binding.set("selected_binding_version", binding.getInt("version")); binding.set("selection_version", selection.selectionVersion + 1);
        app.save(binding);
        audit("select_event", target.id, binding, before, { eventId: target.id, generation: target.getInt("generation"), selectionVersion: binding.getInt("selection_version") }, null, "");
      }
      result = catalogue(); return;
    }
    fail("invalid_input");
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

onRecordUpdate((e) => {
  for (const field of ["edition", "source_key", "upstream_event_id"]) if (e.record.getString(field) !== e.record.original().getString(field)) throw new ForbiddenError("Event source identity is immutable.");
  e.next();
}, "checkin_events");
onRecordDelete((e) => { throw new ForbiddenError("Event configuration history cannot be deleted."); }, "checkin_events");
