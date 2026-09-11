import type PocketBase from "pocketbase";
import type { LifecycleApprovalCommand, LifecycleCloseCommand, LifecycleService, LifecycleStatus } from "./checkin-lifecycle-contract";
import { CheckinError } from "./checkin-service";
export class CheckinLifecycleService implements LifecycleService {
  constructor(private readonly pb: PocketBase, private readonly actor: { userId: string; role: string }) {}
  private async request(operation: string, command?: LifecycleCloseCommand | LifecycleApprovalCommand): Promise<LifecycleStatus> {
    if (!this.actor.userId || this.actor.role !== "admin") throw new CheckinError("forbidden", 403);
    try { return await this.pb.send<LifecycleStatus>("/api/wts/checkin-lifecycle", { method: "POST", body: { operation, actorUserId: this.actor.userId, ...(command ? { command } : {}) }, requestKey: null }); }
    catch (error) {
      const status = (error as { status?: number }).status;
      throw new CheckinError(status === 403 || status === 401 ? "forbidden" : status === 400 ? "conflict" : "unavailable", status === 400 ? 409 : status === 401 || status === 403 ? 403 : 503);
    }
  }
  status() { return this.request("status"); }
  close(command: LifecycleCloseCommand) { return this.request("close", command); }
  approveRestore(command: LifecycleApprovalCommand) { return this.request("approve_restore", command); }
}
