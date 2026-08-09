import type { AppearanceEventRecord } from "~/lib/pocketbase-types";

export interface AppearanceEventAdminService {
  fetchAllRecords(collectionName: string, options?: unknown): Promise<unknown[]>;
  createRecord(collectionName: string, data: unknown): Promise<unknown>;
  updateRecord(collectionName: string, id: string, data: unknown): Promise<unknown>;
  deleteRecord(collectionName: string, id: string): Promise<unknown>;
}

export interface AppearanceEventInput {
  name: string;
  compactLabel?: string;
  published: boolean;
  displayOrder: number;
  destinationUrl?: string;
}

function normalizeDestinationUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Destination URL must be a valid HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Destination URL must be a valid HTTP or HTTPS URL.");
  }
  return value;
}

function normalizeAppearanceEventInput(input: AppearanceEventInput) {
  const name = input.name?.trim() || "";
  if (!name) throw new Error("Public name is required.");
  if (name.length > 160) throw new Error("Public name must be 160 characters or fewer.");

  const compactLabel = input.compactLabel?.trim() || "";
  if (compactLabel.length > 60) {
    throw new Error("Compact ribbon label must be 60 characters or fewer.");
  }

  const displayOrder = Number(input.displayOrder);
  if (!Number.isInteger(displayOrder) || displayOrder < 0) {
    throw new Error("Display order must be a non-negative whole number.");
  }

  return {
    name,
    compact_label: compactLabel,
    published: Boolean(input.published),
    display_order: displayOrder,
    destination_url: normalizeDestinationUrl(input.destinationUrl || ""),
  };
}

function quotePbString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function createAppearanceEvent(
  service: AppearanceEventAdminService,
  input: AppearanceEventInput,
): Promise<AppearanceEventRecord> {
  return (await service.createRecord(
    "appearance_events",
    normalizeAppearanceEventInput(input),
  )) as AppearanceEventRecord;
}

export async function updateAppearanceEvent(
  service: AppearanceEventAdminService,
  id: string,
  input: AppearanceEventInput,
): Promise<AppearanceEventRecord> {
  return (await service.updateRecord(
    "appearance_events",
    id,
    normalizeAppearanceEventInput(input),
  )) as AppearanceEventRecord;
}

export async function deleteAppearanceEvent(
  service: AppearanceEventAdminService,
  id: string,
): Promise<void> {
  const assignments = await service.fetchAllRecords("speakers", {
    filter: `appearance_events.id ?= "${quotePbString(id)}"`,
    fields: "id",
  });
  if (assignments.length > 0) {
    throw new Error(
      "This Appearance Event is assigned to a Speaker. Remove its Speaker assignments or unpublish it instead.",
    );
  }
  const programmes = await service.fetchAllRecords("event_programmes", {
    filter: `appearance_event = "${quotePbString(id)}"`,
    fields: "id",
  });
  if (programmes.length > 0) {
    throw new Error(
      "This Appearance Event has an Event Programme. Remove its Event Programmes or unpublish it instead.",
    );
  }
  await service.deleteRecord("appearance_events", id);
}
