import { createHash } from "node:crypto";
import type PocketBase from "pocketbase";
import type { CheckinActor } from "~/lib/checkin-contract";
import type { CheckinArrivalSource } from "~/lib/checkin-arrival-source";
import { CheckinArrivalService } from "~/lib/checkin-arrival-service";
import { checkinEventBindingHash } from "~/lib/checkin-event-service";
import { CheckinError } from "~/lib/checkin-service";
import { checkinArrivalResumeInputSchema, checkinArrivalResumeOperationIdSchema, checkinArrivalResumeSchema, type CheckinArrivalResumeInput, type CheckinArrivalResumeServiceContract } from "~/lib/checkin-arrival-resume-contract";

export class CheckinArrivalResumeService implements CheckinArrivalResumeServiceContract {
  constructor(private readonly pb: PocketBase, private readonly actor: CheckinActor, private readonly source: CheckinArrivalSource) {}
  private async request(bindingToken: string | undefined, body: object) {
    if (!this.actor?.userId || !["admin", "checkin_operator"].includes(this.actor.role)) throw new CheckinError("forbidden", 403);
    try {
      return checkinArrivalResumeSchema.parse(await this.pb.send("/api/wts/checkin-arrival-resume", { method: "POST", requestKey: null, body: { ...body, identityHash: checkinEventBindingHash(bindingToken), actorUserId: this.actor.userId, sourceKey: this.source.sourceKey } }));
    } catch (error) {
      if (error instanceof CheckinError) throw error;
      const value = error as { status?: number; response?: { data?: { code?: { code?: string } | string } } };
      const field = value.response?.data?.code;
      const code = typeof field === "string" ? field : field?.code;
      if (["forbidden", "invalid_input", "invalid_binding", "revoked_binding", "disabled", "conflict", "unavailable"].includes(code || "")) throw new CheckinError(code as ConstructorParameters<typeof CheckinError>[0], value.status || 400);
      throw new CheckinError(value.status === 401 || value.status === 403 ? "forbidden" : "unavailable", value.status === 401 || value.status === 403 ? 403 : 503);
    }
  }
  async get(bindingToken: string | undefined, operationId: string) {
    if (!checkinArrivalResumeOperationIdSchema.safeParse(operationId).success) throw new CheckinError("invalid_input", 400);
    return this.request(bindingToken, { operation: "get", operationId });
  }
  async resume(bindingToken: string | undefined, input: CheckinArrivalResumeInput) {
    const parsed = checkinArrivalResumeInputSchema.safeParse(input);
    if (!parsed.success) throw new CheckinError("invalid_input", 400);
    const { qrIdentity, ...command } = parsed.data;
    const original = await this.request(bindingToken, { ...command, operation: "resume", qrHash: createHash("sha256").update(`wts2026:arrival:${qrIdentity}`).digest("hex") });
    // Never accept context/choice/prior ID from browser storage. The original
    // payload is reconstructed in server memory, then existing fences run again.
    return new CheckinArrivalService(this.pb, this.actor, this.source).preflight(bindingToken, {
      operationId: command.action === "replay" ? original.operationId : command.nextOperationId,
      context: original.context,
      qrIdentity,
      affiliationChoice: command.action === "replay" ? original.affiliationChoice : command.action === "blank" ? "blank" : "fetch",
      ...(command.action === "replay" ? original.priorOperationId ? { priorOperationId: original.priorOperationId } : {} : { priorOperationId: original.operationId }),
    });
  }
}
