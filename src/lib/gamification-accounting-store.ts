import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import type { GamificationAccountingStore } from "~/lib/gamification-accounting";

const LOCK_COLLECTION = "gamification_operation_locks";
const LOCK_LEASE_MS = 120_000;
const LOCK_WAIT_MS = 15_000;
const heldLocks = new AsyncLocalStorage<Set<string>>();

function isNotFound(error: unknown): boolean {
  return (error as { status?: number })?.status === 404;
}

function matchingFilter(match: Record<string, unknown>): { expression: string; parameters: Record<string, unknown> } {
  const entries = Object.entries(match);
  const parameters: Record<string, unknown> = {};
  const parts = entries.map(([field, value]) => {
    if (Array.isArray(value)) {
      if (value.length === 0) return "id = ''";
      return `(${value.map((item, index) => {
        const key = `${field}_${index}`;
        parameters[key] = item;
        return `${field} = {:${key}}`;
      }).join(" || ")})`;
    }
    parameters[field] = value;
    return `${field} = {:${field}}`;
  });
  return {
    expression: parts.join(" && "),
    parameters,
  };
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** PocketBase adapter kept separate so accounting contracts cannot use a browser client. */
export function createGamificationAccountingStore(): GamificationAccountingStore {
  const admin = getAdminPB();
  const store: GamificationAccountingStore = {
    async findOne<T>(collection: string, match: Record<string, unknown>): Promise<T | undefined> {
      const { expression, parameters } = matchingFilter(match);
      const pb = await admin.getInstance();
      try {
        return await pb.collection(collection).getFirstListItem<T>(pb.filter(expression, parameters));
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async list<T>(
      collection: string,
      match?: Record<string, unknown>,
      options: { sort?: string; limit?: number; offset?: number; fields?: string } = {},
    ): Promise<T[]> {
      const pb = await admin.getInstance();
      const query: Record<string, unknown> = {
        sort: options.sort,
        fields: options.fields,
      };
      if (match && Object.keys(match).length > 0) {
        const { expression, parameters } = matchingFilter(match);
        query.filter = pb.filter(expression, parameters);
      }
      if (options.limit !== undefined) {
        const offset = Math.max(0, options.offset || 0);
        const required = offset + options.limit;
        const batchSize = Math.min(500, Math.max(1, required));
        const rows: T[] = [];
        for (let page = 1; rows.length < required; page += 1) {
          const result = await pb.collection(collection).getList<T>(page, batchSize, query);
          rows.push(...result.items);
          if (page >= result.totalPages) break;
        }
        return rows.slice(offset, required);
      }
      return pb.collection(collection).getFullList<T>(query);
    },
    async getById<T>(collection: string, id: string): Promise<T> {
      return admin.fetchRecordById(collection, id) as Promise<T>;
    },
    async create<T>(collection: string, data: Record<string, unknown>): Promise<T> {
      return admin.createRecord(collection, data) as Promise<T>;
    },
    async createManyAtomic<T>(collection: string, rows: Record<string, unknown>[]): Promise<T[]> {
      if (rows.length === 0) return [];
      const pb = await admin.getInstance();
      const batch = pb.createBatch();
      for (const row of rows) batch.collection(collection).create(row);
      const results = await batch.send();
      return results.map((result) => result.body as T);
    },
    async update<T>(collection: string, id: string, data: Record<string, unknown>): Promise<T> {
      return admin.updateRecord(collection, id, data) as Promise<T>;
    },
    async delete(collection: string, id: string): Promise<void> {
      const pb = await admin.getInstance();
      await pb.collection(collection).delete(id);
    },
    async withLocks<T>(keys: string[], operation: () => Promise<T>): Promise<T> {
      const inherited = heldLocks.getStore() || new Set<string>();
      const required = [...new Set(keys)].filter((key) => !inherited.has(key)).sort();
      if (required.length === 0) return operation();
      const owner = randomUUID();
      const acquired: Array<{ id: string; key: string }> = [];
      const deadline = Date.now() + LOCK_WAIT_MS;
      const pb = await admin.getInstance();
      try {
        for (const key of required) {
          while (Date.now() < deadline) {
            try {
              const lock = await pb.collection(LOCK_COLLECTION).create<{ id: string }>({
                key,
                owner,
                expires_at: new Date(Date.now() + LOCK_LEASE_MS).toISOString(),
              });
              acquired.push({ id: lock.id, key });
              break;
            } catch (error) {
              if ((error as { status?: number }).status !== 400) throw error;
              const { expression, parameters } = matchingFilter({ key });
              const existing = await pb.collection(LOCK_COLLECTION)
                .getFirstListItem<{ id: string; expires_at: string }>(pb.filter(expression, parameters))
                .catch(() => undefined);
              if (existing && Date.parse(existing.expires_at) <= Date.now()) {
                await pb.collection(LOCK_COLLECTION).delete(existing.id).catch(() => undefined);
              } else {
                await wait(25 + Math.floor(Math.random() * 25));
              }
            }
          }
          if (!acquired.some((lock) => lock.key === key)) {
            throw new Error("The gamification operation is busy. Retry using the same operation reference.");
          }
        }
        return await heldLocks.run(new Set([...inherited, ...required]), operation);
      } finally {
        await Promise.all(acquired.map((lock) => pb.collection(LOCK_COLLECTION).delete(lock.id).catch(() => undefined)));
      }
    },
  };
  return store;
}
