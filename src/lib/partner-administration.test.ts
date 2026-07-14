import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";
import { describe, expect, it } from "vitest";
import { AdminActions, type AdminActionStore } from "~/lib/admin-action-ledger";
import { createInMemoryAdminActionStore } from "~/lib/admin-action-memory-store";
import { createPocketBaseAdminActionStore } from "~/lib/admin-action-store";
import {
  PartnerAdministration as AuditedPartnerAdministration,
  type AuditedPartnerAdministrationStore,
  type PartnerAdministrationActor,
  type PartnerAdministrationActorContext,
  type PartnerDraftInput,
  type PartnerPatch,
} from "~/lib/partner-administration";
import { createInMemoryPartnerAdministrationStore } from "~/lib/partner-administration-memory-store";
import { createPocketBasePartnerAdministrationStore } from "~/lib/partner-administration-store";

class PartnerAdministration extends AuditedPartnerAdministration {
  private operationSequence = 0;

  constructor(
    store: AuditedPartnerAdministrationStore,
    actor: PartnerAdministrationActor | PartnerAdministrationActorContext,
    actions = new AdminActions(createInMemoryAdminActionStore()),
  ) {
    super(
      store,
      typeof actor === "string"
        ? { mode: actor, userId: `test-${actor}`, source: actor === "agent" ? "mcp" : "admin_ui" }
        : actor,
      actions,
    );
  }

  private nextOperationId(): string {
    this.operationSequence += 1;
    return `test-operation-${this.operationSequence}`;
  }

  override createDraft(input: PartnerDraftInput, operationId = this.nextOperationId()) {
    return super.createDraft(input, operationId);
  }

  override updatePartner(
    id: string,
    expectedVersion: string,
    patch: PartnerPatch,
    operationId = this.nextOperationId(),
  ) {
    return super.updatePartner(id, expectedVersion, patch, operationId);
  }

  override setNoteApproval(
    id: string,
    expectedVersion: string,
    approved: boolean,
    operationId = this.nextOperationId(),
  ) {
    return super.setNoteApproval(id, expectedVersion, approved, operationId);
  }

  override setPublication(
    id: string,
    expectedVersion: string,
    published: boolean,
    operationId = this.nextOperationId(),
  ) {
    return super.setPublication(id, expectedVersion, published, operationId);
  }

  override deletePartner(
    id: string,
    expectedVersion: string,
    operationId = this.nextOperationId(),
  ) {
    return super.deletePartner(id, expectedVersion, operationId);
  }
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local Partner test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForPocketBase(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // PocketBase is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Disposable PocketBase did not start.");
}

function logoFingerprint(data: number[]): string {
  return createHash("sha256").update(Buffer.from(data).toString("base64")).digest("hex");
}

describe("Partner Administration", () => {
  it("applies and exactly replays an audited Partner mutation without storing Partner Note text", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      actions,
    );
    const input = {
      name: "Audited Partner",
      type: "supporter" as const,
      notes: "Non-sensitive context that must not be copied into history",
    };

    const first = await administration.createDraft(input, "create-audited-partner");
    const replay = await administration.createDraft(input, "create-audited-partner");

    expect(first).toMatchObject({
      success: true,
      action: { status: "applied", replayed: false },
      data: { partner: { id: "partner-1" } },
    });
    expect(replay).toMatchObject({
      success: true,
      action: { id: first.success && first.action.id, status: "applied", replayed: true },
      data: { partner: { id: "partner-1" } },
    });
    expect(await administration.listPartners()).toHaveLength(1);
    const history = await actions.list({ targetCollection: "partners", targetId: "partner-1" });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actorUserId: "user-admin",
      source: "admin_ui",
      operationKind: "partner.create",
      status: "applied",
      targetId: "partner-1",
      beforeSummary: null,
      afterSummary: {
        name: "Audited Partner",
        type: "supporter",
        published: false,
        notePresent: true,
      },
    });
    expect(JSON.stringify(history)).not.toContain(input.notes);
  });

  it("rejects changed Partner input that reuses an applied operation ID", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    const administration = new AuditedPartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      actions,
    );

    await administration.createDraft(
      { name: "Bound Partner", type: "supporter" },
      "bound-create",
    );
    const mismatch = await administration.createDraft(
      { name: "Changed Partner", type: "supporter" },
      "bound-create",
    );

    expect(mismatch).toMatchObject({
      success: false,
      code: "operation_mismatch",
      action: { operationId: "bound-create", status: "applied" },
    });
    await expect(administration.listPartners()).resolves.toHaveLength(1);
  });

  it("replays the prior applied result after later Partner changes and deletion", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    const administration = new AuditedPartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      actions,
    );
    const input = { name: "Stable Replay Partner", type: "supporter" as const };
    const created = await administration.createDraft(input, "stable-create");
    if (!created.success) throw new Error(created.error);
    const priorResult = created.data;
    const updated = await administration.updatePartner(
      created.data.partner.id,
      created.data.partner.version,
      { name: "Later Partner Name" },
      "later-patch",
    );
    if (!updated.success) throw new Error(updated.error);
    const deleted = await administration.deletePartner(
      updated.data.partner.id,
      updated.data.partner.version,
      "later-delete",
    );
    if (!deleted.success) throw new Error(deleted.error);

    const replay = await administration.createDraft(input, "stable-create");

    expect(replay).toMatchObject({
      success: true,
      action: { operationId: "stable-create", replayed: true },
    });
    if (!replay.success) throw new Error(replay.error);
    expect(replay.data).toEqual(priorResult);
    expect(replay.data.partner.name).toBe("Stable Replay Partner");
  });

  it("applies and replays maximum-sized valid Partner data with bounded warnings", async () => {
    const administration = new AuditedPartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      new AdminActions(createInMemoryAdminActionStore()),
    );
    const similarPrefix = `Boundary Partner ${"A".repeat(170)}`;
    for (const suffix of ["One", "Two", "Three"]) {
      const seeded = await administration.createDraft(
        { name: `${similarPrefix} ${suffix}`, type: "supporter" },
        `boundary-seed-${suffix}`,
      );
      if (!seeded.success) throw new Error(seeded.error);
    }
    const input = {
      name: `${similarPrefix} Four`,
      type: "supporter" as const,
      url: `https://example.com/${"path".repeat(490)}`,
      logo: {
        name: `${"😀".repeat(125)}.png`,
        type: "image/png",
        data: [1],
      },
    };

    const applied = await administration.createDraft(input, "boundary-create");
    const replayed = await administration.createDraft(input, "boundary-create");
    if (!applied.success) throw new Error(applied.error);
    if (!replayed.success) throw new Error(replayed.error);

    expect(applied).toMatchObject({
      success: true,
      action: { replayed: false },
      data: { warnings: [{ kind: "similar_name" }, { kind: "similar_name" }, { kind: "similar_name" }] },
    });
    expect(replayed).toEqual({
      ...applied,
      action: { ...applied.action, replayed: true },
    });
  });

  it("rolls back a target mutation when completion fails and retries it without duplication", async () => {
    const baseActionStore = createInMemoryAdminActionStore();
    let failNextCompletion = true;
    const actionStore: AdminActionStore = {
      ...baseActionStore,
      async complete(handle, completion, now) {
        if (failNextCompletion) {
          failNextCompletion = false;
          throw new Error("Injected Admin Action completion failure");
        }
        return baseActionStore.complete(handle, completion, now);
      },
    };
    const actions = new AdminActions(actionStore);
    const administration = new AuditedPartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      actions,
    );
    const input = { name: "Retry Partner", type: "supporter" as const };

    const failed = await administration.createDraft(input, "retry-create");

    expect(failed).toMatchObject({
      success: false,
      code: "operation_failed",
      action: { operationId: "retry-create", status: "failed" },
    });
    await expect(administration.listHistory()).resolves.toMatchObject([
      {
        status: "failed",
        afterSummary: {
          name: "Retry Partner",
          type: "supporter",
          published: false,
        },
      },
    ]);

    const retried = await administration.createDraft(input, "retry-create");
    expect(retried).toMatchObject({
      success: true,
      action: { operationId: "retry-create", status: "applied", replayed: false },
    });
    await expect(administration.listPartners()).resolves.toHaveLength(1);
    await expect(actions.list({ targetCollection: "partners" })).resolves.toMatchObject([
      { status: "applied", attemptCount: 2 },
    ]);
  });

  it("keeps the target and replays success when completion commits before its response is lost", async () => {
    const baseActionStore = createInMemoryAdminActionStore();
    let loseCompletionResponse = true;
    const actionStore: AdminActionStore = {
      ...baseActionStore,
      async complete(handle, completion, now) {
        const applied = await baseActionStore.complete(handle, completion, now);
        if (loseCompletionResponse) {
          loseCompletionResponse = false;
          throw new Error("Injected lost completion response");
        }
        return applied;
      },
    };
    const administration = new AuditedPartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      new AdminActions(actionStore),
    );

    const result = await administration.createDraft(
      { name: "Committed Partner", type: "supporter" },
      "lost-completion-response",
    );

    expect(result).toMatchObject({
      success: true,
      data: { partner: { name: "Committed Partner" } },
      action: { status: "applied", replayed: true },
    });
    await expect(administration.listPartners()).resolves.toHaveLength(1);
  });

  it("serializes a failed create completion before committing a concurrent Partner", async () => {
    const baseActionStore = createInMemoryAdminActionStore();
    let completionCalls = 0;
    let firstCompletionReached!: () => void;
    const reached = new Promise<void>((resolve) => { firstCompletionReached = resolve; });
    let rejectFirstCompletion!: (error: Error) => void;
    const actionStore: AdminActionStore = {
      ...baseActionStore,
      async complete(handle, completion, now) {
        completionCalls += 1;
        if (completionCalls === 1) {
          firstCompletionReached();
          return new Promise<never>((_resolve, reject) => { rejectFirstCompletion = reject; });
        }
        return baseActionStore.complete(handle, completion, now);
      },
    };
    const administration = new AuditedPartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      new AdminActions(actionStore),
    );

    const first = administration.createDraft(
      { name: "First Pending Partner", type: "supporter" },
      "first-concurrent-create",
    );
    await reached;
    const secondPromise = administration.createDraft(
      { name: "Second Applied Partner", type: "supporter" },
      "second-concurrent-create",
    );
    rejectFirstCompletion(new Error("First completion failed before the concurrent commit"));
    const [second, failed] = await Promise.all([secondPromise, first]);

    expect(second).toMatchObject({ success: true, data: { partner: { name: "Second Applied Partner" } } });
    expect(failed).toMatchObject({ success: false, code: "operation_failed" });
    await expect(administration.listPartners()).resolves.toMatchObject([
      { partner: { name: "Second Applied Partner" } },
    ]);

    await expect(
      administration.createDraft(
        { name: "First Pending Partner", type: "supporter" },
        "first-concurrent-create",
      ),
    ).resolves.toMatchObject({ success: true, action: { status: "applied" } });
    await expect(administration.listPartners()).resolves.toHaveLength(2);
  });

  it("reports active pending work and safely recovers an expired crash-incomplete Partner operation", async () => {
    let now = new Date("2026-07-13T12:00:00.000Z");
    const actions = new AdminActions(createInMemoryAdminActionStore(), {
      now: () => now,
      leaseMilliseconds: 30_000,
    });
    const baseStore = createInMemoryPartnerAdministrationStore();
    let createCalls = 0;
    let firstCreateReached!: () => void;
    const reached = new Promise<void>((resolve) => { firstCreateReached = resolve; });
    let rejectInterrupted!: (error: Error) => void;
    const store: AuditedPartnerAdministrationStore = {
      ...baseStore,
      async create(input, action) {
        createCalls += 1;
        if (createCalls === 1) {
          firstCreateReached();
          return new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
        }
        return baseStore.create(input, action);
      },
    };
    const administration = new AuditedPartnerAdministration(
      store,
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      actions,
    );
    const input = { name: "Recovered Partner", type: "supporter" as const };

    const interrupted = administration.createDraft(input, "crash-create");
    await reached;
    await expect(administration.createDraft(input, "crash-create")).resolves.toMatchObject({
      success: false,
      code: "operation_pending",
      action: { status: "pending" },
    });
    await expect(administration.listHistory()).resolves.toMatchObject([
      {
        status: "pending",
        afterSummary: {
          name: "Recovered Partner",
          type: "supporter",
          published: false,
        },
      },
    ]);

    now = new Date("2026-07-13T12:00:31.000Z");
    const recovered = await administration.createDraft(input, "crash-create");
    rejectInterrupted(new Error("Interrupted worker resumed after recovery"));

    expect(recovered).toMatchObject({
      success: true,
      action: { status: "applied", replayed: false },
    });
    await expect(interrupted).resolves.toMatchObject({
      success: true,
      action: { status: "applied", replayed: true },
    });
    await expect(administration.listPartners()).resolves.toHaveLength(1);
    await expect(actions.list({ targetCollection: "partners" })).resolves.toMatchObject([
      { status: "applied", attemptCount: 2 },
    ]);
  });

  it("resolves an expired pending operation when revalidation rejects its retry", async () => {
    let now = new Date("2026-07-13T12:00:00.000Z");
    const actions = new AdminActions(createInMemoryAdminActionStore(), {
      now: () => now,
      leaseMilliseconds: 30_000,
    });
    const baseStore = createInMemoryPartnerAdministrationStore();
    let firstCreateReached!: () => void;
    const reached = new Promise<void>((resolve) => { firstCreateReached = resolve; });
    let rejectInterrupted!: (error: Error) => void;
    let createCalls = 0;
    const interruptedStore: AuditedPartnerAdministrationStore = {
      ...baseStore,
      async create(input, action) {
        createCalls += 1;
        if (createCalls === 1) {
          firstCreateReached();
          return new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
        }
        return baseStore.create(input, action);
      },
    };
    const administration = new AuditedPartnerAdministration(
      interruptedStore,
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      actions,
    );
    const competingAdministration = new AuditedPartnerAdministration(
      baseStore,
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      actions,
    );
    const input = { name: "Intervening Partner", type: "supporter" as const };

    const interrupted = administration.createDraft(input, "expired-duplicate-create");
    await reached;
    await expect(
      competingAdministration.createDraft(input, "competing-create"),
    ).resolves.toMatchObject({ success: true });

    now = new Date("2026-07-13T12:00:31.000Z");
    await expect(
      administration.createDraft(input, "expired-duplicate-create"),
    ).resolves.toMatchObject({ success: false, code: "duplicate" });
    await expect(actions.list({ targetCollection: "partners" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: "expired-duplicate-create",
          status: "failed",
          attemptCount: 2,
        }),
      ]),
    );

    rejectInterrupted(new Error("Interrupted worker resumed after the retry was rejected"));
    await expect(interrupted).resolves.toMatchObject({ success: false, code: "operation_failed" });
  });

  it("audits every human Partner mutation with bounded non-content note metadata", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    const administration = new AuditedPartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      { mode: "human_admin", userId: "user-admin", source: "admin_ui" },
      actions,
    );
    const note = "Approved organizational context that must occur only on the Partner record";
    const created = await administration.createDraft(
      {
        name: "Lifecycle Partner",
        type: "supporter",
        notes: note,
        logo: { name: "official.svg", type: "image/svg+xml", data: [1, 2, 3] },
      },
      "lifecycle-create",
    );
    if (!created.success) throw new Error(created.error);
    const patched = await administration.updatePartner(
      created.data.partner.id,
      created.data.partner.version,
      { notes: `${note} updated` },
      "lifecycle-patch",
    );
    if (!patched.success) throw new Error(patched.error);
    const approved = await administration.setNoteApproval(
      patched.data.partner.id,
      patched.data.partner.version,
      true,
      "lifecycle-note-approval",
    );
    if (!approved.success) throw new Error(approved.error);
    const published = await administration.setPublication(
      approved.data.partner.id,
      approved.data.partner.version,
      true,
      "lifecycle-publish",
    );
    if (!published.success) throw new Error(published.error);
    const unpublished = await administration.setPublication(
      published.data.partner.id,
      published.data.partner.version,
      false,
      "lifecycle-unpublish",
    );
    if (!unpublished.success) throw new Error(unpublished.error);
    await administration.deletePartner(
      unpublished.data.partner.id,
      unpublished.data.partner.version,
      "lifecycle-delete",
    );

    const history = await actions.list({ targetCollection: "partners", limit: 20 });
    expect(history.map((action) => action.operationKind).sort()).toEqual([
      "partner.create",
      "partner.delete",
      "partner.note_approval",
      "partner.patch",
      "partner.publish",
      "partner.unpublish",
    ]);
    expect(history.every((action) => action.status === "applied")).toBe(true);
    expect(JSON.stringify(history)).not.toContain(note);
    expect(history.find((action) => action.operationKind === "partner.patch")?.afterSummary)
      .toMatchObject({ notePresent: true, changedFields: ["partnerNote"] });
    const relevantHistory = await administration.listHistory(unpublished.data.partner.id, 100);
    expect(relevantHistory).toHaveLength(6);
    expect(JSON.stringify(relevantHistory)).not.toContain("inputFingerprint");
    expect(JSON.stringify(relevantHistory)).not.toContain("replayResult");
  });

  it("creates an incomplete Partner draft without a logo and reports what blocks publication", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );

    const result = await administration.createDraft({
      name: " Skopje Tech ",
      type: "community_partner",
      notes: " Non-sensitive organizer context ",
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        partner: {
          name: "Skopje Tech",
          type: "community_partner",
          logo: "",
          noteAgentVisible: false,
          published: false,
        },
        warnings: [],
        publication: {
          ready: false,
          issues: [{ field: "logo", message: "Upload an official Partner logo before publishing." }],
        },
      },
    });
    await expect(administration.listPartners()).resolves.toMatchObject([
      { partner: { notes: "Non-sensitive organizer context", tier: undefined } },
    ]);
  });

  it("requires one valid Sponsor tier and removes tiers from every non-Sponsor", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );

    await expect(administration.createDraft({ name: "Untiered", type: "sponsor" })).resolves.toEqual({
      success: false,
      code: "validation",
      error: "Choose a Sponsor tier.",
    });
    await expect(
      administration.createDraft({ name: "Invalid tier", type: "sponsor", tier: "diamond" as never }),
    ).resolves.toEqual({
      success: false,
      code: "validation",
      error: "Choose a valid Sponsor tier.",
    });

    const sponsor = await administration.createDraft({
      name: "Gold Sponsor",
      type: "sponsor",
      tier: "gold",
    });
    const supporter = await administration.createDraft({
      name: "Community Supporter",
      type: "supporter",
      tier: "gold",
    });

    expect(sponsor).toMatchObject({ success: true, data: { partner: { tier: "gold" } } });
    expect(supporter).toMatchObject({ success: true, data: { partner: { type: "supporter" } } });
    if (!supporter.success) throw new Error(supporter.error);
    expect(supporter.data.partner).not.toHaveProperty("tier");
    for (const classification of [
      "organizer",
      "community_partner",
      "media",
      "catering",
      "other",
    ] as const) {
      const result = await administration.createDraft({
        name: `Canonical ${classification}`,
        type: classification,
      });
      expect(result).toMatchObject({
        success: true,
        data: { partner: { type: classification } },
      });
      if (!result.success) throw new Error(result.error);
      expect(result.data.partner).not.toHaveProperty("tier");
    }
    await expect(
      administration.createDraft({ name: "Legacy", type: "company_supporter" as never }),
    ).resolves.toEqual({
      success: false,
      code: "validation",
      error: "Choose a valid Partner classification.",
    });
  });

  it("accepts only optional absolute HTTPS Partner URLs", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );

    for (const url of [
      "http://partner.example",
      "/partners/example",
      "not a url",
      "https://%zz",
      "https://partner.example\\path",
      "https://partner.example/naïve",
    ]) {
      await expect(
        administration.createDraft({ name: `Invalid ${url}`, type: "other", url }),
      ).resolves.toEqual({
        success: false,
        code: "validation",
        error: "Partner URL must be an absolute HTTPS URL.",
      });
    }

    const result = await administration.createDraft({
      name: "Secure Partner",
      type: "other",
      url: " https://Partner.Example/path?campaign=wts#about ",
    });

    expect(result).toMatchObject({
      success: true,
      data: { partner: { url: "https://Partner.Example/path?campaign=wts#about" } },
    });
  });

  it("blocks exact normalized-name and canonical full-URL duplicates during concurrent creates", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );

    const nameResults = await Promise.all([
      administration.createDraft({ name: "Acme   Labs", type: "supporter" }),
      administration.createDraft({ name: " acme labs ", type: "media" }),
    ]);

    expect(nameResults.filter((result) => result.success)).toHaveLength(1);
    expect(nameResults.find((result) => !result.success)).toMatchObject({
      success: false,
      code: "duplicate",
      field: "name",
      current: { name: "Acme Labs" },
    });

    const firstUrl = await administration.createDraft({
      name: "Original URL",
      type: "other",
      url: "https://Partner.Example/about#conference",
    });
    const duplicateUrl = await administration.createDraft({
      name: "Duplicate URL",
      type: "other",
      url: "https://partner.example/about#sponsor",
    });

    expect(firstUrl.success).toBe(true);
    expect(duplicateUrl).toMatchObject({
      success: false,
      code: "duplicate",
      field: "url",
      current: { name: "Original URL" },
    });

    const dotSegment = await administration.createDraft({
      name: "Dot Segment URL",
      type: "other",
      url: "https://partner.example/a/../canonical",
    });
    const canonicalPath = await administration.createDraft({
      name: "Canonical Path URL",
      type: "other",
      url: "https://partner.example/canonical",
    });
    expect(dotSegment.success).toBe(true);
    expect(canonicalPath).toMatchObject({ success: false, code: "duplicate", field: "url" });

    const encodedPath = await administration.createDraft({
      name: "Encoded Path URL",
      type: "other",
      url: "https://encoded.example/part%6eer",
    });
    const decodedPath = await administration.createDraft({
      name: "Decoded Path URL",
      type: "other",
      url: "https://encoded.example/partner",
    });
    expect(encodedPath.success).toBe(true);
    expect(decodedPath).toMatchObject({ success: false, code: "duplicate", field: "url" });

    const defaultPortAndDot = await administration.createDraft({
      name: "Default Port and Dot URL",
      type: "other",
      url: "https://default.example:0443/sponsors/.",
    });
    const canonicalDefaultPortAndDot = await administration.createDraft({
      name: "Canonical Default Port and Dot URL",
      type: "other",
      url: "https://default.example/sponsors/",
    });
    expect(defaultPortAndDot.success).toBe(true);
    expect(canonicalDefaultPortAndDot).toMatchObject({
      success: false,
      code: "duplicate",
      field: "url",
    });
  });

  it("returns fuzzy-name and shared-host similarities as non-blocking warnings", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    await administration.createDraft({
      name: "Open Source Initiative",
      type: "community_partner",
      url: "https://github.com/opensource",
    });

    const result = await administration.createDraft({
      name: "Open Source Initiativ",
      type: "supporter",
      url: "https://github.com/whatthestackconf",
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        partner: { name: "Open Source Initiativ" },
        warnings: [
          {
            kind: "similar_name",
            partner: { name: "Open Source Initiative" },
          },
          {
            kind: "shared_host",
            partner: { name: "Open Source Initiative" },
          },
        ],
      },
    });
  });

  it("updates only allowlisted fields and distinguishes omitted values from explicit clears", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    const created = await administration.createDraft({
      name: "Draft Partner",
      type: "supporter",
      url: "https://partner.example",
      notes: "Review this context",
      logo: { name: "logo.svg", type: "image/svg+xml", data: [1, 2, 3] },
    });
    if (!created.success) throw new Error(created.error);

    const updated = await administration.updatePartner(
      created.data.partner.id,
      created.data.partner.version,
      { url: null, notes: null, logo: null },
    );

    expect(updated).toMatchObject({
      success: true,
      data: {
        partner: {
          name: "Draft Partner",
          type: "supporter",
          logo: "",
        },
      },
    });
    if (!updated.success) throw new Error(updated.error);
    expect(updated.data.partner).not.toHaveProperty("url");
    expect(updated.data.partner).not.toHaveProperty("notes");

    await expect(
      administration.updatePartner(
        created.data.partner.id,
        created.data.partner.version,
        { published: true } as never,
      ),
    ).resolves.toMatchObject({
      success: false,
      code: "validation",
      error: "Partner patch contains fields that cannot be changed.",
    });
  });

  it("rejects stale and concurrent patches with a safe current snapshot", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    const created = await administration.createDraft({
      name: "Concurrent Partner",
      type: "supporter",
    });
    if (!created.success) throw new Error(created.error);

    const results = await Promise.all([
      administration.updatePartner(
        created.data.partner.id,
        created.data.partner.version,
        { notes: "First edit" },
      ),
      administration.updatePartner(
        created.data.partner.id,
        created.data.partner.version,
        { notes: "Second edit" },
      ),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    const stale = results.find((result) => !result.success);
    expect(stale).toMatchObject({
      success: false,
      code: "stale",
      current: {
        id: created.data.partner.id,
        name: "Concurrent Partner",
        notes: "First edit",
      },
    });
    expect(JSON.stringify(stale)).not.toContain("normalizedName");
    expect(JSON.stringify(stale)).not.toContain("canonicalUrl");
  });

  it("requires human Partner Note approval again after every note edit", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    const created = await administration.createDraft({
      name: "Noted Partner",
      type: "other",
      notes: "Reviewed non-sensitive context",
    });
    if (!created.success) throw new Error(created.error);

    const approved = await administration.setNoteApproval(
      created.data.partner.id,
      created.data.partner.version,
      true,
    );
    expect(approved).toMatchObject({
      success: true,
      data: { partner: { noteAgentVisible: true } },
    });
    if (!approved.success) throw new Error(approved.error);

    const edited = await administration.updatePartner(
      approved.data.partner.id,
      approved.data.partner.version,
      { notes: "Changed non-sensitive context" },
    );
    expect(edited).toMatchObject({
      success: true,
      data: { partner: { noteAgentVisible: false } },
    });
    if (!edited.success) throw new Error(edited.error);
    await expect(administration.listPartners()).resolves.toMatchObject([
      { partner: { notes: "Changed non-sensitive context", noteAgentVisible: false } },
    ]);

    const reapproved = await administration.setNoteApproval(
      edited.data.partner.id,
      edited.data.partner.version,
      true,
    );
    expect(reapproved).toMatchObject({
      success: true,
      data: { partner: { noteAgentVisible: true } },
    });

    const empty = await administration.createDraft({ name: "No Note", type: "other" });
    if (!empty.success) throw new Error(empty.error);
    await expect(
      administration.setNoteApproval(
        empty.data.partner.id,
        empty.data.partner.version,
        true,
      ),
    ).resolves.toMatchObject({
      success: false,
      code: "validation",
      error: "Add a Partner Note before approving agent visibility.",
    });
  });

  it("publishes only ready drafts and keeps Published Partners valid while humans edit them", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    const incomplete = await administration.createDraft({ name: "Incomplete", type: "other" });
    if (!incomplete.success) throw new Error(incomplete.error);

    await expect(
      administration.setPublication(
        incomplete.data.partner.id,
        incomplete.data.partner.version,
        true,
      ),
    ).resolves.toMatchObject({
      success: false,
      code: "publication_not_ready",
      current: { published: false },
      publication: {
        ready: false,
        issues: [{ field: "logo" }],
      },
    });

    const ready = await administration.createDraft({
      name: "Ready Partner",
      type: "sponsor",
      tier: "silver",
      url: "https://ready.example",
      logo: { name: "official.svg", type: "image/svg+xml", data: [1, 2, 3] },
    });
    if (!ready.success) throw new Error(ready.error);
    expect(ready.data.publication).toEqual({ ready: true, issues: [] });

    const published = await administration.setPublication(
      ready.data.partner.id,
      ready.data.partner.version,
      true,
    );
    expect(published).toMatchObject({ success: true, data: { partner: { published: true } } });
    if (!published.success) throw new Error(published.error);

    const edited = await administration.updatePartner(
      published.data.partner.id,
      published.data.partner.version,
      { name: "Ready Partner Updated" },
    );
    expect(edited).toMatchObject({
      success: true,
      data: { partner: { name: "Ready Partner Updated", published: true } },
    });
    if (!edited.success) throw new Error(edited.error);

    await expect(
      administration.updatePartner(edited.data.partner.id, edited.data.partner.version, {
        logo: null,
      }),
    ).resolves.toMatchObject({
      success: false,
      code: "publication_not_ready",
      current: { logo: "official.svg", published: true },
      publication: { issues: [{ field: "logo" }] },
    });
  });

  it("accepts only human-uploaded Partner logo file types and always creates a draft", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );

    await expect(
      administration.createDraft({
        name: "Bad Logo",
        type: "other",
        logo: { name: "logo.txt", type: "text/plain", data: [1] },
      }),
    ).resolves.toEqual({
      success: false,
      code: "validation",
      error: "Logo must be SVG, PNG, JPEG, WebP, or AVIF.",
    });

    const forcedDraft = await administration.createDraft({
      name: "Draft Only",
      type: "other",
      logo: { name: "logo.png", type: "image/png", data: [1] },
      published: true,
    } as never);
    expect(forcedDraft).toMatchObject({
      success: true,
      data: { partner: { published: false } },
    });
  });

  it("reserves logo provenance, note approval, and publication for human admins", async () => {
    const store = createInMemoryPartnerAdministrationStore();
    const humanAdministration = new PartnerAdministration(store, "human_admin");
    const agentAdministration = new PartnerAdministration(store, "agent");
    const logo = { name: "official.svg", type: "image/svg+xml", data: [1, 2, 3] };

    await expect(
      agentAdministration.createDraft({ name: "Agent Logo", type: "other", logo }),
    ).resolves.toEqual({
      success: false,
      code: "validation",
      error: "Only a human admin can upload an official Partner logo.",
    });

    const created = await humanAdministration.createDraft({
      name: "Human-reviewed Partner",
      type: "other",
      notes: "Non-sensitive context",
    });
    if (!created.success) throw new Error(created.error);
    await expect(agentAdministration.listPartners()).resolves.toMatchObject([
      { partner: { notes: undefined, noteAgentVisible: false } },
    ]);
    await expect(
      agentAdministration.deletePartner(created.data.partner.id, created.data.partner.version),
    ).resolves.toMatchObject({ success: false, code: "validation" });

    await expect(
      agentAdministration.updatePartner(created.data.partner.id, created.data.partner.version, {
        logo,
      }),
    ).resolves.toMatchObject({
      success: false,
      code: "validation",
      error: "Only a human admin can upload or remove an official Partner logo.",
    });

    const withLogo = await humanAdministration.updatePartner(
      created.data.partner.id,
      created.data.partner.version,
      { logo },
    );
    expect(withLogo).toMatchObject({ success: true, data: { publication: { ready: true } } });
    if (!withLogo.success) throw new Error(withLogo.error);

    await expect(
      agentAdministration.setNoteApproval(
        withLogo.data.partner.id,
        withLogo.data.partner.version,
        true,
      ),
    ).resolves.toMatchObject({ success: false, code: "validation" });
    await expect(
      agentAdministration.setPublication(
        withLogo.data.partner.id,
        withLogo.data.partner.version,
        true,
      ),
    ).resolves.toMatchObject({ success: false, code: "validation" });
    const approved = await humanAdministration.setNoteApproval(
      withLogo.data.partner.id,
      withLogo.data.partner.version,
      true,
    );
    expect(approved).toMatchObject({ success: true });
    if (!approved.success) throw new Error(approved.error);
    await expect(agentAdministration.listPartners()).resolves.toMatchObject([
      { partner: { notes: "Non-sensitive context", noteAgentVisible: true } },
    ]);
    const published = await humanAdministration.setPublication(
      approved.data.partner.id,
      approved.data.partner.version,
      true,
    );
    expect(published).toMatchObject({ success: true, data: { partner: { published: true } } });
    if (!published.success) throw new Error(published.error);
    await expect(
      agentAdministration.updatePartner(
        published.data.partner.id,
        published.data.partner.version,
        { notes: "Agent edit" },
      ),
    ).resolves.toMatchObject({ success: false, code: "validation" });
    await expect(
      agentAdministration.deletePartner(
        published.data.partner.id,
        published.data.partner.version,
      ),
    ).resolves.toMatchObject({ success: false, code: "validation" });
  });

  it("enforces the same lifecycle through the production PocketBase store adapter", { timeout: 20_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "wts-partner-store-"));
    const migrationsDir = join(root, "pb_migrations");
    const hooksDir = join(root, "pb_hooks");
    const dataDir = join(root, "pb_data");
    mkdirSync(migrationsDir);
    mkdirSync(hooksDir);
    mkdirSync(dataDir);
    writeFileSync(
      join(hooksDir, "partner_administration.pb.js"),
      readFileSync(new URL("../../pocketbase/pb_hooks/partner_administration.pb.js", import.meta.url), "utf8"),
    );
    writeFileSync(
      join(hooksDir, "admin_action_ledger.pb.js"),
      readFileSync(new URL("../../pocketbase/pb_hooks/admin_action_ledger.pb.js", import.meta.url), "utf8"),
    );
    const binary = fileURLToPath(new URL("../../pocketbase/pocketbase", import.meta.url));
    for (const migration of [
      "1782000000_create_partners.js",
      "1782000001_remove_bank_partner_tier.js",
      "1768850001_fix_user_role.js",
      "1783000000_create_mcp_tokens.js",
      "1787000000_normalize_partner_vocabulary.js",
      "1787000002_partner_draft_lifecycle.js",
      "1787000004_create_admin_actions.js",
    ]) {
      writeFileSync(
        join(migrationsDir, migration),
        readFileSync(new URL(`../../pocketbase/pb_migrations/${migration}`, import.meta.url), "utf8"),
      );
    }

    const migrate = spawnSync(binary, [
      "migrate",
      "up",
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
      `--hooksDir=${hooksDir}`,
    ], { encoding: "utf8" });
    expect(migrate.status, `${migrate.stdout}\n${migrate.stderr}`).toBe(0);
    const email = "partner-store@example.com";
    const password = "partner-store-password";
    const superuser = spawnSync(binary, [
      "superuser",
      "create",
      email,
      password,
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
      `--hooksDir=${hooksDir}`,
      "--automigrate=false",
    ], { encoding: "utf8" });
    expect(superuser.status, `${superuser.stdout}\n${superuser.stderr}`).toBe(0);

    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const server = spawn(binary, [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
      `--hooksDir=${hooksDir}`,
      "--automigrate=false",
      "--hooksWatch=false",
      "--dev",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let serverLogs = "";
    server.stdout.on("data", (chunk) => { serverLogs += String(chunk); });
    server.stderr.on("data", (chunk) => { serverLogs += String(chunk); });

    try {
      await waitForPocketBase(baseUrl);
      const pb = new PocketBase(baseUrl);
      pb.autoCancellation(false);
      await pb.collection("_superusers").authWithPassword(email, password);
      const actor = await pb.collection("users").create({
        email: "partner-admin@example.com",
        password: "partner-admin-password",
        passwordConfirm: "partner-admin-password",
        name: "Partner Admin",
        role: "admin",
        verified: true,
      });
      expect(actor.role).toBe("admin");
      const productionStore = createPocketBasePartnerAdministrationStore(pb);
      const productionActions = new AdminActions(createPocketBaseAdminActionStore(pb));
      const administration = new PartnerAdministration(
        productionStore,
        { mode: "human_admin", userId: actor.id, source: "admin_ui" },
        productionActions,
      );

      let ledgerNow = new Date("2026-07-13T12:00:00.000Z");
      const leasedActions = new AdminActions(createPocketBaseAdminActionStore(pb), {
        now: () => ledgerNow,
        leaseMilliseconds: 30_000,
      });
      const leaseRequest = {
        actorUserId: actor.id,
        source: "admin_ui" as const,
        operationKind: "partner.patch",
        targetCollection: "partners",
        targetId: "lease-target",
        operationId: "production-lease",
        normalizedInput: { id: "lease-target", name: "Lease" },
      };
      const leased = await leasedActions.start(leaseRequest);
      if (leased.outcome !== "started") throw new Error("Expected a production lease.");
      ledgerNow = new Date("2026-07-13T12:00:01.000Z");
      await expect(leasedActions.start(leaseRequest)).resolves.toMatchObject({
        outcome: "pending",
        action: { attemptCount: 1 },
      });
      ledgerNow = new Date("2026-07-13T12:00:31.000Z");
      const reclaimed = await leasedActions.start(leaseRequest);
      expect(reclaimed).toMatchObject({ outcome: "started", action: { attemptCount: 2 } });
      if (reclaimed.outcome !== "started") throw new Error("Expected an expired lease retry.");
      await expect(
        leasedActions.complete(reclaimed.handle, {
          targetId: "different-target",
          beforeSummary: { id: "lease-target" },
          afterSummary: { id: "different-target" },
          replayResult: { id: "different-target" },
        }),
      ).rejects.toMatchObject({ status: 400 });
      await leasedActions.fail(reclaimed.handle, {
        code: "lease_test_complete",
        message: "Production lease behavior verified.",
      });

      const concurrentRequest = {
        ...leaseRequest,
        operationId: "production-concurrent-reservation",
        normalizedInput: { id: "lease-target", name: "Concurrent" },
      };
      const concurrentReservations = await Promise.all([
        productionActions.start(concurrentRequest),
        productionActions.start(concurrentRequest),
      ]);
      expect(concurrentReservations.filter((result) => result.outcome === "started")).toHaveLength(1);
      expect(concurrentReservations.some((result) => result.outcome === "pending")).toBe(true);
      const reserved = concurrentReservations.find((result) => result.outcome === "started");
      if (!reserved || reserved.outcome !== "started") throw new Error("Expected one reservation winner.");
      await productionActions.fail(reserved.handle, {
        code: "concurrency_test_complete",
        message: "Concurrent reservation behavior verified.",
      });

      const created = await administration.createDraft({
        name: "Production Adapter",
        type: "supporter",
        logo: null,
      });
      expect(created, serverLogs).toMatchObject({
        success: true,
        data: { partner: { logo: "", published: false } },
      });
      if (!created.success) throw new Error(created.error);

      const action = await pb.collection("admin_actions").getFirstListItem("");
      const ordinaryClient = new PocketBase(baseUrl);
      await ordinaryClient.collection("users").authWithPassword(
        "partner-admin@example.com",
        "partner-admin-password",
      );
      for (const request of [
        () => ordinaryClient.collection("admin_actions").getList(1, 10),
        () => ordinaryClient.collection("admin_actions").create({ status: "failed" }),
        () => ordinaryClient.collection("admin_actions").update(action.id, { status: "failed" }),
        () => ordinaryClient.collection("admin_actions").delete(action.id),
      ]) {
        await expect(request()).rejects.toMatchObject({ status: expect.any(Number) });
      }

      const current = await productionStore.get(created.data.partner.id);
      if (!current) throw new Error("Expected the created Partner.");
      for (const request of [
        () => ordinaryClient.collection("partners").create({
          name: "Bypassed Partner",
          normalized_name: "bypassed partner",
          type: "supporter",
        }),
        () => ordinaryClient.collection("partners").update(current.id, { name: "Bypassed Edit" }),
        () => ordinaryClient.collection("partners").delete(current.id),
      ]) {
        await expect(request()).rejects.toMatchObject({ status: expect.any(Number) });
      }

      if (!created.action) throw new Error("Expected the applied create Admin Action.");
      await expect(
        pb.collection("admin_actions").update(created.action.id, {
          after_summary: { name: "Rewritten history" },
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        pb.collection("admin_actions").delete(created.action.id),
      ).rejects.toMatchObject({ status: 400 });

      const wrongKind = await productionActions.start({
        actorUserId: actor.id,
        source: "admin_ui",
        operationKind: "partner.delete",
        targetCollection: "partners",
        targetId: current.id,
        operationId: "wrong-kind-patch",
        normalizedInput: { id: current.id },
      });
      if (wrongKind.outcome !== "started") throw new Error("Expected a pending wrong-kind action.");
      await expect(
        productionStore.update(
          current.id,
          current.version,
          {
            name: current.name,
            normalizedName: current.normalizedName,
            published: current.published,
            type: current.type,
            tier: current.tier,
            logoUploadedByHuman: current.logoUploadedByHuman,
            url: current.url,
            canonicalUrl: current.canonicalUrl,
            notes: current.notes,
            noteAgentVisible: current.noteAgentVisible,
          },
          {
            handle: wrongKind.handle,
            operationKind: "partner.delete",
            targetId: current.id,
            normalizedInput: { id: current.id },
            completion: {
              targetId: current.id,
              beforeSummary: { id: current.id, name: current.name },
              afterSummary: { id: current.id, name: current.name },
              replayResult: { kind: "partner_delete", data: { id: current.id } },
            },
            complete: (completion) => productionActions.complete(wrongKind.handle, completion),
            isApplied: async () => false,
          },
        ),
      ).rejects.toMatchObject({ status: 400 });
      await productionActions.fail(wrongKind.handle, {
        code: "invalid_target_route",
        message: "Wrong Partner target route was rejected.",
      });

      const reservedPatchInput = {
        id: current.id,
        expectedVersion: current.version,
        patch: { name: "Reserved Partner Name", normalizedName: "reserved partner name" },
      };
      const reservedPatch = await productionActions.start({
        actorUserId: actor.id,
        source: "admin_ui",
        operationKind: "partner.patch",
        targetCollection: "partners",
        targetId: current.id,
        operationId: "smuggled-generic-patch",
        normalizedInput: reservedPatchInput,
      });
      if (reservedPatch.outcome !== "started") throw new Error("Expected a pending Partner patch.");
      await expect(
        productionStore.update(
          current.id,
          current.version,
          {
            name: "Different Smuggled Name",
            normalizedName: "different smuggled name",
            published: current.published,
            type: current.type,
            tier: current.tier,
            logoUploadedByHuman: current.logoUploadedByHuman,
            url: current.url,
            canonicalUrl: current.canonicalUrl,
            notes: current.notes,
            noteAgentVisible: current.noteAgentVisible,
          },
          {
            handle: reservedPatch.handle,
            operationKind: "partner.patch",
            targetId: current.id,
            normalizedInput: reservedPatchInput,
            completion: {
              targetId: current.id,
              beforeSummary: { id: current.id, name: current.name },
              afterSummary: { id: current.id, name: "Reserved Partner Name" },
              replayResult: { kind: "partner_mutation", data: { partner: { id: current.id } } },
            },
            complete: (completion) => productionActions.complete(reservedPatch.handle, completion),
            isApplied: async () => false,
          },
        ),
      ).rejects.toMatchObject({ status: 400 });
      await productionActions.fail(reservedPatch.handle, {
        code: "smuggled_patch_rejected",
        message: "Partner patch input binding was verified.",
      });

      const currentAfterWrongKind = await productionStore.get(created.data.partner.id);
      if (!currentAfterWrongKind) throw new Error("Expected the Partner after wrong-kind rejection.");
      const smuggledPublish = await productionActions.start({
        actorUserId: actor.id,
        source: "admin_ui",
        operationKind: "partner.publish",
        targetCollection: "partners",
        targetId: currentAfterWrongKind.id,
        operationId: "smuggled-publish-edit",
        normalizedInput: { id: currentAfterWrongKind.id, published: true },
      });
      if (smuggledPublish.outcome !== "started") throw new Error("Expected a pending publish action.");
      await expect(
        productionStore.update(
          currentAfterWrongKind.id,
          currentAfterWrongKind.version,
          {
            name: "Smuggled Partner Name",
            normalizedName: "smuggled partner name",
            published: true,
            type: currentAfterWrongKind.type,
            tier: currentAfterWrongKind.tier,
            logoUploadedByHuman: currentAfterWrongKind.logoUploadedByHuman,
            url: currentAfterWrongKind.url,
            canonicalUrl: currentAfterWrongKind.canonicalUrl,
            notes: currentAfterWrongKind.notes,
            noteAgentVisible: currentAfterWrongKind.noteAgentVisible,
          },
          {
            handle: smuggledPublish.handle,
            operationKind: "partner.publish",
            targetId: currentAfterWrongKind.id,
            normalizedInput: { id: currentAfterWrongKind.id, published: true },
            completion: {
              targetId: currentAfterWrongKind.id,
              beforeSummary: { id: currentAfterWrongKind.id, name: currentAfterWrongKind.name },
              afterSummary: { id: currentAfterWrongKind.id, name: "Smuggled Partner Name" },
              replayResult: { kind: "partner_mutation", data: { partner: { id: currentAfterWrongKind.id } } },
            },
            complete: (completion) => productionActions.complete(smuggledPublish.handle, completion),
            isApplied: async () => false,
          },
        ),
      ).rejects.toMatchObject({ status: 400 });
      await productionActions.fail(smuggledPublish.handle, {
        code: "smuggled_edit_rejected",
        message: "Specialized Partner operation field boundary verified.",
      });
      await expect(productionStore.get(created.data.partner.id)).resolves.toMatchObject({
        name: "Production Adapter",
        published: false,
      });

      const reservedLogoData = Array.from(Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ));
      const substitutedLogoData = [...reservedLogoData];
      substitutedLogoData[substitutedLogoData.length - 10] ^= 1;
      const reservedLogoInput = {
        id: currentAfterWrongKind.id,
        expectedVersion: currentAfterWrongKind.version,
        patch: {
          logo: {
            present: true,
            name: "content-bound.png",
            mediaType: "image/png",
            bytes: reservedLogoData.length,
            fingerprint: logoFingerprint(reservedLogoData),
          },
        },
      };
      const reservedLogo = await productionActions.start({
        actorUserId: actor.id,
        source: "admin_ui",
        operationKind: "partner.patch",
        targetCollection: "partners",
        targetId: currentAfterWrongKind.id,
        operationId: "smuggled-logo-content",
        normalizedInput: reservedLogoInput,
      });
      if (reservedLogo.outcome !== "started") throw new Error("Expected a pending logo patch.");
      await expect(
        productionStore.update(
          currentAfterWrongKind.id,
          currentAfterWrongKind.version,
          {
            name: currentAfterWrongKind.name,
            normalizedName: currentAfterWrongKind.normalizedName,
            published: currentAfterWrongKind.published,
            type: currentAfterWrongKind.type,
            tier: currentAfterWrongKind.tier,
            logo: {
              name: "content-bound.png",
              type: "image/png",
              data: substitutedLogoData,
            },
            logoUploadedByHuman: true,
            url: currentAfterWrongKind.url,
            canonicalUrl: currentAfterWrongKind.canonicalUrl,
            notes: currentAfterWrongKind.notes,
            noteAgentVisible: currentAfterWrongKind.noteAgentVisible,
          },
          {
            handle: reservedLogo.handle,
            operationKind: "partner.patch",
            targetId: currentAfterWrongKind.id,
            normalizedInput: reservedLogoInput,
            completion: {
              targetId: currentAfterWrongKind.id,
              beforeSummary: { id: currentAfterWrongKind.id, name: currentAfterWrongKind.name },
              afterSummary: { id: currentAfterWrongKind.id, name: currentAfterWrongKind.name },
              replayResult: { kind: "partner_mutation", data: { partner: { id: currentAfterWrongKind.id } } },
            },
            complete: (completion) => productionActions.complete(reservedLogo.handle, completion),
            isApplied: async () => false,
          },
        ),
      ).rejects.toMatchObject({ status: 400 });
      await productionActions.fail(reservedLogo.handle, {
        code: "smuggled_logo_rejected",
        message: "Partner logo content binding was verified.",
      });

      const sponsor = await administration.createDraft({
        name: "Production Sponsor Demotion",
        type: "sponsor",
        tier: "bronze",
      });
      if (!sponsor.success) throw new Error(sponsor.error);
      const demoted = await administration.updatePartner(
        sponsor.data.partner.id,
        sponsor.data.partner.version,
        { type: "supporter" },
      );
      expect(demoted).toMatchObject({
        success: true,
        data: { partner: { type: "supporter" } },
      });
      if (!demoted.success) throw new Error(demoted.error);
      expect(demoted.data.partner.tier).toBeUndefined();
      const ignoredTier = await administration.updatePartner(
        demoted.data.partner.id,
        demoted.data.partner.version,
        { tier: "gold" },
      );
      expect(ignoredTier).toMatchObject({
        success: true,
        data: { partner: { type: "supporter" } },
      });
      if (!ignoredTier.success) throw new Error(ignoredTier.error);
      expect(ignoredTier.data.partner.tier).toBeUndefined();

      const agentAdministration = new AuditedPartnerAdministration(
        productionStore,
        { mode: "agent", userId: actor.id, source: "mcp" },
        productionActions,
      );
      const timestampPatch = await agentAdministration.updatePartnerDraft(
        ignoredTier.data.partner.id,
        ignoredTier.data.partner.updatedAt,
        { notes: "Production timestamp patch" },
        "production-agent-timestamp-patch",
      );
      expect(timestampPatch, serverLogs).toMatchObject({
        success: true,
        action: { replayed: false },
      });
      if (!timestampPatch.success) throw new Error(timestampPatch.error);
      const timestampReplay = await agentAdministration.updatePartnerDraft(
        ignoredTier.data.partner.id,
        ignoredTier.data.partner.updatedAt,
        { notes: "Production timestamp patch" },
        "production-agent-timestamp-patch",
      );
      expect(timestampReplay).toMatchObject({
        success: true,
        data: { partner: { id: timestampPatch.data.partner.id } },
        action: { id: timestampPatch.action.id, replayed: true },
      });
      await expect(
        agentAdministration.updatePartnerDraft(
          ignoredTier.data.partner.id,
          ignoredTier.data.partner.updatedAt,
          { name: "Stale Production Patch" },
          "production-agent-stale-patch",
        ),
      ).resolves.toMatchObject({ success: false, code: "stale" });

      const withLogo = await administration.updatePartner(
        created.data.partner.id,
        created.data.partner.version,
        {
          logo: {
            name: "official.png",
            type: "image/png",
            data: Array.from(Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              "base64",
            )),
          },
        },
      );
      expect(withLogo, serverLogs).toMatchObject({
        success: true,
        data: { partner: { logo: expect.stringContaining("official") }, publication: { ready: true } },
      });
      if (!withLogo.success) throw new Error(withLogo.error);
      expect(withLogo.data.partner.updatedAt).not.toContain("|");
      expect(withLogo.data.partner.version).toContain("|");

      const duplicateCreates = await Promise.all([
        administration.createDraft({ name: "Production   Collision", type: "other" }),
        administration.createDraft({ name: " production collision ", type: "media" }),
      ]);
      expect(duplicateCreates.filter((result) => result.success)).toHaveLength(1);
      expect(duplicateCreates.find((result) => !result.success)).toMatchObject({
        success: false,
        code: "duplicate",
        field: "name",
      });

      const duplicateUrls = await Promise.all([
        administration.createDraft({
          name: "Production URL One",
          type: "other",
          url: "https://url.example/a/../partner",
        }),
        administration.createDraft({
          name: "Production URL Two",
          type: "media",
          url: "https://url.example/partner",
        }),
      ]);
      expect(duplicateUrls.filter((result) => result.success)).toHaveLength(1);
      expect(duplicateUrls.find((result) => !result.success)).toMatchObject({
        success: false,
        code: "duplicate",
        field: "url",
      });

      const updates = await Promise.all([
        administration.updatePartner(
          withLogo.data.partner.id,
          withLogo.data.partner.version,
          { notes: "First production edit" },
        ),
        administration.updatePartner(
          withLogo.data.partner.id,
          withLogo.data.partner.version,
          { notes: "Second production edit" },
        ),
      ]);
      expect(updates.filter((result) => result.success)).toHaveLength(1);
      expect(updates.find((result) => !result.success)).toMatchObject({
        success: false,
        code: "stale",
      });

      const deletable = await administration.createDraft({
        name: "Production Delete",
        type: "other",
      });
      if (!deletable.success) throw new Error(deletable.error);
      await expect(
        administration.deletePartner(
          deletable.data.partner.id,
          deletable.data.partner.version,
        ),
      ).resolves.toMatchObject({ success: true, data: { id: deletable.data.partner.id } });
    } finally {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists review readiness and version-checks deletion through the module", async () => {
    const administration = new PartnerAdministration(
      createInMemoryPartnerAdministrationStore(),
      "human_admin",
    );
    const created = await administration.createDraft({ name: "Review Draft", type: "other" });
    if (!created.success) throw new Error(created.error);
    const edited = await administration.updatePartner(
      created.data.partner.id,
      created.data.partner.version,
      { notes: "Keep this" },
    );
    if (!edited.success) throw new Error(edited.error);

    await expect(administration.listPartners()).resolves.toMatchObject([
      {
        partner: { id: created.data.partner.id, name: "Review Draft" },
        publication: { ready: false, issues: [{ field: "logo" }] },
      },
    ]);
    await expect(
      administration.deletePartner(created.data.partner.id, created.data.partner.version),
    ).resolves.toMatchObject({ success: false, code: "stale", current: { notes: "Keep this" } });
    await expect(
      administration.deletePartner(edited.data.partner.id, edited.data.partner.version),
    ).resolves.toMatchObject({ success: true, data: { id: edited.data.partner.id } });
    await expect(administration.listPartners()).resolves.toEqual([]);
  });
});
