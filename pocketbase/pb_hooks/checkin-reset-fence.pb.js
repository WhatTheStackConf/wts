/// <reference path="../pb_data/types.d.ts" />
// Additive reset-only send gate. Never performs upstream I/O inside a transaction.
// A claim is already possibly_sent and nonreplayable; this second fence is consumed
// only after fresh upstream inspection, immediately before the coordinator's DELETE.
routerAdd("POST", "/api/wts/checkin-reset-fence", e => {
  const b = e.requestInfo().body;
  function deny() { throw new ApiError(409,"Reset send authorization rejected."); }
  function shape(v, keys) { return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k)); }
  const keys = ["workflowId","resetId","sourceKey","upstreamEventId","upstreamListId","upstreamAttendeeId","checkinId","fingerprint"];
  function pattern(k) { return ["workflowId","resetId"].includes(k) ? /^[a-z0-9]{15}$/ : ["sourceKey","fingerprint"].includes(k) ? /^[a-f0-9]{64}$/ : /^[1-9][0-9]{0,15}$/; }
  function validField(j, k) { return typeof j[k] === "string" && pattern(k).test(j[k]) && (["workflowId","resetId","sourceKey","fingerprint"].includes(k) || Number.isSafeInteger(Number(j[k]))); }
  if (!shape(b,["operation","owner","nowMs","job"]) || b.operation !== "machine_reset_fence" || typeof b.owner !== "string" || !/^[a-f0-9]{64}$/.test(b.owner) || !Number.isSafeInteger(b.nowMs) || !shape(b.job,keys)) deny();
  const j = b.job;
  for (const k of keys) if (!validField(j, k)) deny();
  function differs(actual, expected) { return Object.keys(expected).some(k => actual[k] !== expected[k]); }
  function assertLiveOwner(runtime, now) {
    const seen = Date.parse(runtime.getString("last_seen_at"));
    if (runtime.getString("owner") !== b.owner || !Number.isFinite(seen) || now < seen || now-seen >= runtime.getInt("heartbeat_timeout_ms")) deny();
  }
  function claimedThisGeneration(system, runtime, reset) { return reset.getInt("claim_system_generation") === system.getInt("generation") && reset.getInt("coordinator_generation") === runtime.getInt("generation"); }
  function assertClaimedSend(system, runtime, reset) {
    if (system.getBool("enabled") || reset.getInt("claim_system_generation") < 1 || !claimedThisGeneration(system, runtime, reset) || reset.getString("state") !== "possibly_sent" || !reset.getString("send_boundary_at") || reset.getString("delete_fence_at")) deny();
    const claimed = JSON.parse(reset.getString("send_claim_target") || "null");
    if (!shape(claimed,keys) || !keys.every(k => claimed[k] === j[k])) deny();
  }
  function assertJobTarget(w, reset) {
    const actual = { edition: w.getString("edition"), workflowId: reset.getString("workflow_id"), checkinId: reset.getString("checkin_id"), fingerprint: reset.getString("fingerprint"), sourceKey: w.getString("source_key"), upstreamEventId: w.getString("upstream_event_id"), upstreamListId: w.getString("list_id"), upstreamAttendeeId: w.getString("upstream_attendee_id") };
    if (differs(actual, { edition: "WTS2026", workflowId: w.id, checkinId: j.checkinId, fingerprint: j.fingerprint, sourceKey: j.sourceKey, upstreamEventId: j.upstreamEventId, upstreamListId: j.upstreamListId, upstreamAttendeeId: j.upstreamAttendeeId })) deny();
  }
  function assertPendingReset(recovery, current, command, w, reset) {
    if (!recovery || recovery.getString("decision") !== "reset_pending" || !current || current.id !== reset.id || command.getString("workflow_id") !== w.id || command.getString("operation") !== "reset") deny();
  }
  e.app.runInTransaction(app => {
    const now = Date.now(); // Send authority uses the backend clock, not caller time.
    const runtime = app.findRecordById("checkin_coordinator","wts2026coord000");
    assertLiveOwner(runtime, now);
    const system = app.findRecordById("checkin_system","wts2026system00");
    const lifecycle = require(__hooks+"/checkin-lifecycle.js");
    lifecycle.assertNewWork(app); lifecycle.assertOutcome(app,now);
    const reset = app.findRecordById("checkin_recovery_resets",j.resetId);
    assertClaimedSend(system, runtime, reset);
    const w = app.findRecordById("checkin_arrival_workflows",j.workflowId);
    assertJobTarget(w, reset);
    const R = require(__hooks+"/checkin-recovery.js");
    const recovery = R.projection(app,w);
    const current = R.find(app,"checkin_recovery_resets","workflow_id = {:id}",{id:w.id});
    const command = app.findRecordById("checkin_recovery_commands",reset.getString("command_id"));
    assertPendingReset(recovery, current, command, w, reset);
    reset.set("delete_fence_at",new Date(now).toISOString()); app.save(reset);
  });
  // A lost response cannot be replayed into another grant: the field is committed.
  return e.json(200,{resetId:j.resetId,authorized:true});
}, $apis.requireSuperuserAuth());

// Capture the claim's system generation and exact target atomically with the
// existing claim handler without changing unrelated recovery/agent handlers.
onRecordUpdate(e => {
  const r = e.record, old = r.original();
  if (old.getString("state") === "queued" && r.getString("state") === "possibly_sent") {
    const system = e.app.findRecordById("checkin_system","wts2026system00");
    if (system.getBool("enabled")) throw new ForbiddenError("Reset requires stopped producers.");
    const w = e.app.findRecordById("checkin_arrival_workflows",r.getString("workflow_id"));
    r.set("claim_system_generation",system.getInt("generation"));
    r.set("send_claim_target",{workflowId:w.id,resetId:r.id,sourceKey:w.getString("source_key"),upstreamEventId:w.getString("upstream_event_id"),upstreamListId:w.getString("list_id"),upstreamAttendeeId:w.getString("upstream_attendee_id"),checkinId:r.getString("checkin_id"),fingerprint:r.getString("fingerprint")});
  } else {
    for (const k of ["claim_system_generation","send_claim_target"]) if (r.getString(k) !== old.getString(k)) throw new ForbiddenError("Reset claim is immutable.");
    if (old.getString("state") !== "queued" && r.getString("state") === "queued") throw new ForbiddenError("Reset claim cannot be replayed.");
  }
  if (old.getString("delete_fence_at") && old.getString("delete_fence_at") !== r.getString("delete_fence_at")) throw new ForbiddenError("Reset send grant is consumed.");
  e.next();
}, "checkin_recovery_resets");
