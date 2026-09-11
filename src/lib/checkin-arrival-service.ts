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

interface Begin { result?: CheckinArrivalResult; snapshot?: CheckinEventSnapshot; readiness?: { agentId: string; profileId: string; coordinatorGeneration: number } }
export class CheckinArrivalService implements CheckinArrivalServiceContract {
  constructor(private readonly pb: PocketBase, private readonly actor: CheckinActor, private readonly source: CheckinArrivalSource) {}
  private async request<T>(operation: string, body: object): Promise<T> {
    if (!this.actor?.userId || !["admin", "checkin_operator"].includes(this.actor.role)) throw new CheckinError("forbidden", 403);
    try {
      return await this.pb.send<T>("/api/wts/checkin-arrivals", { method: "POST", requestKey: null, body: { ...body, operation, actorUserId: this.actor.userId, sourceKey: this.source.sourceKey } });
    } catch (error) {
      const value = error as { status?: number; response?: { data?: { code?: { code?: string } | string } } };
      const field = value.response?.data?.code;
      const code = typeof field === "string" ? field : field?.code;
      if (["forbidden", "invalid_input", "invalid_binding", "revoked_binding", "disabled", "conflict", "unavailable"].includes(code || "")) throw new CheckinError(code as ConstructorParameters<typeof CheckinError>[0], value.status || 400);
      throw new CheckinError(value.status === 401 || value.status === 403 ? "forbidden" : "unavailable", value.status === 401 || value.status === 403 ? 403 : 503);
    }
  }
  async preflight(bindingToken: string | undefined, input: CheckinArrivalInput): Promise<CheckinArrivalResult> {
    const parsed = checkinArrivalInputSchema.safeParse(input);
    if (!parsed.success) throw new CheckinError("invalid_input", 400);
    const { qrIdentity, ...command } = parsed.data;
    const args = { identityHash: checkinEventBindingHash(bindingToken), command: { ...command, priorOperationId: command.priorOperationId ?? "", qrHash: createHash("sha256").update(`wts2026:arrival:${qrIdentity}`).digest("hex") } };
    const start = await this.request<Begin>("begin", { ...args, invalidIdentity: !checkinArrivalQrIdentitySchema.safeParse(qrIdentity).success });
    if (start.result) return start.result;
    if (!start.snapshot || !start.readiness) throw new CheckinError("unavailable", 503);
    let resolution: ArrivalResolution = { state: "rejected", reason: "invalid_identity" };
    if (checkinArrivalQrIdentitySchema.safeParse(qrIdentity).success) {
      try { resolution = await this.source.resolve(start.snapshot, qrIdentity); } catch { resolution = { state: "unavailable" }; }
    }
    // Every network boundary is fenced before another read or durable acceptance.
    await this.request("fence", args);
    let affiliation: ArrivalAffiliation = { state: "missing" };
    if (resolution.state === "eligible" && !resolution.attendee.alreadyCheckedIn && command.affiliationChoice === "fetch") {
      try { affiliation = await this.source.affiliation(start.snapshot, resolution.attendee); } catch { affiliation = { state: "unavailable" }; }
    }
    return this.request("finish", { ...args, readiness: start.readiness, resolution, affiliation });
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
