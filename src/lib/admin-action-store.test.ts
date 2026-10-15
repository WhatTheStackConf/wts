import { describe, expect, it } from "vite-plus/test";
import type PocketBase from "pocketbase";
import { createPocketBaseAdminActionStore } from "~/lib/admin-action-store";

const now = "2026-05-01 10:00:00.000Z";

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "action-1",
    actor_user: "user-1",
    mcp_token: "",
    source: "admin_ui",
    operation_kind: "partner.update",
    target_collection: "partners",
    target_id: "",
    operation_id: "op-1",
    input_fingerprint: "fingerprint-1",
    idempotency_key: "key-1",
    status: "pending",
    attempt_count: 1,
    attempt_token: "token-0",
    lease_expires_at: "",
    created: now,
    updated: now,
    ...overrides,
  };
}

type FakeOptions = {
  lookups: Array<Record<string, unknown> | null>;
  createError?: unknown;
};

function fakePocketBase(options: FakeOptions) {
  const calls: string[] = [];
  const lookups = [...options.lookups];
  const pb = {
    filter: (expression: string) => expression,
    collection: () => ({
      getFirstListItem: async () => {
        calls.push("lookup");
        const found = lookups.shift();
        if (!found) throw { status: 404 };
        return found;
      },
      create: async (body: Record<string, unknown>) => {
        calls.push(`create:${body.idempotency_key}:${body.attempt_token}`);
        if (options.createError) throw options.createError;
        return record({ id: "created-1", attempt_token: body.attempt_token });
      },
    }),
    send: async (route: string, request: { body: { attempt_token: string } }) => {
      calls.push(`send:${route}:${request.body.attempt_token}`);
      return {
        outcome: "started",
        action: record({ id: "action-1", attempt_token: request.body.attempt_token, attempt_count: 2 }),
        handle: { actionId: "action-1", attemptToken: request.body.attempt_token },
      };
    },
  };
  return { pb: pb as unknown as PocketBase, calls };
}

const reservation = {
  request: {
    actorUserId: "user-1",
    source: "admin_ui" as const,
    operationKind: "partner.update",
    targetCollection: "partners",
    operationId: "op-1",
  },
  idempotencyKey: "key-1",
  inputFingerprint: "fingerprint-1",
  beforeSummary: null,
  afterSummary: null,
  attemptToken: "token-1",
  now,
  leaseExpiresAt: "2026-05-01 10:00:30.000Z",
};

async function reserve(options: FakeOptions) {
  const { pb, calls } = fakePocketBase(options);
  const store = createPocketBaseAdminActionStore(pb);
  try {
    const result = await store.reserve(reservation as never);
    return { result, calls };
  } catch (error) {
    return { error: (error as Error).message ?? error, calls };
  }
}

describe("PocketBase Admin Action reservation", () => {
  it("creates a new pending action when none exists", async () => {
    const { result, calls } = await reserve({ lookups: [null] });
    expect(calls).toEqual(["lookup", "create:key-1:token-1"]);
    expect(result).toMatchObject({
      outcome: "started",
      action: { id: "created-1", status: "pending" },
      handle: { actionId: "created-1", attemptToken: "token-1" },
    });
  });

  it("replays an applied action without exposing the stored result", async () => {
    const { result, calls } = await reserve({ lookups: [record({ status: "applied", replay_result: { ok: true } })] });
    expect(calls).toEqual(["lookup"]);
    expect(result).toEqual({ outcome: "replayed", action: expect.objectContaining({ id: "action-1", status: "applied" }) });
  });

  it("reports a fingerprint mismatch and a live lease as-is", async () => {
    const mismatch = await reserve({ lookups: [record({ input_fingerprint: "other" })] });
    expect(mismatch.result).toEqual({ outcome: "mismatch", action: expect.objectContaining({ inputFingerprint: "other" }) });
    const pending = await reserve({ lookups: [record({ lease_expires_at: "2026-05-01 10:05:00.000Z" })] });
    expect(pending.result).toEqual({ outcome: "pending", action: expect.objectContaining({ leaseExpiresAt: "2026-05-01 10:05:00.000Z" }) });
    expect(pending.calls).toEqual(["lookup"]);
  });

  it("claims an action whose lease expired", async () => {
    const { result, calls } = await reserve({ lookups: [record({ lease_expires_at: "2026-05-01 09:59:00.000Z" })] });
    expect(calls).toEqual(["lookup", "send:/api/wts/admin-actions/action-1/claim:token-1"]);
    expect(result).toMatchObject({ outcome: "started", action: { id: "action-1", attemptCount: 2 } });
  });

  it("resolves a unique-key race through the winning action", async () => {
    const createError = { status: 400, response: { data: { idempotency_key: { code: "validation_not_unique" } } } };
    const replayed = await reserve({ lookups: [null, record({ status: "applied" })], createError });
    expect(replayed.calls).toEqual(["lookup", "create:key-1:token-1", "lookup"]);
    expect(replayed.result).toEqual({ outcome: "replayed", action: expect.objectContaining({ status: "applied" }) });

    const claimed = await reserve({ lookups: [null, record({ status: "failed" })], createError });
    expect(claimed.calls).toEqual(["lookup", "create:key-1:token-1", "lookup", "send:/api/wts/admin-actions/action-1/claim:token-1"]);
    expect(claimed.result).toMatchObject({ outcome: "started" });
  });

  it("recognizes a uniqueness message and fails when the race winner is missing", async () => {
    const outcome = await reserve({
      lookups: [null, null],
      createError: { status: 400, message: "Failed to create record.", response: { message: "Value must be UNIQUE." } },
    });
    expect(outcome.error).toBe("Concurrent Admin Action reservation could not be resolved.");
    expect(outcome.calls).toEqual(["lookup", "create:key-1:token-1", "lookup"]);
  });

  it("rethrows create failures that are not reservation conflicts", async () => {
    const validation = await reserve({ lookups: [null], createError: new Error("other failure") });
    expect(validation.error).toBe("other failure");
    const server = await reserve({ lookups: [null], createError: Object.assign(new Error("unique index busy"), { status: 500 }) });
    expect(server.error).toBe("unique index busy");
    expect(server.calls).toEqual(["lookup", "create:key-1:token-1"]);
  });
});
