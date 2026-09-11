import { expect, it, vi } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { setup, ready, context } from "./checkin-recovery-test-helper";
import { HttpAdmissionProcessor } from "../../runtime/checkin/admission";
import { Coordinator } from "../../runtime/checkin/coordinator";
import { createCheckinEventSource } from "./checkin-event-source";
import { CheckinReadError, createCheckinUpstreamReader } from "./checkin-upstream-read";
import type { AdmissionJob } from "../../runtime/checkin/protocol";

const config = { apiUrl: "https://admission.example.invalid/api", apiKey: `e30.${Buffer.from('{"account_id":1}').toString("base64url")}.synthetic`, accountId: "1" };
const sourceKey = createCheckinEventSource(config).sourceKey;
const job = { sourceKey, upstreamEventId: "101", upstreamAttendeeId: "501", upstreamListId: "201" } as AdmissionJob;

it("admission preserves 404 classification and shares long GET backoff with discovery", async () => {
  const missing = vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive diagnostic", { status: 404 }));
  expect(await new HttpAdmissionProcessor(config, { fetch: missing }).attendee(job)).toMatchObject({ eligibility: "not_in_list" });
  expect(missing).toHaveBeenCalledTimes(1);
  const limited = vi.fn<typeof fetch>().mockImplementation(async () => new Response("sensitive diagnostic", { status: 429, headers: { "Retry-After": "120" } }));
  await expect(new HttpAdmissionProcessor(config, { fetch: limited }).attendee(job)).rejects.toMatchObject({ reason: "http", status: 429, retryBlocked: false, retryAfterMs: expect.any(Number) });
  await expect(createCheckinUpstreamReader({ base: config.apiUrl, key: config.apiKey }, limited)("events")).rejects.toMatchObject({ reason: "http" });
  expect(limited).toHaveBeenCalledTimes(1);
});

it("oversized Retry-After exhausts retries instead of authorizing an early retry; admission POST is single-shot", async () => {
  const limited = vi.fn<typeof fetch>().mockImplementation(async () => new Response("", { status: 429, headers: { "Retry-After": "9".repeat(400) } }));
  await expect(new HttpAdmissionProcessor(config, { fetch: limited }).attendee(job)).rejects.toMatchObject({ retryBlocked: true, retryAfterMs: 86400000 });
  expect(limited).toHaveBeenCalledTimes(1);
  const processor = new HttpAdmissionProcessor(config, { fetch: limited });
  expect(await processor.admit(job, { upstreamAttendeeId: "501", publicId: "A-ABC1234", productId: "401", alreadyCheckedIn: false, listCapability: "synthetic" })).toEqual({ state: "uncertain" });
  expect(limited).toHaveBeenCalledTimes(2);
  expect(limited.mock.calls[1][1]?.method).toBe("POST");
});

it("real PB persists Retry-After plus additive jitter across coordinator and PB restarts, and exhausts three pre-send failures", async () => {
  const t = await setup(); let coordinator: Coordinator | undefined;
  try {
    const r = await ready(t); coordinator = r.coordinator; await coordinator.listen(); await r.heartbeat();
    const reservation = await t.service.preflight(t.token, { ...t.command(), context: await context(t) });
    if (reservation.state !== "reserved") throw new Error("Synthetic reservation failed");
    const db = new DatabaseSync(join(t.root, "pb_data/data.db"));
    try { db.prepare("UPDATE checkin_arrival_workflows SET source_key=? WHERE id=?").run(sourceKey, reservation.workflow.id); } finally { db.close(); }
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response("diagnostic never stored", { status: 429, headers: { "Retry-After": "120" } }));
    const processor = new HttpAdmissionProcessor(config, { fetch: transport });
    const before = Date.now();
    await coordinator.processAdmissions(processor, 1);
    let attempt = (await t.pb.collection("checkin_arrival_attempts").getFullList())[0];
    expect(attempt.state).toBe("pre_send_failed");
    expect(attempt.pre_send_failures).toBe(1);
    expect(Date.parse(attempt.next_retry_at)).toBeGreaterThanOrEqual(before + 119900);
    expect(Date.parse(attempt.next_retry_at)).toBeLessThanOrEqual(Date.now() + 120250);
    expect(attempt.send_boundary_at).toBe("");
    await coordinator.close();
    // Isolate durable retry persistence from the separately tested restore gate.
    const boot = new DatabaseSync(join(t.root, "pb_data/data.db"));
    try { boot.prepare("UPDATE checkin_lifecycle SET boot_seen=0").run(); } finally { boot.close(); }
    await t.restart();
    coordinator = new Coordinator(t.pb); await coordinator.listen();
    expect(await coordinator.claimAdmission()).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
    // Expire only persisted test deadlines; no wall clock alteration or real wait.
    for (let failures = 2; failures <= 3; failures++) {
      const db = new DatabaseSync(join(t.root, "pb_data/data.db"));
      try { db.prepare("UPDATE checkin_arrival_attempts SET next_retry_at=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), attempt.id); } finally { db.close(); }
      await coordinator.processAdmissions({ attendee: async () => { throw new CheckinReadError("transport"); }, admit: async () => { throw new Error("POST forbidden"); } }, 1);
      attempt = await t.pb.collection("checkin_arrival_attempts").getOne(attempt.id);
      expect(attempt.pre_send_failures).toBe(failures);
    }
    await coordinator.close(); coordinator = new Coordinator(t.pb); await coordinator.listen();
    expect(await coordinator.claimAdmission()).toBeNull();
    expect(attempt.send_boundary_at).toBe("");
  } finally { await coordinator?.close(); await t.cleanup(); }
}, 30000);
