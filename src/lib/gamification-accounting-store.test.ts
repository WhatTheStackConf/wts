import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const create = vi.fn();
  const getFirstListItem = vi.fn();
  const remove = vi.fn();
  const pb = {
    filter: (expression: string, parameters: Record<string, unknown>) => `${expression}|${JSON.stringify(parameters)}`,
    collection: (name: string) => ({
      create: (data: Record<string, unknown>) => {
        calls.push(`create ${name} ${data.key}`);
        return create(data);
      },
      getFirstListItem: (filter: string) => {
        calls.push(`find ${name} ${filter}`);
        return getFirstListItem(filter);
      },
      delete: (id: string) => {
        calls.push(`delete ${name} ${id}`);
        return remove(id);
      },
    }),
  };
  return { calls, create, getFirstListItem, remove, adminService: { getInstance: async () => pb } };
});

vi.mock("~/lib/pocketbase-admin-service", () => ({ getAdminPB: () => mocks.adminService }));

import { withGamificationLocks } from "~/lib/gamification-accounting";
import { createGamificationAccountingStore } from "~/lib/gamification-accounting-store";

const conflict = Object.assign(new Error("conflict"), { status: 400 });

afterEach(() => {
  mocks.calls.length = 0;
  mocks.create.mockReset();
  mocks.getFirstListItem.mockReset();
  mocks.remove.mockReset();
  vi.restoreAllMocks();
});

describe("gamification accounting store locks", () => {
  it("acquires sorted unique keys, runs once, skips inherited keys, and releases every lock", async () => {
    let next = 0;
    mocks.create.mockImplementation(async () => ({ id: `lock-${++next}` }));
    mocks.remove.mockResolvedValue(undefined);
    const store = createGamificationAccountingStore();
    const result = await withGamificationLocks(store, ["b", "a", "b"], async () => {
      mocks.calls.push("outer");
      return withGamificationLocks(store, ["a", "c"], async () => {
        mocks.calls.push("inner");
        return "done";
      });
    });
    expect(result).toBe("done");
    expect(mocks.calls).toEqual([
      "create gamification_operation_locks a",
      "create gamification_operation_locks b",
      "outer",
      "create gamification_operation_locks c",
      "inner",
      "delete gamification_operation_locks lock-3",
      "delete gamification_operation_locks lock-1",
      "delete gamification_operation_locks lock-2",
    ]);
  });

  it("returns the operation directly when every key is already held", async () => {
    mocks.create.mockResolvedValue({ id: "lock-1" });
    mocks.remove.mockResolvedValue(undefined);
    const store = createGamificationAccountingStore();
    await withGamificationLocks(store, ["a"], () => withGamificationLocks(store, ["a"], async () => mocks.calls.push("inner")));
    expect(mocks.calls).toEqual([
      "create gamification_operation_locks a",
      "inner",
      "delete gamification_operation_locks lock-1",
    ]);
  });

  it("deletes an expired conflicting lock, waits behind a live one, then acquires", async () => {
    mocks.create
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ id: "lock-new" });
    mocks.getFirstListItem
      .mockResolvedValueOnce({ id: "stale", expires_at: new Date(Date.now() - 1_000).toISOString() })
      .mockResolvedValueOnce({ id: "live", expires_at: new Date(Date.now() + 60_000).toISOString() })
      .mockRejectedValueOnce(new Error("lookup failed"));
    mocks.remove.mockRejectedValueOnce(new Error("already gone")).mockResolvedValue(undefined);
    const store = createGamificationAccountingStore();
    await expect(withGamificationLocks(store, ["k"], async () => "ok")).resolves.toBe("ok");
    expect(mocks.calls).toEqual([
      "create gamification_operation_locks k",
      'find gamification_operation_locks key = {:key}|{"key":"k"}',
      "delete gamification_operation_locks stale",
      "create gamification_operation_locks k",
      'find gamification_operation_locks key = {:key}|{"key":"k"}',
      "create gamification_operation_locks k",
      'find gamification_operation_locks key = {:key}|{"key":"k"}',
      "create gamification_operation_locks k",
      "delete gamification_operation_locks lock-new",
    ]);
  });

  it("rethrows a non-conflict create failure after releasing locks already acquired", async () => {
    const failure = Object.assign(new Error("server down"), { status: 500 });
    mocks.create.mockResolvedValueOnce({ id: "lock-a" }).mockRejectedValueOnce(failure);
    mocks.remove.mockResolvedValue(undefined);
    const operation = vi.fn();
    const store = createGamificationAccountingStore();
    await expect(withGamificationLocks(store, ["a", "b"], operation)).rejects.toBe(failure);
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.calls).toEqual([
      "create gamification_operation_locks a",
      "create gamification_operation_locks b",
      "delete gamification_operation_locks lock-a",
    ]);
  });

  it("reports busy after the wait deadline and releases locks already acquired", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.create.mockResolvedValueOnce({ id: "lock-a" }).mockImplementation(async () => {
      now += 6_000;
      throw conflict;
    });
    mocks.getFirstListItem.mockResolvedValue({ id: "live", expires_at: new Date(now + 3_600_000).toISOString() });
    mocks.remove.mockResolvedValue(undefined);
    const operation = vi.fn();
    const store = createGamificationAccountingStore();
    await expect(withGamificationLocks(store, ["a", "b"], operation)).rejects.toThrow(
      "The gamification operation is busy. Retry using the same operation reference.",
    );
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.calls.filter((call) => call.startsWith("create"))).toEqual([
      "create gamification_operation_locks a",
      "create gamification_operation_locks b",
      "create gamification_operation_locks b",
      "create gamification_operation_locks b",
    ]);
    expect(mocks.calls.at(-1)).toBe("delete gamification_operation_locks lock-a");
  });
});
