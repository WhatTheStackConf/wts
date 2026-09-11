import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { handleCheckinRecoveryRequest, type RecoveryHttpDependencies } from "./checkin-recovery-http";
import { commandRecovery, createRecoveryCommandSlot, getRecovery, recoveryHistory, previewRecovery } from "./checkin-recovery-client";
import { SYNTHETIC_LABEL_CONFIG } from "./checkin-label-render-contract";
import type { RecoveryCommand, RecoveryWorkflow } from "./checkin-recovery-contract";
const token = "b".repeat(64), workflowId = "workflow0000001";
const command = (): RecoveryCommand => ({ operation: "park", operationId: crypto.randomUUID(), workflowId, expectedVersion: 0 });
const workflow = (): RecoveryWorkflow => ({ workflowId, stationId: "wts2026station1", eventId: "event0000000001", eventTitle: "Conference", admissionState: "admission_uncertain", version: 1, name: "Ѓорѓи", affiliation: "", decision: "", fulfillment: "", parked: true, completedDay: "", isolated: false, profile: { id: "profile00000001", stationId: "wts2026station1", version: 1, approval: "approved", config: SYNTHETIC_LABEL_CONFIG }, admissionReadRetryEligible: false, attempts: [], reads: [], admissionAttempts: [], resets: [], operationsEnabled: false });
function deps(role = "checkin_operator") {
  const service = { get: vi.fn().mockResolvedValue(workflow()), history: vi.fn().mockResolvedValue({ items: [workflow()], nextOffset: null }), reconcile: vi.fn().mockResolvedValue({ id: "reading00000001", state: "absent", checkinId: "" }), command: vi.fn().mockImplementation(async (_token, c) => ({ operationId: c.operationId, workflow: workflow() })), preview: vi.fn() };
  return { authenticate: vi.fn().mockResolvedValue({ id: "actor", role }), service: vi.fn().mockResolvedValue(service), target: service } satisfies RecoveryHttpDependencies & { target: typeof service };
}
function request(body: unknown, options: { origin?: string; cookie?: string; method?: string } = {}) {
  const method = options.method ?? "POST";
  return new Request("https://wts.test/api/checkin-recovery", { method, headers: { origin: options.origin ?? "https://wts.test", "content-type": "application/json", cookie: options.cookie ?? `wts_checkin_client=${token}` }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
}
afterEach(() => vi.unstubAllGlobals());
describe("recovery authenticated HTTP and strict client boundary", () => {
  it("requires authoritative retry eligibility and a receipt; malformed success retains the retry identity", async () => {
    const c: RecoveryCommand = { ...command(), operation: "retry_admission_reads" };
    const d = deps();
    d.target.get.mockResolvedValue({ ...workflow(), admissionReadRetryEligible: undefined });
    expect((await handleCheckinRecoveryRequest(request({ operation: "get", workflowId }), d)).status).toBe(503);
    const slot = createRecoveryCommandSlot();
    const projection = { ...workflow(), admissionState: "not_submitted" };
    const receipt = { operationId: c.operationId, workflow: projection, replayed: true, commandId: "command00000001", commandVersion: 1, commandOutcome: { decision: "", fulfillment: "", printId: "" } };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ operationId: c.operationId, workflow: projection }))
      .mockResolvedValueOnce(Response.json({ ...receipt, workflow: { ...projection, admissionReadRetryEligible: undefined } }))
      .mockResolvedValueOnce(Response.json({ ...receipt, workflow: { ...projection, admissionReadRetryEligible: true } })));
    await expect(slot.submit(c)).rejects.toMatchObject({ ambiguous: true });
    expect(slot.pending()).toEqual(c);
    await expect(slot.submit()).rejects.toMatchObject({ ambiguous: true });
    expect(slot.pending()).toEqual(c);
    // Same recovery version may already have exhausted its read budget again.
    await expect(slot.submit()).resolves.toMatchObject({ replayed: true, commandVersion: 1 });
    expect(slot.pending()).toBeUndefined();
  });
  it("keeps immutable command receipts distinct from later workflow projections", async () => {
    const c = command();
    const receipt = { operationId: c.operationId, workflow: { ...workflow(), version: 5, parked: false }, replayed: true, commandId: "command00000001", commandVersion: 1, commandOutcome: { decision: "", fulfillment: "", printId: "" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(receipt)));
    expect((await commandRecovery(c)).commandVersion).toBe(1);
    for (const bad of [{ ...receipt, replayed: false }, { ...receipt, commandVersion: 2 }, { ...receipt, commandId: undefined }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(bad)));
      await expect(commandRecovery(c)).rejects.toMatchObject({ ambiguous: true });
    }
  });
  it.each(["user", "reviewer", "", "agent"])("denies role %s before privileged service", async role => { const d = deps(role); expect((await handleCheckinRecoveryRequest(request({ operation: "history", offset: 0 }), d)).status).toBe(403); expect(d.service).not.toHaveBeenCalled(); });
  it.each(["authorize_initial", "reset", "deny", "cancel", "continue"])("denies operator truth operation %s", async operation => {
    const d = deps(); const c = { ...command(), operation, reason: "incident", note: "", ...(operation === "authorize_initial" || operation === "reset" ? { readId: "reading00000001" } : {}), ...(operation === "reset" ? { checkinId: "1", confirmed: true, producersQuiescent: true } : {}) };
    expect((await handleCheckinRecoveryRequest(request({ operation: "command", command: c }), d)).status).toBe(403); expect(d.service).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, GET, reconcile, duplicate or malformed cookie and extra capabilities", async () => {
    for (const [body, options] of [[{ operation: "history", offset: 0 }, { origin: "https://evil.test" }], [{ operation: "history", offset: 0 }, { method: "GET" }], [{ operation: "reconcile", workflowId }, {}], [{ operation: "history", offset: 0 }, { cookie: "wts_checkin_client=bad" }], [{ operation: "history", offset: 0 }, { cookie: `wts_checkin_client=${token}; wts_checkin_client=${token}` }], [{ operation: "history", offset: 0, bindingToken: token }, {}]] as const) { const d = deps(); expect((await handleCheckinRecoveryRequest(request(body, options), d)).status).toBeGreaterThanOrEqual(400); expect(d.service).not.toHaveBeenCalled(); }
  });
  it("bounded streaming rejects before service acquisition", async () => {
    let reads = 0; const d = deps(); const body = new ReadableStream<Uint8Array>({ pull(c) { reads++; c.enqueue(new Uint8Array(8193)); } }, { highWaterMark: 0 });
    const r = new Request("https://wts.test/api/checkin-recovery", { method: "POST", headers: { origin: "https://wts.test", "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
    expect((await handleCheckinRecoveryRequest(r, d)).status).toBe(413); expect(reads).toBe(1); expect(d.service).not.toHaveBeenCalled();
  });
  it("round-trips real Request/Response and strict client, private cookies only", async () => {
    const d = deps(); const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { bodies.push(init.body); expect(init.credentials).toBe("same-origin"); expect(init.cache).toBe("no-store"); const response = await handleCheckinRecoveryRequest(request(JSON.parse(init.body)), d); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer"); return response; }));
    const c = command(); expect((await commandRecovery(c)).workflow.name).toBe("Ѓорѓи"); expect((await getRecovery(workflowId)).workflowId).toBe(workflowId); expect((await recoveryHistory()).items).toHaveLength(1); expect(d.target.command).toHaveBeenCalledWith(token, c); expect(bodies.join()).not.toContain(token);
  });
  it("admin can reconcile without station cookie; no output is implicitly authorized", async () => { const d = deps("admin"); expect((await handleCheckinRecoveryRequest(request({ operation: "reconcile", workflowId }, { cookie: "" }), d)).status).toBe(200); expect(d.target.command).not.toHaveBeenCalled(); });
  it.each(["email", "bindingToken", "qr", "capability"])("rejects unexpected successful response field %s server-side", async field => { const d = deps(); d.target.get.mockResolvedValue({ ...workflow(), [field]: "private@example.test" }); const r = await handleCheckinRecoveryRequest(request({ operation: "get", workflowId }), d); expect(r.status).toBe(503); expect(await r.text()).not.toContain("private@"); });
  it("does not render raw upstream diagnostics or private text", async () => { const d = deps(); d.target.get.mockRejectedValue(new Error(`private@example.test ${token}`)); const r = await handleCheckinRecoveryRequest(request({ operation: "get", workflowId }), d); expect(await r.text()).not.toMatch(/private@|bbbb/); });
  it.each(["bad_json", "wrong_id", "wrong_workflow", "wrong_version", "extra_field", "lost_response"])("retains frozen ambiguous command after %s and independent failed reads", async mode => {
    const c = command(), original = structuredClone(c), slot = createRecoveryCommandSlot(); const sent: string[] = []; let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => { const input = JSON.parse(init.body); if (input.operation === "get") throw new Error("read failure"); sent.push(init.body); calls++; if (calls === 1) { if (mode === "lost_response") throw new Error("disconnect"); if (mode === "bad_json") return new Response("{"); const result = { operationId: mode === "wrong_id" ? crypto.randomUUID() : original.operationId, workflow: { ...workflow(), ...(mode === "wrong_workflow" ? { workflowId: "otherwork000001" } : {}), ...(mode === "wrong_version" ? { version: 99 } : {}) }, ...(mode === "extra_field" ? { email: "private@example.test" } : {}) }; return Response.json(result); } return Response.json({ operationId: original.operationId, workflow: workflow() }); }));
    const first = slot.submit(c); c.operationId = crypto.randomUUID(); c.expectedVersion = 99;
    await expect(first).rejects.toMatchObject({ ambiguous: true }); expect(slot.pending()).toEqual(original); expect(Object.isFrozen(slot.pending())).toBe(true);
    await expect(getRecovery(workflowId)).rejects.toBeDefined(); expect(slot.pending()).toEqual(original); await expect(slot.submit()).resolves.toMatchObject({ operationId: original.operationId }); expect(sent[1]).toBe(sent[0]); expect(slot.pending()).toBeUndefined();
  });
  it("does not clear ambiguity on a later 403; scope reset redacts and suppresses stale completion", async () => {
    const slot = createRecoveryCommandSlot(), c = command(); vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValueOnce(new Response("private@example.test", { status: 403 })));
    await expect(slot.submit(c)).rejects.toBeDefined(); await expect(slot.submit()).rejects.toMatchObject({ denied: true }); expect(slot.pending()).toEqual(c);
    let finish!: (r: Response) => void; vi.stubGlobal("fetch", () => new Promise<Response>(resolve => { finish = resolve; })); const inflight = slot.submit(); slot.reset(); finish(Response.json({ operationId: c.operationId, workflow: workflow() })); expect(await inflight).toBeUndefined(); expect(slot.pending()).toBeUndefined();
  });
  it.each([401, 403])("retains the exact first denied command after %s until a validated replay", async status => {
    const slot = createRecoveryCommandSlot(), c = command();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("denied", { status })).mockResolvedValueOnce(Response.json({ operationId: c.operationId, workflow: workflow() })));
    await expect(slot.submit(c)).rejects.toMatchObject({ denied: true });
    expect(slot.pending()).toEqual(c); expect(Object.isFrozen(slot.pending())).toBe(true);
    await expect(slot.submit()).resolves.toMatchObject({ operationId: c.operationId });
    expect(slot.pending()).toBeUndefined();
  });
  it("rejects unsafe input before fetching and mismatched preview text", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); await expect(previewRecovery(workflowId, "private@example.test", "")).rejects.toBeDefined(); expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(Response.json({ workflowId, name: "Wrong", affiliation: "", pngBase64: "iVBORw0KGgo=", width: 600, height: 360, rows: [{ text: "Wrong", fontSize: 64, shortened: false }, { text: "", fontSize: 20, shortened: false }] })); await expect(previewRecovery(workflowId, "Ѓорѓи", "")).rejects.toMatchObject({ ambiguous: true });
  });
});
