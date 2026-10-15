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
    const reasons = ["agent_readiness_separate", "hievents_unconfigured", "notifications_unconfigured", "admission_and_printing_not_implemented"];
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
    return { id: record.id, actorUserId: record.getString("actor_user_id"), actorName: record.getString("actor_name"), actorRole: record.getString("actor_role"), operation: record.getString("operation"), stationId: record.getString("station_id"), bindingId: record.getString("binding_id"), eventId: record.getString("event_id"), reason: record.getString("reason"), note: record.getString("note"), outcome: record.getString("outcome"), createdAt: record.getString("created") };
  }
  function statusDTO(app, system, binding, state) {
    const bound = binding && !binding.getBool("revoked");
    const station = bound ? app.findRecordById("checkin_stations", binding.getString("station")) : null;
    return { system: systemDTO(system), bindingState: state, binding: bound ? bindingDTO(binding) : null, station: station ? stationDTO(app, station, system) : null, operationsEnabled: false, activeWindowSeconds: 300 };
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
  function actorName(actor) {
    const name = actor.getString("name").trim();
    return !name || sensitive(name) || /[\x00-\x1f\x7f]/.test(name) ? "Authorized User" : name.slice(0, 80);
  }
  function authorize(app) {
    const actorId = String(body.actorUserId || "");
    if (!/^[a-z0-9]{15}$/.test(actorId)) fail("forbidden", 403);
    const actor = find(app, "users", "id = {:id}", { id: actorId });
    if (!actor || !actor.getBool("verified") || !["admin", "checkin_operator"].includes(actor.getString("role"))) fail("forbidden", 403);
    const operation = body.operation;
    if (typeof operation !== "string") fail("invalid_input");
    if (operation.startsWith("admin_") && actor.getString("role") !== "admin") fail("forbidden", 403);
    return actor;
  }
  function optionalBinding(app) {
    if (body.identityHash && !/^[a-f0-9]{64}$/.test(body.identityHash)) fail("invalid_binding");
    return body.identityHash ? find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: body.identityHash }) : null;
  }
  function confirmationFor(station, system, current) { return { stationId: station.id, stationVersion: station.getInt("version"), systemGeneration: system.getInt("generation"), bindingVersion: current ? current.getInt("version") : 0 }; }
  function selectedStation(app) {
    const selection = body.confirmation;
    if (!selection || !["wts2026station1", "wts2026station2", "wts2026station3"].includes(selection.stationId)) fail("invalid_input");
    const station = find(app, "checkin_stations", "id = {:id} && edition = 'WTS2026'", { id: selection.stationId });
    if (!station) fail("invalid_input");
    return station;
  }
  function provisionedStation(app) {
    if (typeof body.codeHash !== "string" || !/^[a-f0-9]{64}$/.test(body.codeHash)) fail("invalid_code");
    const station = find(app, "checkin_stations", "provision_code_hash = {:hash}", { hash: body.codeHash });
    if (!station) fail("invalid_code");
    return station;
  }
  function assertConfirmation(confirmation, station, system) {
    if (!confirmation || confirmation.stationId !== station.id || confirmation.stationVersion !== station.getInt("version") || confirmation.systemGeneration !== system.getInt("generation")) fail("conflict", 409);
  }
  function pairingBinding(app) {
    if (typeof body.identityHash !== "string" || !/^[a-f0-9]{64}$/.test(body.identityHash)) fail("invalid_binding");
    const binding = find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: body.identityHash });
    if (binding && binding.getBool("revoked")) fail("revoked_binding", 403);
    return binding;
  }
  function assertBindingFence(binding, station, confirmation) {
    const bindingVersion = binding ? binding.getInt("version") : 0;
    const replay = binding && binding.getString("station") === station.id && bindingVersion === confirmation.bindingVersion + 1;
    if (!Number.isInteger(confirmation.bindingVersion) || confirmation.bindingVersion < 0 || (confirmation.bindingVersion !== bindingVersion && !replay)) fail("conflict", 409);
    return bindingVersion;
  }
  // Preserve only a still-current event choice on a printer dropdown change.
  // Frozen submissions keep their original routing; new intake gets fresh
  // binding and selection fences. QR re-pairing retains its legacy behavior.
  function selectedEventToKeep(app, binding, selecting, changed, bindingVersion) {
    return selecting && changed && binding && binding.getInt("selected_binding_version") === bindingVersion
      ? find(app, "checkin_events", "id = {:id} && edition = 'WTS2026'", { id: binding.getString("selected_event") }) : null;
  }
  function eventStillCurrent(event, binding) {
    return event && event.getBool("member") && event.getBool("enabled")
      && event.getString("list_id") && event.getInt("generation") === binding.getInt("selected_event_generation");
  }
  function upsertBinding(app, binding, changed) {
    if (!binding) {
      binding = new Record(app.findCollectionByNameOrId("checkin_bindings"));
      binding.set("identity_hash", body.identityHash);
      binding.set("version", 1);
      binding.set("revoked", false);
    } else if (changed) binding.set("version", binding.getInt("version") + 1);
    return binding;
  }
  const CONTROLS = {
    set_system_enabled: { kind: "checkin_system", fields: ["enabled"], normalize: requireEnabled, apply: (target, command) => target.set("enabled", command.enabled) },
    set_station_enabled: { kind: "checkin_stations", fields: ["stationId", "enabled"], normalize: requireEnabled, apply: (target, command) => target.set("enabled", command.enabled) },
    configure_station: { kind: "checkin_stations", fields: ["stationId", "label", "location", "printerRef"], normalize: stationText, apply: configureStation },
    rotate_provision_code: { kind: "checkin_stations", fields: ["stationId"], normalize: () => {}, apply: rotateProvisionCode },
    revoke_binding: { kind: "checkin_bindings", fields: ["bindingId"], normalize: () => {}, apply: (target) => target.set("revoked", true) },
  };
  function requireEnabled(command) { if (typeof command.enabled !== "boolean") fail("invalid_input"); }
  function stationText(command) { command.label = text(command.label, 80, true); command.location = text(command.location, 120, false); command.printerRef = text(command.printerRef, 80, false); }
  function configureStation(target, command) { target.set("label", command.label); target.set("location", command.location); target.set("printer_ref", command.printerRef); }
  function rotateProvisionCode(target) {
    if (typeof body.provisionCodeHash !== "string" || !/^[a-f0-9]{64}$/.test(body.provisionCodeHash)) fail("invalid_input");
    target.set("provision_code_hash", body.provisionCodeHash);
  }
  function validControl(command) {
    if (!command || !Object.keys(CONTROLS).includes(command.operation) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(command.operationId || "") || !Number.isInteger(command.expectedVersion) || command.expectedVersion < 1 || !["security", "device_replacement", "maintenance", "incident", "configuration", "operations_restored"].includes(command.reason)) fail("invalid_input");
    const control = CONTROLS[command.operation];
    const allowed = ["operation", "operationId", "expectedVersion", "reason", "note"].concat(control.fields);
    if (Object.keys(command).some((key) => !allowed.includes(key))) fail("invalid_input");
    return control;
  }
  function controlTargetId(kind, command, system) {
    const id = kind === "checkin_system" ? system.id : kind === "checkin_bindings" ? command.bindingId : command.stationId;
    if (kind === "checkin_stations" && !["wts2026station1", "wts2026station2", "wts2026station3"].includes(id)) fail("invalid_input");
    if (kind === "checkin_bindings" && (typeof id !== "string" || !/^[a-z0-9]{15}$/.test(id))) fail("invalid_input");
    return id;
  }
  function replayed(prior, fingerprint) {
    if (prior.getString("input_fingerprint") !== fingerprint || prior.getString("status") !== "applied") fail("conflict", 409);
    // Return the original outcome, not a new mutation or a plaintext QR.
    const previous = JSON.parse(prior.getString("replay_result"));
    previous.replayed = true;
    return previous;
  }
  function controlTarget(app, kind, id, system, command) {
    const target = kind === "checkin_system" ? system : find(app, kind, "id = {:id}", { id });
    if (!target) fail("invalid_input");
    if (target.getInt("version") !== command.expectedVersion) fail("conflict", 409);
    return target;
  }
  function advance(target, kind, profileConfigVersion) {
    target.set("version", target.getInt("version") + 1);
    if (kind !== "checkin_bindings") target.set("generation", target.getInt("generation") + 1);
    if (kind === "checkin_stations") target.set("profile_config_version", profileConfigVersion);
  }
  function controlResult(app, kind, target, system, applied) {
    if (kind === "checkin_system") applied.system = systemDTO(target);
    else if (kind === "checkin_stations") applied.station = stationDTO(app, target, system);
    else applied.binding = bindingDTO(target);
    return applied;
  }
  function controlStationId(kind, target) { return kind === "checkin_stations" ? target.id : kind === "checkin_bindings" ? target.getString("station") : ""; }
  let result;
  e.app.runInTransaction((app) => {
    const actor = authorize(app);
    const operation = body.operation;
    const system = app.findRecordById("checkin_system", "wts2026system00");
    function audit(op, stationId, bindingId, before, after, command, actionId) {
      const event = new Record(app.findCollectionByNameOrId("checkin_audit_events"));
      const values = { actor_user_id: actor.id, actor_name: actorName(actor), actor_role: actor.getString("role"), operation: op, station_id: stationId || "", binding_id: bindingId || "", admin_action_id: actionId || "", reason: command ? command.reason : "", note: command ? command.note || "" : "", outcome: "applied", state: { before, after } };
      for (const key in values) event.set(key, values[key]);
      app.save(event);
    }
    function adminList() {
      const stations = app.findRecordsByFilter("checkin_stations", "edition = 'WTS2026'", "id", 3, 0);
      return { system: systemDTO(system), stations: stations.map((record) => stationDTO(app, record, system)), bindings: paged(app, "checkin_bindings", page(body.bindingPage), bindingDTO), audit: paged(app, "checkin_audit_events", page(body.auditPage), auditDTO), activeWindowSeconds: 300 };
    }
    function status() {
      if (!body.identityHash) return statusDTO(app, system, null, "unbound");
      if (!/^[a-f0-9]{64}$/.test(body.identityHash)) fail("invalid_binding");
      const binding = find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: body.identityHash });
      if (!binding || binding.getBool("revoked")) return statusDTO(app, system, null, binding ? "revoked" : "invalid");
      binding.set("last_seen_at", now.toISOString()); app.save(binding);
      return statusDTO(app, system, binding, "bound");
    }
    function printers() {
      const current = optionalBinding(app);
      if (current && current.getBool("revoked")) fail("revoked_binding", 403);
      const stations = app.findRecordsByFilter("checkin_stations", "edition = 'WTS2026'", "id", 3, 0);
      return { printers: stations.map((station) => ({
        system: systemDTO(system), station: stationDTO(app, station, system),
        confirmation: confirmationFor(station, system, current),
        canBind: system.getBool("enabled") && station.getBool("enabled"),
      })) };
    }
    function bind(station, selecting) {
      const confirmation = body.confirmation;
      assertConfirmation(confirmation, station, system);
      let binding = pairingBinding(app);
      const bindingVersion = assertBindingFence(binding, station, confirmation);
      const before = binding ? snapshot(binding, "checkin_bindings") : null;
      const changed = !binding || binding.getString("station") !== station.id;
      const preserveEvent = eventStillCurrent(selectedEventToKeep(app, binding, selecting, changed, bindingVersion), binding);
      binding = upsertBinding(app, binding, changed);
      if (preserveEvent) {
        binding.set("selected_binding_version", binding.getInt("version"));
        binding.set("selection_version", binding.getInt("selection_version") + 1);
      }
      binding.set("station", station.id);
      binding.set("last_seen_at", now.toISOString());
      app.save(binding);
      // A dropdown selection is still an audited browser-routing change.
      if (changed) audit("bind", station.id, binding.id, before, snapshot(binding, "checkin_bindings"), null, "");
      return statusDTO(app, system, binding, "bound");
    }
    function pair() {
      const selecting = operation === "select_printer";
      const station = selecting ? selectedStation(app) : provisionedStation(app);
      const canBind = system.getBool("enabled") && station.getBool("enabled");
      if (operation === "preview") {
        const current = optionalBinding(app);
        return { system: systemDTO(system), station: stationDTO(app, station, system), confirmation: confirmationFor(station, system, current), canBind };
      }
      if (!canBind) fail("disabled", 409);
      return bind(station, selecting);
    }
    function adminControl() {
      const command = body.command;
      const control = validControl(command);
      const op = command.operation;
      command.note = text(command.note === undefined ? "" : command.note, 240, false);
      control.normalize(command);
      const kind = control.kind;
      const id = controlTargetId(kind, command, system);
      const normalized = {};
      Object.keys(command).sort().forEach((key) => { normalized[key] = command[key]; });
      const fingerprint = $security.sha256(JSON.stringify(normalized));
      const key = $security.sha256("wts2026:checkin:admin_ui:" + actor.id + ":" + command.operationId);
      const prior = find(app, "admin_actions", "idempotency_key = {:key}", { key });
      if (prior) return replayed(prior, fingerprint);
      const target = controlTarget(app, kind, id, system, command);
      const before = snapshot(target, kind);
      // Pause/resume fences authorization, not calibration. Capture before the
      // version bump; configuration/provision changes still invalidate approval.
      const profileConfigVersion = op === "set_station_enabled" ? target.getInt("profile_config_version") || target.getInt("version") : 0;
      control.apply(target, command);
      advance(target, kind, profileConfigVersion);
      const after = snapshot(target, kind);
      const action = new Record(app.findCollectionByNameOrId("admin_actions"));
      const values = { actor_user: actor.id, mcp_token: "", source: "admin_ui", operation_kind: "checkin." + op, target_collection: kind, target_id: target.id, operation_id: command.operationId, input_fingerprint: fingerprint, idempotency_key: key, status: "pending", before_summary: before, after_summary: after, attempt_count: 1, attempt_token: $security.randomString(32), lease_expires_at: "", completed_at: now.toISOString() };
      for (const field in values) action.set(field, values[field]);
      app.save(action);
      app.save(target);
      const applied = controlResult(app, kind, target, system, { actionId: action.id, replayed: false });
      action.set("status", "applied"); action.set("replay_result", applied); app.save(action);
      audit(op, controlStationId(kind, target), kind === "checkin_bindings" ? target.id : "", before, after, command, action.id);
      return applied;
    }
    const handlers = { admin_list: adminList, status, printers, preview: pair, bind: pair, select_printer: pair, admin_control: adminControl };
    if (!Object.prototype.hasOwnProperty.call(handlers, operation)) fail("invalid_input");
    result = handlers[operation]();
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

// App-level immutable audit, including privileged direct record writes. New
// migrations/lifecycle deletion must explicitly introduce its own purge boundary.
onRecordUpdate((e) => { throw new ForbiddenError("Check-in audit is immutable."); }, "checkin_audit_events");
onRecordDelete((e) => { throw new ForbiddenError("Check-in audit is immutable."); }, "checkin_audit_events");
