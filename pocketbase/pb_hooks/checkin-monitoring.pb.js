/// <reference path="../pb_data/types.d.ts" />
// Monitoring is an observer. This route never writes admission, output, or readiness.
routerAdd("POST", "/api/wts/checkin-monitoring", (e) => {
  const b = e.requestInfo().body;
  const machine = typeof b.operation === "string" && b.operation.startsWith("machine_");
  let now = machine && Number.isSafeInteger(b.nowMs) && b.nowMs > 0 ? b.nowMs : Date.now();
  const stations = ["wts2026station1", "wts2026station2", "wts2026station3"];
  function fail(code, status = 400) { throw new ApiError(status, "Monitoring request rejected.", { code: new ValidationError(code, "Monitoring request rejected.") }); }
  function set(r, values) { for (const k in values) r.set(k, values[k]); }
  function rows(app, name, filter = "", params = {}, sort = "id", limit = 100, offset = 0) { return app.findRecordsByFilter(name, filter, sort, limit, offset, params); }
  // Bounded keyset traversal preserves every active scope, even as filters change.
  function each(app, name, filter, visit, params = {}) {
    let after = "";
    while (true) {
      const page = rows(app, name, "(" + filter + ") && id > {:after}", { ...params, after });
      for (const r of page) visit(r);
      if (page.length < 100) return;
      after = page[page.length - 1].id;
    }
  }
  function find(app, name, filter, params = {}) { const a = app.findRecordsByFilter(name, filter, "", 1, 0, params); return a.length ? a[0] : null; }
  function json(r, field) { return JSON.parse(r.getString(field) || "null"); }
  function create(app, name, values) { const r = new Record(app.findCollectionByNameOrId(name)); set(r, values); app.save(r); return r; }
  function audit(app, category, incidentId = "", deliveryId = "", actorId = "") { create(app, "checkin_monitoring_audit", { category, incident_id: incidentId, delivery_id: deliveryId, actor_user_id: actorId, at_ms: now }); }
  function recipients(app, ids) {
    return (ids || []).map((id) => find(app, "users", "id = {:id} && role = 'admin' && verified = true", { id })).filter((r) => r && r.getString("email"));
  }
  function enqueue(app, incident, kind) {
    const sequence = incident.getInt("sequence") + 1;
    create(app, "checkin_monitoring_deliveries", { incident_id: incident.id, sequence, kind, state: "pending", created_ms: now, recipient_user_ids: [] });
    incident.set("sequence", sequence); app.save(incident);
  }
  // Pure allowlisted formatter shared by the envelope and actual PB mailer.
  function formatMail(incident, delivery) {
    return {
      subject: "WTS check-in: " + delivery.getString("kind") + " / " + incident.getString("category"),
      text: ["WTS2026", "Incident: " + incident.id, "Category: " + incident.getString("category"), "Notification: " + delivery.getString("kind"), "Station: " + incident.getString("station_id"), "Workflow: " + (incident.getString("workflow_id") || "none"), "Inspect the check-in monitoring dashboard. This message changes no operational authority."].join("\n"),
    };
  }
  let result, sendJob = null;
  e.app.runInTransaction((app) => {
    const config = app.findRecordById("checkin_monitoring_config", "wts2026monitor0");
    let actor = null, ownStation = "";
    if (!machine) {
      actor = typeof b.actorUserId === "string" && find(app, "users", "id = {:id} && verified = true", { id: b.actorUserId });
      if (!actor || !["admin", "checkin_operator"].includes(actor.getString("role"))) fail("forbidden", 403);
      const binding = typeof b.identityHash === "string" && /^[a-f0-9]{64}$/.test(b.identityHash) && find(app, "checkin_bindings", "identity_hash = {:hash} && revoked = false", { hash: b.identityHash });
      ownStation = binding ? binding.getString("station") : "";
    }
    const isAdmin = actor && actor.getString("role") === "admin";
    function visible(incident) { return isAdmin || (ownStation && incident.getString("station_id") === ownStation); }
    function configuration() { return { version: config.getInt("version"), waitingMs: config.getInt("waiting_ms"), incidentMs: config.getInt("incident_ms"), repeatMs: config.getInt("repeat_ms"), recipientUserIds: json(config, "recipient_user_ids") || [] }; }
    if (b.operation === "dashboard") {
      const selected = recipients(app, json(config, "recipient_user_ids"));
      const lastTickMs = config.getInt("last_tick_ms");
      const offset = Number.isSafeInteger(b.offset) && b.offset >= 0 ? b.offset : 0;
      const filter = "(opened_ms > 0 || (recovered_ms = 0 && category = 'work_stalled' && since_ms <= {:waitingBefore}))" + (isAdmin ? "" : " && station_id = {:station}");
      const visibleRows = rows(app, "checkin_monitoring_incidents", filter, { station: ownStation, waitingBefore: Math.max(lastTickMs, now) - config.getInt("waiting_ms") }, "-opened_ms,-since_ms,id", 101, offset);
      const page = visibleRows.slice(0, 100);
      result = {
        scope: isAdmin ? "all" : ownStation || "unbound", lastTickMs,
        recipientsConfigured: selected.length > 0, hasMore: visibleRows.length > 100,
        incidents: page.map((r) => {
          const deliveries = rows(app, "checkin_monitoring_deliveries", "incident_id = {:id}", { id: r.id }, "-sequence", 1);
          const latest = deliveries[0];
          const state = latest ? latest.getString("state") : "none";
          return { id: r.id, stationId: r.getString("station_id"), workflowId: r.getString("workflow_id") || null, category: r.getString("category"), sinceMs: r.getInt("since_ms"), openedMs: r.getInt("opened_ms"), recoveredMs: r.getInt("recovered_ms"), acknowledgedMs: r.getInt("acknowledged_ms"), nextDeliveryMs: r.getInt("next_delivery_ms"), delivery: state, deliveryKind: latest ? latest.getString("kind") : null, nextAction: !selected.length ? "configure_recipients" : ["unknown", "possibly_sent"].includes(state) ? "investigate_delivery_no_retry" : state === "pending" ? "await_worker" : r.getInt("recovered_ms") ? "none" : "wait_for_repeat" };
        }),
      };
      if (isAdmin) {
        result.config = configuration();
        result.adminChoices = [];
        each(app, "users", "role = 'admin' && verified = true", (r) => result.adminChoices.push({ id: r.id, email: r.getString("email") }));
        result.audit = rows(app, "checkin_monitoring_audit", "", {}, "-at_ms,id", 100).map((r) => ({ category: r.getString("category"), incidentId: r.getString("incident_id"), deliveryId: r.getString("delivery_id"), actorUserId: r.getString("actor_user_id"), atMs: r.getInt("at_ms") }));
      }
      return;
    }
    if (b.operation === "acknowledge") {
      const incident = typeof b.incidentId === "string" && find(app, "checkin_monitoring_incidents", "id = {:id}", { id: b.incidentId });
      if (!incident || !visible(incident)) fail("forbidden", 403);
      if (!incident.getInt("acknowledged_ms")) { set(incident, { acknowledged_ms: now, acknowledged_by: actor.id }); app.save(incident); audit(app, "acknowledged", incident.id, "", actor.id); }
      result = { incidentId: incident.id, acknowledgedMs: incident.getInt("acknowledged_ms") }; return;
    }
    if (b.operation === "configure") {
      if (!isAdmin) fail("forbidden", 403);
      const c = b.command;
      if (!c || Object.keys(c).sort().join(",") !== "expectedVersion,incidentMs,operationId,recipientUserIds,repeatMs,waitingMs" || typeof c.operationId !== "string" || !/^[a-f0-9-]{36}$/.test(c.operationId) || !Number.isSafeInteger(c.expectedVersion) || !Number.isSafeInteger(c.waitingMs) || c.waitingMs < 1000 || c.waitingMs > 3600000 || !Number.isSafeInteger(c.incidentMs) || c.incidentMs < c.waitingMs || c.incidentMs > 3600000 || !Number.isSafeInteger(c.repeatMs) || c.repeatMs < 900000 || c.repeatMs > 86400000 || !Array.isArray(c.recipientUserIds) || c.recipientUserIds.length > 20 || c.recipientUserIds.some((id) => typeof id !== "string" || !/^[a-z0-9]{15}$/.test(id)) || new Set(c.recipientUserIds).size !== c.recipientUserIds.length) fail("invalid_input");
      const fingerprint = $security.sha256(JSON.stringify([c.expectedVersion, c.waitingMs, c.incidentMs, c.repeatMs, c.recipientUserIds]));
      const previous = find(app, "checkin_monitoring_commands", "operation_id = {:id}", { id: c.operationId });
      if (previous) { if (previous.getString("actor_user_id") !== actor.id || previous.getString("fingerprint") !== fingerprint) fail("conflict", 409); result = json(previous, "result"); return; }
      if (config.getInt("version") !== c.expectedVersion) fail("conflict", 409);
      if (recipients(app, c.recipientUserIds).length !== c.recipientUserIds.length) fail("invalid_input");
      set(config, { version: c.expectedVersion + 1, waiting_ms: c.waitingMs, incident_ms: c.incidentMs, repeat_ms: c.repeatMs, recipient_user_ids: c.recipientUserIds }); app.save(config);
      result = configuration();
      create(app, "checkin_monitoring_commands", { operation_id: c.operationId, actor_user_id: actor.id, fingerprint, result }); audit(app, "configured", "", "", actor.id); return;
    }
    if (b.operation === "machine_observe_begin") {
      const observationSequence = config.getInt("observation_sequence") + 1;
      if (!Number.isSafeInteger(observationSequence)) fail("conflict", 409);
      set(config, { observation_sequence: observationSequence, observation_started_ms: now }); app.save(config);
      result = { observationSequence }; return;
    }
    if (b.operation === "machine_tick") {
      if (!Array.isArray(b.readiness) || b.readiness.length !== 3 || stations.some((id) => b.readiness.filter((s) => s.stationId === id && typeof s.readyForAuthorization === "boolean").length !== 1)) fail("invalid_input");
      if (!Number.isSafeInteger(b.observationSequence) || b.observationSequence < 1) fail("invalid_input");
      if (b.observationSequence !== config.getInt("observation_sequence")) { result = { observed: false }; return; }
      const fingerprint = $security.sha256(JSON.stringify(stations.map((id) => b.readiness.find((s) => s.stationId === id).readyForAuthorization)));
      if (b.observationSequence === config.getInt("applied_observation_sequence")) {
        if (fingerprint !== config.getString("observation_fingerprint")) fail("conflict", 409);
        result = { observed: true }; return;
      }
      // Time is captured at reservation, not after the asynchronous read. Only
      // the database sequence orders workers; backwards clocks cannot undo it.
      now = Math.max(config.getInt("observation_started_ms"), config.getInt("last_tick_ms"));
      const observed = {};
      function observe(category, station, workflow, since) {
        if (!stations.includes(station) || (workflow && !/^[a-z0-9]{15}$/.test(workflow))) fail("invalid_input");
        const key = category + ":" + station + ":" + (workflow || "");
        observed[key] = true;
        let incident = find(app, "checkin_monitoring_incidents", "scope_key = {:key} && recovered_ms = 0", { key });
        if (!incident) incident = create(app, "checkin_monitoring_incidents", { scope_key: key, station_id: station, workflow_id: workflow || "", category, since_ms: Number.isFinite(since) && since > 0 && since <= now ? since : now });
        const immediate = category === "admission_uncertain" || category === "output_uncertain";
        if (!incident.getInt("opened_ms") && (immediate || now - incident.getInt("since_ms") >= config.getInt("incident_ms"))) {
          incident.set("opened_ms", now); app.save(incident); enqueue(app, incident, "open"); audit(app, "opened", incident.id);
        }
      }
      // Readiness is projected by the established checkin-agents service, not
      // recomputed here. Its heartbeat/auth safety contract is unchanged.
      for (const station of b.readiness) if (!station.readyForAuthorization) observe("station_unavailable", station.stationId, "", now);
      each(app, "checkin_arrival_workflows", "state = 'admission_uncertain' || state = 'existing_unattributed' || state = 'not_submitted' || state = 'admission_pending'", (w) => {
        const state = w.getString("state");
        if (["admission_uncertain", "existing_unattributed"].includes(state)) observe("admission_uncertain", w.getString("station_id"), w.id, now);
        if (["not_submitted", "admission_pending"].includes(state)) observe("work_stalled", w.getString("station_id"), w.id, Date.parse(w.getString("created")));
      });
      each(app, "checkin_print_attempts", "state = 'uncertain' || state = 'queued' || state = 'dispatched'", (p) => {
        const state = p.getString("state");
        if (state === "uncertain") observe("output_uncertain", p.getString("station_id"), p.getString("workflow_id"), now);
        if (["queued", "dispatched"].includes(state)) observe("work_stalled", p.getString("station_id"), p.getString("workflow_id"), Date.parse(p.getString("created")));
      });
      // Generic protocol attempts have no attendee/workflow and still matter.
      each(app, "checkin_agent_authorizations", "outcome = 'output_uncertain'", (auth) => {
        const attempt = app.findRecordById("checkin_agent_attempts", auth.getString("attempt_id"));
        if (!attempt.getString("print_attempt_id")) observe("output_uncertain", attempt.getString("station"), "", now);
      });
      each(app, "checkin_monitoring_incidents", "recovered_ms = 0", (incident) => {
        if (!observed[incident.getString("scope_key")]) {
          incident.set("recovered_ms", now); app.save(incident);
          each(app, "checkin_monitoring_deliveries", "incident_id = {:id} && state = 'pending'", (d) => { d.set("state", "cancelled"); app.save(d); }, { id: incident.id });
          if (incident.getInt("opened_ms")) { enqueue(app, incident, "recovery"); audit(app, "recovered", incident.id); }
        } else if (incident.getInt("opened_ms") && incident.getInt("last_boundary_ms") && now >= Math.max(incident.getInt("next_delivery_ms"), incident.getInt("last_boundary_ms") + config.getInt("repeat_ms"))) {
          const previous = rows(app, "checkin_monitoring_deliveries", "incident_id = {:id}", { id: incident.id }, "-sequence", 1)[0];
          if (previous && ["sent", "failed"].includes(previous.getString("state"))) enqueue(app, incident, "repeat");
        }
      });
      set(config, { last_tick_ms: now, applied_observation_sequence: b.observationSequence, observation_fingerprint: fingerprint }); app.save(config); result = { observed: true }; return;
    }
    if (b.operation === "machine_claim") {
      const people = recipients(app, json(config, "recipient_user_ids"));
      if (!people.length) { result = { job: null }; return; }
      const d = rows(app, "checkin_monitoring_deliveries", "state = 'pending'", {}, "created_ms,id", 1)[0];
      if (!d) { result = { job: null }; return; }
      const incident = app.findRecordById("checkin_monitoring_incidents", d.getString("incident_id"));
      const boundary = Math.max(now, config.getInt("last_tick_ms"), incident.getInt("last_boundary_ms"));
      const token = $security.randomStringWithAlphabet(64, "abcdef0123456789");
      set(d, { state: "possibly_sent", claim_token: token, boundary_ms: boundary, recipient_user_ids: people.map((r) => r.id) }); app.save(d);
      set(incident, { last_boundary_ms: boundary, next_delivery_ms: boundary + config.getInt("repeat_ms") }); app.save(incident);
      audit(app, "delivery_boundary", incident.id, d.id);
      // No freeform labels, summaries, diagnostics, or attendee data in email.
      const { subject, text } = formatMail(incident, d);
      result = { job: { deliveryId: d.id, claimToken: token, incidentId: incident.id, kind: d.getString("kind"), subject, text, recipients: people.map((r) => r.getString("email")) } }; return;
    }
    if (["machine_result", "machine_send"].includes(b.operation)) {
      const d = typeof b.deliveryId === "string" && find(app, "checkin_monitoring_deliveries", "id = {:id}", { id: b.deliveryId });
      if (!d || typeof b.claimToken !== "string" || d.getString("claim_token") !== b.claimToken) fail("forbidden", 403);
      if (b.operation === "machine_result") {
        if (!["sent", "failed", "unknown"].includes(b.outcome)) fail("invalid_input");
        if (d.getString("state") !== "possibly_sent") { if (d.getString("state") !== b.outcome) fail("conflict", 409); result = { outcome: b.outcome }; return; }
        set(d, { state: b.outcome, completed_ms: Math.max(now, d.getInt("boundary_ms")) }); app.save(d); audit(app, "delivery_" + b.outcome, d.getString("incident_id"), d.id); result = { outcome: b.outcome }; return;
      }
      // A second durable CAS guards the actual mailer against HTTP replay.
      if (d.getString("state") !== "possibly_sent" || d.getBool("send_started")) { result = { outcome: ["sent", "failed"].includes(d.getString("state")) ? d.getString("state") : "unknown" }; return; }
      d.set("send_started", true); app.save(d);
      const people = recipients(app, json(d, "recipient_user_ids"));
      const currentIds = json(config, "recipient_user_ids") || [];
      const allowed = people.filter((r) => currentIds.includes(r.id));
      const incident = app.findRecordById("checkin_monitoring_incidents", d.getString("incident_id"));
      sendJob = { deliveryId: d.id, incidentId: incident.id, people: allowed.map((r) => r.getString("email")), ...formatMail(incident, d) };
      return;
    }
    fail("invalid_input");
  });
  if (sendJob) {
    // External effect OUTSIDE transaction; failures can be ambiguous SMTP acks.
    // Configuration absence is definitely pre-send. Exceptions are never logged.
    const meta = e.app.settings().meta;
    let outcome = "failed";
    if (sendJob.people.length && meta.senderAddress) {
      outcome = "unknown";
      try {
        e.app.newMailClient().send(new MailerMessage({ from: { address: meta.senderAddress, name: meta.senderName }, bcc: sendJob.people.map((address) => ({ address })), subject: sendJob.subject, text: sendJob.text }));
        outcome = "sent";
      } catch { /* Persist bounded unknown; do not retry this delivery. */ }
    }
    e.app.runInTransaction((app) => {
      const d = app.findRecordById("checkin_monitoring_deliveries", sendJob.deliveryId);
      if (d.getString("state") === "possibly_sent") { set(d, { state: outcome, completed_ms: Math.max(now, d.getInt("boundary_ms")) }); app.save(d); audit(app, "delivery_" + outcome, sendJob.incidentId, d.id); }
    });
    result = { outcome };
  }
  return e.json(200, result);
}, $apis.requireSuperuserAuth());
// Only the authenticated command seam may mutate monitoring state via HTTP.
onRecordCreateRequest(() => { throw new ForbiddenError("Use monitoring commands."); }, "checkin_monitoring_config", "checkin_monitoring_incidents", "checkin_monitoring_deliveries", "checkin_monitoring_commands", "checkin_monitoring_audit");
onRecordUpdateRequest(() => { throw new ForbiddenError("Use monitoring commands."); }, "checkin_monitoring_config", "checkin_monitoring_incidents", "checkin_monitoring_deliveries", "checkin_monitoring_commands", "checkin_monitoring_audit");
onRecordDeleteRequest(() => { throw new ForbiddenError("Use explicit lifecycle purge."); }, "checkin_monitoring_config", "checkin_monitoring_incidents", "checkin_monitoring_deliveries", "checkin_monitoring_commands", "checkin_monitoring_audit");
