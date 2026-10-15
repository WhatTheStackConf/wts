/// <reference path="../pb_data/types.d.ts" />
// Only the authenticated WTS server may call this command seam. No device I/O.
routerAdd("POST", "/api/wts/checkin-labels", (e) => {
  const body = e.requestInfo().body;
  function fail(code, status = 400) { throw new ApiError(status, "Name Label profile request rejected.", { code: new ValidationError(code, "Name Label profile request rejected.") }); }
  function find(app, collection, filter, params, sort = "") { const records = app.findRecordsByFilter(collection, filter, sort, 1, 0, params || {}); return records.length ? records[0] : null; }
  function id(value) { return typeof value === "string" && /^[a-z0-9]{15}$/.test(value); }
  function integer(value, min, max = 2147483647) { return Number.isSafeInteger(value) && value >= min && value <= max; }
  function shape(value, keys) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)); }
  function sensitive(value) { return /@|:\/\/|www\.|[a-f0-9]{64}|wts_mcp_|bearer\s|password|secret|token\s*[:=]|\/dev\//i.test(value); }
  function text(value, max, required) {
    if (typeof value !== "string" || value.length > max || /[\x00-\x1f\x7f<>]/.test(value) || sensitive(value)) fail("invalid_input");
    const cleaned = value.trim(); if (required && !cleaned) fail("invalid_input"); return cleaned;
  }
  function canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    return "{" + Object.keys(value).sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  // Deliberately duplicated at the trusted storage boundary: a caller cannot
  // bypass pins/media/geometry validation by using the superuser command route.
  // Keep the pins aligned with checkin-label-render-contract.ts on upgrades.
  function assertIdentity(config) {
    if (!shape(config, ["rendererVersion", "fontVersion", "printerRef", "stockRef", "synthetic", "media", "raster", "printable", "margins", "offset", "direction", "feed", "density", "threshold"])) fail("invalid_input");
    if (config.rendererVersion !== "wts-name-label-v1" || config.fontVersion !== "noto-sans-2.008-latin-cyrillic-v1" || typeof config.synthetic !== "boolean") fail("invalid_input");
  }
  function assertReference(value) {
    if (text(value, 80, true) !== value || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) || /[a-f0-9]{64}|wts_mcp_|bearer|password|secret/i.test(value)) fail("invalid_input");
  }
  function assertReferences(config) {
    for (const field of ["printerRef", "stockRef"]) assertReference(config[field]);
    if (!config.synthetic && (config.printerRef === "synthetic-preview" || config.stockRef === "synthetic-50x30-gap")) fail("invalid_input");
  }
  function assertMediaAndRaster(config) {
    if (!shape(config.media, ["widthMm", "heightMm", "kind"]) || config.media.widthMm !== 50 || config.media.heightMm !== 30 || config.media.kind !== "precut-gap") fail("invalid_input");
    if (!shape(config.raster, ["width", "height"]) || !integer(config.raster.width, 1, 2048) || !integer(config.raster.height, 1, 2048)) fail("invalid_input");
  }
  function validPrintable(printable, raster) {
    return shape(printable, ["x", "y", "width", "height"]) && integer(printable.x, 0, 2048) && integer(printable.y, 0, 2048) && integer(printable.width, 1, 2048) && integer(printable.height, 1, 2048) && printable.x + printable.width <= raster.width && printable.y + printable.height <= raster.height;
  }
  function assertMargins(config) {
    if (!shape(config.margins, ["top", "right", "bottom", "left"]) || Object.keys(config.margins).some((key) => !integer(config.margins[key], 0, 2048))) fail("invalid_input");
    if (config.printable.width - config.margins.left - config.margins.right < 48 || config.printable.height - config.margins.top - config.margins.bottom < 112) fail("invalid_input");
  }
  function insidePrintable(printable, margins, offset) {
    return printable.x + margins.left + offset.x >= printable.x && printable.y + margins.top + offset.y >= printable.y && printable.x + printable.width - margins.right + offset.x <= printable.x + printable.width && printable.y + printable.height - margins.bottom + offset.y <= printable.y + printable.height;
  }
  function assertOffset(config) {
    if (!shape(config.offset, ["x", "y"]) || !integer(config.offset.x, -2048, 2048) || !integer(config.offset.y, -2048, 2048)) fail("invalid_input");
    if (!insidePrintable(config.printable, config.margins, config.offset)) fail("invalid_input");
  }
  function validFeed(config) {
    return [0, 90, 180, 270].includes(config.direction) && shape(config.feed, ["mode", "gapDots", "advanceDots"]) && config.feed.mode === "gap" && integer(config.feed.gapDots, 1, 2048) && integer(config.feed.advanceDots, 0, 2048) && integer(config.density, 1, 5) && integer(config.threshold, 1, 254);
  }
  function validate(config) {
    assertIdentity(config);
    assertReferences(config);
    assertMediaAndRaster(config);
    if (!validPrintable(config.printable, config.raster)) fail("invalid_input");
    assertMargins(config);
    assertOffset(config);
    if (!validFeed(config)) fail("invalid_input");
  }
  function stationFor(app, stationId) {
    const station = find(app, "checkin_stations", "id = {:id} && edition = 'WTS2026'", { id: stationId });
    if (!station) fail("invalid_input"); return station;
  }
  function latest(app, stationId) { return find(app, "checkin_label_profiles", "station = {:station}", { station: stationId }, "-version"); }
  function effectiveVersion(station) { return station.getInt("profile_config_version") || station.getInt("version"); }
  function dto(app, record) {
    const config = JSON.parse(record.getString("config"));
    const approved = find(app, "checkin_label_approvals", "profile = {:id}", { id: record.id });
    const station = stationFor(app, record.getString("station"));
    // Effective approval fails closed after ANY station version change, even
    // replacing a printer and subsequently restoring its old display reference.
    const current = approved && latest(app, station.id).id === record.id && approved.getInt("station_version") === effectiveVersion(station) && record.getInt("station_version") === effectiveVersion(station) && config.printerRef === station.getString("printer_ref");
    return { id: record.id, stationId: record.getString("station"), version: record.getInt("version"), approval: current ? "approved" : "unapproved", config };
  }
  function commandFence(app, profile) {
    const station = stationFor(app, profile.getString("station"));
    return profile.getInt("station_version") === effectiveVersion(station) ? station.getInt("version") : profile.getInt("station_version");
  }
  function listProfiles(app) {
    const stations = app.findRecordsByFilter("checkin_stations", "edition = 'WTS2026'", "id", 4, 0);
    if (stations.length > 3) fail("unavailable", 503);
    const profiles = stations.map((station) => latest(app, station.id)).filter(Boolean);
    const profileStationVersions = {};
    // Present the current command fence when only agent credentials changed.
    for (const profile of profiles) profileStationVersions[profile.id] = commandFence(app, profile);
    return { profiles: profiles.map((profile) => dto(app, profile)), profileStationVersions, stations: stations.map((station) => ({ id: station.id, label: station.getString("label"), printerRef: station.getString("printer_ref"), version: station.getInt("version") })), operationsEnabled: false };
  }
  function getProfile(app) {
    if (!id(body.profileId)) fail("invalid_input");
    const record = find(app, "checkin_label_profiles", "id = {:id}", { id: body.profileId });
    if (!record) fail("invalid_input"); return dto(app, record);
  }
  function validCommand(command, approving) {
    const fields = ["operationId", "expectedVersion", "expectedStationVersion", "reason", "note"].concat(approving ? ["profileId", "physicalConfirmation"] : ["stationId", "config"]);
    return shape(command, fields) && typeof command.operationId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(command.operationId) && integer(command.expectedVersion, approving ? 1 : 0) && integer(command.expectedStationVersion, 1) && id(approving ? command.profileId : command.stationId) && ["security", "device_replacement", "maintenance", "incident", "configuration", "operations_restored"].includes(command.reason);
  }
  function replay(prior, fingerprint) {
    if (prior.getString("input_fingerprint") !== fingerprint || prior.getString("status") !== "applied") fail("conflict", 409);
    const replayed = JSON.parse(prior.getString("replay_result")); replayed.replayed = true; return replayed;
  }
  function existingProfile(app, command, approving) {
    if (!approving) return null;
    const existing = find(app, "checkin_label_profiles", "id = {:id}", { id: command.profileId });
    if (!existing) fail("invalid_input");
    return existing;
  }
  function assertStationFence(station, existing, command) {
    if (station.getInt("version") !== command.expectedStationVersion) fail("conflict", 409);
    if (existing && existing.getInt("station_version") !== effectiveVersion(station)) fail("conflict", 409);
  }
  function assertApprovable(app, existing, previous, config) {
    if (previous.id !== existing.id) fail("conflict", 409);
    if (config.synthetic) fail("invalid_input");
    if (find(app, "checkin_label_approvals", "profile = {:id}", { id: existing.id })) fail("conflict", 409);
  }
  function newProfile(app, station, command, config) {
    const target = new Record(app.findCollectionByNameOrId("checkin_label_profiles"));
    target.set("id", $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"));
    target.set("station", station.id); target.set("station_version", station.getInt("version")); target.set("version", command.expectedVersion + 1); target.set("config", config);
    return target;
  }
  function attach(app, approving, target, station, action) {
    if (approving) {
      const approval = new Record(app.findCollectionByNameOrId("checkin_label_approvals"));
      approval.set("profile", target.id); approval.set("station_version", effectiveVersion(station)); approval.set("physical_confirmation", true); approval.set("admin_action_id", action.id); app.save(approval);
    } else { station.set("profile_config_version", 0); app.save(station); target.set("admin_action_id", action.id); app.save(target); }
  }
  function actorName(actor) {
    const name = actor.getString("name").trim();
    return !name || sensitive(name) || /[\x00-\x1f\x7f<>]/.test(name) ? "Authorized User" : name.slice(0, 80);
  }
  function validatedCommand(approving) {
    const command = body.command;
    if (!validCommand(command, approving)) fail("invalid_input");
    if (approving) { if (command.physicalConfirmation !== true) fail("invalid_input"); }
    else validate(command.config);
    return command;
  }
  function resolveProfile(app, command, approving) {
    const existing = existingProfile(app, command, approving);
    const station = stationFor(app, approving ? existing.getString("station") : command.stationId);
    assertStationFence(station, existing, command);
    const config = approving ? JSON.parse(existing.getString("config")) : command.config;
    validate(config);
    if (!station.getString("printer_ref") || station.getString("printer_ref") !== config.printerRef) fail("invalid_input");
    const previous = latest(app, station.id);
    if ((previous ? previous.getInt("version") : 0) !== command.expectedVersion) fail("conflict", 409);
    if (approving) assertApprovable(app, existing, previous, config);
    return { existing, station, config, previous };
  }
  function auditCommand(app, actor, operation, station, target, action, command, note, state) {
    const audit = new Record(app.findCollectionByNameOrId("checkin_audit_events"));
    const auditValues = { actor_user_id: actor.id, actor_name: actorName(actor), actor_role: "admin", operation, station_id: station.id, binding_id: "", event_id: "", label_profile_id: target.id, admin_action_id: action.id, reason: command.reason, note, outcome: "applied", state };
    for (const field in auditValues) audit.set(field, auditValues[field]); app.save(audit);
  }
  function applyCommand(app, actor) {
    if (!["configure", "approve"].includes(body.operation)) fail("invalid_input");
    const approving = body.operation === "approve";
    const operation = approving ? "approve_label_profile" : "configure_label_profile";
    const command = validatedCommand(approving);
    // Fingerprint exact supplied values BEFORE note sanitation: a changed payload
    // under an existing actor/UUID is not a transport replay.
    const fingerprint = $security.sha256(canonical({ operation, command }));
    const note = text(command.note, 240, approving);
    const key = $security.sha256("wts2026:checkin:admin_ui:" + actor.id + ":" + command.operationId);
    const prior = find(app, "admin_actions", "idempotency_key = {:key}", { key });
    if (prior) return replay(prior, fingerprint);
    const plan = resolveProfile(app, command, approving);
    const target = approving ? plan.existing : newProfile(app, plan.station, command, plan.config);
    const before = plan.previous ? dto(app, plan.previous) : null;
    const after = { id: target.id, stationId: plan.station.id, version: target.getInt("version"), approval: approving ? "approved" : "unapproved", config: plan.config };
    const action = new Record(app.findCollectionByNameOrId("admin_actions"));
    const values = { actor_user: actor.id, mcp_token: "", source: "admin_ui", operation_kind: "checkin." + operation, target_collection: "checkin_label_profiles", target_id: target.id, operation_id: command.operationId, input_fingerprint: fingerprint, idempotency_key: key, status: "pending", before_summary: before, after_summary: after, attempt_count: 1, attempt_token: $security.randomString(32), lease_expires_at: "", completed_at: new Date().toISOString() };
    for (const field in values) action.set(field, values[field]); app.save(action);
    attach(app, approving, target, plan.station, action);
    const applied = { actionId: action.id, replayed: false, profile: after };
    action.set("status", "applied"); action.set("replay_result", applied); app.save(action);
    auditCommand(app, actor, operation, plan.station, target, action, command, note, { before, after });
    return applied;
  }
  let result;
  e.app.runInTransaction((app) => {
    if (!id(body.actorUserId)) fail("forbidden", 403);
    const actor = find(app, "users", "id = {:id}", { id: body.actorUserId });
    if (!actor || !actor.getBool("verified") || actor.getString("role") !== "admin") fail("forbidden", 403);
    if (body.operation === "list") result = listProfiles(app);
    else if (body.operation === "get") result = getProfile(app);
    else result = applyCommand(app, actor);
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

onRecordCreateRequest(() => { throw new ForbiddenError("Use audited Name Label profile commands."); }, "checkin_label_profiles", "checkin_label_approvals");
onRecordUpdate(() => { throw new ForbiddenError("Name Label profile and approval history is immutable."); }, "checkin_label_profiles", "checkin_label_approvals");
onRecordDelete(() => { throw new ForbiddenError("Name Label profile and approval history cannot be deleted."); }, "checkin_label_profiles", "checkin_label_approvals");
