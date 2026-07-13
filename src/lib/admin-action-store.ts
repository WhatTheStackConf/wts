import type PocketBase from "pocketbase";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import type {
  AdminActionRecord,
  AdminActionStore,
  AdminActionStoreStartResult,
  AdminActionValue,
} from "~/lib/admin-action-ledger";
import type { AdminActionRecord as PocketBaseAdminActionRecord } from "~/lib/pocketbase-types";

const ADMIN_ACTIONS_COLLECTION = "admin_actions";
const ADMIN_ACTION_ROUTE = "/api/wts/admin-actions";

function adminActionRecord(record: PocketBaseAdminActionRecord): AdminActionRecord {
  return {
    id: record.id,
    actorUserId: record.actor_user,
    mcpTokenId: record.mcp_token || undefined,
    source: record.source,
    operationKind: record.operation_kind,
    targetCollection: record.target_collection,
    targetId: record.target_id || undefined,
    operationId: record.operation_id,
    inputFingerprint: record.input_fingerprint,
    status: record.status,
    beforeSummary: (record.before_summary as AdminActionValue | undefined) ?? null,
    afterSummary: (record.after_summary as AdminActionValue | undefined) ?? null,
    replayResult: (record.replay_result as AdminActionValue | undefined) ?? null,
    failure: record.failure_code
      ? {
          code: record.failure_code,
          message: record.failure_message || "Administrative operation failed.",
          metadata: record.failure_metadata as AdminActionValue | undefined,
        }
      : undefined,
    attemptCount: record.attempt_count,
    leaseExpiresAt: record.lease_expires_at || undefined,
    createdAt: record.created,
    updatedAt: record.updated,
  };
}

function isNotFound(error: unknown): boolean {
  return (error as { status?: number })?.status === 404;
}

function isConflict(error: unknown): boolean {
  const value = error as {
    status?: number;
    message?: string;
    response?: {
      message?: string;
      data?: Record<string, { code?: string; message?: string }>;
    };
  };
  const identityError = value.response?.data?.idempotency_key;
  return value.status === 400 && (
    identityError?.code === "validation_not_unique" ||
    `${identityError?.message || ""} ${value.message || ""} ${value.response?.message || ""}`
      .toLowerCase()
      .includes("unique")
  );
}

function timestamp(value: string): number {
  return Date.parse(value.replace(" ", "T"));
}

export function createPocketBaseAdminActionStore(client?: PocketBase): AdminActionStore {
  const pocketBase = async () => client || getAdminPB().getInstance();

  const inspect: AdminActionStore["inspect"] = async (input) => {
    const pb = await pocketBase();
    try {
      const record = await pb.collection(ADMIN_ACTIONS_COLLECTION).getFirstListItem<PocketBaseAdminActionRecord>(
        pb.filter("idempotency_key = {:key}", { key: input.idempotencyKey }),
      );
      const action = adminActionRecord(record);
      if (action.inputFingerprint !== input.inputFingerprint) return { outcome: "mismatch", action };
      if (action.status === "applied") return { outcome: "replayed", action, result: action.replayResult };
      if (
        action.status === "pending" &&
        action.leaseExpiresAt &&
        timestamp(action.leaseExpiresAt) > timestamp(input.now)
      ) {
        return { outcome: "pending", action };
      }
      return { outcome: "retryable", action };
    } catch (error) {
      if (isNotFound(error)) return { outcome: "new" };
      throw error;
    }
  };

  const claim = async (
    pb: PocketBase,
    actionId: string,
    input: Parameters<AdminActionStore["reserve"]>[0],
  ): Promise<AdminActionStoreStartResult> => {
    const claimed = await pb.send<
      | { outcome: "started"; action: PocketBaseAdminActionRecord; handle: { actionId: string; attemptToken: string } }
      | { outcome: "replayed" | "pending" | "mismatch"; action: PocketBaseAdminActionRecord }
    >(`${ADMIN_ACTION_ROUTE}/${encodeURIComponent(actionId)}/claim`, {
      method: "POST",
      body: {
        input_fingerprint: input.inputFingerprint,
        attempt_token: input.attemptToken,
        lease_expires_at: input.leaseExpiresAt,
        now: input.now,
      },
    });
    return { ...claimed, action: adminActionRecord(claimed.action) };
  };

  return {
    inspect,
    async reserve(input): Promise<AdminActionStoreStartResult> {
      const pb = await pocketBase();
      const current = await inspect(input);
      if (current.outcome === "mismatch" || current.outcome === "pending") return current;
      if (current.outcome === "replayed") {
        return { outcome: "replayed", action: current.action };
      }
      if (current.outcome === "retryable") {
        return claim(pb, current.action.id, input);
      }

      try {
        const record = await pb.collection(ADMIN_ACTIONS_COLLECTION).create<PocketBaseAdminActionRecord>({
          actor_user: input.request.actorUserId,
          mcp_token: input.request.mcpTokenId || "",
          source: input.request.source,
          operation_kind: input.request.operationKind,
          target_collection: input.request.targetCollection,
          target_id: input.request.targetId || "",
          operation_id: input.request.operationId,
          input_fingerprint: input.inputFingerprint,
          idempotency_key: input.idempotencyKey,
          status: "pending",
          before_summary: input.beforeSummary,
          after_summary: input.afterSummary,
          attempt_count: 1,
          attempt_token: input.attemptToken,
          lease_expires_at: input.leaseExpiresAt,
        });
        const action = adminActionRecord(record);
        return {
          outcome: "started",
          action,
          handle: { actionId: action.id, attemptToken: input.attemptToken },
        };
      } catch (error) {
        if (!isConflict(error)) throw error;
        const raced = await inspect(input);
        if (raced.outcome === "retryable") {
          return claim(pb, raced.action.id, input);
        }
        if (raced.outcome === "new") {
          throw new Error("Concurrent Admin Action reservation could not be resolved.");
        }
        return raced.outcome === "replayed"
          ? { outcome: "replayed", action: raced.action }
          : raced;
      }
    },
    async complete(handle, completion, now) {
      const pb = await pocketBase();
      const record = await pb.send<PocketBaseAdminActionRecord>(
        `${ADMIN_ACTION_ROUTE}/${encodeURIComponent(handle.actionId)}/complete`,
        {
          method: "POST",
          body: {
            attempt_token: handle.attemptToken,
            target_id: completion.targetId || "",
            before_summary: JSON.stringify(completion.beforeSummary),
            after_summary: JSON.stringify(completion.afterSummary),
            replay_result: JSON.stringify(completion.replayResult),
            now,
          },
        },
      );
      return adminActionRecord(record);
    },
    async fail(handle, failure, now) {
      const pb = await pocketBase();
      const record = await pb.send<PocketBaseAdminActionRecord>(
        `${ADMIN_ACTION_ROUTE}/${encodeURIComponent(handle.actionId)}/fail`,
        {
          method: "POST",
          body: {
            attempt_token: handle.attemptToken,
            failure_code: failure.code,
            failure_message: failure.message,
            failure_metadata: JSON.stringify(failure.metadata ?? null),
            now,
          },
        },
      );
      return adminActionRecord(record);
    },
    async list(query) {
      const pb = await pocketBase();
      const filters = [pb.filter("target_collection = {:collection}", { collection: query.targetCollection })];
      if (query.targetId !== undefined) {
        filters.push(pb.filter("target_id = {:targetId}", { targetId: query.targetId }));
      }
      if (query.statuses?.length) {
        filters.push(`(${query.statuses.map((status) => pb.filter("status = {:status}", { status })).join(" || ")})`);
      }
      const records = await pb.collection(ADMIN_ACTIONS_COLLECTION).getList<PocketBaseAdminActionRecord>(1, query.limit, {
        filter: filters.join(" && "),
        sort: "-created,-id",
      });
      return records.items.map(adminActionRecord);
    },
  };
}
