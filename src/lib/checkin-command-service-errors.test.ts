import { describe, expect, it, vi } from "vite-plus/test";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
import type PocketBase from "pocketbase";
import { CheckinLifecycleService } from "~/lib/checkin-lifecycle-service";
import { CheckinLookupService } from "~/lib/checkin-lookup-service";
import { CheckinMonitoringService } from "~/lib/checkin-monitoring-service";
import { CheckinRecoveryService } from "~/lib/checkin-recovery-service";
import { CheckinError, CheckinService } from "~/lib/checkin-service";
import type { CheckinArrivalSource } from "~/lib/checkin-arrival-source";
import type { CheckinLookupSource } from "~/lib/checkin-lookup-hievents";
import type { RecoverySource } from "~/lib/checkin-recovery-contract";

const token = "a".repeat(64);
const operationId = "11111111-1111-4111-8111-111111111111";
const admin = { userId: "admin0000000001", role: "admin" as const };
const operator = { userId: "operator0000001", role: "checkin_operator" as const };
type Actor = typeof admin | typeof operator | { userId: string; role: "user" };
type Send = ReturnType<typeof vi.fn>;
const context: CheckinEventContext = { protocolVersion: 1, edition: "WTS2026", eventId: "aaaaaaaaaaaaaaa", eventGeneration: 1, bindingId: "bbbbbbbbbbbbbbb", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 };
const lookupSource = { sourceKey: "source-key" } as unknown as CheckinLookupSource;
const arrivalSource = { sourceKey: "source-key" } as unknown as CheckinArrivalSource;
const recoverySource = { reconcile: vi.fn() } as unknown as RecoverySource;
const bound = { bindingState: "bound", binding: { id: context.bindingId, version: 1, revoked: false }, station: { id: context.stationId } };
const finalCommand = { final: true, command: { context, operationId, attendeeId: "21" }, recovery: {} };
function pb(send: Send) { return { send } as unknown as PocketBase; }
function routed(routes: Record<string, () => unknown>) {
  return pb(vi.fn(async (path: string) => routes[path]()));
}
const services: Record<string, (send: Send, actor: Actor) => Promise<unknown>> = {
  lifecycle: (send, actor) => new CheckinLifecycleService(pb(send), actor).status(),
  monitoring: (send, actor) => new CheckinMonitoringService(pb(send), actor as never).dashboard(token),
  recovery: (send, actor) => new CheckinRecoveryService(pb(send), actor as never, recoverySource).history(token),
  checkin: (send, actor) => new CheckinService(pb(send), actor as never).status(token),
  lookupContext: (send, actor) => new CheckinLookupService(pb(send), actor as never, lookupSource, arrivalSource).search(token, { context, query: "person" }),
  lookupCommand: (send, actor) => new CheckinLookupService(pb(send), actor as never, lookupSource, arrivalSource).getRecovery(token, operationId),
  lookupArrival: (send, actor) => new CheckinLookupService(routed({ "/api/wts/checkin-lookup-commands": () => finalCommand, "/api/wts/checkin": () => bound, "/api/wts/checkin-arrivals": () => (send as () => Promise<unknown>)() }), actor as never, lookupSource, arrivalSource).getRecovery(token, operationId),
};
async function outcome(run: () => Promise<unknown>) {
  try { await run(); }
  catch (caught) { return caught instanceof CheckinError ? `${caught.code}:${caught.status}` : `other:${String(caught)}`; }
  return "resolved";
}
const pbError = (status: number | undefined, code?: unknown) => ({ status, response: { data: { code } } });
const cases: [string, unknown, Record<string, string>][] = [
  ["string conflict", pbError(409, "conflict"), { lifecycle: "unavailable:503", monitoring: "conflict:409", recovery: "conflict:409", checkin: "conflict:409", lookupContext: "conflict:409", lookupCommand: "conflict:409", lookupArrival: "conflict:409" }],
  ["nested invalid_input without status", pbError(undefined, { code: "invalid_input" }), { lifecycle: "unavailable:503", monitoring: "invalid_input:400", recovery: "unavailable:503", checkin: "invalid_input:400", lookupContext: "invalid_input:400", lookupCommand: "invalid_input:400", lookupArrival: "invalid_input:400" }],
  ["bad request", pbError(400), { lifecycle: "conflict:409", monitoring: "unavailable:503", recovery: "invalid_input:400", checkin: "unavailable:503", lookupContext: "unavailable:503", lookupCommand: "unavailable:503", lookupArrival: "unavailable:503" }],
  ["forbidden code", pbError(403, "forbidden"), { lifecycle: "forbidden:403", monitoring: "forbidden:403", recovery: "forbidden:403", checkin: "forbidden:403", lookupContext: "forbidden:403", lookupCommand: "forbidden:403", lookupArrival: "forbidden:403" }],
  ["invalid_binding", pbError(403, "invalid_binding"), { lifecycle: "forbidden:403", monitoring: "unavailable:503", recovery: "forbidden:403", checkin: "invalid_binding:403", lookupContext: "invalid_binding:403", lookupCommand: "invalid_binding:403", lookupArrival: "invalid_binding:403" }],
  ["retired invalid_code with 400", pbError(400, "invalid_code"), { lifecycle: "conflict:409", monitoring: "unavailable:503", recovery: "invalid_input:400", checkin: "unavailable:503", lookupContext: "unavailable:503", lookupCommand: "unavailable:503", lookupArrival: "unavailable:503" }],
  ["disabled", pbError(423, "disabled"), { lifecycle: "unavailable:503", monitoring: "unavailable:503", recovery: "unavailable:503", checkin: "disabled:423", lookupContext: "disabled:423", lookupCommand: "disabled:423", lookupArrival: "disabled:423" }],
  ["unavailable with zero status", pbError(0, "unavailable"), { lifecycle: "unavailable:503", monitoring: "unavailable:503", recovery: "unavailable:503", checkin: "unavailable:400", lookupContext: "unavailable:400", lookupCommand: "unavailable:400", lookupArrival: "unavailable:400" }],
  ["unknown code with 401", pbError(401, "mystery"), { lifecycle: "forbidden:403", monitoring: "unavailable:503", recovery: "unavailable:503", checkin: "forbidden:403", lookupContext: "forbidden:403", lookupCommand: "unavailable:503", lookupArrival: "unavailable:503" }],
  ["unknown code with 403", pbError(403, "mystery"), { lifecycle: "forbidden:403", monitoring: "unavailable:503", recovery: "forbidden:403", checkin: "forbidden:403", lookupContext: "forbidden:403", lookupCommand: "forbidden:403", lookupArrival: "forbidden:403" }],
  ["prototype key code", pbError(500, "toString"), { lifecycle: "unavailable:503", monitoring: "unavailable:503", recovery: "unavailable:503", checkin: "unavailable:503", lookupContext: "unavailable:503", lookupCommand: "unavailable:503", lookupArrival: "unavailable:503" }],
  ["bare error", new Error("private"), { lifecycle: "unavailable:503", monitoring: "unavailable:503", recovery: "unavailable:503", checkin: "unavailable:503", lookupContext: "unavailable:503", lookupCommand: "unavailable:503", lookupArrival: "unavailable:503" }],
];

describe("check-in command service error mapping", () => {
  it.each(cases)("maps %s", async (_name, error, expected) => {
    const actual: Record<string, string> = {};
    for (const [name, run] of Object.entries(services)) actual[name] = await outcome(() => run(vi.fn().mockRejectedValue(error), admin));
    expect(actual).toEqual(expected);
  });
  it("authorizes actors before any PocketBase request", async () => {
    const results: Record<string, string[]> = {};
    for (const [name, run] of Object.entries(services)) {
      results[name] = [];
      for (const actor of [{ userId: "user00000000001", role: "user" as const }, { userId: "", role: "admin" as const }, operator]) {
        const send = vi.fn().mockRejectedValue(new Error("reached"));
        results[name].push(`${await outcome(() => run(send, actor))}/${send.mock.calls.length}`);
      }
    }
    expect(results).toEqual({
      lifecycle: ["forbidden:403/0", "forbidden:403/0", "forbidden:403/0"],
      monitoring: ["forbidden:403/0", "forbidden:403/0", "unavailable:503/1"],
      recovery: ["forbidden:403/0", "forbidden:403/0", "unavailable:503/1"],
      checkin: ["forbidden:403/0", "forbidden:403/0", "unavailable:503/1"],
      lookupContext: ["forbidden:403/0", "forbidden:403/0", "unavailable:503/1"],
      lookupCommand: ["forbidden:403/0", "forbidden:403/0", "unavailable:503/1"],
      lookupArrival: ["forbidden:403/0", "forbidden:403/0", "unavailable:503/1"],
    });
  });
  it("sends exact request bodies", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    await new CheckinLifecycleService(pb(send), admin).status();
    await new CheckinLifecycleService(pb(send), admin).close({ operationId, confirmEdition: "WTS2026" });
    await new CheckinLifecycleService(pb(send), admin).approveRestore({ generation: 2, confirmEdition: "WTS2026" });
    await new CheckinMonitoringService(pb(send), admin).dashboard(null, 3);
    await new CheckinMonitoringService(pb(send), admin).configure({ operationId } as never);
    await new CheckinMonitoringService(pb(send), operator).acknowledge("incident0000001", token);
    await new CheckinService(pb(send), operator).status();
    await new CheckinService(pb(send), admin).adminList({ auditPage: 2 });
    expect(send.mock.calls.map(([path, options]) => [path, options.body, options.requestKey])).toEqual([
      ["/api/wts/checkin-lifecycle", { operation: "status", actorUserId: admin.userId }, null],
      ["/api/wts/checkin-lifecycle", { operation: "close", actorUserId: admin.userId, command: { operationId, confirmEdition: "WTS2026" } }, null],
      ["/api/wts/checkin-lifecycle", { operation: "approve_restore", actorUserId: admin.userId, command: { generation: 2, confirmEdition: "WTS2026" } }, null],
      ["/api/wts/checkin-monitoring", { identityHash: "", offset: 3, operation: "dashboard", actorUserId: admin.userId }, null],
      ["/api/wts/checkin-monitoring", { command: { operationId }, operation: "configure", actorUserId: admin.userId }, null],
      ["/api/wts/checkin-monitoring", { incidentId: "incident0000001", identityHash: "ac2578950a00d5d4afe3e16eeadbda09391c4234fd437f04d60f652ecc5d5069", operation: "acknowledge", actorUserId: operator.userId }, null],
      ["/api/wts/checkin", { identityHash: "", operation: "status", actorUserId: operator.userId }, null],
      ["/api/wts/checkin", { auditPage: 2, operation: "admin_list", actorUserId: admin.userId }, null],
    ]);
  });
  it("guards role-specific operations and binding tokens before requests", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    expect(await outcome(() => new CheckinMonitoringService(pb(send), operator).configure({} as never))).toBe("forbidden:403");
    expect(await outcome(() => new CheckinMonitoringService(pb(send), operator).dashboard("bad"))).toBe("invalid_binding:400");
    expect(await outcome(() => new CheckinService(pb(send), operator).adminList())).toBe("forbidden:403");
    expect(await outcome(() => new CheckinRecoveryService(pb(send), operator as never, recoverySource).attemptHistory(token, "workflow0000001", -1))).toBe("invalid_input:400");
    expect(await outcome(() => new CheckinLookupService(pb(send), operator as never, lookupSource, arrivalSource).search(undefined, { context, query: "person" }))).toBe("invalid_binding:403");
    expect(await outcome(() => new CheckinLookupService(pb(send), operator as never, lookupSource, { sourceKey: "other" } as never).search(token, { context, query: "person" }))).toBe("unavailable:503");
    expect(await outcome(() => new CheckinLookupService(pb(send), operator as never, lookupSource, { sourceKey: "other" } as never).getRecovery(token, operationId))).toBe("unavailable:503");
    expect(send).not.toHaveBeenCalled();
  });
  it("confirms the live station binding around cached lookup results", async () => {
    const run = (status: unknown, arrival: unknown = { result: { ok: true } }) => outcome(() => new CheckinLookupService(routed({ "/api/wts/checkin-lookup-commands": () => finalCommand, "/api/wts/checkin": () => status, "/api/wts/checkin-arrivals": () => arrival }), operator as never, lookupSource, arrivalSource).getRecovery(token, operationId));
    expect(await run(bound)).toBe("resolved");
    expect(await run(bound, {})).toBe("conflict:409");
    expect(await run({ ...bound, bindingState: "revoked" })).toBe("revoked_binding:403");
    expect(await run({ ...bound, binding: { ...bound.binding, revoked: true } })).toBe("revoked_binding:403");
    expect(await run({ ...bound, bindingState: "unbound" })).toBe("invalid_binding:403");
    expect(await run({ ...bound, binding: null })).toBe("conflict:409");
    expect(await run({ ...bound, binding: { ...bound.binding, id: "ccccccccccccccc" } })).toBe("conflict:409");
    expect(await run({ ...bound, binding: { ...bound.binding, version: 2 } })).toBe("conflict:409");
    expect(await run({ ...bound, station: null })).toBe("conflict:409");
    expect(await run({ ...bound, station: { id: "wts2026station2" } })).toBe("conflict:409");
  });
});
