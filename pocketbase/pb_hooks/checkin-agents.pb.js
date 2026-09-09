/// <reference path="../pb_data/types.d.ts" />
// Trusted storage command seam. Machine bearers never enter PocketBase directly.
routerAdd("POST", "/api/wts/checkin-agents", (e) => {
  const b = e.requestInfo().body;
  function fail(code, status = 400) { throw new ApiError(status, "Agent request rejected.", { code: new ValidationError(code, "Agent request rejected.") }); }
  function find(app, name, filter, params, sort = "") { const rows = app.findRecordsByFilter(name, filter, sort, 1, 0, params || {}); return rows.length ? rows[0] : null; }
  function set(record, values) { for (const key in values) record.set(key, values[key]); }
  function hash(v) { return typeof v === "string" && /^[a-f0-9]{64}$/.test(v); }
  function ident(v) { return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v); }
  function canonical(v) { if (v === null || typeof v !== "object") return JSON.stringify(v); return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}"; }
  let result;
  let reservation = null;
  try { e.app.runInTransaction((app) => {
    // Clock injection is confined to the privileged coordinator seam, never HTTP
    // payloads from a machine/browser. Production coordinator uses wall clock.
    const machine = typeof b.operation === "string" && b.operation.startsWith("machine_");
    const now = machine && Number.isSafeInteger(b.nowMs) ? b.nowMs : Date.now();
    const iso = new Date(now).toISOString();
    const system = app.findRecordById("checkin_system", "wts2026system00");
    const runtime = app.findRecordById("checkin_coordinator", "wts2026coord000");
    function connected() { const t = Date.parse(runtime.getString("last_seen_at")); return Number.isFinite(t) && now >= t && now - t < runtime.getInt("heartbeat_timeout_ms"); }
    function latest(station) { return find(app, "checkin_agents", "station = {:station}", { station }, "-revision"); }
    function dto(station, agent) {
      const seen = agent ? agent.getString("last_heartbeat_at") : "";
      const age = now - Date.parse(seen);
      const connection = !seen ? "never_seen" : age >= 0 && age < runtime.getInt("heartbeat_timeout_ms") ? "connected" : "stale";
      const credentialState = !agent ? "not_issued" : agent.getBool("revoked") ? "revoked" : Date.parse(agent.getString("expires_at")) <= now ? "expired" : "active";
      let profile = "unconfigured";
      if (agent && agent.getString("profile_id")) {
        const p = find(app, "checkin_label_profiles", "id = {:id}", { id: agent.getString("profile_id") });
        const current = find(app, "checkin_label_profiles", "station = {:station}", { station: station.id }, "-version");
        const approved = p && find(app, "checkin_label_approvals", "profile = {:id}", { id: p.id });
        const config = p ? JSON.parse(p.getString("config")) : null;
        const pv = station.getInt("profile_config_version") || station.getInt("version");
        profile = !p || !current || current.id !== p.id || p.getString("station") !== station.id || config.printerRef !== station.getString("printer_ref") || config.printerRef !== agent.getString("printer_identity") || p.getInt("station_version") !== pv || (seen && agent.getString("reported_profile") !== p.id) ? "mismatch" : approved && !config.synthetic && approved.getInt("station_version") === pv ? "approved" : "unapproved";
      }
      const compatibility = agent ? agent.getString("compatibility") || "unknown" : "unknown";
      const journal = agent && agent.getBool("quarantined") ? "quarantined" : seen ? "healthy" : "unknown";
      const stopped = !system.getBool("enabled") || !station.getBool("enabled");
      const reasons = [];
      // Physical uncertainty belongs to the fixed station, not its current agent.
      // A replacement credential cannot orphan a previously started operation.
      const unresolvedOutput = new DynamicModel({ present: 0 });
      app.db().newQuery("SELECT EXISTS (SELECT 1 FROM checkin_agent_authorizations a JOIN checkin_agents g ON g.id = a.agent_id WHERE g.station = {:station} AND a.started_at != '' AND a.outcome != 'protocol_complete') AS present").bind({ station: station.id }).one(unresolvedOutput);
      if (unresolvedOutput.present) reasons.push("printer_output_unresolved");
      if (!connected()) reasons.push("coordinator_unavailable");
      if (credentialState !== "active") reasons.push("credential_" + credentialState);
      if (connection !== "connected") reasons.push("agent_" + connection);
      if (compatibility !== "compatible") reasons.push("compatibility_" + compatibility);
      if (profile !== "approved") reasons.push("profile_" + profile);
      if (journal !== "healthy") reasons.push("journal_" + journal);
      if (!system.getBool("enabled")) reasons.push("system_disabled");
      if (!station.getBool("enabled")) reasons.push("station_disabled");
      return { stationId: station.id, stationLabel: station.getString("label"), stationVersion: station.getInt("version"), agentId: agent ? agent.id : null, credentialState, credentialExpiresAt: agent ? agent.getString("expires_at") : null, connection, compatibility, profile, journal, stopped, coordinator: connected() ? "connected" : "unavailable", readyForAuthorization: reasons.length === 0, operationsEnabled: false, reasons, lastHeartbeatAt: seen || null, heartbeatIntervalMs: runtime.getInt("heartbeat_interval_ms"), heartbeatTimeoutMs: runtime.getInt("heartbeat_timeout_ms"), authorizationTtlMs: runtime.getInt("authorization_ttl_ms") };
    }
    if (!machine) {
      const actor = typeof b.actorUserId === "string" && find(app, "users", "id = {:id}", { id: b.actorUserId });
      if (!actor || !actor.getBool("verified") || !["admin", "checkin_operator"].includes(actor.getString("role"))) fail("forbidden", 403);
      if (b.operation === "status") {
        const binding = hash(b.identityHash) && find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: b.identityHash });
        if (!binding || binding.getBool("revoked")) { result = { station: null }; return; }
        const station = app.findRecordById("checkin_stations", binding.getString("station"));
        result = { station: dto(station, latest(station.id)) }; return;
      }
      if (actor.getString("role") !== "admin") fail("forbidden", 403);
      if (b.operation === "admin_list") { result = { stations: app.findRecordsByFilter("checkin_stations", "edition = 'WTS2026'", "id", 3, 0).map((s) => dto(s, latest(s.id))) }; return; }
      if (!["admin_issue", "admin_revoke"].includes(b.operation)) fail("invalid_input");
      const issuing = b.operation === "admin_issue";
      const c = b.command;
      const fields = ["operationId", "stationId", "expectedStationVersion", "reason", "note"].concat(issuing ? ["agentIdentity", "printerIdentity", "journalIdentity", "profileId", "credentialLifetimeHours"] : ["agentId"]);
      if (!c || Object.keys(c).length !== fields.length || fields.some((k) => !Object.prototype.hasOwnProperty.call(c, k)) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(c.operationId || "") || !["wts2026station1", "wts2026station2", "wts2026station3"].includes(c.stationId) || !Number.isSafeInteger(c.expectedStationVersion) || c.expectedStationVersion < 1 || !["security", "device_replacement", "maintenance", "incident", "configuration", "operations_restored"].includes(c.reason) || typeof c.note !== "string" || c.note.length > 240 || /[\x00-\x1f\x7f<>@]|:\/\/|www\.|[a-f0-9]{64}|bearer|password|secret|token\s*[:=]|\/dev\//i.test(c.note)) fail("invalid_input");
      if (issuing && (![c.agentIdentity, c.printerIdentity, c.journalIdentity].every(ident) || !(c.profileId === "" || /^[a-z0-9]{15}$/.test(c.profileId)) || !Number.isInteger(c.credentialLifetimeHours) || c.credentialLifetimeHours < 1 || c.credentialLifetimeHours > 720 || !hash(b.credentialHash))) fail("invalid_input");
      const fingerprint = $security.sha256(canonical({ operation: b.operation, command: c }));
      const key = $security.sha256("wts2026:checkin:admin_ui:" + actor.id + ":" + c.operationId);
      const prior = find(app, "admin_actions", "idempotency_key = {:key}", { key });
      if (prior) {
        if (prior.getString("input_fingerprint") !== fingerprint) fail("conflict", 409);
        if (prior.getString("status") === "applied") { result = JSON.parse(prior.getString("replay_result")); result.replayed = true; return; }
        if (prior.getString("status") !== "failed") fail("conflict", 409);
      }
      const station = app.findRecordById("checkin_stations", c.stationId);
      if (station.getInt("version") !== c.expectedStationVersion) fail("conflict", 409);
      const previous = latest(station.id);
      if (!issuing && (!previous || previous.id !== c.agentId)) fail("conflict", 409);
      if (issuing && c.printerIdentity !== station.getString("printer_ref")) fail("invalid_input");
      if (issuing && c.profileId) { const p = find(app, "checkin_label_profiles", "id = {:id}", { id: c.profileId }); if (!p || p.getString("station") !== station.id) fail("invalid_input"); }
      const before = dto(station, previous);
      let agent = issuing ? new Record(app.findCollectionByNameOrId("checkin_agents")) : previous;
      if (issuing) agent.set("id", prior ? prior.getString("target_id") : $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"));
      // Reserve the immutable administrative identity before changing authority.
      let action = prior || new Record(app.findCollectionByNameOrId("admin_actions"));
      const priorToken = prior ? prior.getString("attempt_token") : "";
      const values = { actor_user: actor.id, mcp_token: "", source: "admin_ui", operation_kind: issuing ? "checkin.issue_agent" : "checkin.revoke_agent", target_collection: "checkin_agents", target_id: agent.id, operation_id: c.operationId, input_fingerprint: fingerprint, idempotency_key: key, status: "pending", before_summary: before, after_summary: null, replay_result: null, failure_code: "", failure_message: "", failure_metadata: null, completed_at: "", lease_expires_at: "", attempt_count: prior ? prior.getInt("attempt_count") + 1 : 1, attempt_token: $security.randomString(32) };
      set(action, values); app.save(action);
      reservation = { id: action.id, values, priorToken };
      action = app.findRecordById("admin_actions", action.id);
      if (previous) { previous.set("revoked", true); app.save(previous); }
      if (issuing) {
        // Journal continuity belongs to the stable station/journal, not a bearer.
        // Search retained history too: rotating away and back must not reset it.
        const watermark = find(app, "checkin_agents", "station = {:station} && journal_identity = {:journal}", { station: station.id, journal: c.journalIdentity }, "-journal_sequence,-revision");
        const changedIdentity = previous && (previous.getString("agent_identity") !== c.agentIdentity || previous.getString("printer_identity") !== c.printerIdentity || previous.getString("journal_identity") !== c.journalIdentity);
        set(agent, { journal_sequence: watermark ? watermark.getInt("journal_sequence") : 0, journal_digest: watermark ? watermark.getString("journal_digest") : "" });
        set(agent, { revision: station.getInt("version") + 1, station: station.id, credential_hash: b.credentialHash, agent_identity: c.agentIdentity, printer_identity: c.printerIdentity, journal_identity: c.journalIdentity, profile_id: c.profileId, expires_at: new Date(now + c.credentialLifetimeHours * 3600000).toISOString(), revoked: false, quarantined: !!changedIdentity || (previous ? previous.getBool("quarantined") : false) || (watermark ? watermark.getBool("quarantined") : false), compatibility: "unknown" }); app.save(agent);
      }
      // Agent rotation changes authorization generation, not the printer config.
      station.set("profile_config_version", station.getInt("profile_config_version") || station.getInt("version"));
      station.set("version", station.getInt("version") + 1); station.set("generation", station.getInt("generation") + 1); app.save(station);
      const after = dto(station, agent);
      action.set("after_summary", after); action.set("completed_at", iso);
      result = { actionId: action.id, replayed: false, station: after };
      action.set("status", "applied"); action.set("replay_result", result); app.save(action);
      const audit = new Record(app.findCollectionByNameOrId("checkin_audit_events"));
      set(audit, { actor_user_id: actor.id, actor_name: actor.getString("name").trim() && !/[\x00-\x1f\x7f<>@]|:\/\/|www\.|[a-f0-9]{64}|bearer|password|secret|token\s*[:=]/i.test(actor.getString("name")) ? actor.getString("name").trim().slice(0, 80) : "Authorized User", actor_role: "admin", operation: issuing ? "issue_agent" : "revoke_agent", station_id: station.id, admin_action_id: action.id, reason: c.reason, note: c.note.trim(), outcome: "applied", state: { before, after } }); app.save(audit); return;
    }
    if (b.operation === "machine_acquire") {
      if (!hash(b.owner) || (connected() && runtime.getString("owner") !== b.owner)) fail("conflict", 409);
      const c = b.config;
      if (!c || !Number.isInteger(c.heartbeatIntervalMs) || c.heartbeatIntervalMs < 100 || c.heartbeatIntervalMs > 60000 || !Number.isInteger(c.heartbeatTimeoutMs) || c.heartbeatTimeoutMs <= c.heartbeatIntervalMs || c.heartbeatTimeoutMs > 180000 || !Number.isInteger(c.authorizationTtlMs) || c.authorizationTtlMs < 100 || c.authorizationTtlMs > 10000) fail("invalid_input");
      if (runtime.getString("owner") !== b.owner) runtime.set("generation", runtime.getInt("generation") + 1);
      set(runtime, { owner: b.owner, last_seen_at: iso, heartbeat_interval_ms: c.heartbeatIntervalMs, heartbeat_timeout_ms: c.heartbeatTimeoutMs, authorization_ttl_ms: c.authorizationTtlMs }); app.save(runtime); result = { generation: runtime.getInt("generation") }; return;
    }
    if (!hash(b.owner) || runtime.getString("owner") !== b.owner || !connected()) fail("unavailable", 503);
    if (b.operation === "machine_pulse") { runtime.set("last_seen_at", iso); app.save(runtime); result = { generation: runtime.getInt("generation") }; return; }
    if (b.operation === "machine_release") { runtime.set("last_seen_at", ""); runtime.set("owner", ""); app.save(runtime); result = { released: true }; return; }
    // The future producer seam is privileged-only and NOT forwarded by the HTTP
    // coordinator. No browser/agent can manufacture an attempt or label payload.
    if (b.operation === "machine_prepare") {
      const a = find(app, "checkin_agents", "id = {:id}", { id: b.agentId });
      if (!a) fail("invalid_input"); const s = app.findRecordById("checkin_stations", a.getString("station"));
      if (!dto(s, a).readyForAuthorization || !hash(b.payloadHash)) fail("conflict", 409);
      const attempt = new Record(app.findCollectionByNameOrId("checkin_agent_attempts"));
      set(attempt, { station: s.id, agent_id: a.id, profile_id: a.getString("profile_id"), payload_hash: b.payloadHash, station_generation: s.getInt("generation"), system_generation: system.getInt("generation"), coordinator_generation: runtime.getInt("generation") }); app.save(attempt);
      result = { attemptId: attempt.id, payloadHash: b.payloadHash, profileId: a.getString("profile_id") }; return;
    }
    const agent = hash(b.credentialHash) && find(app, "checkin_agents", "credential_hash = {:hash}", { hash: b.credentialHash });
    if (!agent) fail("forbidden", 403);
    const station = app.findRecordById("checkin_stations", agent.getString("station"));
    const p = b.payload || {};
    if (p.stationId !== station.id) fail("forbidden", 403);
    if (b.operation === "machine_outcome") {
      const auth = find(app, "checkin_agent_authorizations", "attempt_id = {:attempt} && agent_id = {:agent}", { attempt: p.attemptId || "", agent: agent.id });
      if (!auth || !hash(p.authorizationHash) || auth.getString("authorization_hash") !== p.authorizationHash || !auth.getString("started_at")) fail("forbidden", 403);
      if (!["protocol_complete", "output_uncertain"].includes(p.outcome)) fail("invalid_input");
      if (auth.getString("outcome") && auth.getString("outcome") !== p.outcome) fail("conflict", 409);
      auth.set("outcome", p.outcome); app.save(auth); if (p.outcome === "output_uncertain") { agent.set("quarantined", true); app.save(agent); } result = { attemptId: p.attemptId, outcome: p.outcome }; return;
    }
    if (agent.getBool("revoked") || now >= Date.parse(agent.getString("expires_at")) || latest(station.id).id !== agent.id) fail("forbidden", 403);
    if (b.operation === "machine_heartbeat") {
      if (!Number.isSafeInteger(p.journalSequence) || p.journalSequence < 1 || !hash(p.journalDigest) || !["healthy", "lost", "corrupt", "restored"].includes(p.journalState)) fail("invalid_input");
      const compatible = p.protocolGeneration === 1 && p.schemaGeneration === 1;
      const wrong = p.agentIdentity !== agent.getString("agent_identity") || p.printerIdentity !== agent.getString("printer_identity") || p.journalIdentity !== agent.getString("journal_identity") || p.profileId !== agent.getString("profile_id");
      const old = p.journalSequence < agent.getInt("journal_sequence") || (p.journalSequence === agent.getInt("journal_sequence") && p.journalDigest !== agent.getString("journal_digest"));
      if (wrong || old || p.journalState !== "healthy" || !compatible) agent.set("quarantined", true);
      set(agent, { compatibility: compatible && !wrong ? "compatible" : "mismatch", reported_profile: typeof p.profileId === "string" ? p.profileId : "", protocol_generation: compatible ? 1 : 0, schema_generation: compatible ? 1 : 0 });
      if (!wrong && !old && p.journalState === "healthy" && compatible && !agent.getBool("quarantined")) set(agent, { last_heartbeat_at: iso, journal_sequence: p.journalSequence, journal_digest: p.journalDigest });
      app.save(agent); result = { station: dto(station, agent) }; return;
    }
    if (b.operation === "machine_status") { result = { station: dto(station, agent) }; return; }
    if (!dto(station, agent).readyForAuthorization) fail("conflict", 409);
    if (b.operation === "machine_work") {
      const selected = [];
      // Filter authorized work before applying the public ten-attempt limit.
      // PocketBase's ?!= is ANY-not-equal, not a SQL anti-join.
      for (let offset = 0; selected.length < 10; offset += 100) {
        const page = app.findRecordsByFilter("checkin_agent_attempts", "agent_id = {:agent} && station = {:station} && station_generation = {:sg} && system_generation = {:yg} && coordinator_generation = {:cg}", "created,id", 100, offset, { agent: agent.id, station: station.id, sg: station.getInt("generation"), yg: system.getInt("generation"), cg: runtime.getInt("generation") });
        for (const a of page) { if (!find(app, "checkin_agent_authorizations", "attempt_id = {:id}", { id: a.id })) selected.push({ attemptId: a.id, profileId: a.getString("profile_id"), payloadHash: a.getString("payload_hash") }); if (selected.length === 10) break; }
        if (page.length < 100) break;
      }
      result = { attempts: selected }; return;
    }
    const attempt = find(app, "checkin_agent_attempts", "id = {:id} && agent_id = {:agent} && station = {:station}", { id: p.attemptId || "", agent: agent.id, station: station.id });
    if (!attempt || attempt.getString("payload_hash") !== p.payloadHash || attempt.getString("profile_id") !== agent.getString("profile_id") || attempt.getInt("station_generation") !== station.getInt("generation") || attempt.getInt("system_generation") !== system.getInt("generation") || attempt.getInt("coordinator_generation") !== runtime.getInt("generation")) fail("conflict", 409);
    let auth = find(app, "checkin_agent_authorizations", "attempt_id = {:id}", { id: attempt.id });
    if (b.operation === "machine_authorize") {
      if (!hash(p.authorizationHash)) fail("invalid_input");
      if (auth) { if (auth.getString("authorization_hash") !== p.authorizationHash || auth.getString("started_at") || now >= Date.parse(auth.getString("expires_at"))) fail("conflict", 409); }
      else { auth = new Record(app.findCollectionByNameOrId("checkin_agent_authorizations")); set(auth, { attempt_id: attempt.id, agent_id: agent.id, authorization_hash: p.authorizationHash, expires_at: new Date(Math.min(now + runtime.getInt("authorization_ttl_ms"), Date.parse(agent.getString("expires_at")))).toISOString(), station_generation: station.getInt("generation"), system_generation: system.getInt("generation"), coordinator_generation: runtime.getInt("generation") }); app.save(auth); }
      result = { attemptId: attempt.id, stationId: station.id, agentId: agent.id, payloadHash: attempt.getString("payload_hash"), expiresAt: auth.getString("expires_at"), stationGeneration: station.getInt("generation"), systemGeneration: system.getInt("generation"), coordinatorGeneration: runtime.getInt("generation") }; return;
    }
    if (b.operation === "machine_start") {
      if (!auth || auth.getString("authorization_hash") !== p.authorizationHash || auth.getString("started_at") || now >= Date.parse(auth.getString("expires_at"))) fail("conflict", 409);
      // Persist the possibly-started boundary before acknowledging. A lost reply
      // cannot grant a second start; subsequent outcome reporting stays allowed.
      // Outcome authority is per-attempt and survives expiry/stops/restarts until lifecycle purge.
      set(auth, { started_at: iso, report_until: "" }); app.save(auth);
      result = { attemptId: attempt.id, started: true, reportUntil: auth.getString("report_until") }; return;
    }
    fail("invalid_input");
  }); } catch (error) {
    // State and audit writes have rolled back. Preserve only the validated
    // reservation, never partial authority or raw storage diagnostics. This is
    // configuration-only recovery, not an external-effect lease/replay scheme.
    if (reservation) e.app.runInTransaction((app) => {
      const saved = find(app, "admin_actions", "idempotency_key = {:key}", { key: reservation.values.idempotency_key });
      // Another request may have committed while rollback released the lock.
      if (saved && (saved.id !== reservation.id || saved.getString("status") !== "failed" || saved.getString("attempt_token") !== reservation.priorToken)) return;
      let action = saved || new Record(app.findCollectionByNameOrId("admin_actions"));
      action.set("id", reservation.id); set(action, reservation.values); app.save(action);
      action = app.findRecordById("admin_actions", action.id);
      set(action, { status: "failed", failure_code: "storage_failure", failure_message: "Administrative command could not be applied.", completed_at: new Date().toISOString() }); app.save(action);
    });
    throw error;
  }
  return e.json(200, result);
}, $apis.requireSuperuserAuth());
onRecordCreateRequest(() => { throw new ForbiddenError("Use agent commands."); }, "checkin_agents", "checkin_coordinator", "checkin_agent_attempts", "checkin_agent_authorizations");
onRecordUpdateRequest(() => { throw new ForbiddenError("Use agent commands."); }, "checkin_agents", "checkin_coordinator", "checkin_agent_authorizations");
onRecordUpdate(() => { throw new ForbiddenError("Attempt identity is immutable."); }, "checkin_agent_attempts");
onRecordDelete(() => { throw new ForbiddenError("Agent history requires an explicit lifecycle migration."); }, "checkin_agents", "checkin_coordinator", "checkin_agent_attempts", "checkin_agent_authorizations");
