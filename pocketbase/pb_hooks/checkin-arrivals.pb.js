/// <reference path="../pb_data/types.d.ts" />
// Privileged storage command seam only. No admission/print producer exists here.
routerAdd("POST", "/api/wts/checkin-arrivals", (e) => {
  const b = e.requestInfo().body;
  function fail(code, status = 400) { throw new ApiError(status, "Arrival request rejected.", { code: new ValidationError(code, "Arrival request rejected.") }); }
  function find(app, name, filter, params, sort = "") { const rows = app.findRecordsByFilter(name, filter, sort, 1, 0, params || {}); return rows.length ? rows[0] : null; }
  function set(record, values) { for (const key in values) record.set(key, values[key]); }
  function canonical(v) { if (v === null || typeof v !== "object") return JSON.stringify(v); if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]"; return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}"; }
  function json(r, field) { return JSON.parse(r.getString(field) || "null"); }
  function hash(v) { return typeof v === "string" && /^[a-f0-9]{64}$/.test(v); }
  function uuid(v) { return typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v); }
  function upstream(v) { return typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v) && Number.isSafeInteger(Number(v)); }
  function safeText(v, max, required) { return typeof v === "string" && v.length <= max && (!required || !!v.trim()) && !/[\x00-\x1f\x7f<>@]|:\/\/|www\.|[a-f0-9]{64}|wts_mcp_|bearer\s|password|secret|token\s*[:=]|\/dev\//i.test(v); }
  let result;
  e.app.runInTransaction((app) => {
    const machine = typeof b.operation === "string" && b.operation.startsWith("machine_");
    const actor = machine ? null : typeof b.actorUserId === "string" && find(app, "users", "id = {:id}", { id: b.actorUserId });
    if (!machine && (!actor || !actor.getBool("verified") || !["admin", "checkin_operator"].includes(actor.getString("role")))) fail("forbidden", 403);
    const allHistory = b.operation === "history" && b.query && b.query.scope === "all";
    if (allHistory && actor.getString("role") !== "admin") fail("forbidden", 403);
    const binding = hash(b.identityHash) && find(app, "checkin_bindings", "identity_hash = {:hash}", { hash: b.identityHash });
    if (!machine && !binding && !allHistory) fail("invalid_binding", 403);
    if (!machine && binding && binding.getBool("revoked")) fail("revoked_binding", 403);
    const station = binding ? app.findRecordById("checkin_stations", binding.getString("station")) : null;
    const system = app.findRecordById("checkin_system", "wts2026system00");
    const now = machine && Number.isSafeInteger(b.nowMs) ? b.nowMs : Date.now(); const iso = new Date(now).toISOString();
    function localDay(time) {
      const year = new Date(time).getUTCFullYear();
      const march = new Date(Date.UTC(year, 2, 31, 1)); march.setUTCDate(31 - march.getUTCDay());
      const october = new Date(Date.UTC(year, 9, 31, 1)); october.setUTCDate(31 - october.getUTCDay());
      return new Date(time + (time >= march.getTime() && time < october.getTime() ? 2 : 1) * 3600000).toISOString().slice(0, 10);
    }
    function workflowDTO(w) { return { id: w.id, stationId: w.getString("station_id"), eventId: w.getString("event_id"), eventTitle: w.getString("event_title"), state: w.getString("state"), name: w.getString("name"), affiliation: w.getString("affiliation"), profileId: w.getString("profile_id"), createdAt: w.getString("created") }; }
    if (machine) {
      const runtime = app.findRecordById("checkin_coordinator", "wts2026coord000");
      if (!hash(b.owner) || runtime.getString("owner") !== b.owner) fail("forbidden", 403);
      const seen = Date.parse(runtime.getString("last_seen_at"));
      if (!Number.isFinite(seen) || now - seen < 0 || now - seen >= runtime.getInt("heartbeat_timeout_ms")) fail("unavailable", 503);
      function currentAgent(stationId) { return find(app, "checkin_agents", "station = {:station}", { station: stationId }, "-revision"); }
      function ready(station, agent) {
        if (!system.getBool("enabled") || !station.getBool("enabled") || !agent || agent.getBool("revoked") || agent.getBool("quarantined")) return false;
        const heartbeat = Date.parse(agent.getString("last_heartbeat_at"));
        if (!Number.isFinite(heartbeat) || now - heartbeat < 0 || now - heartbeat >= runtime.getInt("heartbeat_timeout_ms")) return false;
        if (!Date.parse(agent.getString("expires_at")) || Date.parse(agent.getString("expires_at")) <= now || agent.getString("compatibility") !== "compatible") return false;
        const profile = find(app, "checkin_label_profiles", "station = {:station}", { station: station.id }, "-version");
        const approval = profile && find(app, "checkin_label_approvals", "profile = {:profile}", { profile: profile.id });
        if (!profile || profile.id !== agent.getString("profile_id") || profile.id !== agent.getString("reported_profile") || profile.getInt("station_version") !== (station.getInt("profile_config_version") || station.getInt("version")) || !approval || approval.getInt("station_version") !== (station.getInt("profile_config_version") || station.getInt("version"))) return false;
        const config = json(profile, "config");
        if (!config || config.synthetic || config.printerRef !== station.getString("printer_ref") || config.printerRef !== agent.getString("printer_identity")) return false;
        return true;
      }
      function admissionAudit(command, workflow, operation, state) {
        const human = find(app, "users", "id = {:id}", { id: command.getString("actor_user_id") });
        if (!human || !human.getBool("verified") || !["admin", "checkin_operator"].includes(human.getString("role"))) fail("forbidden", 403);
        const audit = new Record(app.findCollectionByNameOrId("checkin_audit_events"));
        const name = human.getString("name").trim();
        set(audit, { actor_user_id: human.id, actor_name: safeText(name, 200, true) ? name.slice(0, 80) : "Authorized User", actor_role: human.getString("role"), operation, station_id: command.getString("station_id"), binding_id: json(command, "context").bindingId || "", event_id: command.getString("event_id"), arrival_command_id: command.id, workflow_id: workflow.id, outcome: "applied", state: { state } });
        app.save(audit);
      }
      function markUncertain(attempt) {
        if (attempt.getString("state") !== "possibly_sent") return;
        const workflow = app.findRecordById("checkin_arrival_workflows", attempt.getString("workflow_id"));
        const command = app.findRecordById("checkin_arrival_commands", attempt.getString("command_id"));
        set(attempt, { state: "uncertain" }); set(workflow, { state: "admission_uncertain" });
        app.save(attempt);
        set(command, { result: { state: "admission_uncertain", workflow: workflowDTO(workflow) }, completed_at: "", completed_day: "", workflow_id: workflow.id, admission_attempt_id: attempt.id, history_visible: true });
        app.save(command); admissionAudit(command, workflow, "admission_result", "admission_uncertain");
      }
      if (b.operation === "machine_admission_reconcile") {
        for (const attempt of app.findRecordsByFilter("checkin_arrival_attempts", "state = 'possibly_sent'", "created,id", 100, 0)) markUncertain(attempt);
        result = { reconciled: true }; return;
      }
      if (b.operation === "machine_admission_claim") {
        const candidates = app.findRecordsByFilter("checkin_arrival_workflows", "state = 'not_submitted'", "created,id", 100, 0);
        for (const workflow of candidates) {
          const station = app.findRecordById("checkin_stations", workflow.getString("station_id"));
          const agent = currentAgent(station.id);
          if (!ready(station, agent)) continue;
          const command = find(app, "checkin_arrival_commands", "operation_id = {:operation}", { operation: workflow.getString("operation_id") });
          if (!command || command.getString("status") !== "final") continue;
          const existingAttempt = find(app, "checkin_arrival_attempts", "workflow_id = {:workflow}", { workflow: workflow.id });
          if (existingAttempt) {
            const retryAt = Date.parse(existingAttempt.getString("next_retry_at"));
            if (existingAttempt.getString("state") === "pre_send_failed" && (existingAttempt.getInt("pre_send_failures") >= 3 || Number.isFinite(retryAt) && now < retryAt)) continue;
            if (existingAttempt.getString("state") !== "pre_send_failed" && !(existingAttempt.getString("state") === "claimed" && existingAttempt.getInt("coordinator_generation") !== runtime.getInt("generation"))) continue;
          }
          const attempt = existingAttempt || new Record(app.findCollectionByNameOrId("checkin_arrival_attempts"));
          set(attempt, { workflow_id: workflow.id, command_id: command.id, station_id: station.id, upstream_event_id: workflow.getString("upstream_event_id"), upstream_attendee_id: workflow.getString("upstream_attendee_id"), list_id: workflow.getString("list_id"), source_key: workflow.getString("source_key"), station_generation: station.getInt("generation"), system_generation: system.getInt("generation"), coordinator_generation: runtime.getInt("generation"), state: "claimed", send_boundary_at: "", completed_at: "", result_fingerprint: "", next_retry_at: "" });
          app.save(attempt);
          set(workflow, { admission_attempt_id: attempt.id }); app.save(workflow);
          set(command, { admission_attempt_id: attempt.id }); app.save(command);
          admissionAudit(command, workflow, "admission_claim", "claimed");
          result = { job: { attemptId: attempt.id, workflowId: workflow.id, commandId: command.id, stationId: station.id, eventId: workflow.getString("event_id"), sourceKey: workflow.getString("source_key"), upstreamEventId: workflow.getString("upstream_event_id"), upstreamAttendeeId: workflow.getString("upstream_attendee_id"), upstreamListId: workflow.getString("list_id"), context: json(workflow, "context"), affiliation: json(workflow, "affiliation_mapping"), coordinatorGeneration: runtime.getInt("generation") } };
          return;
        }
        result = { job: null }; return;
      }
      if (b.operation === "machine_admission_release") {
        if (!/^[a-z0-9]{15}$/.test(b.attemptId)) fail("invalid_input");
        const attempt = app.findRecordById("checkin_arrival_attempts", b.attemptId);
        const workflow = app.findRecordById("checkin_arrival_workflows", attempt.getString("workflow_id"));
        const command = app.findRecordById("checkin_arrival_commands", attempt.getString("command_id"));
        if (attempt.getString("state") !== "claimed" || workflow.getString("state") !== "not_submitted" || attempt.getInt("coordinator_generation") !== runtime.getInt("generation")) fail("conflict", 409);
        const failures = attempt.getInt("pre_send_failures") + 1;
        const delay = Math.min(60000, 1000 * 2 ** Math.min(failures - 1, 6));
        set(attempt, { state: "pre_send_failed", completed_at: iso, pre_send_failures: failures, next_retry_at: failures < 3 ? new Date(now + delay).toISOString() : "" }); app.save(attempt);
        admissionAudit(command, workflow, "admission_result", "pre_send_failed");
        result = { released: true }; return;
      }
      if (b.operation === "machine_admission_fence") {
        if (!/^[a-z0-9]{15}$/.test(b.attemptId) || !Number.isSafeInteger(b.coordinatorGeneration)) fail("invalid_input");
        const attempt = app.findRecordById("checkin_arrival_attempts", b.attemptId);
        const workflow = app.findRecordById("checkin_arrival_workflows", attempt.getString("workflow_id"));
        const station = app.findRecordById("checkin_stations", attempt.getString("station_id"));
        if (attempt.getString("state") !== "claimed" || workflow.getString("state") !== "not_submitted" || attempt.getInt("coordinator_generation") !== b.coordinatorGeneration || attempt.getInt("coordinator_generation") !== runtime.getInt("generation") || attempt.getInt("station_generation") !== station.getInt("generation") || attempt.getInt("system_generation") !== system.getInt("generation")) fail("conflict", 409);
        const agent = currentAgent(station.id);
        if (!ready(station, agent)) fail("unavailable", 503);
        set(attempt, { state: "possibly_sent", send_boundary_at: iso }); app.save(attempt);
        set(workflow, { state: "admission_pending" }); app.save(workflow);
        admissionAudit(app.findRecordById("checkin_arrival_commands", attempt.getString("command_id")), workflow, "admission_claim", "possibly_sent");
        result = { valid: true }; return;
      }
      if (b.operation === "machine_admission_result") {
        if (!/^[a-z0-9]{15}$/.test(b.attemptId)) fail("invalid_input");
        const attempt = app.findRecordById("checkin_arrival_attempts", b.attemptId);
        const workflow = app.findRecordById("checkin_arrival_workflows", attempt.getString("workflow_id"));
        const command = app.findRecordById("checkin_arrival_commands", attempt.getString("command_id"));
        const outcome = b.outcome;
        const claimedRejection = attempt.getString("state") === "claimed" && outcome?.state === "rejected";
        if ((!claimedRejection && attempt.getString("state") !== "possibly_sent") || workflow.getString("state") !== (claimedRejection ? "not_submitted" : "admission_pending") || workflow.getString("admission_attempt_id") !== attempt.id || attempt.getInt("coordinator_generation") !== runtime.getInt("generation") || attempt.getInt("station_generation") !== app.findRecordById("checkin_stations", attempt.getString("station_id")).getInt("generation") || attempt.getInt("system_generation") !== system.getInt("generation")) fail("conflict", 409);
        if (!outcome || typeof outcome !== "object" || Array.isArray(outcome) || !["newly_checked_in", "existing_unattributed", "rejected", "uncertain"].includes(outcome.state)) fail("invalid_input");
        let decision;
        if (outcome.state === "newly_checked_in" || outcome.state === "existing_unattributed") {
          if (!hash(outcome.fingerprint)) fail("invalid_input");
          const state = outcome.state === "newly_checked_in" ? "accepted" : "existing_unattributed";
          set(attempt, { state: outcome.state === "newly_checked_in" ? "accepted" : "existing_unattributed", completed_at: iso, result_fingerprint: outcome.fingerprint });
          set(workflow, { state, admission_completed_at: iso, admission_completed_day: localDay(now) });
          if (state === "accepted") {
            const print = new Record(app.findCollectionByNameOrId("checkin_print_attempts"));
            const profileConfig = json(workflow, "profile_config");
            const payloadHash = $security.sha256(canonical({ profileId: workflow.getString("profile_id"), profileConfig, name: workflow.getString("name"), affiliation: workflow.getString("affiliation") }));
            set(print, { workflow_id: workflow.id, station_id: workflow.getString("station_id"), purpose: "initial", state: "queued", profile_id: workflow.getString("profile_id"), profile_config: profileConfig, name: workflow.getString("name"), affiliation: workflow.getString("affiliation"), payload_hash: payloadHash, predecessor_attempt_id: "" });
            app.save(print);
            set(workflow, { print_intent_id: print.id });
            decision = { state: "accepted", workflow: workflowDTO(workflow), printIntentId: print.id };
          } else decision = { state, workflow: workflowDTO(workflow) };
        } else if (outcome.state === "rejected") {
          if (!["not_in_list", "cancelled", "awaiting_payment", "unknown_eligibility"].includes(outcome.reason)) fail("invalid_input");
          set(attempt, { state: "rejected", completed_at: iso }); set(workflow, { state: "rejected", admission_completed_at: iso, admission_completed_day: localDay(now) });
          decision = { state: "rejected", reason: outcome.reason };
        } else {
          set(attempt, { state: "uncertain" }); set(workflow, { state: "admission_uncertain" });
          decision = { state: "admission_uncertain", workflow: workflowDTO(workflow) };
        }
        app.save(attempt); app.save(workflow);
        set(command, { result: decision, completed_at: decision.state === "admission_uncertain" || decision.state === "existing_unattributed" ? "" : iso, completed_day: decision.state === "admission_uncertain" || decision.state === "existing_unattributed" ? "" : localDay(now), workflow_id: workflow.id, admission_attempt_id: attempt.id, history_visible: true });
        app.save(command); admissionAudit(command, workflow, "admission_result", decision.state);
        result = { attemptId: attempt.id, state: decision.state }; return;
      }
      fail("invalid_input");
    }
    if (!machine && b.operation === "admission_retry") {
      if (!binding || !station || !/^[a-z0-9]{15}$/.test(b.attemptId)) fail("invalid_input");
      const attempt = app.findRecordById("checkin_arrival_attempts", b.attemptId);
      const workflow = app.findRecordById("checkin_arrival_workflows", attempt.getString("workflow_id"));
      const command = app.findRecordById("checkin_arrival_commands", attempt.getString("command_id"));
      if (attempt.getString("state") !== "pre_send_failed" || workflow.getString("state") !== "not_submitted" || workflow.getString("station_id") !== station.id || attempt.getInt("pre_send_failures") < 3) fail("conflict", 409);
      set(attempt, { pre_send_failures: 0, next_retry_at: "" }); app.save(attempt);
      const audit = new Record(app.findCollectionByNameOrId("checkin_audit_events"));
      const name = actor.getString("name").trim();
      set(audit, { actor_user_id: actor.id, actor_name: safeText(name, 200, true) ? name.slice(0, 80) : "Authorized User", actor_role: actor.getString("role"), operation: "admission_result", station_id: station.id, binding_id: binding.id, event_id: command.getString("event_id"), arrival_command_id: command.id, workflow_id: workflow.id, outcome: "applied", state: { state: "retry_requested" } }); app.save(audit);
      result = { retry: true }; return;
    }
    function decision(command, all = false) {
      if (!all && command.getString("station_id") !== station.id) return { state: "already_handled" };
      return json(command, "result") || { state: "dependency_unavailable" };
    }
    function envelope(command, replayed) { return Object.assign(decision(command), { operationId: command.getString("operation_id"), replayed, operationsEnabled: false }); }
    if (b.operation === "history") {
      const q = b.query;
      if (!q || !["station", "all"].includes(q.scope) || !Number.isInteger(q.limit) || q.limit < 1 || q.limit > 100 || typeof b.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) fail("invalid_input");
      if (q.scope === "all" && actor.getString("role") !== "admin") fail("forbidden", 403);
      let filter = "history_visible = true && (completed_at = '' || completed_day = {:day})";
      const params = { day: b.day, station: station ? station.id : "" };
      if (q.scope === "station") filter += " && station_id = {:station}";
      if (q.cursor) {
        if (typeof q.cursor !== "string" || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?\|[a-z0-9]{15}$/.test(q.cursor)) fail("invalid_input");
        const parts = q.cursor.split("|"); params.created = parts[0]; params.id = parts[1];
        filter += " && (created > {:created} || (created = {:created} && id > {:id}))";
      }
      // Project resolution from append-only continuation/audit evidence. Never
      // rewrite a failed command, its replay result, or its original ownership.
      const eligible = []; let offset = 0;
      while (eligible.length <= q.limit) {
        const rows = app.findRecordsByFilter("checkin_arrival_commands", filter, "created,id", 100, offset, params);
        for (const c of rows) {
          const entry = { id: c.id, operationId: c.getString("operation_id"), stationId: c.getString("station_id"), eventId: c.getString("event_id"), createdAt: c.getString("created"), completedAt: c.getString("completed_at") || null, result: decision(c, q.scope === "all") };
          if (["needs_affiliation_choice", "dependency_unavailable"].includes(entry.result.state)) {
            const projection = new DynamicModel({ resolution: "" });
            app.db().newQuery(`WITH RECURSIVE descendants AS (
              SELECT id, operation_id, prior_operation_id, status, result FROM checkin_arrival_commands WHERE prior_operation_id = {:operation}
              UNION
              SELECT c.id, c.operation_id, c.prior_operation_id, c.status, c.result FROM checkin_arrival_commands c JOIN descendants d ON c.prior_operation_id = d.operation_id
            ) SELECT COALESCE((SELECT json_object('operationId', d.operation_id, 'completedAt', a.created)
              FROM descendants d JOIN checkin_audit_events a ON a.arrival_command_id = d.id AND a.operation = 'arrival_result'
              WHERE d.status = 'final' AND json_extract(d.result, '$.state') IN ('reserved', 'existing', 'already_handled', 'rejected')
              ORDER BY a.created, a.id LIMIT 1), 'null') AS resolution`).bind({ operation: entry.operationId }).one(projection);
            const resolved = JSON.parse(projection.resolution);
            if (resolved) {
              if (localDay(Date.parse(resolved.completedAt)) !== b.day) continue;
              entry.completedAt = resolved.completedAt;
              entry.resolvedByOperationId = resolved.operationId;
            }
          }
          eligible.push(entry);
          if (eligible.length > q.limit) break;
        }
        if (rows.length < 100) break;
        offset += rows.length;
      }
      // Filter before limiting: older resolved exceptions must not starve work.
      const page = eligible.slice(0, q.limit); const last = page[page.length - 1];
      result = { day: b.day, operationsEnabled: false, nextCursor: eligible.length > q.limit ? last.createdAt + "|" + last.id : null, items: page }; return;
    }
    if (!["begin", "fence", "finish"].includes(b.operation) || !hash(b.sourceKey)) fail("invalid_input");
    const c = b.command;
    const fields = ["operationId", "context", "affiliationChoice", "priorOperationId", "qrHash"];
    if (!c || Object.keys(c).length !== fields.length || fields.some((k) => !Object.prototype.hasOwnProperty.call(c, k)) || !uuid(c.operationId) || !hash(c.qrHash) || !["fetch", "blank"].includes(c.affiliationChoice) || !(c.priorOperationId === "" || uuid(c.priorOperationId))) fail("invalid_input");
    const fingerprint = $security.sha256(canonical({ command: c, sourceKey: b.sourceKey }));
    let command = find(app, "checkin_arrival_commands", "operation_id = {:id}", { id: c.operationId });
    if (command) {
      if (command.getString("payload_hash") !== fingerprint) fail("conflict", 409);
      if (command.getString("status") === "final") { result = b.operation === "begin" ? { result: envelope(command, true) } : envelope(command, true); return; }
    }
    const event = find(app, "checkin_events", "id = {:id}", { id: c.context && c.context.eventId || "" });
    const currentContext = event && { protocolVersion: 1, edition: "WTS2026", eventId: event.id, eventGeneration: event.getInt("generation"), bindingId: binding.id, bindingVersion: binding.getInt("version"), selectionVersion: binding.getInt("selection_version"), stationId: station.id, stationGeneration: station.getInt("generation"), systemGeneration: system.getInt("generation") };
    if (!event || canonical(c.context) !== canonical(currentContext) || binding.getString("selected_event") !== event.id || binding.getInt("selected_event_generation") !== event.getInt("generation") || binding.getInt("selected_binding_version") !== binding.getInt("version")) fail("conflict", 409);
    if (!system.getBool("enabled") || !station.getBool("enabled") || !event.getBool("member") || !event.getBool("enabled") || !event.getString("list_id")) fail("disabled", 409);
    if (event.getString("edition") !== "WTS2026" || event.getString("source_key") !== b.sourceKey || find(app, "checkin_events", "edition = 'WTS2026' && source_key != {:key}", { key: b.sourceKey })) fail("unavailable", 503);
    if (c.priorOperationId) {
      const prior = find(app, "checkin_arrival_commands", "operation_id = {:id}", { id: c.priorOperationId });
      if (!prior || prior.getString("status") !== "final" || prior.getString("qr_hash") !== c.qrHash || prior.getString("source_key") !== b.sourceKey || canonical(json(prior, "context")) !== canonical(c.context) || !["needs_affiliation_choice", "dependency_unavailable"].includes((json(prior, "result") || {}).state) || (c.affiliationChoice === "blank" && json(prior, "result").state !== "needs_affiliation_choice")) fail("conflict", 409);
    } else if (c.affiliationChoice === "blank") fail("invalid_input");
    function audit(operation, state) {
      const a = new Record(app.findCollectionByNameOrId("checkin_audit_events"));
      const name = actor.getString("name");
      set(a, { actor_user_id: actor.id, actor_name: safeText(name, 200, true) ? name.trim().slice(0, 80) : "Authorized User", actor_role: actor.getString("role"), operation, station_id: station.id, binding_id: binding.id, event_id: event.id, arrival_command_id: command.id, workflow_id: command.getString("workflow_id"), outcome: "applied", state: { state } }); app.save(a);
    }
    if (!command) {
      if (b.operation !== "begin") fail("conflict", 409);
      command = new Record(app.findCollectionByNameOrId("checkin_arrival_commands"));
      set(command, { operation_id: c.operationId, payload_hash: fingerprint, qr_hash: c.qrHash, context: c.context, source_key: b.sourceKey, affiliation_choice: c.affiliationChoice, prior_operation_id: c.priorOperationId, actor_user_id: actor.id, station_id: station.id, event_id: event.id, status: "pending", history_visible: true }); app.save(command);
      audit("arrival_begin", "pending");
      command = app.findRecordById("checkin_arrival_commands", command.id);
    }
    function finish(value, workflow) {
      set(command, { status: "final", result: value, workflow_id: workflow ? workflow.id : "", history_visible: !["existing", "already_handled"].includes(value.state) });
      if (value.state === "rejected") {
        set(command, { completed_at: iso, completed_day: localDay(now) });
      }
      app.save(command); audit("arrival_result", value.state);
      result = b.operation === "begin" ? { result: envelope(command, false) } : envelope(command, false);
    }
    if (b.operation === "fence") { result = { valid: true }; return; }
    function readiness() {
      const runtime = app.findRecordById("checkin_coordinator", "wts2026coord000");
      const agent = find(app, "checkin_agents", "station = {:id}", { id: station.id }, "-revision");
      const fresh = (value) => { const time = Date.parse(value); return Number.isFinite(time) && now >= time && now - time < runtime.getInt("heartbeat_timeout_ms"); };
      if (!fresh(runtime.getString("last_seen_at")) || !agent || agent.getBool("revoked") || agent.getBool("quarantined") || !(Date.parse(agent.getString("expires_at")) > now) || !fresh(agent.getString("last_heartbeat_at")) || agent.getString("compatibility") !== "compatible") return null;
      const profile = find(app, "checkin_label_profiles", "station = {:id}", { id: station.id }, "-version");
      if (!profile || profile.id !== agent.getString("profile_id") || profile.id !== agent.getString("reported_profile")) return null;
      const config = json(profile, "config"); const pv = station.getInt("profile_config_version") || station.getInt("version");
      const approval = find(app, "checkin_label_approvals", "profile = {:id}", { id: profile.id });
      if (!config || config.synthetic || config.printerRef !== station.getString("printer_ref") || config.printerRef !== agent.getString("printer_identity") || profile.getInt("station_version") !== pv || !approval || approval.getInt("station_version") !== pv) return null;
      const unresolved = new DynamicModel({ present: 0 });
      app.db().newQuery("SELECT EXISTS (SELECT 1 FROM checkin_agent_authorizations a JOIN checkin_agents g ON g.id = a.agent_id WHERE g.station = {:station} AND a.started_at != '' AND a.outcome != 'protocol_complete') AS present").bind({ station: station.id }).one(unresolved);
      if (unresolved.present) return null;
      return { profile, fence: { agentId: agent.id, profileId: profile.id, coordinatorGeneration: runtime.getInt("generation") } };
    }
    // Reopening immutable work needs authority, not live upstream/printer reads.
    const priorResolved = find(app, "checkin_arrival_commands", "source_key = {:source} && event_id = {:event} && qr_hash = {:qr} && workflow_id != ''", { source: b.sourceKey, event: event.id, qr: c.qrHash });
    if (priorResolved) {
      const existing = app.findRecordById("checkin_arrival_workflows", priorResolved.getString("workflow_id"));
      if (existing.getString("edition") !== "WTS2026" || existing.getString("upstream_event_id") !== event.getString("upstream_event_id") || existing.getString("source_key") !== b.sourceKey) fail("conflict", 409);
      if (existing.getString("station_id") !== station.id) { finish({ state: "already_handled" }, existing); return; }
      const previous = json(priorResolved, "result");
      if (previous && ["accepted", "admission_pending", "admission_uncertain", "existing_unattributed", "rejected"].includes(previous.state)) {
        finish({ ...previous, workflow: workflowDTO(existing) }, existing); return;
      }
      finish({ state: "existing", workflow: workflowDTO(existing) }, existing); return;
    }
    const ready = readiness();
    if (b.operation === "begin") {
      if (b.invalidIdentity === true) { finish({ state: "rejected", reason: "invalid_identity" }); return; }
      if (!ready) { finish({ state: "dependency_unavailable" }); return; }
      result = { snapshot: { context: currentContext, sourceKey: b.sourceKey, upstreamEventId: event.getString("upstream_event_id"), upstreamListId: event.getString("list_id"), affiliation: json(event, "affiliation"), actor: { userId: actor.id, role: actor.getString("role") } }, readiness: ready.fence }; return;
    }
    if (!ready || canonical(b.readiness) !== canonical(ready.fence)) { finish({ state: "dependency_unavailable" }); return; }
    const r = b.resolution;
    if (!r || !["eligible", "rejected", "unavailable"].includes(r.state)) fail("invalid_input");
    if (r.state === "unavailable") { finish({ state: "dependency_unavailable" }); return; }
    if (r.state === "rejected") { if (!["invalid_identity", "not_in_list", "cancelled", "awaiting_payment", "unknown_eligibility"].includes(r.reason)) fail("invalid_input"); finish({ state: "rejected", reason: r.reason }); return; }
    const attendee = r.attendee;
    if (!attendee || !upstream(attendee.upstreamAttendeeId) || !upstream(attendee.productId) || !safeText(attendee.name, 200, true) || typeof attendee.alreadyCheckedIn !== "boolean") { finish({ state: "rejected", reason: "unknown_eligibility" }); return; }
    // The stable workflow wins over a subsequent read's already-checked-in flag.
    const existing = find(app, "checkin_arrival_workflows", "edition = 'WTS2026' && upstream_event_id = {:event} && upstream_attendee_id = {:attendee}", { event: event.getString("upstream_event_id"), attendee: attendee.upstreamAttendeeId });
    if (existing) { finish(existing.getString("station_id") === station.id ? { state: "existing", workflow: workflowDTO(existing) } : { state: "already_handled" }, existing); return; }
    if (attendee.alreadyCheckedIn) { finish({ state: "rejected", reason: "already_checked_in" }); return; }
    const affiliation = b.affiliation;
    if (!affiliation || !["present", "missing", "unavailable"].includes(affiliation.state)) fail("invalid_input");
    if (c.affiliationChoice === "fetch" && affiliation.state === "unavailable") { finish({ state: "needs_affiliation_choice" }); return; }
    const text = c.affiliationChoice === "blank" || affiliation.state === "missing" ? "" : affiliation.text;
    if (!safeText(text, 200, false)) { finish({ state: "needs_affiliation_choice" }); return; }
    const w = new Record(app.findCollectionByNameOrId("checkin_arrival_workflows"));
    set(w, { edition: "WTS2026", upstream_event_id: event.getString("upstream_event_id"), upstream_attendee_id: attendee.upstreamAttendeeId, station_id: station.id, event_id: event.id, event_title: event.getString("title"), list_id: event.getString("list_id"), context: currentContext, source_key: b.sourceKey, profile_id: ready.profile.id, profile_config: json(ready.profile, "config"), affiliation_mapping: json(event, "affiliation"), name: attendee.name, affiliation: text, state: "not_submitted", operation_id: c.operationId }); app.save(w);
    finish({ state: "reserved", workflow: workflowDTO(w) }, w);
  });
  return e.json(200, result);
}, $apis.requireSuperuserAuth());

onRecordCreateRequest(() => { throw new ForbiddenError("Use arrival commands."); }, "checkin_arrival_commands", "checkin_arrival_workflows");
onRecordUpdateRequest(() => { throw new ForbiddenError("Use arrival commands."); }, "checkin_arrival_commands", "checkin_arrival_workflows");
onRecordUpdate((e) => {
  const original = e.record.original();
  const identity = ["operation_id", "payload_hash", "qr_hash", "context", "source_key", "affiliation_choice", "prior_operation_id", "actor_user_id", "station_id", "event_id", "created"];
  for (const field of identity) if (e.record.getString(field) !== original.getString(field)) throw new ForbiddenError("Arrival command identity is immutable.");
  if (original.getString("status") === "pending" && e.record.getString("status") === "final") return e.next();
  if (original.getString("status") === "final" && e.record.getString("status") === "final") {
    for (const field of ["payload_hash", "qr_hash", "context", "source_key", "affiliation_choice", "prior_operation_id", "actor_user_id", "station_id", "event_id"]) if (e.record.getString(field) !== original.getString(field)) throw new ForbiddenError("Arrival command identity is immutable.");
    return e.next();
  }
  throw new ForbiddenError("Arrival command results are immutable.");
}, "checkin_arrival_commands");
onRecordUpdate((e) => {
  const original = e.record.original();
  const allowed = (original.getString("state") === "not_submitted" && ["not_submitted", "admission_pending", "rejected"].includes(e.record.getString("state")))
    || (original.getString("state") === "admission_pending" && ["accepted", "existing_unattributed", "rejected", "admission_uncertain"].includes(e.record.getString("state")));
  if (!allowed) throw new ForbiddenError("Reserved workflow snapshots are immutable.");
  for (const field of ["edition", "upstream_event_id", "upstream_attendee_id", "station_id", "event_id", "event_title", "list_id", "context", "source_key", "profile_id", "profile_config", "affiliation_mapping", "name", "affiliation", "operation_id", "created"]) if (e.record.getString(field) !== original.getString(field)) throw new ForbiddenError("Reserved workflow snapshots are immutable.");
  e.next();
}, "checkin_arrival_workflows");
onRecordDelete(() => { throw new ForbiddenError("Arrival history requires an explicit lifecycle migration."); }, "checkin_arrival_commands", "checkin_arrival_workflows");
