import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { startCheckinPocketBase } from "./checkin-pocketbase-test-helper";
import { CheckinLifecycleService } from "./checkin-lifecycle-service";

let fixture: Awaited<ReturnType<typeof startCheckinPocketBase>>;
beforeAll(async () => { fixture = await startCheckinPocketBase(); });
afterAll(async () => { await fixture?.cleanup(); });
it("audits one irreversible closure, fixes its deadline and rejects ordinary enable after restart", async () => {
  const admin = await fixture.user("admin");
  const service = new CheckinLifecycleService(fixture.pb, admin.actor);
  const before = await service.status();
  expect(before.closedAt).toBeNull();
  const command = { operationId: crypto.randomUUID(), confirmEdition: "WTS2026" as const };
  const closed = await service.close(command);
  expect(Date.parse(closed.purgeDeadline!) - Date.parse(closed.closedAt!)).toBe(2_592_000_000);
  expect((await fixture.pb.collection("checkin_system").getOne("wts2026system00")).enabled).toBe(false);
  expect(await service.close(command)).toEqual(closed);
  expect((await service.close({ ...command, operationId: crypto.randomUUID() })).purgeDeadline).toBe(closed.purgeDeadline);
  expect((await fixture.pb.collection("checkin_lifecycle_audit").getFullList({ filter: "operation = 'close'" }))).toHaveLength(1);
  await fixture.restart();
  expect((await service.status()).purgeDeadline).toBe(closed.purgeDeadline);
  await expect(fixture.pb.collection("checkin_system").update("wts2026system00", { enabled: true })).rejects.toMatchObject({ status: 403 });
  const operator = await fixture.user("checkin_operator");
  await expect(new CheckinLifecycleService(fixture.pb, operator.actor).close(command)).rejects.toMatchObject({ status: 403 });
});
