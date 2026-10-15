import { describe, expect, it, vi } from "vite-plus/test";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
import { handleCheckinLifecycleRequest } from "~/lib/checkin-lifecycle-http";
import { handleCheckinLookupRequest } from "~/lib/checkin-lookup-http";
import { handleCheckinMonitoringRequest } from "~/lib/checkin-monitoring-http";
import { handleCheckinRecoveryRequest } from "~/lib/checkin-recovery-http";
import { CheckinError } from "~/lib/checkin-service";

const origin = "https://wts.example.test";
const token = "a".repeat(64);
const operationId = "11111111-1111-4111-8111-111111111111";
const nextOperationId = "22222222-2222-4222-8222-222222222222";
const workflowId = "workflow0000001";
const context: CheckinEventContext = { protocolVersion: 1, edition: "WTS2026", eventId: "aaaaaaaaaaaaaaa", eventGeneration: 1, bindingId: "bbbbbbbbbbbbbbb", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 };
const openStatus = { edition: "WTS2026", closedAt: null, purgeDeadline: null, centralDeletedAt: null, centralCompactedAt: null, totals: null, restoreRequired: false, restoreGeneration: 0, reconciledAt: null, approvedAt: null, devices: [] };
type Handler = (request: Request, deps: never) => Promise<Response>;
type Service = Record<string, ReturnType<typeof vi.fn>>;

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/checkin`, { method: "POST", headers: { origin, "content-type": "application/json", cookie: `wts_checkin_client=${token}`, ...headers }, body });
}
function json(body: unknown, headers?: Record<string, string>) { return post(JSON.stringify(body), headers); }
function setup(methods: string[], role: string, id = "human0000000001") {
  const service: Service = Object.fromEntries(methods.map(name => [name, vi.fn().mockResolvedValue(undefined)]));
  return { service, deps: { authenticate: vi.fn().mockResolvedValue({ id, role }), service: vi.fn().mockResolvedValue(service) } };
}
async function call(handle: Handler, request: Request, deps: object) {
  const response = await handle(request, deps as never);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

describe("lifecycle command boundary", () => {
  const handle = handleCheckinLifecycleRequest as Handler;
  const methods = ["status", "close", "approveRestore"];
  it("returns fixed guard responses in order", async () => {
    const denied = { status: 403, body: { error: "Lifecycle access denied." } };
    expect(await call(handle, json({ operation: "status" }, { origin: "https://foreign.test" }), setup(methods, "admin").deps)).toMatchObject(denied);
    const broken = setup(methods, "admin"); broken.deps.authenticate.mockRejectedValue(new Error("secret"));
    expect(await call(handle, json({ operation: "status" }), broken.deps)).toMatchObject(denied);
    for (const [role, id] of [["checkin_operator", "human0000000001"], ["admin", ""]]) expect(await call(handle, json({ operation: "status" }), setup(methods, role, id).deps)).toMatchObject({ status: 403, body: { error: "Lifecycle access requires an admin." } });
    expect(await call(handle, json({ operation: "status" }, { "content-type": "text/plain" }), setup(methods, "admin").deps)).toMatchObject({ status: 415, body: { error: "Use a JSON lifecycle command." } });
    expect(await call(handle, post(" ".repeat(4097)), setup(methods, "admin").deps)).toMatchObject({ status: 413, body: { error: "Lifecycle command too large." } });
    expect(await call(handle, post(new Uint8Array([0x7b, 0xff, 0x7d])), setup(methods, "admin").deps)).toMatchObject({ status: 400, body: { error: "Invalid lifecycle command." } });
    expect(await call(handle, post(null), setup(methods, "admin").deps)).toMatchObject({ status: 400, body: { error: "Invalid lifecycle command." } });
  });
  it("accepts parameterized JSON within the exact byte limit and dispatches each operation", async () => {
    const fixture = setup(methods, "admin"); fixture.service.status.mockResolvedValue(openStatus);
    const padded = JSON.stringify({ operation: "status" }).padEnd(4096, " ");
    const ok = await call(handle, post(padded, { "content-type": " Application/JSON ; charset=utf-8" }), fixture.deps);
    expect(ok).toMatchObject({ status: 200, body: openStatus });
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff"); expect(ok.headers.get("vary")).toBe("Cookie");
    expect(await call(handle, post(`\uFEFF${JSON.stringify({ operation: "status" })}`), fixture.deps)).toMatchObject({ status: 200, body: openStatus });
    const close = { operationId, confirmEdition: "WTS2026" }, approve = { generation: 3, confirmEdition: "WTS2026" };
    const unavailable = { status: 503, body: { error: "Lifecycle outcome unavailable. A mutation may have been saved; retry the same command." } };
    expect(await call(handle, json({ operation: "close", command: close }), fixture.deps)).toMatchObject(unavailable);
    expect(await call(handle, json({ operation: "approve_restore", command: approve }), fixture.deps)).toMatchObject(unavailable);
    expect(fixture.service.close).toHaveBeenCalledWith(close); expect(fixture.service.approveRestore).toHaveBeenCalledWith(approve);
    expect(fixture.deps.service).toHaveBeenCalledWith({ id: "human0000000001", role: "admin" });
  });
  it("maps service errors to fixed messages", async () => {
    for (const [error, expected] of [
      [new CheckinError("forbidden", 403), { status: 403, body: { error: "Lifecycle access denied." } }],
      [new CheckinError("conflict", 409), { status: 409, body: { error: "Lifecycle command rejected. Refresh the lifecycle state." } }],
      [new CheckinError("invalid_input", 400), { status: 400, body: { error: "Lifecycle command rejected. Refresh the lifecycle state." } }],
      [new CheckinError("unavailable", 503), { status: 503, body: { error: "Lifecycle outcome unavailable. A mutation may have been saved; retry the same command." } }],
    ] as const) {
      const fixture = setup(methods, "admin"); fixture.service.status.mockRejectedValue(error);
      expect(await call(handle, json({ operation: "status" }), fixture.deps)).toMatchObject(expected);
    }
  });
});

describe("lookup command boundary", () => {
  const handle = handleCheckinLookupRequest as Handler;
  const methods = ["search", "confirm", "getRecovery", "recover"];
  const search = { operation: "search", input: { context, query: "person" } };
  it("returns fixed guard responses in order", async () => {
    const denied = { status: 403, body: { error: "Check-in access denied." } };
    expect(await call(handle, json(search, { origin: "https://foreign.test" }), setup(methods, "admin").deps)).toMatchObject(denied);
    const broken = setup(methods, "admin"); broken.deps.authenticate.mockRejectedValue(new Error("secret"));
    expect(await call(handle, json(search), broken.deps)).toMatchObject(denied);
    for (const [role, id] of [["user", "human0000000001"], ["admin", ""]]) expect(await call(handle, json(search), setup(methods, role, id).deps)).toMatchObject(denied);
    expect(await call(handle, json(search, { "content-type": "application/jsonx" }), setup(methods, "admin").deps)).toMatchObject({ status: 415, body: { error: "Use a JSON lookup command." } });
    expect(await call(handle, post(" ".repeat(8193)), setup(methods, "admin").deps)).toMatchObject({ status: 413, body: { error: "Lookup command too large." } });
    expect(await call(handle, post("{"), setup(methods, "admin").deps)).toMatchObject({ status: 400, body: { error: "Invalid lookup command." } });
    for (const cookie of ["", "wts_checkin_client=", `wts_checkin_client=${"A".repeat(64)}`, `wts_checkin_client=${token}; wts_checkin_client=${token}`]) expect(await call(handle, json(search, { cookie }), setup(methods, "admin").deps)).toMatchObject({ status: 403, body: { error: "Invalid station client identity." } });
  });
  it("dispatches each operation with the single station token", async () => {
    const fixture = setup(methods, "checkin_operator");
    const unavailable = { status: 503, body: { error: "Lookup service unavailable. A confirmation may have been saved; retry the same command." } };
    const headers = { cookie: `theme=dark; wts_checkin_client=${token}`, "content-type": "application/json; charset=utf-8" };
    expect(await call(handle, post(JSON.stringify(search).padEnd(8192, " "), headers), fixture.deps)).toMatchObject(unavailable);
    expect(fixture.service.search).toHaveBeenCalledWith(token, { ...search.input, offset: 0 });
    const confirm = { context, operationId, attendeeId: "21", qrIdentity: "A-TEST001", affiliationChoice: "fetch" };
    expect(await call(handle, json({ operation: "confirm", input: confirm }), fixture.deps)).toMatchObject(unavailable);
    expect(fixture.service.confirm).toHaveBeenCalledWith(token, confirm);
    expect(await call(handle, json({ operation: "recovery_get", input: { operationId } }), fixture.deps)).toMatchObject(unavailable);
    expect(fixture.service.getRecovery).toHaveBeenCalledWith(token, operationId);
    expect(await call(handle, json({ operation: "recover", input: { operationId, action: "retry", nextOperationId } }), fixture.deps)).toMatchObject(unavailable);
    expect(fixture.service.getRecovery).toHaveBeenCalledTimes(2); expect(fixture.service.recover).not.toHaveBeenCalled();
  });
  it("reconstructs known errors and validates successful search results", async () => {
    const fixture = setup(methods, "admin");
    const error = new CheckinError("conflict", 409); error.message = "mutated secret";
    fixture.service.search.mockRejectedValueOnce(error);
    expect(await call(handle, json(search), fixture.deps)).toMatchObject({ status: 409, body: { code: "conflict", error: "State changed. Review the current state and confirm again." } });
    fixture.service.search.mockResolvedValueOnce({ state: "complete", context, items: [], nextOffset: null });
    expect(await call(handle, json(search), fixture.deps)).toMatchObject({ status: 200, body: { state: "complete", context, items: [], nextOffset: null } });
  });
});

describe("monitoring command boundary", () => {
  const handle = handleCheckinMonitoringRequest as Handler;
  const methods = ["dashboard", "configure", "acknowledge"];
  const command = { operationId, expectedVersion: 1, recipientUserIds: [], waitingMs: 30000, incidentMs: 60000, repeatMs: 900000 };
  it("returns fixed guard responses in order", async () => {
    const denied = { status: 403, body: { error: "Monitoring access denied." } };
    expect(await call(handle, json({ operation: "dashboard" }, { origin: "https://foreign.test" }), setup(methods, "admin").deps)).toMatchObject(denied);
    const broken = setup(methods, "admin"); broken.deps.authenticate.mockRejectedValue(new Error("secret"));
    expect(await call(handle, json({ operation: "dashboard" }), broken.deps)).toMatchObject(denied);
    expect(await call(handle, json({ operation: "dashboard" }), setup(methods, "user").deps)).toMatchObject(denied);
    expect(await call(handle, json({ operation: "dashboard" }, { "content-type": "text/json" }), setup(methods, "admin").deps)).toMatchObject({ status: 415, body: { error: "Use JSON." } });
    expect(await call(handle, post(" ".repeat(8193)), setup(methods, "admin").deps)).toMatchObject({ status: 413, body: { error: "Command too large." } });
    expect(await call(handle, json({ operation: "dashboard", offset: -1 }), setup(methods, "admin").deps)).toMatchObject({ status: 400, body: { error: "Invalid monitoring command." } });
    expect(await call(handle, json({ operation: "configure", command }), setup(methods, "checkin_operator").deps)).toMatchObject({ status: 403, body: { error: "Admin required." } });
    expect(await call(handle, json({ operation: "dashboard" }, { cookie: `wts_checkin_client=x; wts_checkin_client=y` }), setup(methods, "admin").deps)).toMatchObject({ status: 400, body: { error: "Invalid station binding." } });
  });
  it("dispatches operations with an optional unvalidated station token", async () => {
    const fixture = setup(methods, "admin", "");
    const unavailable = { status: 503, body: { error: "Monitoring service unavailable." } };
    expect(await call(handle, post(JSON.stringify({ operation: "dashboard" }).padEnd(8192, " "), { "content-type": "application/jsonx", cookie: "" }), fixture.deps)).toMatchObject(unavailable);
    expect(fixture.service.dashboard).toHaveBeenLastCalledWith(null, 0);
    expect(await call(handle, json({ operation: "dashboard", offset: 4 }, { cookie: "wts_checkin_client=" }), fixture.deps)).toMatchObject(unavailable);
    expect(fixture.service.dashboard).toHaveBeenLastCalledWith(null, 4);
    expect(await call(handle, json({ operation: "configure", command }), fixture.deps)).toMatchObject(unavailable);
    expect(fixture.service.configure).toHaveBeenCalledWith(command);
    fixture.service.acknowledge.mockResolvedValueOnce({ incidentId: "incident0000002", acknowledgedMs: 5 });
    expect(await call(handle, json({ operation: "acknowledge", incidentId: "incident0000001" }, { cookie: "wts_checkin_client=raw" }), fixture.deps)).toMatchObject(unavailable);
    expect(fixture.service.acknowledge).toHaveBeenLastCalledWith("incident0000001", "raw");
    fixture.service.acknowledge.mockResolvedValueOnce({ incidentId: "incident0000001", acknowledgedMs: 5 });
    expect(await call(handle, json({ operation: "acknowledge", incidentId: "incident0000001" }), fixture.deps)).toMatchObject({ status: 200, body: { incidentId: "incident0000001", acknowledgedMs: 5 } });
    expect(fixture.service.acknowledge).toHaveBeenLastCalledWith("incident0000001", token);
  });
  it("maps checkin errors to a fixed rejection", async () => {
    const fixture = setup(methods, "admin"); fixture.service.dashboard.mockRejectedValue(new CheckinError("invalid_binding", 400));
    expect(await call(handle, json({ operation: "dashboard" }), fixture.deps)).toMatchObject({ status: 400, body: { code: "invalid_binding", error: "Monitoring command rejected." } });
  });
});

describe("recovery command boundary", () => {
  const handle = handleCheckinRecoveryRequest as Handler;
  const methods = ["get", "history", "attemptHistory", "reconcile", "command", "preview"];
  const park = { operation: "park", operationId, workflowId, expectedVersion: 0 };
  const deny = { operation: "deny", operationId, workflowId, expectedVersion: 0, reason: "incident", note: "" };
  it("returns fixed guard responses in order", async () => {
    const denied = { status: 403, body: { error: "Recovery access denied." } };
    const history = { operation: "history", offset: 0 };
    expect(await call(handle, json(history, { origin: "https://foreign.test" }), setup(methods, "admin").deps)).toMatchObject(denied);
    const broken = setup(methods, "admin"); broken.deps.authenticate.mockRejectedValue(new Error("secret"));
    expect(await call(handle, json(history), broken.deps)).toMatchObject(denied);
    for (const [role, id] of [["user", "human0000000001"], ["admin", ""]]) expect(await call(handle, json(history), setup(methods, role, id).deps)).toMatchObject(denied);
    expect(await call(handle, json(history, { "content-type": "application/jsonx" }), setup(methods, "admin").deps)).toMatchObject({ status: 415, body: { error: "JSON required." } });
    expect(await call(handle, post(" ".repeat(8193)), setup(methods, "admin").deps)).toMatchObject({ status: 413, body: { error: "Command too large." } });
    expect(await call(handle, json({ operation: "history" }), setup(methods, "admin").deps)).toMatchObject({ status: 400, body: { error: "Invalid recovery command." } });
    for (const body of [{ operation: "reconcile", workflowId }, { operation: "command", command: deny }]) expect(await call(handle, json(body), setup(methods, "checkin_operator").deps)).toMatchObject({ status: 403, body: { error: "Admin required." } });
    const binding = { status: 403, body: { error: "Station binding required." } };
    for (const [role, cookie] of [["admin", `wts_checkin_client=${token}; wts_checkin_client=${token}`], ["admin", "wts_checkin_client=bad"], ["admin", "wts_checkin_client="], ["checkin_operator", ""]]) expect(await call(handle, json(history, { cookie }), setup(methods, role).deps)).toMatchObject(binding);
  });
  it("dispatches each operation", async () => {
    const fixture = setup(methods, "admin");
    const unavailable = { status: 503, body: { error: "Recovery unavailable. Preserve and retry the exact command; its outcome may be unknown." } };
    for (const body of [{ operation: "get", workflowId }, { operation: "history", offset: 2 }, { operation: "attempt_history", workflowId, offset: 3 }, { operation: "preview", workflowId, name: "Ана", affiliation: "" }, { operation: "command", command: park }]) expect(await call(handle, json(body), fixture.deps)).toMatchObject(unavailable);
    expect(fixture.service.get).toHaveBeenCalledWith(token, workflowId);
    expect(fixture.service.history).toHaveBeenCalledWith(token, 2);
    expect(fixture.service.attemptHistory).toHaveBeenCalledWith(token, workflowId, 3);
    expect(fixture.service.preview).toHaveBeenCalledWith(token, workflowId, "Ана", "");
    expect(fixture.service.command).toHaveBeenCalledWith(token, park);
    fixture.service.reconcile.mockResolvedValueOnce({ id: "reading00000001", state: "absent", checkinId: "" });
    expect(await call(handle, json({ operation: "reconcile", workflowId }, { cookie: "" }), fixture.deps)).toMatchObject({ status: 200, body: { id: "reading00000001", state: "absent", checkinId: "" } });
    expect(fixture.service.reconcile).toHaveBeenCalledWith(workflowId);
  });
  it("maps service errors to fixed messages", async () => {
    for (const [status, code] of [[400, "invalid_input"], [403, "forbidden"], [409, "conflict"]] as const) {
      const fixture = setup(methods, "admin"); fixture.service.history.mockRejectedValue(new CheckinError(code, status));
      expect(await call(handle, json({ operation: "history", offset: 0 }), fixture.deps)).toMatchObject({ status, body: { error: "Recovery request rejected." } });
    }
    const fixture = setup(methods, "admin"); fixture.service.history.mockRejectedValue(new CheckinError("unavailable", 503));
    expect(await call(handle, json({ operation: "history", offset: 0 }), fixture.deps)).toMatchObject({ status: 503, body: { error: "Recovery unavailable. Preserve and retry the exact command; its outcome may be unknown." } });
  });
});
