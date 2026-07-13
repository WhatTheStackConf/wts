import { describe, expect, it } from "vitest";
import { AdminActions } from "~/lib/admin-action-ledger";
import { createInMemoryAdminActionStore } from "~/lib/admin-action-memory-store";

const request = {
  actorUserId: "user-admin",
  source: "admin_ui" as const,
  operationKind: "partner.create",
  targetCollection: "partners",
  operationId: "create-partner-1",
  normalizedInput: {
    name: "Example Partner",
    type: "supporter",
  },
};

describe("Admin Actions", () => {
  it("reserves a pending action and replays its exact applied result", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore(), {
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      createAttemptToken: () => "attempt-1",
    });

    const started = await actions.start(request);

    expect(started).toMatchObject({
      outcome: "started",
      action: {
        actorUserId: "user-admin",
        mcpTokenId: undefined,
        source: "admin_ui",
        operationKind: "partner.create",
        targetCollection: "partners",
        targetId: undefined,
        operationId: "create-partner-1",
        status: "pending",
        attemptCount: 1,
      },
      handle: { attemptToken: "attempt-1" },
    });
    if (started.outcome !== "started") throw new Error("Expected a started Admin Action.");

    const completed = await actions.complete(started.handle, {
      targetId: "partner-1",
      beforeSummary: null,
      afterSummary: { name: "Example Partner", published: false },
      replayResult: { partnerId: "partner-1" },
    });

    expect(completed).toMatchObject({
      status: "applied",
      targetId: "partner-1",
      beforeSummary: null,
      afterSummary: { name: "Example Partner", published: false },
      replayResult: { partnerId: "partner-1" },
    });
    await expect(actions.start(request)).resolves.toMatchObject({
      outcome: "replayed",
      action: { id: completed.id, status: "applied" },
      result: { partnerId: "partner-1" },
    });
  });

  it("rejects an operation ID reused with changed normalized input", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    await actions.start(request);

    await expect(
      actions.start({
        ...request,
        normalizedInput: { name: "Different Partner", type: "supporter" },
      }),
    ).resolves.toMatchObject({
      outcome: "mismatch",
      action: { operationId: "create-partner-1", status: "pending" },
    });
  });

  it("rejects an operation ID reused for a different target", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    await actions.start({ ...request, targetId: "partner-1" });

    await expect(
      actions.start({ ...request, targetId: "partner-2" }),
    ).resolves.toMatchObject({
      outcome: "mismatch",
      action: { operationId: "create-partner-1", targetId: "partner-1" },
    });
  });

  it("does not let completion rebind a reserved target", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    const started = await actions.start({ ...request, targetId: "partner-1" });
    if (started.outcome !== "started") throw new Error("Expected a started Admin Action.");

    await expect(
      actions.complete(started.handle, {
        targetId: "partner-2",
        beforeSummary: { id: "partner-1" },
        afterSummary: { id: "partner-2" },
        replayResult: { partnerId: "partner-2" },
      }),
    ).rejects.toThrow("target");
    await expect(actions.inspect({ ...request, targetId: "partner-1" })).resolves.toMatchObject({
      outcome: "pending",
      action: { targetId: "partner-1" },
    });
  });

  it("reports an active pending operation without starting duplicate work", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    const started = await actions.start(request);
    if (started.outcome !== "started") throw new Error("Expected a started Admin Action.");

    await expect(actions.start(request)).resolves.toMatchObject({
      outcome: "pending",
      action: { id: started.action.id, status: "pending", attemptCount: 1 },
    });
  });

  it("allows an exact failed operation to retry under a new attempt", async () => {
    const attemptTokens = ["attempt-1", "attempt-2"];
    const actions = new AdminActions(createInMemoryAdminActionStore(), {
      createAttemptToken: () => attemptTokens.shift() || "unexpected-attempt",
    });
    const started = await actions.start(request);
    if (started.outcome !== "started") throw new Error("Expected a started Admin Action.");

    const failed = await actions.fail(started.handle, {
      code: "partner_write_failed",
      message: "Partner persistence failed safely.",
      metadata: { retryable: true },
    });

    expect(failed).toMatchObject({
      status: "failed",
      failure: {
        code: "partner_write_failed",
        message: "Partner persistence failed safely.",
        metadata: { retryable: true },
      },
    });
    await expect(actions.start(request)).resolves.toMatchObject({
      outcome: "started",
      action: { id: failed.id, status: "pending", attemptCount: 2, failure: undefined },
      handle: { actionId: failed.id, attemptToken: "attempt-2" },
    });
  });

  it("keeps a crash-incomplete operation visible and reclaims it only after its lease expires", async () => {
    let now = new Date("2026-07-13T12:00:00.000Z");
    const attemptTokens = ["attempt-1", "unused-pending-attempt", "attempt-2"];
    const actions = new AdminActions(createInMemoryAdminActionStore(), {
      now: () => now,
      createAttemptToken: () => attemptTokens.shift() || "unexpected-attempt",
      leaseMilliseconds: 30_000,
    });
    const interrupted = await actions.start(request);
    if (interrupted.outcome !== "started") throw new Error("Expected a started Admin Action.");

    now = new Date("2026-07-13T12:00:20.000Z");
    await expect(actions.start(request)).resolves.toMatchObject({
      outcome: "pending",
      action: { id: interrupted.action.id, attemptCount: 1 },
    });

    now = new Date("2026-07-13T12:00:31.000Z");
    await expect(actions.start(request)).resolves.toMatchObject({
      outcome: "started",
      action: { id: interrupted.action.id, status: "pending", attemptCount: 2 },
      handle: { actionId: interrupted.action.id, attemptToken: "attempt-2" },
    });
  });

  it("rejects sensitive or unbounded state summaries before persistence", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    const started = await actions.start(request);
    if (started.outcome !== "started") throw new Error("Expected a started Admin Action.");

    await expect(
      actions.complete(started.handle, {
        beforeSummary: null,
        afterSummary: { name: "Example Partner", notes: "private Partner Note" },
        replayResult: { partnerId: "partner-1" },
      }),
    ).rejects.toThrow("sensitive field");

    await expect(
      actions.complete(started.handle, {
        beforeSummary: null,
        afterSummary: { name: "x".repeat(2_100) },
        replayResult: { partnerId: "partner-1" },
      }),
    ).rejects.toThrow("2,048 bytes");

    const unsafeSummaries: Array<Record<string, string>> = [
      { partnerNote: "private Partner Note" },
      { partner_note: "private Partner Note" },
      { access_token: "private bearer token" },
      { client_secret: "private client secret" },
      { raw_body: "private request body" },
    ];
    for (const afterSummary of unsafeSummaries) {
      await expect(
        actions.complete(started.handle, {
          beforeSummary: null,
          afterSummary,
          replayResult: { partnerId: "partner-1" },
        }),
      ).rejects.toThrow("sensitive field");
    }

    await expect(
      actions.complete(started.handle, {
        beforeSummary: null,
        afterSummary: { name: "Example Partner" },
        replayResult: { value: "x".repeat(33_000) },
      }),
    ).rejects.toThrow("32,768 bytes");
  });

  it("rejects non-finite normalized input before fingerprinting", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());

    await expect(
      actions.start({ ...request, normalizedInput: { score: Number.NaN } }),
    ).rejects.toThrow("non-finite");
  });

  it("inspects operation identity without reserving invalid work", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());

    await expect(actions.inspect(request)).resolves.toEqual({ outcome: "new" });
    const started = await actions.start(request);
    if (started.outcome !== "started") throw new Error("Expected a started Admin Action.");
    await expect(actions.inspect(request)).resolves.toMatchObject({
      outcome: "pending",
      action: { id: started.action.id },
    });
    await expect(
      actions.inspect({ ...request, normalizedInput: { name: "Changed", type: "supporter" } }),
    ).resolves.toMatchObject({ outcome: "mismatch", action: { id: started.action.id } });
  });

  it("lists bounded history for a target across applied, pending, and failed states", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    const applied = await actions.start({ ...request, targetId: "partner-1" });
    if (applied.outcome !== "started") throw new Error("Expected a started Admin Action.");
    await actions.complete(applied.handle, {
      targetId: "partner-1",
      beforeSummary: { name: "Old" },
      afterSummary: { name: "New" },
      replayResult: { partnerId: "partner-1" },
    });
    await actions.start(
      {
        ...request,
        targetId: "partner-1",
        operationId: "publish-partner-1",
        operationKind: "partner.publish",
        normalizedInput: { id: "partner-1", published: true },
      },
      {
        beforeSummary: { id: "partner-1", name: "New", published: false },
        afterSummary: { id: "partner-1", name: "New", published: true },
      },
    );
    const failed = await actions.start({
      ...request,
      targetId: "partner-2",
      operationId: "delete-partner-2",
      operationKind: "partner.delete",
      normalizedInput: { id: "partner-2" },
    });
    if (failed.outcome !== "started") throw new Error("Expected a started Admin Action.");
    await actions.fail(failed.handle, { code: "blocked", message: "Partner deletion was blocked." });

    const history = await actions.list({
      targetCollection: "partners",
      targetId: "partner-1",
      limit: 10,
    });

    expect(history).toHaveLength(2);
    expect(history.map((action) => action.status).sort()).toEqual(["applied", "pending"]);
    expect(history.every((action) => action.targetId === "partner-1")).toBe(true);
    expect(history.find((action) => action.status === "pending")).toMatchObject({
      beforeSummary: { id: "partner-1", name: "New", published: false },
      afterSummary: { id: "partner-1", name: "New", published: true },
    });
  });

  it("returns detached summary and replay values that cannot mutate ledger history", async () => {
    const actions = new AdminActions(createInMemoryAdminActionStore());
    const started = await actions.start(request);
    if (started.outcome !== "started") throw new Error("Expected a started Admin Action.");
    const completed = await actions.complete(started.handle, {
      targetId: "partner-1",
      beforeSummary: { partner: { name: "Before" } },
      afterSummary: { partner: { name: "After" } },
      replayResult: { partner: { id: "partner-1", name: "Applied" } },
    });

    (completed.afterSummary as { partner: { name: string } }).partner.name = "Corrupted";
    (completed.replayResult as { partner: { name: string } }).partner.name = "Corrupted";
    const inspected = await actions.inspect(request);
    if (inspected.outcome !== "replayed") throw new Error("Expected an applied Admin Action.");
    (inspected.result as { partner: { name: string } }).partner.name = "Corrupted";

    await expect(actions.start(request)).resolves.toMatchObject({
      outcome: "replayed",
      result: { partner: { id: "partner-1", name: "Applied" } },
    });
    await expect(actions.list({ targetCollection: "partners" })).resolves.toMatchObject([
      { afterSummary: { partner: { name: "After" } } },
    ]);
  });
});
