import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { AdminActions } from "~/lib/admin-action-ledger";
import { createPocketBaseAdminActionStore } from "~/lib/admin-action-store";
import { startLiveQaPocketBase } from "~/lib/live-qa-pocketbase-test-helper";
import {
  PartnerAdministration,
  type AuditedPartnerAdministrationStore,
  type PartnerAdministrationActorContext,
} from "~/lib/partner-administration";
import { createPocketBasePartnerAdministrationStore } from "~/lib/partner-administration-store";

const oversizedLogo = {
  name: "huge.png",
  type: "image/png",
  data: Array.from(Buffer.alloc(5 * 1024 * 1024 + 1, 1)),
};

function attachingOversizedLogo(store: AuditedPartnerAdministrationStore, rejections: unknown[]): AuditedPartnerAdministrationStore {
  async function observed<T>(write: Promise<T>): Promise<T> {
    try {
      return await write;
    } catch (error) {
      rejections.push(error);
      throw error;
    }
  }
  return {
    ...store,
    create: (input, action) => observed(store.create({ ...input, logo: oversizedLogo }, action)),
    update: (id, version, input, action) => observed(store.update(id, version, { ...input, logo: oversizedLogo }, action)),
  };
}

describe("Partner mutation routes through real PocketBase", () => {
  let fixture: Awaited<ReturnType<typeof startLiveQaPocketBase>>;
  let store: AuditedPartnerAdministrationStore;
  let actions: AdminActions;
  let actor: PartnerAdministrationActorContext;
  beforeAll(async () => {
    fixture = await startLiveQaPocketBase({ workspace: true });
    store = createPocketBasePartnerAdministrationStore(fixture.pb);
    actions = new AdminActions(createPocketBaseAdminActionStore(fixture.pb));
    actor = { mode: "human_admin", userId: (await fixture.user("admin")).record.id, source: "admin_ui" };
  }, 60_000);
  afterAll(async () => { await fixture?.cleanup(); });
  const tooLarge = { status: 400, response: { message: "Partner logo is too large." } };

  it("rejects an oversized logo on create instead of creating the Partner without it", async () => {
    const rejections: unknown[] = [];
    const administration = new PartnerAdministration(attachingOversizedLogo(store, rejections), actor, actions);
    await administration.createDraft({ name: "Oversized Create", type: "supporter", logo: null }, randomUUID());
    expect.soft(rejections).toMatchObject([tooLarge]);
    expect((await store.list()).filter((partner) => partner.name === "Oversized Create")).toEqual([]);
  }, 20_000);

  it("rejects an oversized logo on update instead of applying the patch without it", async () => {
    const created = await new PartnerAdministration(store, actor, actions).createDraft({ name: "Original Partner", type: "supporter", logo: null }, randomUUID());
    if (!created.success) throw new Error(created.error);
    const rejections: unknown[] = [];
    const administration = new PartnerAdministration(attachingOversizedLogo(store, rejections), actor, actions);
    await administration.updatePartner(created.data.partner.id, created.data.partner.version, { name: "Renamed Partner" }, randomUUID());
    expect.soft(rejections).toMatchObject([tooLarge]);
    expect(await store.get(created.data.partner.id)).toMatchObject({ name: "Original Partner", logo: "" });
  }, 20_000);
});
