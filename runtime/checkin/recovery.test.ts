import { afterEach, expect, it } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PocketBase from "pocketbase";
import { AgentRuntime, type AgentTransport } from "./agent.js";
import { AgentJournal } from "./journal.js";
import { Coordinator } from "./coordinator.js";
import { AgentError, printPayloadHash, type Operation, type PrintPayload, type ResetJob, type Work } from "./protocol.js";

const identity = { stationId: "wts2026station1", agentIdentity: "test-agent", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: "profile00000001" };
const roots: string[] = [];
const journals: AgentJournal[] = [];
afterEach(() => { for (const j of journals.splice(0)) { try { j.close(); } catch { /* already closed */ } } for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });
function open(path: string) { const j = new AgentJournal(path, identity); journals.push(j); return j; }
function fixture() { const root = mkdtempSync(join(tmpdir(), "wts-recovery-runtime-")); roots.push(root); const path = join(root, "journal.sqlite"); AgentJournal.provision(path, identity); return { path, journal: open(path) }; }
function work(purpose: PrintPayload["purpose"] = "initial", attemptId = "attempt00000001"): Work {
  const payload: PrintPayload = { purpose, text: { name: "Тест Attendee", affiliation: "" }, profile: { printerRef: identity.printerIdentity }, rendererVersion: "renderer-v1", fontVersion: "font-v1" };
  return { attemptId, profileId: identity.profileId, payloadHash: printPayloadHash(identity.profileId, payload), payload };
}
const cancellationId = "cancel000000001";
function wire(input: Work) {
  const calls: Operation[] = [];
  let intents: unknown[] = [];
  const transport: AgentTransport = { async request(operation, payload) {
    calls.push(operation);
    if (operation === "work") { expect(payload.purpose).toBe("label"); return { attempts: [input] }; }
    if (operation === "ack") return { attemptId: input.attemptId, acknowledged: true };
    if (operation === "cancellations") return { cancellations: intents };
    if (operation === "neutralized") return { cancellationId, acknowledged: true };
    if (operation === "authorize") return { attemptId: input.attemptId, stationId: identity.stationId, agentId: "agent0000000001", payloadHash: input.payloadHash, expiresAt: new Date(Date.now() + 9000).toISOString(), stationGeneration: 1, systemGeneration: 1, coordinatorGeneration: 1 };
    if (operation === "start") return { attemptId: input.attemptId, started: true, reportUntil: "" };
    if (operation === "outcome") return { attemptId: input.attemptId, outcome: payload.outcome };
    throw new Error(`Unexpected ${operation}`);
  } };
  return { transport, calls, cancel: (startState?: "not_started" | "started") => { intents = [{ cancellationId, work: input, ...(startState ? { startState } : {}) }]; }, clear: () => { intents = []; } };
}
it.each(["initial", "replacement"] as const)("receipts and permanently cancels %s across ack response loss and file reopen", async purpose => {
  const f = fixture(), input = work(purpose), w = wire(input); let runtime = new AgentRuntime(identity, f.journal, w.transport);
  await runtime.work(); expect(f.journal.get(input.attemptId)?.payload).toEqual(input.payload);
  if (purpose === "replacement") await runtime.authorize(input);
  w.cancel(); const request = w.transport.request; let lost = true;
  w.transport.request = async (op, data) => {
    if (op === "neutralized") {
      const persisted = open(f.path); expect(persisted.get(input.attemptId)).toMatchObject({ state: "cancelled", cancellation: { acknowledged: false, disposition: "neutralized" } }); persisted.close();
      if (lost) { lost = false; w.clear(); throw new AgentError("network_unavailable"); }
    }
    return request(op, data);
  };
  await expect(runtime.recover()).rejects.toThrow("network_unavailable");
  const watermark = f.journal.snapshot(); f.journal.close(); const reopened = open(f.path); expect(reopened.snapshot()).toEqual(watermark);
  runtime = new AgentRuntime(identity, reopened, w.transport);
  expect(await runtime.recover()).toEqual({ reported: 0, acknowledged: 1, pending: 0 });
  expect(await runtime.recover()).toEqual({ reported: 0, acknowledged: 0, pending: 0 });
  let prints = 0; const printer = { printerIdentity: identity.printerIdentity, print: async () => { prints++; } };
  await expect(runtime.process(input, printer)).rejects.toThrow("attempt_cancelled");
  await expect(runtime.authorize(input)).rejects.toThrow("already_started");
  expect(prints).toBe(0); expect(w.calls).not.toContain("start");
  expect(() => reopened.put({ ...reopened.get(input.attemptId)!, state: "received" })).toThrow("attempt_conflict");
});
it("replacement retains purpose in the immutable hash and completes once across reopen", async () => {
  const f = fixture(), input = work("replacement"), w = wire(input); let runtime = new AgentRuntime(identity, f.journal, w.transport);
  await runtime.work(); let prints = 0; const printer = { printerIdentity: identity.printerIdentity, print: async () => { prints++; } };
  expect(await runtime.process(input, printer)).toBe("protocol_complete"); f.journal.close(); const reopened = open(f.path); runtime = new AgentRuntime(identity, reopened, w.transport);
  expect(await runtime.process(input, printer)).toBe("protocol_complete"); expect(prints).toBe(1);
  await expect(runtime.process({ ...input, payload: { ...input.payload!, purpose: "initial" } }, printer)).rejects.toThrow("payload_hash_mismatch");
  expect(reopened.get(input.attemptId)?.payload?.purpose).toBe("replacement");
});
it("lost start is never replayed or called safely neutralized; late outcome can settle cancellation", async () => {
  const f = fixture(), input = work("replacement"), w = wire(input); const request = w.transport.request;
  let acceptOutcome = false; w.transport.request = async (op, data) => {
    if (op === "start") { w.calls.push(op); throw new AgentError("network_unavailable"); }
    if (op === "outcome" && !acceptOutcome) throw new AgentError("request_rejected");
    if (op === "neutralized") expect(data.disposition).toBe("settled");
    return request(op, data);
  };
  let runtime = new AgentRuntime(identity, f.journal, w.transport); await runtime.authorize(input); await expect(runtime.start(input.attemptId)).rejects.toThrow(); f.journal.close();
  const reopened = open(f.path); runtime = new AgentRuntime(identity, reopened, w.transport); w.cancel();
  expect((await runtime.recover()).acknowledged).toBe(0); expect(w.calls).not.toContain("neutralized");
  expect(reopened.get(input.attemptId)?.state).toBe("possibly_starting");
  acceptOutcome = true; expect(await runtime.recover()).toEqual({ reported: 1, acknowledged: 1, pending: 0 });
  expect(w.calls.filter(op => op === "start")).toHaveLength(1);
  expect(reopened.get(input.attemptId)).toMatchObject({ state: "reported", outcome: "output_uncertain" });
  let prints = 0; await runtime.process(input, { printerIdentity: identity.printerIdentity, print: async () => { prints++; } }); expect(prints).toBe(0);
});
it("neutralizes a possibly-starting journal only with explicit server no-start proof", async () => {
  const f = fixture(), input = work(), w = wire(input); const request = w.transport.request;
  w.transport.request = async (op, payload) => {
    if (op === "start" || op === "outcome") throw new AgentError("request_rejected");
    if (op === "neutralized") {
      expect(f.journal.get(input.attemptId)?.state).toBe("cancelled");
      expect(payload.disposition).toBe("neutralized");
    }
    return request(op, payload);
  };
  const runtime = new AgentRuntime(identity, f.journal, w.transport);
  await runtime.authorize(input); await expect(runtime.start(input.attemptId)).rejects.toThrow();
  w.cancel(); expect((await runtime.recover()).acknowledged).toBe(0);
  w.cancel("not_started");
  expect(await runtime.recover()).toEqual({ reported: 0, acknowledged: 1, pending: 0 });
  expect(f.journal.get(input.attemptId)).toMatchObject({ state: "cancelled", cancellation: { acknowledged: true } });
  let prints = 0;
  await expect(runtime.process(input, { printerIdentity: identity.printerIdentity, print: async () => { prints++; } })).rejects.toThrow("attempt_cancelled");
  expect(prints).toBe(0);
});
it("serializes cancellation behind an in-flight physical task and reports only settled disposition", async () => {
  const f = fixture(), input = work(), w = wire(input); const runtime = new AgentRuntime(identity, f.journal, w.transport);
  let release!: () => void, started!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  const printing = runtime.process(input, { printerIdentity: identity.printerIdentity, print: async () => { started(); await gate; } }); await entered; w.cancel();
  const recovering = runtime.recover(); await Promise.resolve(); expect(w.calls).not.toContain("neutralized");
  release(); await printing; await recovering; expect(f.journal.get(input.attemptId)?.cancellation?.disposition).toBe("settled");
});

const resetJob: ResetJob = { workflowId: "workflow0000001", sourceKey: "a".repeat(64), upstreamEventId: "101", upstreamListId: "201", upstreamAttendeeId: "301", resetId: "reset0000000001", checkinId: "401", fingerprint: "b".repeat(64) };
it.each(["deleted", "uncertain", "identity_changed", "malformed", "lost"])("coordinator commits reset fence before injected external transport: %s", async result => {
  const pb = new PocketBase("http://127.0.0.1"); let state = "queued", effects = 0; const calls: string[] = [];
  pb.send = (async (_url: string, options: { body: Record<string, unknown> }) => {
    const op = String(options.body.operation); calls.push(op);
    if (op === "machine_reset_claim") { if (state !== "queued") return { job: null }; state = "possibly_sent"; return { job: resetJob }; }
    if (op === "machine_reset_fence") return { resetId: resetJob.resetId, authorized: true };
    if (op === "machine_reset_result") { expect(state).toBe("possibly_sent"); state = String(options.body.outcome); return { resetId: resetJob.resetId, state }; }
    return {};
  }) as typeof pb.send;
  const coordinator = new Coordinator(pb); await coordinator.listen();
  try {
    const transport = { reset: async (job: ResetJob, beforeDelete: () => Promise<void>) => { expect(state).toBe("possibly_sent"); expect(job).toEqual(resetJob); if (result === "identity_changed") return "identity_changed" as const; await beforeDelete(); effects++; if (result === "lost") throw new Error("synthetic loss"); return result as "deleted"; } };
    expect(await coordinator.processResets(transport)).toBe(1); expect(await coordinator.processResets(transport)).toBe(0); expect(effects).toBe(result === "identity_changed" ? 0 : 1);
    expect(state).toBe(["malformed", "lost"].includes(result) ? "uncertain" : result);
    await expect(coordinator.machine("wts_agent_" + "a".repeat(64), "machine_reset_claim" as "work", { stationId: identity.stationId })).rejects.toThrow();
  } finally { await coordinator.close(); }
});
it("malformed reset job and lost claim/result responses never repeat the external effect", async () => {
  for (const fault of ["job", "claim", "result"]) {
    const pb = new PocketBase("http://127.0.0.1"); let claimed = false, effects = 0;
    pb.send = (async (_url: string, options: { body: Record<string, unknown> }) => {
      const op = options.body.operation;
      if (op === "machine_reset_claim") { if (claimed) return { job: null }; claimed = true; if (fault === "claim") throw new Error("lost"); return { job: fault === "job" ? { ...resetJob, checkinId: "01" } : resetJob }; }
      if (op === "machine_reset_fence") return { resetId: resetJob.resetId, authorized: true };
      if (op === "machine_reset_result") throw new Error("lost");
      return {};
    }) as typeof pb.send;
    const coordinator = new Coordinator(pb); await coordinator.listen();
    try { const transport = { reset: async (_job: ResetJob, beforeDelete: () => Promise<void>) => { await beforeDelete(); effects++; return "deleted" as const; } }; await expect(coordinator.processResets(transport)).rejects.toThrow(); expect(await coordinator.processResets(transport)).toBe(0); expect(effects).toBe(fault === "result" ? 1 : 0); }
    finally { await coordinator.close(); }
  }
});
