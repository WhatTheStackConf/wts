import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
import { lifecycleStatusSchema, validateLifecycleResponse } from "~/lib/checkin-lifecycle-validation";
import { parseCheckinLookupRecovery } from "~/lib/checkin-lookup-recovery-validation";
import { confirmCheckinLookup, getCheckinLookupRecovery, searchCheckinLookup } from "~/lib/checkin-lookup-client";
import { commandRecovery, createRecoveryCommandSlot } from "~/lib/checkin-recovery-client";
import { SYNTHETIC_LABEL_CONFIG } from "~/lib/checkin-label-render-contract";
import type { RecoveryCommand, RecoveryWorkflow } from "~/lib/checkin-recovery-contract";

const operationId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const context: CheckinEventContext = { protocolVersion: 1, edition: "WTS2026", eventId: "aaaaaaaaaaaaaaa", eventGeneration: 1, bindingId: "bbbbbbbbbbbbbbb", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 };
afterEach(() => vi.unstubAllGlobals());

describe("lifecycle status invariants", () => {
  const open = { edition: "WTS2026", closedAt: null, purgeDeadline: null, centralDeletedAt: null, centralCompactedAt: null, totals: null, restoreRequired: false, restoreGeneration: 0, reconciledAt: null, approvedAt: null, devices: [] };
  const closedAt = "2026-10-01T00:00:00.000Z", deadline = "2026-10-31T00:00:00.000Z", later = "2026-11-01T00:00:00.000Z";
  const device = { id: "device", stationId: "station", journalIdentity: "", completedAt: null, method: null, unreachable: false };
  const issues = (value: object) => { const result = lifecycleStatusSchema.safeParse({ ...open, ...value }); return result.success ? [] : result.error.issues.map(issue => issue.message); };
  it.each([
    [{}, []],
    [{ closedAt, purgeDeadline: deadline, centralDeletedAt: later, centralCompactedAt: later, totals: { workflows: 1, prints: 2 }, reconciledAt: later, approvedAt: later }, []],
    [{ closedAt }, ["Closure requires a fixed deadline"]],
    [{ purgeDeadline: deadline }, ["Closure requires a fixed deadline"]],
    [{ closedAt, purgeDeadline: later }, ["Deadline must be thirty days after closure"]],
    [{ centralDeletedAt: later }, ["Deletion cannot precede deadline", "Anonymous totals accompany central deletion"]],
    [{ closedAt, purgeDeadline: deadline, centralDeletedAt: closedAt, totals: { workflows: 0, prints: 0 } }, ["Deletion cannot precede deadline"]],
    [{ centralCompactedAt: later }, ["Compaction requires deletion"]],
    [{ closedAt, purgeDeadline: deadline, centralDeletedAt: later, centralCompactedAt: deadline, totals: { workflows: 0, prints: 0 } }, ["Compaction requires deletion"]],
    [{ totals: { workflows: 0, prints: 0 } }, ["Anonymous totals accompany central deletion"]],
    [{ approvedAt: later }, ["Approval requires reconciled state"]],
    [{ approvedAt: later, reconciledAt: later, restoreRequired: true }, ["Approval requires reconciled state"]],
    [{ approvedAt: deadline, reconciledAt: later }, ["Approval requires reconciled state"]],
    [{ devices: [device, { ...device, completedAt: later }, { ...device, id: "other", method: "wipe" }] }, ["Duplicate device identity", "Device completion requires method", "Device completion requires method"]],
    [{ closedAt, totals: { workflows: 0, prints: 0 }, devices: [{ ...device, method: "wipe" }] }, ["Closure requires a fixed deadline", "Anonymous totals accompany central deletion", "Device completion requires method"]],
  ] as const)("reports %j as %j", (value, expected) => { expect(issues(value)).toEqual(expected); });
  it("confirms the requested operation", () => {
    const close = { operation: "close", command: { operationId, confirmEdition: "WTS2026" } } as const;
    const approve = (generation: number) => ({ operation: "approve_restore", command: { generation, confirmEdition: "WTS2026" } }) as const;
    expect(validateLifecycleResponse(open, { operation: "status" })).toEqual(open);
    expect(() => validateLifecycleResponse(open, close)).toThrow("Closure not confirmed");
    expect(validateLifecycleResponse({ ...open, closedAt, purgeDeadline: deadline }, close).closedAt).toBe(closedAt);
    const approved = { ...open, restoreGeneration: 2, reconciledAt: closedAt, approvedAt: deadline };
    expect(validateLifecycleResponse(approved, approve(2))).toEqual(approved);
    for (const [value, generation] of [[approved, 3], [{ ...approved, approvedAt: null }, 2], [{ ...open, restoreGeneration: 2 }, 2], [{ ...approved, closedAt, purgeDeadline: deadline }, 2]] as const) expect(() => validateLifecycleResponse(value, approve(generation))).toThrow("Restore approval not confirmed for this generation");
  });
});

describe("lookup recovery descriptor", () => {
  const base = { operationId, context, attendeeId: "21", state: "dependency_unavailable", recovery: "available", actions: ["retry"] };
  const workflow = { id: "workflow0000001", stationId: "wts2026station1", eventId: "aaaaaaaaaaaaaaa", eventTitle: "Conference", state: "not_submitted", name: "Ана", affiliation: "", profileId: "profile", createdAt: "2026-10-01T00:00:00Z" };
  const reserved = { ...base, state: "reserved", actions: [], result: { operationId, state: "reserved", workflow, replayed: false, operationsEnabled: false } };
  it.each([
    [base, "ok"],
    [{ ...base, actions: [], state: "accepted" }, "ok"],
    [{ ...base, state: "needs_affiliation_choice", actions: ["blank", "retry", "replay"] }, "ok"],
    [reserved, "ok"],
    [{ ...base, operationId: otherId }, "Mismatched recovery identity"],
    [{ ...base, actions: ["retry", "retry"] }, "Mismatched recovery identity"],
    [{ ...base, recovery: "context_changed" }, "Changed context cannot grant recovery"],
    [{ ...base, recovery: "context_changed", actions: [] }, "ok"],
    [{ ...base, actions: ["blank"] }, "Invalid blank continuation"],
    [{ ...base, state: "accepted" }, "Invalid read continuation"],
    [{ ...base, result: { operationId: otherId, state: "dependency_unavailable", replayed: false, operationsEnabled: false } }, "Mismatched recovered outcome"],
    [{ ...base, result: { operationId, state: "needs_affiliation_choice", replayed: false, operationsEnabled: false } }, "Mismatched recovered outcome"],
    [{ ...reserved, result: { ...reserved.result, workflow: { ...workflow, stationId: "wts2026station2" } } }, "Mismatched recovered origin"],
    [{ ...reserved, result: { ...reserved.result, workflow: { ...workflow, eventId: "ccccccccccccccc" } } }, "Mismatched recovered origin"],
  ] as const)("parses %j as %s", (value, expected) => {
    let outcome = "ok";
    try { expect(parseCheckinLookupRecovery(value, operationId)).toEqual(value); } catch (error) { outcome = (error as Error).message; }
    expect(outcome).toBe(expected);
  });
});

describe("lookup browser request errors", () => {
  const confirm = { operationId, attendeeId: "21", qrIdentity: "A-TEST001", affiliationChoice: "fetch" as const, context };
  const failure = async (run: () => Promise<unknown>) => { try { await run(); return "resolved"; } catch (error) { const e = error as { message: string; ambiguous: boolean; kind: string; status?: number }; return [e.message, e.ambiguous, e.kind, e.status]; } };
  it.each([
    [401, ["Lookup access denied. Verify your login and station binding.", false, "access", 401], ["Lookup access denied. Verify your login and station binding.", true, "access", 401]],
    [403, ["Lookup access denied. Verify your login and station binding.", false, "access", 403], ["Lookup access denied. Verify your login and station binding.", true, "access", 403]],
    [409, ["Lookup context changed. Preserve the original confirmation for recovery.", false, "context", 409], ["Lookup context changed. Preserve the original confirmation for recovery.", true, "context", 409]],
    [500, ["Lookup unavailable. Retry the same request.", false, "transport", 500], ["Lookup unavailable. Retry the same request.", true, "transport", 500]],
  ] as const)("maps HTTP %s", async (status, read, mutation) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(null, { status })));
    expect(await failure(() => searchCheckinLookup({ context, query: "Person" }))).toEqual(read);
    expect(await failure(() => confirmCheckinLookup(confirm))).toEqual(mutation);
  });
  it("maps transport and invalid responses by mutation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await failure(() => searchCheckinLookup({ context, query: "Person" }))).toEqual(["Lookup unavailable. Retry your search.", false, "transport", undefined]);
    expect(await failure(() => confirmCheckinLookup(confirm))).toEqual(["Confirmation outcome unknown. Retry the same confirmation.", true, "transport", undefined]);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ bad: true })));
    expect(await failure(() => getCheckinLookupRecovery(operationId))).toEqual(["Lookup response invalid. No results can be used; retry your search.", false, "invalid", undefined]);
    expect(await failure(() => confirmCheckinLookup(confirm))).toEqual(["Confirmation response invalid. Outcome unknown; retry the same confirmation.", true, "invalid", undefined]);
  });
});

describe("recovery command projection checks", () => {
  const workflowId = "workflow0000001", printId = "print0000000001", nextPrint = "print0000000002";
  const workflow = (patch: Partial<RecoveryWorkflow> = {}): RecoveryWorkflow => ({ workflowId, stationId: "wts2026station1", eventId: "event0000000001", eventTitle: "Conference", admissionState: "admission_uncertain", version: 1, name: "Ана", affiliation: "", decision: "", fulfillment: "", parked: false, completedDay: "", isolated: false, profile: { id: "profile00000001", stationId: "wts2026station1", version: 1, approval: "approved", config: SYNTHETIC_LABEL_CONFIG }, admissionReadRetryEligible: false, attempts: [], reads: [], admissionAttempts: [], resets: [], operationsEnabled: false, ...patch });
  const attempt = (patch: object) => ({ id: printId, purpose: "initial", state: "completed", name: "Ана", affiliation: "", predecessorId: "", observation: null, cancellation: null, ...patch });
  const base = { operationId, workflowId, expectedVersion: 0 };
  const truth = { ...base, reason: "incident" as const, note: "" };
  const outcome = async (command: RecoveryCommand, result: object) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ operationId, ...result })));
    try { await commandRecovery(command); return "ok"; } catch (error) { return (error as { ambiguous: boolean }).ambiguous ? "ambiguous" : "rejected"; }
  };
  it.each([
    ["correct match", { ...base, operation: "correct", name: "Ана", affiliation: "" }, { workflow: workflow() }, "ok"],
    ["correct drift", { ...base, operation: "correct", name: "Ана", affiliation: "Org" }, { workflow: workflow() }, "ambiguous"],
    ["park match", { ...base, operation: "park" }, { workflow: workflow({ parked: true }) }, "ok"],
    ["park drift", { ...base, operation: "park" }, { workflow: workflow() }, "ambiguous"],
    ["resume match", { ...base, operation: "resume" }, { workflow: workflow() }, "ok"],
    ["resume drift", { ...base, operation: "resume" }, { workflow: workflow({ parked: true }) }, "ambiguous"],
    ["observe match", { ...base, operation: "observe", printId, outcome: "printed" }, { workflow: workflow({ attempts: [attempt({ observation: "printed" })] }) }, "ok"],
    ["observe drift", { ...base, operation: "observe", printId, outcome: "printed" }, { workflow: workflow({ attempts: [attempt({ observation: "not_printed" })] }) }, "ambiguous"],
    ["observe empty", { ...base, operation: "observe", printId, outcome: "printed" }, { workflow: workflow() }, "ambiguous"],
    ["replace match", { ...base, operation: "replace", printId }, { workflow: workflow({ attempts: [attempt({}), attempt({ id: nextPrint, purpose: "replacement", predecessorId: printId })] }) }, "ok"],
    ["replace same", { ...base, operation: "replace", printId }, { workflow: workflow({ attempts: [attempt({ purpose: "replacement", predecessorId: printId })] }) }, "ambiguous"],
    ["replace predecessor", { ...base, operation: "replace", printId }, { workflow: workflow({ attempts: [attempt({ id: nextPrint, purpose: "replacement", predecessorId: "" })] }) }, "ambiguous"],
    ["authorize match", { ...truth, operation: "authorize_initial", readId: "reading00000001" }, { workflow: workflow({ decision: "authorized", attempts: [attempt({})] }) }, "ok"],
    ["authorize decision", { ...truth, operation: "authorize_initial", readId: "reading00000001" }, { workflow: workflow({ attempts: [attempt({})] }) }, "ambiguous"],
    ["authorize count", { ...truth, operation: "authorize_initial", readId: "reading00000001" }, { workflow: workflow({ decision: "authorized", attempts: [attempt({}), attempt({})] }) }, "ambiguous"],
    ["handwrite match", { ...base, operation: "handwrite", physicallyIsolated: true }, { workflow: workflow({ fulfillment: "handwrite_pending" }) }, "ok"],
    ["handwrite drift", { ...base, operation: "handwrite", physicallyIsolated: true }, { workflow: workflow({ fulfillment: "printed" }) }, "ambiguous"],
    ["reset match", { ...truth, operation: "reset", readId: "reading00000001", checkinId: "901", confirmed: true, producersQuiescent: true }, { workflow: workflow({ decision: "reset_pending", resets: [{ id: "reset0000000001", state: "queued", checkinId: "901", sendBoundaryAt: "" }] }) }, "ok"],
    ["reset drift", { ...truth, operation: "reset", readId: "reading00000001", checkinId: "901", confirmed: true, producersQuiescent: true }, { workflow: workflow({ decision: "reset_pending" }) }, "ambiguous"],
    ["deny unchecked", { ...truth, operation: "deny" }, { workflow: workflow() }, "ok"],
    ["retry receipt", { ...base, operation: "retry_admission_reads" }, { workflow: workflow() }, "ambiguous"],
    ["wrong operation", { ...base, operation: "park" }, { operationId: otherId, workflow: workflow({ parked: true }) }, "ambiguous"],
    ["wrong workflow", { ...base, operation: "park" }, { workflow: workflow({ parked: true, workflowId: "workflow0000002" }) }, "ambiguous"],
    ["wrong version", { ...base, operation: "park" }, { workflow: workflow({ parked: true, version: 2 }) }, "ambiguous"],
    ["receipt behind projection", { ...base, operation: "park" }, { workflow: workflow({ version: 4 }), commandVersion: 1, replayed: true, commandId: "command00000001", commandOutcome: { decision: "", fulfillment: "" } }, "ok"],
    ["fresh receipt behind projection", { ...base, operation: "park" }, { workflow: workflow({ version: 4 }), commandVersion: 1, replayed: false, commandId: "command00000001", commandOutcome: { decision: "", fulfillment: "" } }, "ambiguous"],
    ["projection behind receipt", { ...base, operation: "park" }, { workflow: workflow({ version: 0, parked: true }), commandVersion: 1, replayed: true, commandId: "command00000001", commandOutcome: { decision: "", fulfillment: "" } }, "ambiguous"],
  ] as const)("%s", async (_name, command, result, expected) => {
    expect(await outcome(command as RecoveryCommand, result)).toBe(expected);
  });
  it("keeps one pending command per slot and generation", async () => {
    const slot = createRecoveryCommandSlot();
    const park: RecoveryCommand = { ...base, operation: "park" };
    await expect(slot.submit()).rejects.toMatchObject({ ambiguous: false, denied: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 409 })));
    await expect(slot.submit(park)).rejects.toMatchObject({ ambiguous: false });
    expect(slot.pending()).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(slot.submit(park)).rejects.toMatchObject({ denied: true });
    expect(slot.pending()).toEqual(park);
    await expect(slot.submit(park)).rejects.toMatchObject({ ambiguous: false, denied: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 409 })));
    await expect(slot.submit()).rejects.toMatchObject({ ambiguous: false });
    expect(slot.pending()).toEqual(park);
    let release!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(resolve => { release = resolve; })));
    const running = slot.submit();
    await expect(slot.submit()).rejects.toMatchObject({ ambiguous: false });
    slot.reset();
    expect(slot.pending()).toBeUndefined();
    release(Response.json({ operationId, workflow: workflow({ parked: true }) }));
    expect(await running).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ operationId, workflow: workflow({ parked: true }) })));
    await expect(slot.submit(park)).resolves.toMatchObject({ operationId });
    expect(slot.pending()).toBeUndefined();
  });
});
