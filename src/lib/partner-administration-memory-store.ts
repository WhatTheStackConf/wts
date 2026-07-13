import type {
  AuditedPartnerAdministrationStore,
  PartnerStoredRecord,
  PartnerStoreCreateInput,
  PartnerStoreUpdateInput,
} from "~/lib/partner-administration";
import {
  completePartnerMutationAdminAction,
  PartnerStoreConflictError,
} from "~/lib/partner-administration";

export function createInMemoryPartnerAdministrationStore(): AuditedPartnerAdministrationStore {
  let sequence = 0;
  const records: PartnerStoredRecord[] = [];
  let mutationQueue = Promise.resolve();

  const mutate = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = mutationQueue;
    let release!: () => void;
    mutationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  return {
    async list(): Promise<PartnerStoredRecord[]> {
      await mutationQueue;
      return records.map((record) => ({ ...record }));
    },
    async get(id: string): Promise<PartnerStoredRecord | undefined> {
      await mutationQueue;
      const record = records.find((candidate) => candidate.id === id);
      return record ? { ...record } : undefined;
    },
    async create(input: PartnerStoreCreateInput, adminAction): Promise<PartnerStoredRecord> {
      return mutate(async () => {
        if (records.some((record) => record.normalizedName === input.normalizedName)) {
          throw new PartnerStoreConflictError("name");
        }
        if (
          input.canonicalUrl &&
          records.some((record) => record.canonicalUrl === input.canonicalUrl)
        ) {
          throw new PartnerStoreConflictError("url");
        }
        sequence += 1;
        const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, sequence)).toISOString();
        const record: PartnerStoredRecord = {
          id: `partner-${sequence}`,
          name: input.name,
          normalizedName: input.normalizedName,
          published: input.published,
          type: input.type,
          tier: input.tier,
          logo: input.logo?.name || "",
          logoUploadedByHuman: input.logoUploadedByHuman,
          url: input.url,
          canonicalUrl: input.canonicalUrl,
          notes: input.notes,
          noteAgentVisible: input.noteAgentVisible,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: timestamp,
        };
        records.push(record);
        try {
          await adminAction.complete(
            completePartnerMutationAdminAction(adminAction.completion, record),
          );
        } catch (error) {
          if (!(await adminAction.isApplied())) records.splice(records.indexOf(record), 1);
          throw error;
        }
        return { ...record };
      });
    },
    async update(id: string, expectedVersion: string, input: PartnerStoreUpdateInput, adminAction) {
      return mutate(async () => {
        const index = records.findIndex((record) => record.id === id);
        if (index < 0) throw new Error("Partner was not found.");
        if (records[index].version !== expectedVersion) {
          return { success: false as const, current: { ...records[index] } };
        }
        if (records.some((record) => record.id !== id && record.normalizedName === input.normalizedName)) {
          throw new PartnerStoreConflictError("name");
        }
        if (
          input.canonicalUrl &&
          records.some((record) => record.id !== id && record.canonicalUrl === input.canonicalUrl)
        ) {
          throw new PartnerStoreConflictError("url");
        }
        sequence += 1;
        const existing = records[index];
        const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, sequence)).toISOString();
        const updated: PartnerStoredRecord = {
          ...existing,
          name: input.name,
          normalizedName: input.normalizedName,
          published: input.published,
          type: input.type,
          tier: input.tier,
          logo:
            input.logo === undefined
              ? existing.logo
              : input.logo === null
                ? ""
                : input.logo.name,
          logoUploadedByHuman: input.logoUploadedByHuman,
          url: input.url,
          canonicalUrl: input.canonicalUrl,
          notes: input.notes,
          noteAgentVisible: input.noteAgentVisible,
          updatedAt,
          version: updatedAt,
        };
        records[index] = updated;
        try {
          await adminAction.complete(
            completePartnerMutationAdminAction(adminAction.completion, updated),
          );
        } catch (error) {
          if (!(await adminAction.isApplied())) records[index] = existing;
          throw error;
        }
        return { success: true as const, record: { ...updated } };
      });
    },
    async delete(id: string, expectedVersion: string, adminAction) {
      return mutate(async () => {
        const index = records.findIndex((record) => record.id === id);
        if (index < 0) throw new Error("Partner was not found.");
        if (records[index].version !== expectedVersion) {
          return { success: false as const, current: { ...records[index] } };
        }
        const [deleted] = records.splice(index, 1);
        try {
          await adminAction.complete(adminAction.completion);
        } catch (error) {
          if (!(await adminAction.isApplied())) records.splice(index, 0, deleted);
          throw error;
        }
        return { success: true as const };
      });
    },
  };
}
