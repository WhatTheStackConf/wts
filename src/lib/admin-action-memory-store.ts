import type {
  AdminActionCompletion,
  AdminActionFailure,
  AdminActionRecord,
  AdminActionStore,
  AdminActionStoreStartResult,
} from "~/lib/admin-action-ledger";

export function createInMemoryAdminActionStore(): AdminActionStore {
  const records: Array<AdminActionRecord & { idempotencyKey: string; attemptToken: string }> = [];
  const cloneValue = <T>(value: T): T => structuredClone(value);

  const publicRecord = (
    record: AdminActionRecord & { idempotencyKey: string; attemptToken: string },
  ): AdminActionRecord => {
    const { idempotencyKey: _idempotencyKey, attemptToken: _attemptToken, ...value } = record;
    return {
      ...value,
      beforeSummary: cloneValue(value.beforeSummary),
      afterSummary: cloneValue(value.afterSummary),
      replayResult: cloneValue(value.replayResult),
      failure: value.failure ? cloneValue(value.failure) : undefined,
    };
  };

  return {
    async inspect(input) {
      const existing = records.find((record) => record.idempotencyKey === input.idempotencyKey);
      if (!existing) return { outcome: "new" as const };
      if (existing.inputFingerprint !== input.inputFingerprint) {
        return { outcome: "mismatch" as const, action: publicRecord(existing) };
      }
      if (existing.status === "applied") {
        return {
          outcome: "replayed" as const,
          action: publicRecord(existing),
          result: cloneValue(existing.replayResult),
        };
      }
      if (
        existing.status === "pending" &&
        existing.leaseExpiresAt &&
        Date.parse(existing.leaseExpiresAt) > Date.parse(input.now)
      ) {
        return { outcome: "pending" as const, action: publicRecord(existing) };
      }
      return { outcome: "retryable" as const, action: publicRecord(existing) };
    },
    async reserve(input): Promise<AdminActionStoreStartResult> {
      const existing = records.find((record) => record.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (existing.inputFingerprint !== input.inputFingerprint) {
          return { outcome: "mismatch", action: publicRecord(existing) };
        }
        if (existing.status === "applied") {
          return { outcome: "replayed", action: publicRecord(existing) };
        }
        if (
          existing.status === "pending" &&
          existing.leaseExpiresAt &&
          Date.parse(existing.leaseExpiresAt) > Date.parse(input.now)
        ) {
          return { outcome: "pending", action: publicRecord(existing) };
        }
        existing.status = "pending";
        existing.failure = undefined;
        existing.attemptCount += 1;
        existing.attemptToken = input.attemptToken;
        existing.leaseExpiresAt = input.leaseExpiresAt;
        existing.updatedAt = input.now;
        return {
          outcome: "started",
          action: publicRecord(existing),
          handle: { actionId: existing.id, attemptToken: input.attemptToken },
        };
      }

      const action: AdminActionRecord & { idempotencyKey: string; attemptToken: string } = {
        id: `admin-action-${records.length + 1}`,
        ...input.request,
        inputFingerprint: input.inputFingerprint,
        idempotencyKey: input.idempotencyKey,
        status: "pending",
        beforeSummary: cloneValue(input.beforeSummary),
        afterSummary: cloneValue(input.afterSummary),
        replayResult: null,
        attemptCount: 1,
        attemptToken: input.attemptToken,
        leaseExpiresAt: input.leaseExpiresAt,
        createdAt: input.now,
        updatedAt: input.now,
      };
      records.push(action);
      return {
        outcome: "started",
        action: publicRecord(action),
        handle: { actionId: action.id, attemptToken: input.attemptToken },
      };
    },
    async complete(handle, completion: AdminActionCompletion, now): Promise<AdminActionRecord> {
      const record = records.find((candidate) => candidate.id === handle.actionId);
      if (!record || record.status !== "pending" || record.attemptToken !== handle.attemptToken) {
        throw new Error("Admin Action attempt is no longer active.");
      }
      if (record.targetId && completion.targetId && record.targetId !== completion.targetId) {
        throw new Error("Admin Action completion cannot change its reserved target.");
      }
      record.status = "applied";
      record.targetId = completion.targetId || record.targetId;
      record.beforeSummary = cloneValue(completion.beforeSummary);
      record.afterSummary = cloneValue(completion.afterSummary);
      record.replayResult = cloneValue(completion.replayResult);
      record.leaseExpiresAt = undefined;
      record.updatedAt = now;
      return publicRecord(record);
    },
    async fail(handle, failure: AdminActionFailure, now): Promise<AdminActionRecord> {
      const record = records.find((candidate) => candidate.id === handle.actionId);
      if (!record || record.status !== "pending" || record.attemptToken !== handle.attemptToken) {
        throw new Error("Admin Action attempt is no longer active.");
      }
      record.status = "failed";
      record.failure = cloneValue(failure);
      record.leaseExpiresAt = undefined;
      record.updatedAt = now;
      return publicRecord(record);
    },
    async list(query): Promise<AdminActionRecord[]> {
      return records
        .filter(
          (record) =>
            (query.targetCollection === undefined || record.targetCollection === query.targetCollection) &&
            (query.targetId === undefined || record.targetId === query.targetId) &&
            (!query.sources?.length || query.sources.includes(record.source)) &&
            (!query.statuses?.length || query.statuses.includes(record.status)),
        )
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
        )
        .slice(0, query.limit)
        .map(publicRecord);
    },
  };
}
