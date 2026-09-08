/// <reference path="../pb_data/types.d.ts" />
// Only the web server's privileged PB client can enter. Human authorization is
// independently refreshed inside the transaction; no browser/Pi/MCP surface.
routerAdd("POST", "/api/wts/checkin", (e) => {
  const body = e.requestInfo().body;
  function fail(code, status = 400) { throw new ApiError(status, "Check-in request rejected.", { code: new ValidationError(code, "Check-in request rejected.") }); }
  function find(app, collection, filter, params) {
    const records = app.findRecordsByFilter(collection, filter, "", 1, 0, params || {});
    return records.length ? records[0] : null;
  }
  function systemDTO(record) { return { edition: "WTS2026", enabled: record.getBool("enabled"), version: record.getInt("version"), generation: record.getInt("generation") }; }
  const now = new Date();
  const cutoff = new Date(now.getTime() - 300000).toISOString();
  function bindingDTO(record) {
    return { id: record.id, stationId: record.getString("station"), version: record.getInt("version"), revoked: record.getBool("revoked"), lastSeenAt: record.getString("last_seen_at"), active: !record.getBool("revoked") && Date.parse(record.getString("last_seen_at")) >= Date.parse(cutoff) };
  }
  function stationDTO(app, record, system) {
    const activeBindingCount = app.countRecords("checkin_bindings", $dbx.exp("station = {:id} AND revoked = false AND last_seen_at >= {:cutoff}", { id: record.id, cutoff: cutoff.replace("T", " ") }));
    const reasons = ["coordinator_unavailable", "hievents_unconfigured", "printer_unavailable", "event_configuration_missing", "notifications_unconfigured", "admission_and_printing_not_implemented"];
    if (!system.getBool("enabled")) reasons.unshift("system_disabled");
    if (!record.getBool("enabled")) reasons.unshift("station_disabled");
    return { id: record.id, edition: "WTS2026", label: record.getString("label"), location: record.getString("location"), printerRef: record.getString("printer_ref"), enabled: record.getBool("enabled"), version: record.getInt("version"), generation: record.getInt("generation"), provisionCodeIssued: Boolean(record.getString("provision_code_hash")), activeBindingCount, multiplePhonesWarning: activeBindingCount > 2, ready: false, unreadyReasons: reasons };
  }
  function page(value) {
    if (value === undefined) return 1;
    if (!Number.isInteger(value) || value < 1 || value > 10000) fail("invalid_input");
    return value;
  }
  function paged(app, collection, index, project) {
    const records = app.findRecordsByFilter(collection, "", "-created,-id", 51, (index - 1) * 50);
    return { items: records.slice(0, 50).map(project), page: index, hasMore: records.length > 50 };
  }
  function auditDTO(record) {
    return { id: record.id, actorUserId: record.getString("actor_user_id"), actorName: record.getString("actor_name"), actorRole: record.getString("actor_role"), operation: record.getString("operation"), stationId: record.getString("station_id"), bindingId: record.getString("binding_id"), reason: record.getString("reason"), note: record.getString("note"), outcome: record.getString("outcome"), createdAt: record.getString("created") };
  }
  function statusDTO(app, system, binding, state) {
    const bound = binding && !binding.getBool("revoked");
    const station = bound ? app.findRecordById("checkin_stations", binding.getString("station")) : null;
    return { system: systemDTO(system), bindingState: state, binding: bound ? bindingDTO(binding) : null, station: station ? stationDTO(app, station, system) : null, operationsEnabled: false, activeWindowSeconds: 300 };
  }
  let result;
  e.app.runInTransaction((app) => {
    const actorId = String(body.actorUserId || "");
    if (!/^[a-z0-9]{15}$/.test(actorId)) fail("forbidden", 403);
    const actor = find(app, "users", "id = {:id}", { id: actorId });
    if (!actor || !actor.getBool("verified") || !["admin", "checkin_operator"].includes(actor.getString("role"))) fail("forbidden", 403);
    const operation = body.operation;
    if (typeof operation !== "string") fail("invalid_input");
    if (operation.startsWith("admin_") && actor.getString("role") !== "admin") fail("forbidden", 403);
    const system = app.findRecordById("checkin_system", "wts2026system00");
    if (operation === "admin_list") {
      const stations = app.findRecordsByFilter("checkin_stations", "edition = 'WTS2026'", "id", 3, 0);
      result = { system: systemDTO(system), stations: stations.map((record) => stationDTO(app, record, system)), bindings: paged(app, "checkin_bindings", page(body.bindingPage), bindingDTO), audit: paged(app, "checkin_audit_events", page(body.auditPage), auditDTO), activeWindowSeconds: 300 };
      return;
    }
    if (operation === "status") {
      if (!body.identityHash) { result = statusDTO(app, system, null, "unbound"); return; }
      if (!/^[a-f0-9]{64}$/.test(body.identityHash)) fail("invalid_binding");
      const binding = find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: body.identityHash });
      if (!binding || binding.getBool("revoked")) { result = statusDTO(app, system, null, binding ? "revoked" : "invalid"); return; }
      binding.set("last_seen_at", now.toISOString()); app.save(binding);
      result = statusDTO(app, system, binding, "bound");
      return;
    }
    function sensitive(value) {
      return /@|:\/\/|www\.|[a-f0-9]{64}|wts_mcp_|bearer\s|password|secret|token\s*[:=]|\/dev\//i.test(value);
    }
    function text(value, max, required) {
      if (typeof value !== "string" || value.length > max || /[\x00-\x1f\x7f]/.test(value) || sensitive(value)) fail("invalid_input");
      value = value.trim();
      if (required && !value) fail("invalid_input");
      return value;
    }
    function snapshot(record, kind) {
      if (kind === "checkin_system") return systemDTO(record);
      if (kind === "checkin_bindings") return { id: record.id, stationId: record.getString("station"), version: record.getInt("version"), revoked: record.getBool("revoked") };
      return { id: record.id, label: record.getString("label"), location: record.getString("location"), printerRef: record.getString("printer_ref"), enabled: record.getBool("enabled"), version: record.getInt("version"), generation: record.getInt("generation"), provisionCodeIssued: Boolean(record.getString("provision_code_hash")) };
    }
    function audit(op, stationId, bindingId, before, after, command, actionId) {
      const event = new Record(app.findCollectionByNameOrId("checkin_audit_events"));
      const name = actor.getString("name").trim();
      const values = { actor_user_id: actor.id, actor_name: !name || sensitive(name) || /[\x00-\x1f\x7f]/.test(name) ? "Authorized User" : name.slice(0, 80), actor_role: actor.getString("role"), operation: op, station_id: stationId || "", binding_id: bindingId || "", admin_action_id: actionId || "", reason: command ? command.reason : "", note: command ? command.note || "" : "", outcome: "applied", state: { before, after } };
      for (const key in values) event.set(key, values[key]);
      app.save(event);
    }
    if (operation === "preview" || operation === "bind") {
      if (typeof body.codeHash !== "string" || !/^[a-f0-9]{64}$/.test(body.codeHash)) fail("invalid_code");
      const station = find(app, "checkin_stations", "provision_code_hash = {:hash}", { hash: body.codeHash });
      if (!station) fail("invalid_code");
      const canBind = system.getBool("enabled") && station.getBool("enabled");
      if (operation === "preview") {
        if (body.identityHash && !/^[a-f0-9]{64}$/.test(body.identityHash)) fail("invalid_binding");
        const current = body.identityHash ? find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: body.identityHash }) : null;
        result = { system: systemDTO(system), station: stationDTO(app, station, system), confirmation: { stationId: station.id, stationVersion: station.getInt("version"), systemGeneration: system.getInt("generation"), bindingVersion: current ? current.getInt("version") : 0 }, canBind };
        return;
      }
      if (!canBind) fail("disabled", 409);
      const confirmation = body.confirmation;
      if (!confirmation || confirmation.stationId !== station.id || confirmation.stationVersion !== station.getInt("version") || confirmation.systemGeneration !== system.getInt("generation")) fail("conflict", 409);
      if (typeof body.identityHash !== "string" || !/^[a-f0-9]{64}$/.test(body.identityHash)) fail("invalid_binding");
      let binding = find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: body.identityHash });
      if (binding && binding.getBool("revoked")) fail("revoked_binding", 403);
      const bindingVersion = binding ? binding.getInt("version") : 0;
      const replay = binding && binding.getString("station") === station.id && bindingVersion === confirmation.bindingVersion + 1;
      if (!Number.isInteger(confirmation.bindingVersion) || confirmation.bindingVersion < 0 || (confirmation.bindingVersion !== bindingVersion && !replay)) fail("conflict", 409);
      const before = binding ? snapshot(binding, "checkin_bindings") : null;
      const changed = !binding || binding.getString("station") !== station.id;
      if (!binding) {
        binding = new Record(app.findCollectionByNameOrId("checkin_bindings"));
        binding.set("identity_hash", body.identityHash);
        binding.set("version", 1);
        binding.set("revoked", false);
      } else if (changed) binding.set("version", binding.getInt("version") + 1);
      binding.set("station", station.id);
      binding.set("last_seen_at", now.toISOString());
      app.save(binding);
      if (changed) audit("bind", station.id, binding.id, before, snapshot(binding, "checkin_bindings"), null, "");
      result = statusDTO(app, system, binding, "bound");
      return;
    }
    if (operation === "admin_control") {
      const command = body.command;
      const operations = ["set_system_enabled", "set_station_enabled", "configure_station", "rotate_provision_code", "revoke_binding"];
      if (!command || !operations.includes(command.operation) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(command.operationId || "") || !Number.isInteger(command.expectedVersion) || command.expectedVersion < 1 || !["security", "device_replacement", "maintenance", "incident", "configuration", "operations_restored"].includes(command.reason)) fail("invalid_input");
      const op = command.operation;
      const allowed = ["operation", "operationId", "expectedVersion", "reason", "note"].concat(op === "set_system_enabled" ? ["enabled"] : op === "revoke_binding" ? ["bindingId"] : ["stationId"].concat(op === "set_station_enabled" ? ["enabled"] : op === "configure_station" ? ["label", "location", "printerRef"] : []));
      if (Object.keys(command).some((key) => !allowed.includes(key))) fail("invalid_input");
      command.note = text(command.note === undefined ? "" : command.note, 240, false);
      if (op === "set_system_enabled" || op === "set_station_enabled") { if (typeof command.enabled !== "boolean") fail("invalid_input"); }
      if (op === "configure_station") {
        command.label = text(command.label, 80, true); command.location = text(command.location, 120, false); command.printerRef = text(command.printerRef, 80, false);
      }
      const kind = op === "set_system_enabled" ? "checkin_system" : op === "revoke_binding" ? "checkin_bindings" : "checkin_stations";
      const id = kind === "checkin_system" ? system.id : kind === "checkin_bindings" ? command.bindingId : command.stationId;
      if (kind === "checkin_stations" && !["wts2026station1", "wts2026station2", "wts2026station3"].includes(id)) fail("invalid_input");
      if (kind === "checkin_bindings" && (typeof id !== "string" || !/^[a-z0-9]{15}$/.test(id))) fail("invalid_input");
      const normalized = {};
      Object.keys(command).sort().forEach((key) => { normalized[key] = command[key]; });
      const fingerprint = $security.sha256(JSON.stringify(normalized));
      const key = $security.sha256("wts2026:checkin:admin_ui:" + actor.id + ":" + command.operationId);
      const prior = find(app, "admin_actions", "idempotency_key = {:key}", { key });
      if (prior) {
        if (prior.getString("input_fingerprint") !== fingerprint || prior.getString("status") !== "applied") fail("conflict", 409);
        // Return the original outcome, not a new mutation or a plaintext QR.
        result = JSON.parse(prior.getString("replay_result"));
        result.replayed = true;
        return;
      }
      const target = kind === "checkin_system" ? system : find(app, kind, "id = {:id}", { id });
      if (!target) fail("invalid_input");
      if (target.getInt("version") !== command.expectedVersion) fail("conflict", 409);
      const before = snapshot(target, kind);
      if (op === "set_system_enabled" || op === "set_station_enabled") target.set("enabled", command.enabled);
      if (op === "configure_station") { target.set("label", command.label); target.set("location", command.location); target.set("printer_ref", command.printerRef); }
      if (op === "rotate_provision_code") {
        if (typeof body.provisionCodeHash !== "string" || !/^[a-f0-9]{64}$/.test(body.provisionCodeHash)) fail("invalid_input");
        target.set("provision_code_hash", body.provisionCodeHash);
      }
      if (op === "revoke_binding") target.set("revoked", true);
      target.set("version", target.getInt("version") + 1);
      if (kind !== "checkin_bindings") target.set("generation", target.getInt("generation") + 1);
      app.save(target);
      const after = snapshot(target, kind);
      const action = new Record(app.findCollectionByNameOrId("admin_actions"));
      const values = { actor_user: actor.id, mcp_token: "", source: "admin_ui", operation_kind: "checkin." + op, target_collection: kind, target_id: target.id, operation_id: command.operationId, input_fingerprint: fingerprint, idempotency_key: key, status: "pending", before_summary: before, after_summary: after, attempt_count: 1, attempt_token: $security.randomString(32), lease_expires_at: "", completed_at: now.toISOString() };
      for (const field in values) action.set(field, values[field]);
      app.save(action);
      result = { actionId: action.id, replayed: false };
      if (kind === "checkin_system") result.system = systemDTO(target);
      else if (kind === "checkin_stations") result.station = stationDTO(app, target, system);
      else result.binding = bindingDTO(target);
      action.set("status", "applied"); action.set("replay_result", result); app.save(action);
      audit(op, kind === "checkin_stations" ? target.id : kind === "checkin_bindings" ? target.getString("station") : "", kind === "checkin_bindings" ? target.id : "", before, after, command, action.id);
      return;
    }
    fail("invalid_input");
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

// App-level immutable audit, including privileged direct record writes. New
// migrations/lifecycle deletion must explicitly introduce its own purge boundary.
onRecordUpdate((e) => { throw new ForbiddenError("Check-in audit is immutable."); }, "checkin_audit_events");
onRecordDelete((e) => { throw new ForbiddenError("Check-in audit is immutable."); }, "checkin_audit_events");
