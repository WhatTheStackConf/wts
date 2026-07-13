import type {
  PartnerAdministrationStore,
  PartnerStoredRecord,
  PartnerStoreCreateInput,
  PartnerStoreUpdateInput,
} from "~/lib/partner-administration";
import { PartnerStoreConflictError } from "~/lib/partner-administration";

export function createInMemoryPartnerAdministrationStore(): PartnerAdministrationStore {
  let sequence = 0;
  const records: PartnerStoredRecord[] = [];

  return {
    async list(): Promise<PartnerStoredRecord[]> {
      return records.map((record) => ({ ...record }));
    },
    async get(id: string): Promise<PartnerStoredRecord | undefined> {
      const record = records.find((candidate) => candidate.id === id);
      return record ? { ...record } : undefined;
    },
    async create(input: PartnerStoreCreateInput): Promise<PartnerStoredRecord> {
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
      return { ...record };
    },
    async update(id: string, expectedVersion: string, input: PartnerStoreUpdateInput) {
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
      return { success: true as const, record: { ...updated } };
    },
    async delete(id: string, expectedVersion: string) {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) throw new Error("Partner was not found.");
      if (records[index].version !== expectedVersion) {
        return { success: false as const, current: { ...records[index] } };
      }
      records.splice(index, 1);
      return { success: true as const };
    },
  };
}
