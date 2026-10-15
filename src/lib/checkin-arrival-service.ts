import { createHash } from "node:crypto";
import { z } from "zod";
import type { CheckinArrivalStatus } from "~/lib/checkin-arrival-contract";
import type PocketBase from "pocketbase";
import type { CheckinActor } from "~/lib/checkin-contract";
import type { CheckinEventSnapshot } from "~/lib/checkin-event-contract";
import type { CheckinArrivalHistory, CheckinArrivalHistoryQuery, CheckinArrivalInput, CheckinArrivalResult, CheckinArrivalServiceContract } from "~/lib/checkin-arrival-contract";
import type { CheckinArrivalSource, ArrivalResolution, ArrivalAffiliation } from "~/lib/checkin-arrival-source";
import { checkinArrivalHistoryQuerySchema, checkinArrivalInputSchema, checkinArrivalQrIdentitySchema } from "~/lib/checkin-arrival-validation";
import { checkinEventBindingHash } from "~/lib/checkin-event-service";
import { CheckinError } from "~/lib/checkin-service";
import { CHECKIN_STATION_ERROR_CODES, checkinHookError } from "~/lib/checkin-hook-error";

interface Begin { result?: CheckinArrivalResult; snapshot?: CheckinEventSnapshot; readiness?: { agentId: string; profileId: string; coordinatorGeneration: number } }
export class CheckinArrivalService implements CheckinArrivalServiceContract {
  constructor(private readonly pb: PocketBase, private readonly actor: CheckinActor, private readonly source: CheckinArrivalSource) {}
  private async request<T>(operation: string, body: object): Promise<T> {
    if (!this.actor?.userId || !["admin", "checkin_operator"].includes(this.actor.role)) throw new CheckinError("forbidden", 403);
    try {
      return await this.pb.send<T>("/api/wts/checkin-arrivals", { method: "POST", requestKey: null, body: { ...body, operation, actorUserId: this.actor.userId, sourceKey: this.source.sourceKey } });
    } catch (error) { throw checkinHookError(error, CHECKIN_STATION_ERROR_CODES); }
  }
  async preflight(bindingToken: string | undefined, input: CheckinArrivalInput): Promise<CheckinArrivalResult> {
    const parsed = checkinArrivalInputSchema.safeParse(input);
    if (!parsed.success) throw new CheckinError("invalid_input", 400);
    const { qrIdentity, ...command } = parsed.data;
    const args = { identityHash: checkinEventBindingHash(bindingToken), command: { ...command, priorOperationId: command.priorOperationId ?? "", qrHash: createHash("sha256").update(`wts2026:arrival:${qrIdentity}`).digest("hex") } };
    const start = await this.request<Begin>("begin", { ...args, invalidIdentity: !checkinArrivalQrIdentitySchema.safeParse(qrIdentity).success });
    if (start.result) return start.result;
    if (!start.snapshot || !start.readiness) throw new CheckinError("unavailable", 503);
    const resolution = await this.resolveArrival(start.snapshot, qrIdentity);
    // Every network boundary is fenced before another read or durable acceptance.
    await this.request("fence", args);
    const affiliation = await this.readAffiliation(start.snapshot, resolution, command.affiliationChoice);
    return this.request("finish", { ...args, readiness: start.readiness, resolution, affiliation });
  }
  private async resolveArrival(snapshot: CheckinEventSnapshot, qrIdentity: string): Promise<ArrivalResolution> {
    if (!checkinArrivalQrIdentitySchema.safeParse(qrIdentity).success) return { state: "rejected", reason: "invalid_identity" };
    try { return await this.source.resolve(snapshot, qrIdentity); } catch { return { state: "unavailable" }; }
  }
  private async readAffiliation(snapshot: CheckinEventSnapshot, resolution: ArrivalResolution, choice: CheckinArrivalInput["affiliationChoice"]): Promise<ArrivalAffiliation> {
    if (resolution.state !== "eligible" || resolution.attendee.alreadyCheckedIn || choice !== "fetch") return { state: "missing" };
    try { return await this.source.affiliation(snapshot, resolution.attendee); } catch { return { state: "unavailable" }; }
  }
  async status(bindingToken: string | undefined, operationId: string): Promise<CheckinArrivalStatus> {
    if (!z.uuid().safeParse(operationId).success) throw new CheckinError("invalid_input", 400);
    return this.request("status", { identityHash: checkinEventBindingHash(bindingToken), operationId });
  }
  async history(bindingToken: string | undefined, query: CheckinArrivalHistoryQuery = {}): Promise<CheckinArrivalHistory> {
    const parsed = checkinArrivalHistoryQuerySchema.safeParse(query);
    if (!parsed.success) throw new CheckinError("invalid_input", 400);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Skopje", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return this.request("history", { identityHash: parsed.data.scope === "all" ? "" : checkinEventBindingHash(bindingToken), query: parsed.data, day });
  }
}
