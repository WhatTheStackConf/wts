import type {
  CheckinAdminEventCatalogue, CheckinConfigureEvent, CheckinConfigureEventResult,
  CheckinEventCatalogue, CheckinEventOptions, CheckinEventSelection,
} from "~/lib/checkin-event-contract";

/** A transport/5xx failure may have happened after a command was committed. */
export class CheckinEventRequestError extends Error {
  constructor(message: string, readonly ambiguous: boolean, readonly code?: string) {
    super(message);
    this.name = "CheckinEventRequestError";
  }
}

async function request<T>(body: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/checkin-events", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new CheckinEventRequestError("Event service could not be reached. The outcome of a submitted change is unknown.", true);
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
    throw new CheckinEventRequestError(
      typeof failure?.error === "string" ? failure.error : "Event service is unavailable. Retry explicitly.",
      response.status >= 500 || response.status === 408,
      typeof failure?.code === "string" ? failure.code : undefined,
    );
  }
  try { return await response.json() as T; }
  catch { throw new CheckinEventRequestError("Event service returned an unreadable response. A submitted change may have been saved.", true); }
}

export const checkinAdminEventCatalogue = () => request<CheckinAdminEventCatalogue>({ operation: "admin_catalogue" });
export const checkinAdminEventOptions = (upstreamEventId: string) => request<CheckinEventOptions>({ operation: "admin_options", upstreamEventId });
export const configureCheckinEvent = (command: CheckinConfigureEvent) => request<CheckinConfigureEventResult>({ operation: "configure", command });
export const checkinEventCatalogue = () => request<CheckinEventCatalogue>({ operation: "catalogue" });
export const selectCheckinEvent = (selection: CheckinEventSelection) => request<CheckinEventCatalogue>({ operation: "select", selection });
