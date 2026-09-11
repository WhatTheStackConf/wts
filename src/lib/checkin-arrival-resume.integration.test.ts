import { expect, it } from "vite-plus/test";
import { setup, ready, context } from "~/lib/checkin-arrival-resume-test-helper";
import { CheckinArrivalResumeService } from "~/lib/checkin-arrival-resume-service";

it("reacquires only opaque frozen context after reload, without reads or effects", { timeout: 60000 }, async () => {
 const t = await setup();
 try {
  const command = t.command();
  expect((await t.service.preflight(t.token, command)).state).toBe("dependency_unavailable");
  const resume = new CheckinArrivalResumeService(t.pb, t.operator.actor, t.source);
  const before = await t.pb.collection("checkin_arrival_commands").getFullList();
  expect(await resume.get(t.token, command.operationId)).toMatchObject({ operationId: command.operationId, context: command.context, status: "final", state: "dependency_unavailable", actions: ["retry"], recovery: "available" });
  expect(await t.pb.collection("checkin_arrival_commands").getFullList()).toEqual(before);
  expect(await t.pb.collection("checkin_arrival_workflows").getFullList()).toEqual([]);
  await t.restart();
  // A database reboot is deliberately different from a phone reload: lifecycle
  // quarantines the edition and rotates generations. Never rebase old work.
  expect(await resume.get(t.token, command.operationId)).toMatchObject({ context: command.context, recovery: "context_changed", actions: [] });
  await expect(resume.resume(t.token, { operationId: command.operationId, action: "retry", nextOperationId: crypto.randomUUID(), qrIdentity: command.qrIdentity })).rejects.toMatchObject({ code: "conflict" });
 } finally { await t.cleanup(); }
});

for (const action of ["retry", "blank"] as const) it(`restores ${action} after reload with the same QR and caller UUID`, { timeout: 60000 }, async () => {
 const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
 try {
  await runtime.heartbeat();
  let reads = 0;
  const source = { ...t.source, affiliation: async () => { reads++; return { state: "unavailable" as const }; } };
  const { CheckinArrivalService } = await import("~/lib/checkin-arrival-service");
  const command = { ...t.command(), context: await context(t) };
  expect((await new CheckinArrivalService(t.pb, t.operator.actor, source).preflight(t.token, command)).state).toBe("needs_affiliation_choice");
  // Recreate the caller and human session, not the database's restore epoch.
  const handoff = await t.user("checkin_operator");
  const resume = new CheckinArrivalResumeService(t.pb, handoff.actor, t.source);
  const opaque = await resume.get(t.token, command.operationId);
  expect(opaque.actions).toEqual(["retry", "blank"]);
  expect(JSON.stringify(opaque)).not.toMatch(/qr_hash|qrHash|A-ABC1234|sourceKey|token|upstream|name|affiliation_mapping/);
  const input = { operationId: command.operationId, action, qrIdentity: command.qrIdentity, nextOperationId: crypto.randomUUID() };
  await expect(resume.resume(t.token, { ...input, qrIdentity: "A-OTHER01" })).rejects.toMatchObject({ code: "conflict" });
  const result = await resume.resume(t.token, input);
  expect(result).toMatchObject({ state: "reserved", operationId: input.nextOperationId, workflow: { affiliation: action === "blank" ? "" : "Test organisation" } });
  const rows = await t.pb.collection("checkin_arrival_commands").getFullList();
  expect(rows).toHaveLength(2);
  const child = rows.find(r => r.operation_id === input.nextOperationId)!;
  expect(child).toMatchObject({ prior_operation_id: command.operationId, context: command.context, actor_user_id: handoff.actor.userId });
  expect(JSON.stringify(rows)).not.toContain(command.qrIdentity);
  expect(await resume.resume(t.token, input)).toEqual({ ...result, replayed: true });
  await expect(resume.resume(t.token, { ...input, nextOperationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "conflict" });
  expect((await resume.get(t.token, command.operationId)).recovery).toBe("read_only");
  expect(await t.pb.collection("checkin_arrival_commands").getFullList()).toEqual(rows);
  expect(await t.pb.collection("checkin_arrival_workflows").getFullList()).toHaveLength(1);
  expect(await t.pb.collection("checkin_arrival_attempts").getFullList()).toEqual([]);
  expect(await t.pb.collection("checkin_print_attempts").getFullList()).toEqual([]);
  expect(reads).toBe(1);
 } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

it("reconstructs a pending command exactly, fences QR, and never substitutes a fresh UUID", { timeout: 60000 }, async () => {
 const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
 try {
  await runtime.heartbeat();
  const command = { ...t.command(), context: await context(t) };
  const { createHash } = await import("node:crypto");
  const { checkinEventBindingHash } = await import("~/lib/checkin-event-service");
  const { qrIdentity, ...rest } = command;
  await t.pb.send("/api/wts/checkin-arrivals", { method: "POST", body: { operation: "begin", actorUserId: t.operator.actor.userId, sourceKey: t.source.sourceKey, identityHash: checkinEventBindingHash(t.token), command: { ...rest, priorOperationId: "", qrHash: createHash("sha256").update(`wts2026:arrival:${qrIdentity}`).digest("hex") }, invalidIdentity: false } });
  const resume = new CheckinArrivalResumeService(t.pb, t.operator.actor, t.source);
  expect(await resume.get(t.token, command.operationId)).toMatchObject({ status: "pending", state: "pending", actions: ["replay"] });
  await expect(resume.resume(t.token, { action: "retry", operationId: command.operationId, nextOperationId: crypto.randomUUID(), qrIdentity })).rejects.toMatchObject({ code: "conflict" });
  const result = await resume.resume(t.token, { action: "replay", operationId: command.operationId, qrIdentity });
  expect(result).toMatchObject({ state: "reserved", operationId: command.operationId });
  expect(await resume.resume(t.token, { action: "replay", operationId: command.operationId, qrIdentity })).toEqual({ ...result, replayed: true });
  expect(await t.pb.collection("checkin_arrival_commands").getFullList()).toHaveLength(1);
  expect(await t.pb.collection("checkin_arrival_workflows").getFullList()).toHaveLength(1);
 } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

it("rejects foreign bindings and stale authority, and never rebases a changed selection", { timeout: 60000 }, async () => {
 const t = await setup();
 try {
  const command = t.command(); await t.service.preflight(t.token, command);
  const resume = new CheckinArrivalResumeService(t.pb, t.operator.actor, t.source);
  const input = { action: "retry" as const, operationId: command.operationId, nextOperationId: crypto.randomUUID(), qrIdentity: command.qrIdentity };
  await expect(resume.resume(t.token, { ...input, action: "blank" })).rejects.toMatchObject({ code: "conflict" });
  const foreign = "e".repeat(64);
  await t.control.bind(t.code, foreign, (await t.control.preview(t.code)).confirmation);
  await expect(resume.get(foreign, command.operationId)).rejects.toMatchObject({ code: "forbidden" });
  await expect(t.operator.client.send("/api/wts/checkin-arrival-resume", { method: "POST", body: {} })).rejects.toMatchObject({ status: 403 });
  await t.pb.collection("users").update(t.operator.actor.userId, { role: "user" });
  await expect(resume.get(t.token, command.operationId)).rejects.toMatchObject({ code: "forbidden" });
  await t.pb.collection("users").update(t.operator.actor.userId, { role: "checkin_operator" });
  await context(t);
  expect(await resume.get(t.token, command.operationId)).toMatchObject({ recovery: "context_changed", context: command.context, actions: [] });
  await expect(resume.resume(t.token, input)).rejects.toMatchObject({ code: "conflict" });
  expect(await t.pb.collection("checkin_arrival_commands").getFullList()).toHaveLength(1);
 } finally { await t.cleanup(); }
});

for (const state of ["accepted", "admission_uncertain"] as const) it(`never turns ${state} into another intake or admission`, { timeout: 60000 }, async () => {
 const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
 try {
  await runtime.heartbeat(); const command = { ...t.command(), context: await context(t) };
  await t.service.preflight(t.token, command);
  let posts = 0;
  await runtime.coordinator.processAdmissions({ attendee: async job => ({ upstreamAttendeeId: job.upstreamAttendeeId, publicId: command.qrIdentity, productId: "401", alreadyCheckedIn: false }), admit: async () => { posts++; return state === "accepted" ? { state: "newly_checked_in", fingerprint: "d".repeat(64) } : { state: "uncertain" }; } });
  const resume = new CheckinArrivalResumeService(t.pb, t.operator.actor, t.source);
  expect(await resume.get(t.token, command.operationId)).toMatchObject({ state, recovery: "read_only", actions: [] });
  const before = await t.pb.collection("checkin_arrival_commands").getFullList();
  for (const action of ["retry", "blank"] as const) await expect(resume.resume(t.token, { action, operationId: command.operationId, nextOperationId: crypto.randomUUID(), qrIdentity: command.qrIdentity })).rejects.toMatchObject({ code: "conflict" });
  expect(await resume.resume(t.token, { action: "replay", operationId: command.operationId, qrIdentity: command.qrIdentity })).toMatchObject({ state, replayed: true });
  await t.restart();
  expect(await resume.get(t.token, command.operationId)).toMatchObject({ state, recovery: "context_changed", actions: [] });
  await expect(resume.resume(t.token, { action: "replay", operationId: command.operationId, qrIdentity: command.qrIdentity })).rejects.toMatchObject({ code: "conflict" });
  expect(await t.pb.collection("checkin_arrival_commands").getFullList()).toEqual(before);
  expect(await t.pb.collection("checkin_arrival_attempts").getFullList()).toHaveLength(1);
  expect(posts).toBe(1);
 } finally { await runtime.coordinator.close(); await t.cleanup(); }
});
