import { expect, it } from "vite-plus/test";
import { handleCheckinMonitoringRequest } from "~/lib/checkin-monitoring-http";
import { CheckinMonitoringService } from "~/lib/checkin-monitoring-service";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";

it("protects the browser command boundary with real authenticated PocketBase, current role, strict input and private responses", async () => {
  const f = await startCheckinPocketBase();
  try {
    const human = await f.user("checkin_operator");
    const deps = {
      authenticate: async () => { const { record } = await human.client.collection("users").authRefresh(); return { id: record.id, role: record.role as string }; },
      service: async (actor: { id: string; role: string }) => new CheckinMonitoringService(f.pb, { userId: actor.id, role: actor.role }),
    };
    const request = (body: object, origin = "https://wts.test", cookie = "") => new Request("https://wts.test/api/checkin-monitoring", { method: "POST", headers: { "content-type": "application/json", origin, cookie }, body: JSON.stringify(body) });
    const send = (body: object, origin?: string, cookie?: string) => handleCheckinMonitoringRequest(request(body, origin, cookie), deps);
    expect((await send({ operation: "dashboard" }, "https://foreign.test")).status).toBe(403);
    const result = await send({ operation: "dashboard" });
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
    expect(await result.json()).toEqual({ scope: "unbound", lastTickMs: 0, recipientsConfigured: false, hasMore: false, incidents: [] });
    for (const body of [{ operation: "machine_claim" }, { operation: "dashboard", stationId: "wts2026station2" }, { operation: "dashboard", actorUserId: human.record.id }, { operation: "dashboard", offset: -1 }]) expect((await send(body)).status).toBe(400);
    expect((await send({ operation: "dashboard" }, undefined, `wts_checkin_client=${"a".repeat(64)}; wts_checkin_client=${"b".repeat(64)}`)).status).toBe(400);
    const command = { operationId: crypto.randomUUID(), expectedVersion: 1, recipientUserIds: [], waitingMs: 30000, incidentMs: 60000, repeatMs: 900000 };
    expect((await send({ operation: "configure", command })).status).toBe(403);
    expect((await send({ operation: "dashboard", extra: "x".repeat(9000) })).status).toBe(413);
    await f.pb.collection("users").update(human.record.id, { role: "admin" });
    expect((await send({ operation: "configure", command })).status).toBe(200);
    const admin = await (await send({ operation: "dashboard" })).json();
    expect(admin.scope).toBe("all"); expect(admin.adminChoices[0].email).toBe(human.record.email);
    await f.pb.collection("users").update(human.record.id, { role: "user" });
    expect((await send({ operation: "dashboard" })).status).toBe(403);
  } finally { await f.cleanup(); }
});
