import { describe, expect, it, vi } from "vite-plus/test";
import type PocketBase from "pocketbase";
import { CheckinAgentService } from "~/lib/checkin-agent-service";
import { CheckinArrivalService } from "~/lib/checkin-arrival-service";
import { CheckinArrivalResumeService } from "~/lib/checkin-arrival-resume-service";
import { CheckinEventService } from "~/lib/checkin-event-service";
import { CheckinLabelProfileService } from "~/lib/checkin-label-profile-service";
import { CheckinError } from "~/lib/checkin-service";
import type { CheckinArrivalSource } from "~/lib/checkin-arrival-source";
import type { CheckinEventSource } from "~/lib/checkin-event-service";

const token = "a".repeat(64);
const operationId = "11111111-1111-4111-8111-111111111111";
const admin = { userId: "admin0000000001", role: "admin" as const };
const operator = { userId: "operator0000001", role: "checkin_operator" as const };
type Actor = typeof admin | typeof operator | { userId: string; role: "user" };
const source = { sourceKey: "source-key" } as unknown as CheckinArrivalSource & CheckinEventSource;
function pb(send: ReturnType<typeof vi.fn>) { return { send } as unknown as PocketBase; }
const services: Record<string, (send: ReturnType<typeof vi.fn>, actor: Actor) => Promise<unknown>> = {
  agent: (send, actor) => new CheckinAgentService(pb(send), actor as never).adminList(),
  arrival: (send, actor) => new CheckinArrivalService(pb(send), actor as never, source).status(token, operationId),
  resume: (send, actor) => new CheckinArrivalResumeService(pb(send), actor as never, source).get(token, operationId),
  event: (send, actor) => new CheckinEventService(pb(send), actor as never, source).adminCatalogue(),
  label: (send, actor) => new CheckinLabelProfileService(pb(send), actor as never).list(),
};
async function failure(name: string, error: unknown, actor: Actor = admin) {
  try { await services[name](vi.fn().mockRejectedValue(error), actor); }
  catch (caught) { return caught instanceof CheckinError ? `${caught.code}:${caught.status}` : `other:${String(caught)}`; }
  return "resolved";
}
const pbError = (status: number | undefined, code?: unknown) => ({ status, response: { data: { code } } });
const cases: [string, unknown, Record<string, string>][] = [
  ["string conflict", pbError(409, "conflict"), { agent: "conflict:409", arrival: "conflict:409", resume: "conflict:409", event: "conflict:409", label: "conflict:409" }],
  ["nested invalid_input without status", pbError(undefined, { code: "invalid_input" }), { agent: "invalid_input:400", arrival: "invalid_input:400", resume: "invalid_input:400", event: "invalid_input:400", label: "invalid_input:400" }],
  ["invalid_binding", pbError(403, "invalid_binding"), { agent: "forbidden:403", arrival: "invalid_binding:403", resume: "invalid_binding:403", event: "invalid_binding:403", label: "forbidden:403" }],
  ["disabled", pbError(423, "disabled"), { agent: "unavailable:503", arrival: "disabled:423", resume: "disabled:423", event: "disabled:423", label: "unavailable:503" }],
  ["unavailable with zero status", pbError(0, "unavailable"), { agent: "unavailable:503", arrival: "unavailable:400", resume: "unavailable:400", event: "unavailable:400", label: "unavailable:400" }],
  ["unknown code with 401", pbError(401, "mystery"), { agent: "forbidden:403", arrival: "forbidden:403", resume: "forbidden:403", event: "forbidden:403", label: "forbidden:403" }],
  ["unknown code with 500", pbError(500, "mystery"), { agent: "unavailable:503", arrival: "unavailable:503", resume: "unavailable:503", event: "unavailable:503", label: "unavailable:503" }],
  ["bare error", new Error("private"), { agent: "unavailable:503", arrival: "unavailable:503", resume: "unavailable:503", event: "unavailable:503", label: "unavailable:503" }],
  ["domain error from transport", new CheckinError("conflict", 403), { agent: "forbidden:403", arrival: "forbidden:403", resume: "conflict:403", event: "forbidden:403", label: "forbidden:403" }],
];

describe("check-in service PocketBase error mapping", () => {
  it.each(cases)("maps %s", async (_name, error, expected) => {
    const actual: Record<string, string> = {};
    for (const name of Object.keys(services)) actual[name] = await failure(name, error);
    expect(actual).toEqual(expected);
  });
  it("authorizes actors before any PocketBase request", async () => {
    const results: Record<string, string[]> = {};
    for (const name of Object.keys(services)) {
      results[name] = [];
      for (const actor of [{ userId: "user00000000001", role: "user" as const }, { userId: "", role: "admin" as const }, operator]) {
        const send = vi.fn().mockResolvedValue({ ok: true });
        try { await services[name](send, actor); results[name].push(`ok:${send.mock.calls.length}`); }
        catch (error) { results[name].push(`${(error as CheckinError).code}:${send.mock.calls.length}`); }
      }
    }
    expect(results).toEqual({
      agent: ["forbidden:0", "forbidden:0", "forbidden:0"],
      arrival: ["forbidden:0", "forbidden:0", "ok:1"],
      resume: ["forbidden:0", "forbidden:0", "unavailable:1"],
      event: ["forbidden:0", "forbidden:0", "forbidden:0"],
      label: ["forbidden:0", "forbidden:0", "forbidden:0"],
    });
  });
  it("sends the actor, operation and source key", async () => {
    const send = vi.fn().mockResolvedValue({ station: null });
    await new CheckinAgentService(pb(send), operator as never).status(null);
    await new CheckinArrivalService(pb(send), operator as never, source).status(token, operationId);
    expect(send.mock.calls.map(([path, options]) => [path, options.method, options.requestKey, Object.keys(options.body).sort()])).toEqual([
      ["/api/wts/checkin-agents", "POST", null, ["actorUserId", "identityHash", "operation"]],
      ["/api/wts/checkin-arrivals", "POST", null, ["actorUserId", "identityHash", "operation", "operationId", "sourceKey"]],
    ]);
    expect(send.mock.calls[0][1].body).toMatchObject({ identityHash: "", operation: "status", actorUserId: operator.userId });
  });
});
