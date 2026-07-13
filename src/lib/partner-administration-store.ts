import { randomUUID } from "node:crypto";
import type PocketBase from "pocketbase";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import type { PartnerRecord } from "~/lib/pocketbase-types";
import {
  PartnerStoreConflictError,
  type PartnerAdministrationStore,
  type PartnerLogoPayload,
  type PartnerStoredRecord,
  type PartnerStoreCreateInput,
  type PartnerStoreUpdateInput,
} from "~/lib/partner-administration";

const PARTNERS_COLLECTION = "partners";
const PARTNER_MUTATION_ROUTE = "/api/wts/partners";

type PocketBasePartnerRecord = Pick<
  PartnerRecord,
  | "id"
  | "name"
  | "normalized_name"
  | "published"
  | "type"
  | "tier"
  | "logo"
  | "logo_uploaded_by_human"
  | "url"
  | "canonical_url"
  | "mutation_token"
  | "notes"
  | "note_agent_visible"
  | "created"
  | "updated"
>;

function partnerRecord(record: PocketBasePartnerRecord): PartnerStoredRecord {
  return {
    id: record.id,
    name: record.name,
    normalizedName: record.normalized_name,
    published: Boolean(record.published),
    type: record.type,
    tier: record.tier || undefined,
    logo: record.logo || "",
    logoUploadedByHuman: Boolean(record.logo_uploaded_by_human),
    url: record.url || undefined,
    canonicalUrl: record.canonical_url || "",
    notes: record.notes || undefined,
    noteAgentVisible: Boolean(record.note_agent_visible),
    createdAt: record.created,
    updatedAt: record.updated,
    version: `${record.updated}|${record.mutation_token}`,
  };
}

function appendLogo(
  fields: Record<string, unknown>,
  logo: PartnerLogoPayload,
): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, String(value));
  }
  body.append(
    "logo",
    new Blob([new Uint8Array(logo.data)], { type: logo.type }),
    logo.name,
  );
  return body;
}

function createBody(input: PartnerStoreCreateInput): Record<string, unknown> | FormData {
  const fields: Record<string, unknown> = {
    name: input.name,
    normalized_name: input.normalizedName,
    published: false,
    type: input.type,
    tier: input.tier || "",
    logo_uploaded_by_human: input.logoUploadedByHuman,
    url: input.url || "",
    canonical_url: input.canonicalUrl,
    mutation_token: randomUUID(),
    notes: input.notes || "",
    note_agent_visible: false,
  };
  return input.logo ? appendLogo(fields, input.logo) : fields;
}

function updateBody(input: PartnerStoreUpdateInput): Record<string, unknown> | FormData {
  const fields: Record<string, unknown> = {
    name: input.name,
    normalized_name: input.normalizedName,
    published: input.published,
    type: input.type,
    tier: input.tier || "",
    logo_uploaded_by_human: input.logoUploadedByHuman,
    url: input.url || "",
    canonical_url: input.canonicalUrl,
    notes: input.notes || "",
    note_agent_visible: input.noteAgentVisible,
  };
  if (input.logo === null) fields.logo = "";
  return input.logo ? appendLogo(fields, input.logo) : fields;
}

function throwIdentityConflict(error: unknown): never {
  const response = (error as {
    response?: { data?: Record<string, unknown>; message?: string };
    message?: string;
  })?.response;
  const detail = `${response?.message || ""} ${(error as { message?: string })?.message || ""}`;
  if (response?.data?.normalized_name || detail.includes("normalized_name")) {
    throw new PartnerStoreConflictError("name");
  }
  if (response?.data?.canonical_url || detail.includes("canonical_url")) {
    throw new PartnerStoreConflictError("url");
  }
  throw error;
}

function isNotFound(error: unknown): boolean {
  return (error as { status?: number })?.status === 404;
}

/** Production Partner store; all lifecycle rules remain in PartnerAdministration. */
export function createPocketBasePartnerAdministrationStore(
  client?: PocketBase,
): PartnerAdministrationStore {
  const pocketBase = async () => client || getAdminPB().getInstance();

  return {
    async list(): Promise<PartnerStoredRecord[]> {
      const pb = await pocketBase();
      const records = await pb.collection(PARTNERS_COLLECTION).getFullList<PocketBasePartnerRecord>({
        sort: "name,id",
      });
      return records.map(partnerRecord);
    },
    async get(id: string): Promise<PartnerStoredRecord | undefined> {
      const pb = await pocketBase();
      try {
        const record = await pb.collection(PARTNERS_COLLECTION).getOne<PocketBasePartnerRecord>(id);
        return partnerRecord(record);
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async create(input: PartnerStoreCreateInput): Promise<PartnerStoredRecord> {
      const pb = await pocketBase();
      try {
        const record = await pb.collection(PARTNERS_COLLECTION)
          .create<PocketBasePartnerRecord>(createBody(input));
        return partnerRecord(record);
      } catch (error) {
        return throwIdentityConflict(error);
      }
    },
    async update(id: string, expectedVersion: string, input: PartnerStoreUpdateInput) {
      const pb = await pocketBase();
      try {
        const body = updateBody(input);
        if (body instanceof FormData) body.append("expected_version", expectedVersion);
        else body.expected_version = expectedVersion;
        const result = await pb.send<
          | { success: true; record: PocketBasePartnerRecord }
          | { success: false; current: PocketBasePartnerRecord }
        >(`${PARTNER_MUTATION_ROUTE}/${encodeURIComponent(id)}`, { method: "PATCH", body });
        return result.success
          ? { success: true as const, record: partnerRecord(result.record) }
          : { success: false as const, current: partnerRecord(result.current) };
      } catch (error) {
        return throwIdentityConflict(error);
      }
    },
    async delete(id: string, expectedVersion: string) {
      const pb = await pocketBase();
      const result = await pb.send<
        | { success: true }
        | { success: false; current: PocketBasePartnerRecord }
      >(`${PARTNER_MUTATION_ROUTE}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: { expected_version: expectedVersion },
      });
      return result.success
        ? { success: true as const }
        : { success: false as const, current: partnerRecord(result.current) };
    },
  };
}
