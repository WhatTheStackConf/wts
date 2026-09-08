import type {
  CheckinAdminCommand, CheckinAdminDTO, CheckinAdminResult, CheckinConfirmation,
  CheckinPreviewDTO, CheckinStatusDTO,
} from "~/lib/checkin-contract";

async function command<T>(body: object): Promise<T> {
  const response = await fetch("/api/checkin", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    referrerPolicy: "no-referrer",
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
export const previewCheckinStation = (code: string) => command<CheckinPreviewDTO>({ operation: "preview", code });
export const bindCheckinStation = (code: string, confirmation: CheckinConfirmation) => command<CheckinStatusDTO>({ operation: "bind", code, confirmation });
export const checkinAdminList = (bindingPage = 1, auditPage = 1) => command<CheckinAdminDTO>({ operation: "admin_list", bindingPage, auditPage });
export const checkinAdminControl = (input: CheckinAdminCommand) => command<IssuedCheckinQR>({ operation: "admin_control", command: input });
