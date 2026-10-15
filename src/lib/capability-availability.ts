import { getAdminPB } from "~/lib/pocketbase-admin-service";
import {
  isCapabilityAvailable,
  type AvailabilityRecord,
  type ConferenceCapability,
} from "~/lib/conference-capability-policy";

export type { ConferenceCapability } from "~/lib/conference-capability-policy";
export class CapabilityUnavailableError extends Error {
  readonly status = 404;
  readonly code = "capability_unavailable";

  constructor(capability: ConferenceCapability) {
    super(`${capability === "cfp" ? "CFP" : "Review"} is unavailable.`);
    this.name = "CapabilityUnavailableError";
    Object.defineProperty(this, Symbol.for("solid.SafeError"), { value: true });
  }
}

export { isCapabilityAvailable };

export async function capabilityAvailable(capability: ConferenceCapability): Promise<boolean> {
  try {
    const records = await getAdminPB().fetchAllRecords("conference_config", {
      fields: "availability,cfp_open",
    }) as AvailabilityRecord[];
    return isCapabilityAvailable(records, capability);
  } catch {
    return false;
  }
}

export async function capabilityAvailableForClient(capability: ConferenceCapability): Promise<boolean> {
  "use server";
  return capabilityAvailable(capability);
}


export async function requireCapability(capability: ConferenceCapability): Promise<void> {
  if (!await capabilityAvailable(capability)) throw new CapabilityUnavailableError(capability);
}

export function isCapabilityUnavailable(error: unknown): error is CapabilityUnavailableError {
  return error instanceof CapabilityUnavailableError;
}
export function capabilityUnavailableMetadata(
  error: unknown,
): { status?: number; code?: string } {
  return isCapabilityUnavailable(error)
    ? { status: error.status, code: error.code }
    : {};
}
