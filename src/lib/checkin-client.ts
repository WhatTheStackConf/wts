import type {
  CheckinAdminCommand, CheckinAdminDTO, CheckinAdminResult, CheckinConfirmation,
  CheckinPreviewDTO, CheckinStatusDTO, CheckinPrinterCatalogueDTO,
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

export interface IssuedCheckinQR extends CheckinAdminResult {
  provisionUrl?: string;
  qrDataUrl?: string;
}
export const checkinStatus = () => command<CheckinStatusDTO>({ operation: "status" });
/** Share the legacy preview lock: first catalogue requests establish the same
 * HttpOnly identity, including when an older tab still uses QR provisioning. */
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
export async function previewCheckinStation(code: string): Promise<CheckinPreviewDTO> {
  if (typeof window === "undefined" || !navigator.locks) {
    throw new Error("Safe station provisioning requires a browser with Web Locks over HTTPS. Use a current browser to continue.");
  }
  // Serialize cookie establishment across same-origin tabs, through receipt of
  // the complete response. A delayed first preview must never overwrite an
  // identity another tab has already confirmed. No secret goes into the lock.
  return navigator.locks.request("wts-checkin-client-preview", { mode: "exclusive" }, () =>
    command<CheckinPreviewDTO>({ operation: "preview", code }),
  );
}
export const bindCheckinStation = (code: string, confirmation: CheckinConfirmation) => command<CheckinStatusDTO>({ operation: "bind", code, confirmation });
export const checkinAdminList = (bindingPage = 1, auditPage = 1) => command<CheckinAdminDTO>({ operation: "admin_list", bindingPage, auditPage });
export const checkinAdminControl = (input: CheckinAdminCommand) => command<IssuedCheckinQR>({ operation: "admin_control", command: input });
