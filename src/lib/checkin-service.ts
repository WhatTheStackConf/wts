import { createHash, randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import type {
  CheckinActor, CheckinAdminCommand, CheckinAdminDTO, CheckinAdminResult,
  CheckinBindResult, CheckinConfirmation, CheckinErrorCode, CheckinPreviewDTO,
  CheckinServiceContract, CheckinStatusDTO, CheckinPrinterCatalogueDTO,
} from "~/lib/checkin-contract";

const messages: Record<CheckinErrorCode, string> = {
  forbidden: "Check-in authorization required.", invalid_input: "Check the supplied values.",
  invalid_code: "This provisioning code is invalid or has been replaced.",
  invalid_binding: "This browser has no valid station binding.",
  revoked_binding: "This browser binding has been revoked. Ask an admin for help.",
  disabled: "The system or station is disabled.", conflict: "State changed. Review the current state and confirm again.",
  unavailable: "Check-in storage is unavailable. No admission or printing was attempted.",
};
export class CheckinError extends Error {
  constructor(public readonly code: CheckinErrorCode, public readonly status: number) {
    super(messages[code]); this.name = "CheckinError";
  }
}
/** Admin or check-in operator with a resolved user ID. */
export function isCheckinStaff(actor: CheckinActor | null | undefined): actor is CheckinActor {
  return !!actor?.userId && ["admin", "checkin_operator"].includes(actor.role);
}
interface PocketBaseFailure { status?: number; response?: { data?: { code?: string | { code?: string } } } }
/** The HTTP status and hook error code of a PocketBase rejection. */
export function pocketBaseFailure(error: unknown): { code: string | undefined; status: number | undefined } {
  const value = error as PocketBaseFailure;
  const field = value.response?.data?.code;
  return { code: typeof field === "string" ? field : field?.code, status: value.status };
}
function checkinFailure(error: unknown): CheckinError {
  const { code, status } = pocketBaseFailure(error);
  // Never forward PB errors, request bodies, hashes or diagnostics to clients/logs.
  if (code && Object.hasOwn(messages, code)) return new CheckinError(code as CheckinErrorCode, status || 400);
  const denied = status === 403 || status === 401;
  return new CheckinError(denied ? "forbidden" : "unavailable", denied ? 403 : 503);
}
function digest(value: string, kind: "binding" | "provision"): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new CheckinError(kind === "binding" ? "invalid_binding" : "invalid_code", 400);
  return createHash("sha256").update(`wts2026:${kind}:${value}`).digest("hex");
}
/** Server-only domain service. The caller must first resolve the canonical live
 * human session; the privileged PB hook independently rereads that User inside
 * every query/mutation transaction. Binding possession never supplies a role.
 * Admin Actions and the feature audit are committed with each privileged write. */
export class CheckinService implements CheckinServiceContract {
  constructor(private readonly pb: PocketBase, private readonly actor: CheckinActor) {}
  private async request<T>(operation: string, data: object = {}): Promise<T> {
    if (!isCheckinStaff(this.actor) || (operation.startsWith("admin_") && this.actor.role !== "admin")) throw new CheckinError("forbidden", 403);
    try {
      return await this.pb.send<T>("/api/wts/checkin", {
        method: "POST", body: { ...data, operation, actorUserId: this.actor.userId }, requestKey: null,
      });
    } catch (error) { throw checkinFailure(error); }
  }
  status(bindingToken?: string | null): Promise<CheckinStatusDTO> {
    return this.request("status", { identityHash: bindingToken ? digest(bindingToken, "binding") : "" });
  }
  printers(bindingToken?: string | null): Promise<CheckinPrinterCatalogueDTO> {
    return this.request("printers", { identityHash: bindingToken ? digest(bindingToken, "binding") : "" });
  }
  async selectPrinter(bindingToken: string | null | undefined, confirmation: CheckinConfirmation): Promise<CheckinBindResult> {
    if (!bindingToken) throw new CheckinError("invalid_binding", 400);
    const status = await this.request<CheckinStatusDTO>("select_printer", { identityHash: digest(bindingToken, "binding"), confirmation });
    return { status, bindingToken };
  }
  preview(code: string, bindingToken?: string): Promise<CheckinPreviewDTO> {
    return this.request("preview", { codeHash: digest(code, "provision"), identityHash: bindingToken ? digest(bindingToken, "binding") : "" });
  }
  async bind(code: string, bindingToken: string | null | undefined, confirmation: CheckinConfirmation): Promise<CheckinBindResult> {
    // HTTP issues the persistent identity on preview, before any confirmation.
    if (!bindingToken) throw new CheckinError("invalid_binding", 400);
    const status = await this.request<CheckinStatusDTO>("bind", { codeHash: digest(code, "provision"), identityHash: digest(bindingToken, "binding"), confirmation });
    return { status, bindingToken };
  }
  adminList(query: { bindingPage?: number; auditPage?: number } = {}): Promise<CheckinAdminDTO> {
    return this.request("admin_list", query);
  }
  async adminControl(command: CheckinAdminCommand): Promise<CheckinAdminResult> {
    const code = command.operation === "rotate_provision_code" ? randomBytes(32).toString("hex") : undefined;
    const result = await this.request<CheckinAdminResult>("admin_control", {
      command, ...(code ? { provisionCodeHash: digest(code, "provision") } : {}),
    });
    return code && !result.replayed ? { ...result, provisionCode: code } : result;
  }
}
