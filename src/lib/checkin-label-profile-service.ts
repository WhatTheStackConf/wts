import type PocketBase from "pocketbase";
import type { CheckinActor, CheckinErrorCode } from "~/lib/checkin-contract";
import type { CheckinApproveLabelProfile, CheckinConfigureLabelProfile, CheckinLabelProfileList, CheckinLabelProfileResult, CheckinLabelProfileServiceContract, LabelProfile } from "~/lib/checkin-label-profile-contract";
import { validateLabelProfileConfig } from "~/lib/checkin-label-renderer";
import { CheckinError } from "~/lib/checkin-service";

/** Server only. Caller resolves the canonical live session; PB independently
 * rereads the actor inside every transaction, including queries and replay.
 * Neither this service nor approval calls a device or enables production effects. */
export class CheckinLabelProfileService implements CheckinLabelProfileServiceContract {
  constructor(private readonly pb: PocketBase, private readonly actor: CheckinActor) {}
  private authorize() {
    if (!this.actor?.userId || this.actor.role !== "admin") throw new CheckinError("forbidden", 403);
  }
  private async request<T>(operation: string, data: object = {}): Promise<T> {
    this.authorize();
    try {
      return await this.pb.send<T>("/api/wts/checkin-labels", { method: "POST", body: { ...data, operation, actorUserId: this.actor.userId }, requestKey: null });
    } catch (error) {
      const value = error as { status?: number; response?: { data?: { code?: string | { code?: string } } } };
      const field = value.response?.data?.code;
      const code = typeof field === "string" ? field : field?.code;
      if (["forbidden", "invalid_input", "conflict", "unavailable"].includes(code || "")) throw new CheckinError(code as CheckinErrorCode, value.status || 400);
      // Never expose raw storage diagnostics or submitted values.
      throw new CheckinError(value.status === 401 || value.status === 403 ? "forbidden" : "unavailable", value.status === 401 || value.status === 403 ? 403 : 503);
    }
  }
  list(): Promise<CheckinLabelProfileList> { return this.request("list"); }
  get(profileId: string): Promise<LabelProfile> { return this.request("get", { profileId }); }
  async configure(command: CheckinConfigureLabelProfile): Promise<CheckinLabelProfileResult> {
    this.authorize();
    validateLabelProfileConfig(command?.config);
    return this.request("configure", { command });
  }
  approve(command: CheckinApproveLabelProfile): Promise<CheckinLabelProfileResult> { return this.request("approve", { command }); }
}
