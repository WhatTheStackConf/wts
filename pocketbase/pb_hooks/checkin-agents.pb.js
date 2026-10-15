/// <reference path="../pb_data/types.d.ts" />
// Trusted storage command seam. Machine bearers never enter PocketBase directly.
routerAdd("POST", "/api/wts/checkin-agents", (e) => {
  const b = e.requestInfo().body;
  const recovery = require(__hooks + "/checkin-recovery.js");
  function fail(code, status = 400) { throw new ApiError(status, "Agent request rejected.", { code: new ValidationError(code, "Agent request rejected.") }); }
  function find(app, name, filter, params, sort = "") { const rows = app.findRecordsByFilter(name, filter, sort, 1, 0, params || {}); return rows.length ? rows[0] : null; }
  function set(record, values) { for (const key in values) record.set(key, values[key]); }
  function json(record, field) { return JSON.parse(record.getString(field) || "null"); }
  function hash(v) { return typeof v === "string" && /^[a-f0-9]{64}$/.test(v); }
  function ident(v) { return typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v); }
  function canonical(v) { if (v === null || typeof v !== "object") return JSON.stringify(v); return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}"; }
  function has(table, key) { return Object.prototype.hasOwnProperty.call(table, key); }
  function clock(machine) { return machine && !["machine_monitoring_readiness", "machine_coordinator_status"].includes(b.operation) && Number.isSafeInteger(b.nowMs) ? b.nowMs : Date.now(); }
  function unsafeText(value) { return /[\x00-\x1f\x7f<>@]|:\/\/|www\.|[a-f0-9]{64}|bearer|password|secret|token\s*[:=]/i.test(value); }
  function safeNote(note) { return typeof note === "string" && note.length <= 240 && !/[\x00-\x1f\x7f<>@]|:\/\/|www\.|[a-f0-9]{64}|bearer|password|secret|token\s*[:=]|\/dev\//i.test(note); }
  function validAdminCommand(c, fields) {
    return !!c && Object.keys(c).length === fields.length && !fields.some((k) => !Object.prototype.hasOwnProperty.call(c, k)) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(c.operationId || "") && ["wts2026station1", "wts2026station2", "wts2026station3"].includes(c.stationId) && Number.isSafeInteger(c.expectedStationVersion) && c.expectedStationVersion >= 1 && ["security", "device_replacement", "maintenance", "incident", "configuration", "operations_restored"].includes(c.reason) && safeNote(c.note);
  }
  function validIssue(c) { return [c.agentIdentity, c.printerIdentity, c.journalIdentity].every(ident) && (c.profileId === "" || /^[a-z0-9]{15}$/.test(c.profileId)) && Number.isInteger(c.credentialLifetimeHours) && c.credentialLifetimeHours >= 1 && c.credentialLifetimeHours <= 720 && hash(b.credentialHash); }
  function validLease(c) { return !!c && Number.isInteger(c.heartbeatIntervalMs) && c.heartbeatIntervalMs >= 100 && c.heartbeatIntervalMs <= 60000 && Number.isInteger(c.heartbeatTimeoutMs) && c.heartbeatTimeoutMs > c.heartbeatIntervalMs && c.heartbeatTimeoutMs <= 180000 && Number.isInteger(c.authorizationTtlMs) && c.authorizationTtlMs >= 100 && c.authorizationTtlMs <= 10000; }
  function validHeartbeat(p) { return Number.isSafeInteger(p.journalSequence) && p.journalSequence >= 1 && hash(p.journalDigest) && ["healthy", "lost", "corrupt", "restored"].includes(p.journalState); }
  function wrongIdentity(agent, p) { return p.agentIdentity !== agent.getString("agent_identity") || p.printerIdentity !== agent.getString("printer_identity") || p.journalIdentity !== agent.getString("journal_identity") || p.profileId !== agent.getString("profile_id"); }
  function staleJournal(agent, p) { return p.journalSequence < agent.getInt("journal_sequence") || (p.journalSequence === agent.getInt("journal_sequence") && p.journalDigest !== agent.getString("journal_digest")); }
  function changedIdentity(previous, c) { return !!previous && (previous.getString("agent_identity") !== c.agentIdentity || previous.getString("printer_identity") !== c.printerIdentity || previous.getString("journal_identity") !== c.journalIdentity); }
  function inheritedQuarantine(previous, watermark) { return (previous ? previous.getBool("quarantined") : false) || (watermark ? watermark.getBool("quarantined") : false); }
  function profileMismatch(v) { return !v.p || !v.current || v.current.id !== v.p.id || !boundToStation(v.p, v.config, v.station, v.agent, v.pv) || (v.seen && v.agent.getString("reported_profile") !== v.p.id); }
  function actorName(actor) { return actor.getString("name").trim() && !unsafeText(actor.getString("name")) ? actor.getString("name").trim().slice(0, 80) : "Authorized User"; }
  function compatibilityOf(agent) { return agent ? agent.getString("compatibility") || "unknown" : "unknown"; }
  function journalOf(agent, seen) { return agent && agent.getBool("quarantined") ? "quarantined" : seen ? "healthy" : "unknown"; }
  function boundToStation(p, config, station, agent, pv) { return p.getString("station") === station.id && config.printerRef === station.getString("printer_ref") && config.printerRef === agent.getString("printer_identity") && p.getInt("station_version") === pv; }
  let result;
  let reservation = null;
  try { e.app.runInTransaction((app) => {
    // Clock injection is confined to the privileged coordinator seam, never HTTP
    // payloads from a machine/browser. Production coordinator uses wall clock.
    const machine = typeof b.operation === "string" && b.operation.startsWith("machine_");
    const now = clock(machine);
    const iso = new Date(now).toISOString();
    const system = app.findRecordById("checkin_system", "wts2026system00");
    const runtime = app.findRecordById("checkin_coordinator", "wts2026coord000");
    function connected() { const t = Date.parse(runtime.getString("last_seen_at")); return Number.isFinite(t) && now >= t && now - t < runtime.getInt("heartbeat_timeout_ms"); }
    function latest(station) { return find(app, "checkin_agents", "station = {:station}", { station }, "-revision"); }
    function connectionOf(seen) {
      const age = now - Date.parse(seen);
      return !seen ? "never_seen" : age >= 0 && age < runtime.getInt("heartbeat_timeout_ms") ? "connected" : "stale";
    }
    function credentialOf(agent) { return !agent ? "not_issued" : agent.getBool("revoked") ? "revoked" : Date.parse(agent.getString("expires_at")) <= now ? "expired" : "active"; }
    function profileOf(station, agent, seen) {
      if (!agent || !agent.getString("profile_id")) return "unconfigured";
      const p = find(app, "checkin_label_profiles", "id = {:id}", { id: agent.getString("profile_id") });
      const current = find(app, "checkin_label_profiles", "station = {:station}", { station: station.id }, "-version");
      const approved = p && find(app, "checkin_label_approvals", "profile = {:id}", { id: p.id });
      const config = p ? JSON.parse(p.getString("config")) : null;
      const pv = station.getInt("profile_config_version") || station.getInt("version");
      if (profileMismatch({ p, current, config, station, agent, pv, seen })) return "mismatch";
      return approved && !config.synthetic && approved.getInt("station_version") === pv ? "approved" : "unapproved";
    }
    function readinessReasons(station, states) {
      const reasons = [];
      // Physical uncertainty belongs to the fixed station, not its current agent.
      // A replacement credential cannot orphan a previously started operation.
      const unresolvedOutput = new DynamicModel({ present: 0 });
      app.db().newQuery("SELECT EXISTS (SELECT 1 FROM checkin_agent_authorizations a JOIN checkin_agents g ON g.id = a.agent_id WHERE g.station = {:station} AND a.started_at != '' AND a.outcome != 'protocol_complete' AND NOT EXISTS (SELECT 1 FROM checkin_recovery_observations o WHERE o.agent_attempt_id = a.attempt_id)) AS present").bind({ station: station.id }).one(unresolvedOutput);
      if (unresolvedOutput.present) reasons.push("printer_output_unresolved");
      if (recovery.isolated(app, station.id)) reasons.push("printer_physically_isolated");
      if (!connected()) reasons.push("coordinator_unavailable");
      for (const check of [["credential_", states.credentialState, "active"], ["agent_", states.connection, "connected"], ["compatibility_", states.compatibility, "compatible"], ["profile_", states.profile, "approved"], ["journal_", states.journal, "healthy"]]) if (check[1] !== check[2]) reasons.push(check[0] + check[1]);
      if (!system.getBool("enabled")) reasons.push("system_disabled");
      if (!station.getBool("enabled")) reasons.push("station_disabled");
      return reasons;
    }
    function dto(station, agent) {
      const seen = agent ? agent.getString("last_heartbeat_at") : "";
      const connection = connectionOf(seen);
      const credentialState = credentialOf(agent);
      const profile = profileOf(station, agent, seen);
      const compatibility = compatibilityOf(agent);
      const journal = journalOf(agent, seen);
      const stopped = !system.getBool("enabled") || !station.getBool("enabled");
      const reasons = readinessReasons(station, { credentialState, connection, compatibility, profile, journal });
      return { stationId: station.id, stationLabel: station.getString("label"), stationVersion: station.getInt("version"), agentId: agent ? agent.id : null, credentialState, credentialExpiresAt: agent ? agent.getString("expires_at") : null, connection, compatibility, profile, journal, stopped, coordinator: connected() ? "connected" : "unavailable", readyForAuthorization: reasons.length === 0, operationsEnabled: false, reasons, lastHeartbeatAt: seen || null, heartbeatIntervalMs: runtime.getInt("heartbeat_interval_ms"), heartbeatTimeoutMs: runtime.getInt("heartbeat_timeout_ms"), authorizationTtlMs: runtime.getInt("authorization_ttl_ms") };
    }
    function stationViews() { return app.findRecordsByFilter("checkin_stations", "edition = 'WTS2026'", "id", 3, 0).map((s) => dto(s, latest(s.id))); }
    // Independent central observer: no actor impersonation or producer lease.
    // Ignore caller clocks on these read-only projections.
    function coordinatorStatus() {
      const lifecycle = require(__hooks + "/checkin-lifecycle.js").state(app);
      return { mode: lifecycle.getString("closed_at") ? "closed" : lifecycle.getBool("restore_required") ? "restore_required" : "open" };
    }
    function operatorActor() {
      const actor = typeof b.actorUserId === "string" && find(app, "users", "id = {:id}", { id: b.actorUserId });
      if (!actor || !actor.getBool("verified") || !["admin", "checkin_operator"].includes(actor.getString("role"))) fail("forbidden", 403);
      return actor;
    }
    function bindingStatus() {
      const binding = hash(b.identityHash) && find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: b.identityHash });
      if (!binding || binding.getBool("revoked")) return { station: null };
      const station = app.findRecordById("checkin_stations", binding.getString("station"));
      return { station: dto(station, latest(station.id)) };
    }
    function replayOrRetry(prior, fingerprint) {
      if (prior.getString("input_fingerprint") !== fingerprint) fail("conflict", 409);
      if (prior.getString("status") === "applied") return true;
      if (prior.getString("status") !== "failed") fail("conflict", 409);
      return false;
    }
    function replayOf(prior) { const replayed = JSON.parse(prior.getString("replay_result")); replayed.replayed = true; return replayed; }
    function adminStation(c) {
      const station = app.findRecordById("checkin_stations", c.stationId);
      if (station.getInt("version") !== c.expectedStationVersion) fail("conflict", 409);
      return station;
    }
    function assertIssueTarget(c, station) {
      if (c.printerIdentity !== station.getString("printer_ref")) fail("invalid_input");
      if (c.profileId) { const p = find(app, "checkin_label_profiles", "id = {:id}", { id: c.profileId }); if (!p || p.getString("station") !== station.id) fail("invalid_input"); }
    }
    function newAgent(prior) {
      const agent = new Record(app.findCollectionByNameOrId("checkin_agents"));
      agent.set("id", prior ? prior.getString("target_id") : $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"));
      return agent;
    }
    function issueAgent(agent, station, c, previous) {
      // Journal continuity belongs to the stable station/journal, not a bearer.
      // Search retained history too: rotating away and back must not reset it.
      const watermark = find(app, "checkin_agents", "station = {:station} && journal_identity = {:journal}", { station: station.id, journal: c.journalIdentity }, "-journal_sequence,-revision");
      set(agent, { journal_sequence: watermark ? watermark.getInt("journal_sequence") : 0, journal_digest: watermark ? watermark.getString("journal_digest") : "" });
      set(agent, { revision: station.getInt("version") + 1, station: station.id, credential_hash: b.credentialHash, agent_identity: c.agentIdentity, printer_identity: c.printerIdentity, journal_identity: c.journalIdentity, profile_id: c.profileId, expires_at: new Date(now + c.credentialLifetimeHours * 3600000).toISOString(), revoked: false, quarantined: changedIdentity(previous, c) || inheritedQuarantine(previous, watermark), compatibility: "unknown" }); app.save(agent);
    }
    function rotateStation(station) {
      // Agent rotation changes authorization generation, not the printer config.
      station.set("profile_config_version", station.getInt("profile_config_version") || station.getInt("version"));
      station.set("version", station.getInt("version") + 1); station.set("generation", station.getInt("generation") + 1); app.save(station);
    }
    function adminCommand(issuing) {
      const c = b.command;
      const fields = ["operationId", "stationId", "expectedStationVersion", "reason", "note"].concat(issuing ? ["agentIdentity", "printerIdentity", "journalIdentity", "profileId", "credentialLifetimeHours"] : ["agentId"]);
      if (!validAdminCommand(c, fields)) fail("invalid_input");
      if (issuing && !validIssue(c)) fail("invalid_input");
      return c;
    }
    function assertAdminTarget(c, station, previous, issuing) {
      if (issuing) assertIssueTarget(c, station);
      else if (!previous || previous.id !== c.agentId) fail("conflict", 409);
    }
    function applyRotation(c, station, previous, agent, issuing) {
      if (previous) { previous.set("revoked", true); app.save(previous); }
      if (issuing) issueAgent(agent, station, c, previous);
      rotateStation(station);
    }
    function administer(actor) {
      const issuing = b.operation === "admin_issue";
      const c = adminCommand(issuing);
      const fingerprint = $security.sha256(canonical({ operation: b.operation, command: c }));
      const key = $security.sha256("wts2026:checkin:admin_ui:" + actor.id + ":" + c.operationId);
      const prior = find(app, "admin_actions", "idempotency_key = {:key}", { key });
      if (prior && replayOrRetry(prior, fingerprint)) return replayOf(prior);
      const station = adminStation(c);
      const previous = latest(station.id);
      assertAdminTarget(c, station, previous, issuing);
      const before = dto(station, previous);
      const agent = issuing ? newAgent(prior) : previous;
      function reserve() {
        // Reserve the immutable administrative identity before changing authority.
        const reserved = prior || new Record(app.findCollectionByNameOrId("admin_actions"));
        const priorToken = prior ? prior.getString("attempt_token") : "";
        const values = { actor_user: actor.id, mcp_token: "", source: "admin_ui", operation_kind: issuing ? "checkin.issue_agent" : "checkin.revoke_agent", target_collection: "checkin_agents", target_id: agent.id, operation_id: c.operationId, input_fingerprint: fingerprint, idempotency_key: key, status: "pending", before_summary: before, after_summary: null, replay_result: null, failure_code: "", failure_message: "", failure_metadata: null, completed_at: "", lease_expires_at: "", attempt_count: prior ? prior.getInt("attempt_count") + 1 : 1, attempt_token: $security.randomString(32) };
        set(reserved, values); app.save(reserved);
        reservation = { id: reserved.id, values, priorToken };
        return app.findRecordById("admin_actions", reserved.id);
      }
      const action = reserve();
      applyRotation(c, station, previous, agent, issuing);
      const after = dto(station, agent);
      action.set("after_summary", after); action.set("completed_at", iso);
      const applied = { actionId: action.id, replayed: false, station: after };
      action.set("status", "applied"); action.set("replay_result", applied); app.save(action);
      const audit = new Record(app.findCollectionByNameOrId("checkin_audit_events"));
      set(audit, { actor_user_id: actor.id, actor_name: actorName(actor), actor_role: "admin", operation: issuing ? "issue_agent" : "revoke_agent", station_id: station.id, admin_action_id: action.id, reason: c.reason, note: c.note.trim(), outcome: "applied", state: { before, after } }); app.save(audit);
      return applied;
    }
    function humanCommand() {
      const actor = operatorActor();
      if (b.operation === "status") return bindingStatus();
      if (actor.getString("role") !== "admin") fail("forbidden", 403);
      if (b.operation === "admin_list") return { stations: stationViews() };
      if (!["admin_issue", "admin_revoke"].includes(b.operation)) fail("invalid_input");
      return administer(actor);
    }
    function acquire() {
      require(__hooks + "/checkin-lifecycle.js").assertNewWork(app);
      if (!hash(b.owner) || (connected() && runtime.getString("owner") !== b.owner)) fail("conflict", 409);
      const c = b.config;
      if (!validLease(c)) fail("invalid_input");
      if (runtime.getString("owner") !== b.owner) runtime.set("generation", runtime.getInt("generation") + 1);
      set(runtime, { owner: b.owner, last_seen_at: iso, heartbeat_interval_ms: c.heartbeatIntervalMs, heartbeat_timeout_ms: c.heartbeatTimeoutMs, authorization_ttl_ms: c.authorizationTtlMs }); app.save(runtime); return { generation: runtime.getInt("generation") };
    }
    // Read-only status remains available without a live producer lease.
    function machineStatus() {
      const agent = hash(b.credentialHash) && find(app, "checkin_agents", "credential_hash = {:hash}", { hash: b.credentialHash });
      if (!agent || !b.payload || b.payload.stationId !== agent.getString("station")) fail("forbidden", 403);
      return { station: dto(app.findRecordById("checkin_stations", agent.getString("station")), agent) };
    }
    // Original credentials may report/neutralize retained work without a live
    // producer lease. These paths cannot grant a new physical start.
    function assertAuthority() {
      const reportingOnly = ["machine_outcome", "machine_cancellations", "machine_neutralized"].includes(b.operation);
      if (reportingOnly) require(__hooks + "/checkin-lifecycle.js").assertOutcome(app, now);
      else if (!hash(b.owner) || runtime.getString("owner") !== b.owner || !connected()) fail("unavailable", 503);
    }
    function pulse() { runtime.set("last_seen_at", iso); app.save(runtime); return { generation: runtime.getInt("generation") }; }
    function release() { runtime.set("last_seen_at", ""); runtime.set("owner", ""); app.save(runtime); return { released: true }; }
    function generations(station) { return { station_generation: station.getInt("generation"), system_generation: system.getInt("generation"), coordinator_generation: runtime.getInt("generation") }; }
    function claimPrint(print) {
      const workflow = app.findRecordById("checkin_arrival_workflows", print.getString("workflow_id"));
      const station = app.findRecordById("checkin_stations", print.getString("station_id"));
      const agent = latest(station.id);
      if (!recovery.permitted(app, workflow) || recovery.blocked(app, print) || !agent || !dto(station, agent).readyForAuthorization) return false;
      const prior = find(app, "checkin_agent_attempts", "print_attempt_id = {:print}", { print: print.id }, "-created");
      if (prior) return false;
      const profile = json(print, "profile_snapshot");
      const payload = { purpose: print.getString("purpose"), text: { name: print.getString("name"), affiliation: print.getString("affiliation") }, profile, rendererVersion: profile.config.rendererVersion, fontVersion: profile.config.fontVersion };
      const attempt = new Record(app.findCollectionByNameOrId("checkin_agent_attempts"));
      set(attempt, { station: station.id, agent_id: agent.id, profile_id: print.getString("profile_id"), payload_hash: print.getString("payload_hash"), print_attempt_id: print.id, purpose: print.getString("purpose"), payload, ...generations(station) });
      app.save(attempt); return true;
    }
    // The future producer seam is privileged-only and NOT forwarded by the HTTP
    // coordinator. No browser/agent can manufacture an attempt or label payload.
    function printClaim() {
      require(__hooks + "/checkin-lifecycle.js").assertNewWork(app);
      const limit = Number.isSafeInteger(b.limit) && b.limit >= 1 && b.limit <= 100 ? b.limit : 10;
      let claimed = 0;
      recovery.each(app, "checkin_print_attempts", "state = 'queued'", {}, (print) => {
        if (claimed >= limit) return false;
        if (claimPrint(print)) claimed++;
      });
      return { claimed };
    }
    function prepare() {
      const a = find(app, "checkin_agents", "id = {:id}", { id: b.agentId });
      if (!a) fail("invalid_input"); const s = app.findRecordById("checkin_stations", a.getString("station"));
      if (!dto(s, a).readyForAuthorization || !hash(b.payloadHash)) fail("conflict", 409);
      const attempt = new Record(app.findCollectionByNameOrId("checkin_agent_attempts"));
      set(attempt, { station: s.id, agent_id: a.id, profile_id: a.getString("profile_id"), payload_hash: b.payloadHash, print_attempt_id: "", purpose: "generic", payload: null, ...generations(s) }); app.save(attempt);
      return { attemptId: attempt.id, payloadHash: b.payloadHash, profileId: a.getString("profile_id") };
    }
    function cancellationView(row, attempt) {
      return { cancellationId: row.id, startState: find(app, "checkin_agent_authorizations", "attempt_id = {:id}", { id: attempt.id })?.getString("started_at") ? "started" : "not_started", work: { attemptId: attempt.id, profileId: attempt.getString("profile_id"), payloadHash: attempt.getString("payload_hash"), payload: json(attempt, "payload") } };
    }
    // Neutralization is reporting-only authority: survives stops, expiry and revocation.
    function cancellations(agent, station) {
      const pending = [];
      recovery.each(app, "checkin_recovery_cancellations", "station_id = {:station} && state = 'pending'", { station: station.id }, (row) => {
        const attempt = find(app, "checkin_agent_attempts", "id = {:id} && agent_id = {:agent}", { id: row.getString("agent_attempt_id"), agent: agent.id });
        if (attempt) pending.push(cancellationView(row, attempt));
        if (pending.length === 10) return false;
      });
      return { cancellations: pending };
    }
    function neutralizedWork(agent, station, p) {
      const row = find(app, "checkin_recovery_cancellations", "id = {:id} && station_id = {:station}", { id: p.cancellationId || "", station: station.id });
      const attempt = row && find(app, "checkin_agent_attempts", "id = {:id} && agent_id = {:agent}", { id: row.getString("agent_attempt_id"), agent: agent.id });
      if (!attempt || p.attemptId !== attempt.id || p.payloadHash !== attempt.getString("payload_hash") || !["neutralized", "settled"].includes(p.disposition)) fail("forbidden", 403);
      return { row, attempt };
    }
    function assertDisposition(p, auth) {
      if (p.disposition === "neutralized" && auth?.getString("started_at") || p.disposition === "settled" && !auth?.getString("outcome")) fail("conflict", 409);
    }
    function settleProjection(row) {
      const workflow = app.findRecordById("checkin_arrival_workflows", row.getString("workflow_id"));
      const projection = recovery.projection(app, workflow);
      // Machine neutralization proves queue safety, never human handwriting.
      if (projection && !find(app, "checkin_recovery_cancellations", "workflow_id = {:id} && state != 'acknowledged'", { id: workflow.id }) && projection.getString("decision") === "cancel_pending") {
        set(projection, { decision: "cancelled", fulfillment: "cancelled", completed_day: recovery.day(now), updated_at: iso, version: projection.getInt("version") + 1 }); app.save(projection);
      }
    }
    function neutralized(agent, station, p) {
      const work = neutralizedWork(agent, station, p);
      const auth = find(app, "checkin_agent_authorizations", "attempt_id = {:id}", { id: work.attempt.id });
      assertDisposition(p, auth);
      if (work.row.getString("state") !== "acknowledged") { set(work.row, { state: "acknowledged", acknowledged_at: iso }); app.save(work.row); }
      settleProjection(work.row);
      return { cancellationId: work.row.id, acknowledged: true };
    }
    function startedAuthorization(agent, p) {
      const auth = find(app, "checkin_agent_authorizations", "attempt_id = {:attempt} && agent_id = {:agent}", { attempt: p.attemptId || "", agent: agent.id });
      if (!auth || !hash(p.authorizationHash) || auth.getString("authorization_hash") !== p.authorizationHash || !auth.getString("started_at")) fail("forbidden", 403);
      return auth;
    }
    function projectPrintOutcome(printAttempt, p) {
      const print = app.findRecordById("checkin_print_attempts", printAttempt.getString("print_attempt_id"));
      if (!["queued", "dispatched", p.outcome === "protocol_complete" ? "completed" : "uncertain"].includes(print.getString("state"))) fail("conflict", 409);
      print.set("state", p.outcome === "protocol_complete" ? "completed" : "uncertain"); app.save(print);
      recovery.projectOutcome(app, print, p.outcome, now);
    }
    function outcome(agent, station, p) {
      require(__hooks + "/checkin-lifecycle.js").assertOutcome(app, now);
      const auth = startedAuthorization(agent, p);
      if (!["protocol_complete", "output_uncertain"].includes(p.outcome)) fail("invalid_input");
      if (auth.getString("outcome") && auth.getString("outcome") !== p.outcome) fail("conflict", 409);
      auth.set("outcome", p.outcome); app.save(auth);
      const printAttempt = find(app, "checkin_agent_attempts", "id = {:id}", { id: p.attemptId });
      if (printAttempt && printAttempt.getString("print_attempt_id")) projectPrintOutcome(printAttempt, p);
      // Physical uncertainty is blocked by immutable authorization evidence, not identity quarantine.
      return { attemptId: p.attemptId, outcome: p.outcome };
    }
    function reportCompatibility(agent, p, compatible, wrong) { set(agent, { compatibility: compatible && !wrong ? "compatible" : "mismatch", reported_profile: typeof p.profileId === "string" ? p.profileId : "", protocol_generation: compatible ? 1 : 0, schema_generation: compatible ? 1 : 0 }); }
    function heartbeat(agent, station, p) {
      if (!validHeartbeat(p)) fail("invalid_input");
      const compatible = p.protocolGeneration === 1 && p.schemaGeneration === 1;
      const wrong = wrongIdentity(agent, p);
      const healthy = !wrong && !staleJournal(agent, p) && p.journalState === "healthy" && compatible;
      if (!healthy) agent.set("quarantined", true);
      reportCompatibility(agent, p, compatible, wrong);
      if (healthy && !agent.getBool("quarantined")) set(agent, { last_heartbeat_at: iso, journal_sequence: p.journalSequence, journal_digest: p.journalDigest });
      app.save(agent); return { station: dto(station, agent) };
    }
    function currentGenerations(attempt, station) { return attempt.getInt("station_generation") === station.getInt("generation") && attempt.getInt("system_generation") === system.getInt("generation") && attempt.getInt("coordinator_generation") === runtime.getInt("generation"); }
    function collectWork(a, selected) {
      const print = a.getString("print_attempt_id") ? app.findRecordById("checkin_print_attempts", a.getString("print_attempt_id")) : null;
      if (print && recovery.blocked(app, print)) return;
      if (find(app, "checkin_agent_authorizations", "attempt_id = {:id}", { id: a.id })) return;
      const work = { attemptId: a.id, profileId: a.getString("profile_id"), payloadHash: a.getString("payload_hash") };
      if (["initial", "replacement"].includes(a.getString("purpose"))) work.payload = json(a, "payload");
      selected.push(work);
    }
    function listWork(agent, station, p) {
      const selected = [];
      // Filter authorized work before applying the public ten-attempt limit.
      // PocketBase's ?!= is ANY-not-equal, not a SQL anti-join.
      const purposeFilter = p.purpose === "initial" ? " && purpose = 'initial'" : p.purpose === "label" ? " && (purpose = 'initial' || purpose = 'replacement')" : "";
      for (let offset = 0; selected.length < 10; offset += 100) {
        const page = app.findRecordsByFilter("checkin_agent_attempts", `agent_id = {:agent} && station = {:station}${purposeFilter} && station_generation = {:sg} && system_generation = {:yg} && coordinator_generation = {:cg}`, "created,id", 100, offset, { agent: agent.id, station: station.id, sg: station.getInt("generation"), yg: system.getInt("generation"), cg: runtime.getInt("generation") });
        for (const a of page) { collectWork(a, selected); if (selected.length === 10) break; }
        if (page.length < 100) break;
      }
      return { attempts: selected };
    }
    function ack(agent, station, p) {
      const attempt = find(app, "checkin_agent_attempts", "id = {:id} && agent_id = {:agent} && station = {:station}", { id: p.attemptId || "", agent: agent.id, station: station.id });
      if (!attempt || !["initial", "replacement"].includes(attempt.getString("purpose")) || attempt.getString("payload_hash") !== p.payloadHash || !currentGenerations(attempt, station)) fail("conflict", 409);
      return { attemptId: attempt.id, acknowledged: true };
    }
    function assertPrintable(attempt) {
      const print = app.findRecordById("checkin_print_attempts", attempt.getString("print_attempt_id"));
      const workflow = app.findRecordById("checkin_arrival_workflows", print.getString("workflow_id"));
      if (recovery.blocked(app, print) || !recovery.permitted(app, workflow)) fail("conflict", 409);
    }
    function unauthorizable(auth, p) { return auth.getString("authorization_hash") !== p.authorizationHash || !!auth.getString("started_at") || now >= Date.parse(auth.getString("expires_at")); }
    function authorize(attempt, agent, station, p, auth) {
      if (!hash(p.authorizationHash)) fail("invalid_input");
      if (auth) { if (unauthorizable(auth, p)) fail("conflict", 409); }
      else { auth = new Record(app.findCollectionByNameOrId("checkin_agent_authorizations")); set(auth, { attempt_id: attempt.id, agent_id: agent.id, authorization_hash: p.authorizationHash, expires_at: new Date(Math.min(now + runtime.getInt("authorization_ttl_ms"), Date.parse(agent.getString("expires_at")))).toISOString(), ...generations(station) }); app.save(auth); }
      return { attemptId: attempt.id, stationId: station.id, agentId: agent.id, payloadHash: attempt.getString("payload_hash"), expiresAt: auth.getString("expires_at"), stationGeneration: station.getInt("generation"), systemGeneration: system.getInt("generation"), coordinatorGeneration: runtime.getInt("generation") };
    }
    function start(attempt, p, auth) {
      if (!auth || unauthorizable(auth, p)) fail("conflict", 409);
      // Persist the possibly-started boundary before acknowledging. A lost reply
      // cannot grant a second start; subsequent outcome reporting stays allowed.
      // Outcome authority is per-attempt and survives expiry/stops/restarts until lifecycle purge.
      set(auth, { started_at: iso, report_until: "" }); app.save(auth);
      const printAttempt = find(app, "checkin_agent_attempts", "id = {:id}", { id: attempt.id });
      if (printAttempt && printAttempt.getString("print_attempt_id")) {
        const print = app.findRecordById("checkin_print_attempts", printAttempt.getString("print_attempt_id"));
        if (print.getString("state") !== "queued") fail("conflict", 409);
        print.set("state", "dispatched"); app.save(print);
      }
      return { attemptId: attempt.id, started: true, reportUntil: auth.getString("report_until") };
    }
    function authorization(agent, station, p) {
      const attempt = find(app, "checkin_agent_attempts", "id = {:id} && agent_id = {:agent} && station = {:station}", { id: p.attemptId || "", agent: agent.id, station: station.id });
      if (!attempt || attempt.getString("payload_hash") !== p.payloadHash || attempt.getString("profile_id") !== agent.getString("profile_id") || !currentGenerations(attempt, station)) fail("conflict", 409);
      if (attempt.getString("print_attempt_id")) assertPrintable(attempt);
      const auth = find(app, "checkin_agent_authorizations", "attempt_id = {:id}", { id: attempt.id });
      if (b.operation === "machine_authorize") return authorize(attempt, agent, station, p, auth);
      if (b.operation === "machine_start") return start(attempt, p, auth);
      fail("invalid_input");
    }
    function liveAgentCommand(agent, station, p) {
      if (agent.getBool("revoked") || now >= Date.parse(agent.getString("expires_at")) || latest(station.id).id !== agent.id) fail("forbidden", 403);
      if (b.operation === "machine_heartbeat") return heartbeat(agent, station, p);
      if (!dto(station, agent).readyForAuthorization) fail("conflict", 409);
      const work = { machine_work: listWork, machine_ack: ack };
      return has(work, b.operation) ? work[b.operation](agent, station, p) : authorization(agent, station, p);
    }
    function credentialAgent() {
      const agent = hash(b.credentialHash) && find(app, "checkin_agents", "credential_hash = {:hash}", { hash: b.credentialHash });
      if (!agent) fail("forbidden", 403);
      const station = app.findRecordById("checkin_stations", agent.getString("station"));
      const p = b.payload || {};
      if (p.stationId !== station.id) fail("forbidden", 403);
      return { agent, station, p };
    }
    function agentCommand() {
      const credential = credentialAgent();
      const reporting = { machine_cancellations: cancellations, machine_neutralized: neutralized, machine_outcome: outcome };
      const handler = has(reporting, b.operation) ? reporting[b.operation] : liveAgentCommand;
      return handler(credential.agent, credential.station, credential.p);
    }
    const observers = { machine_monitoring_readiness: () => ({ stations: stationViews() }), machine_coordinator_status: coordinatorStatus };
    if (has(observers, b.operation)) { result = observers[b.operation](); return; }
    if (!machine) { result = humanCommand(); return; }
    const unleased = { machine_acquire: acquire, machine_status: machineStatus };
    if (has(unleased, b.operation)) { result = unleased[b.operation](); return; }
    assertAuthority();
    const leased = { machine_pulse: pulse, machine_release: release, machine_print_claim: printClaim, machine_prepare: prepare };
    result = has(leased, b.operation) ? leased[b.operation]() : agentCommand();
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
