import type { LifecycleApprovalCommand, LifecycleCloseCommand, LifecycleStatus } from "./checkin-lifecycle-contract";
import { lifecycleRequestSchema, validateLifecycleResponse, type LifecycleRequest } from "./checkin-lifecycle-validation";

export class CheckinLifecycleRequestError extends Error {
  constructor(message: string, readonly ambiguous: boolean) { super(message); this.name = "CheckinLifecycleRequestError"; }
}
export function createCheckinLifecycleClient(fetcher: typeof fetch = (...args) => fetch(...args)) {
  let frozenClose: LifecycleCloseCommand | undefined;
  let closeFlight: Promise<LifecycleStatus> | undefined;
  async function request(body: LifecycleRequest): Promise<LifecycleStatus> {
    const submitted = lifecycleRequestSchema.parse(structuredClone(body));
    let response: Response;
    try {
      response = await fetcher("/api/checkin-lifecycle", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, cache: "no-store", referrerPolicy: "no-referrer", body: JSON.stringify(submitted) });
    } catch { throw new CheckinLifecycleRequestError("Lifecycle service could not be reached. A mutation may have been saved; retry the same command.", true); }
    if (!response.ok) throw new CheckinLifecycleRequestError(response.status === 403 ? "Lifecycle access requires a current admin session." : "Lifecycle request failed. Refresh state or retry the same pending command.", response.status >= 500 || response.status === 408);
    try {
      if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new Error("Not JSON");
      return validateLifecycleResponse(await response.json(), submitted);
    } catch { throw new CheckinLifecycleRequestError("Lifecycle success response was malformed or did not match the command. Outcome unknown; retry the same command.", true); }
  }
  return {
    status: () => request({ operation: "status" }),
    pendingClose: () => frozenClose ? { ...frozenClose } : undefined,
    async close(confirmEdition: string): Promise<LifecycleStatus> {
      if (confirmEdition !== "WTS2026") throw new CheckinLifecycleRequestError("Type WTS2026 exactly to confirm closure.", false);
      if (closeFlight) return closeFlight;
      frozenClose ??= { operationId: crypto.randomUUID(), confirmEdition: "WTS2026" };
      // Keep the same command on every failure, including later failed reads and
      // session expiry. Only a validated closure response resolves this intent.
      closeFlight = request({ operation: "close", command: { ...frozenClose } }).then((status) => { frozenClose = undefined; return status; }).finally(() => { closeFlight = undefined; });
      return closeFlight;
    },
    approveRestore: (command: LifecycleApprovalCommand) => request({ operation: "approve_restore", command }),
  };
}
export type CheckinLifecycleClient = ReturnType<typeof createCheckinLifecycleClient>;
