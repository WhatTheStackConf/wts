import type PocketBase from "pocketbase";
import type { CheckinActor } from "~/lib/checkin-contract";
import type { CheckinApproveLabelProfile, CheckinConfigureLabelProfile, CheckinLabelProfileList, CheckinLabelProfileResult, CheckinLabelProfileServiceContract, LabelProfile } from "~/lib/checkin-label-profile-contract";
import { validateLabelProfileConfig } from "~/lib/checkin-label-renderer";
import { CheckinError } from "~/lib/checkin-service";
import { checkinHookError } from "~/lib/checkin-hook-error";

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
      // Never expose raw storage diagnostics or submitted values.
      throw checkinHookError(error, ["forbidden", "invalid_input", "conflict", "unavailable"]);
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
