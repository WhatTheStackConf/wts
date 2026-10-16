import type {
  CheckinAdminCommand, CheckinAdminDTO, CheckinAdminResult, CheckinConfirmation,
  CheckinStatusDTO, CheckinPrinterCatalogueDTO,
} from "~/lib/checkin-contract";

async function command<T>(body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/checkin", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(failure?.error || "Check-in unavailable. Refresh before retrying.");
  }
  return response.json() as Promise<T>;
}

export const checkinStatus = () => command<CheckinStatusDTO>({ operation: "status" });
/** Serialize first catalogue requests across tabs so they establish one HttpOnly identity.
 * The lock keeps its legacy name so tabs still open from an older release share it. */
async function withPrinterIdentity<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (typeof window === "undefined" || !navigator.locks) {
    throw new Error("Printer selection requires a current browser over HTTPS.");
  }
  return navigator.locks.request("wts-checkin-client-preview", { mode: "exclusive", ...(signal ? { signal } : {}) }, () => {
    signal?.throwIfAborted();
    return run();
  });
}
export const checkinPrinters = () => withPrinterIdentity(() => command<CheckinPrinterCatalogueDTO>({ operation: "printers" }));
export const selectCheckinPrinter = (confirmation: CheckinConfirmation, authority?: { expectedActorId: string; signal: AbortSignal }) =>
  withPrinterIdentity(() => command<CheckinStatusDTO>({ operation: "select_printer", confirmation, ...(authority ? { expectedActorId: authority.expectedActorId } : {}) }, authority?.signal), authority?.signal);
export const checkinAdminList = (bindingPage = 1, auditPage = 1) => command<CheckinAdminDTO>({ operation: "admin_list", bindingPage, auditPage });
export const checkinAdminControl = (input: CheckinAdminCommand) => command<CheckinAdminResult>({ operation: "admin_control", command: input });
