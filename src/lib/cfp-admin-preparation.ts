import { parseCapabilityAvailability } from "~/lib/conference-capability-policy";
import { parseClosedCfpConfig } from "~/lib/cfp-config-preparation";

export type CfpAdminConfigurationService = {
  fetchAllRecords(collection: string): Promise<unknown[]>;
  createRecord(collection: string, data: Record<string, unknown>): Promise<unknown>;
  updateRecord(collection: string, id: string, data: Record<string, unknown>): Promise<unknown>;
};

type ConferenceConfigRecord = {
  id: string;
  cfp_open?: unknown;
  cfp_deadline?: unknown;
  availability?: unknown;
};

function normalizeCfpDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Conference CFP configuration is incomplete.");
  const date = value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!date || !Number.isFinite(Date.parse(value)) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) ||
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
    throw new Error("Conference CFP configuration is incomplete.");
  }
  return date;
}

export async function fetchCfpAdminConfiguration(service: CfpAdminConfigurationService) {
  const records = await service.fetchAllRecords("conference_config") as ConferenceConfigRecord[];
  if (records.length !== 1) throw new Error("Conference configuration must contain exactly one record.");
  const record = records[0];
  if (typeof record.cfp_open !== "boolean") {
    throw new Error("Conference CFP configuration is incomplete.");
  }
  const availability = parseCapabilityAvailability(record.availability);
  if (!availability) {
    throw new Error("Capability availability configuration is incomplete.");
  }
  return {
    cfp_open: record.cfp_open,
    cfp_available: record.cfp_open && availability.cfp,
    cfp_deadline: normalizeCfpDate(record.cfp_deadline),
  };
}

export async function saveClosedCfpConfiguration(
  service: CfpAdminConfigurationService,
  input: unknown,
) {
  const closedConfig = parseClosedCfpConfig(input);
  const records = await service.fetchAllRecords("conference_config") as Array<{ id: string }>;
  if (records.length > 1) throw new Error("Conference configuration must contain exactly one record.");
  const data = { ...closedConfig, availability: { cfp: false, review: false } };
  if (records.length === 0) return service.createRecord("conference_config", data);
  return service.updateRecord("conference_config", records[0].id, data);
}
