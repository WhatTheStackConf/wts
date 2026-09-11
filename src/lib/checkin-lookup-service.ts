import type PocketBase from "pocketbase";
import { createHash } from "node:crypto";
import { checkinLookupRecoverInputSchema, checkinLookupRecoveryOperationIdSchema, type CheckinLookupRecoverInput, type CheckinLookupRecovery } from "~/lib/checkin-lookup-recovery-contract";

type StoredCommand = Omit<CheckinLookupConfirmInput, "qrIdentity"> & { qrHash: string; priorOperationId: string };
interface StoredLookup { command: StoredCommand; snapshot: CheckinEventSnapshot; final: boolean; recovery: CheckinLookupRecovery }
const qrHash = (qr: string) => createHash("sha256").update(`wts2026:arrival:${qr}`).digest("hex");
import type { CheckinActor } from "~/lib/checkin-contract";
import type { CheckinEventContext, CheckinEventSnapshot } from "~/lib/checkin-event-contract";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import type { CheckinArrivalSource } from "~/lib/checkin-arrival-source";
import { CheckinArrivalService } from "~/lib/checkin-arrival-service";
import { checkinEventBindingHash } from "~/lib/checkin-event-service";
import { CheckinError, CheckinService } from "~/lib/checkin-service";
import type { CheckinLookupSource, LookupRead } from "~/lib/checkin-lookup-hievents";
import { checkinLookupAttendeeSchema, checkinLookupConfirmInputSchema, checkinLookupSearchInputSchema, type CheckinLookupConfirmInput, type CheckinLookupSearchInput, type CheckinLookupSearchResult } from "~/lib/checkin-lookup-contract";

/** Server-only orchestration. Search data lives only in this request; confirmation
 * enters the existing guarded arrival ledger, never an alternative effect path. */
export class CheckinLookupService {
  constructor(private readonly pb: PocketBase, private readonly actor: CheckinActor, private readonly source: CheckinLookupSource, private readonly arrivalSource: CheckinArrivalSource) {}

  private async context(bindingToken: string | undefined, context: CheckinEventContext): Promise<CheckinEventSnapshot> {
    if (!this.actor?.userId || !["admin", "checkin_operator"].includes(this.actor.role)) throw new CheckinError("forbidden", 403);
    const identityHash = checkinEventBindingHash(bindingToken);
    if (this.source.sourceKey !== this.arrivalSource.sourceKey) throw new CheckinError("unavailable", 503);
    try {
      // Existing PB transaction re-reads live user/verification, binding, selection,
      // system/station/event generations. This call does not write or read upstream.
      return await this.pb.send<CheckinEventSnapshot>("/api/wts/checkin-events", { method: "POST", requestKey: null, body: { operation: "context", actorUserId: this.actor.userId, sourceKey: this.source.sourceKey, identityHash, context } });
    } catch (error) {
      const value = error as { status?: number; response?: { data?: { code?: { code?: string } | string } } };
      const field = value.response?.data?.code;
      const code = typeof field === "string" ? field : field?.code;
      if (["forbidden", "invalid_input", "invalid_binding", "revoked_binding", "disabled", "conflict", "unavailable"].includes(code || "")) throw new CheckinError(code as ConstructorParameters<typeof CheckinError>[0], value.status || 400);
      throw new CheckinError(value.status === 401 || value.status === 403 ? "forbidden" : "unavailable", value.status === 401 || value.status === 403 ? 403 : 503);
    }
  }

  async search(bindingToken: string | undefined, input: CheckinLookupSearchInput): Promise<CheckinLookupSearchResult> {
    const parsed = checkinLookupSearchInputSchema.safeParse(input);
    if (!parsed.success) throw new CheckinError("invalid_input", 400);
    const { context, query, offset } = parsed.data;
    const snapshot = await this.context(bindingToken, context);
    let read: LookupRead;
    try { read = await this.source.search(snapshot, query); } catch { read = { state: "unavailable" }; }
    await this.context(bindingToken, context);
    if (read.state !== "complete") return { state: read.state, context, items: [], nextOffset: null };
    const attendees = checkinLookupAttendeeSchema.array().max(1000).safeParse(read.attendees);
    if (!attendees.success || new Set(attendees.data.map(row => row.attendeeId)).size !== attendees.data.length || new Set(attendees.data.map(row => row.publicId)).size !== attendees.data.length) return { state: "unavailable", context, items: [], nextOffset: null };
    return { state: "complete", context, items: attendees.data.slice(offset, offset + 20), nextOffset: offset + 20 < attendees.data.length ? offset + 20 : null };
  }

  private async confirmBinding(bindingToken: string | undefined, context: CheckinEventContext) {
    if (this.source.sourceKey !== this.arrivalSource.sourceKey) throw new CheckinError("unavailable", 503);
    const current = await new CheckinService(this.pb, this.actor).status(bindingToken);
    if (current.bindingState === "revoked" || current.binding?.revoked) throw new CheckinError("revoked_binding", 403);
    if (current.bindingState !== "bound") throw new CheckinError("invalid_binding", 403);
    if (current.binding?.id !== context.bindingId || current.binding.version !== context.bindingVersion || current.station?.id !== context.stationId) throw new CheckinError("conflict", 409);
  }

  private async lookupCommand(token: string | undefined, body: object): Promise<StoredLookup> {
    if (!this.actor?.userId || !["admin", "checkin_operator"].includes(this.actor.role)) throw new CheckinError("forbidden", 403);
    if (this.source.sourceKey !== this.arrivalSource.sourceKey) throw new CheckinError("unavailable", 503);
    try {
      return await this.pb.send("/api/wts/checkin-lookup-commands", { method: "POST", requestKey: null, body: { ...body, identityHash: checkinEventBindingHash(token), actorUserId: this.actor.userId, sourceKey: this.source.sourceKey } });
    } catch (error) {
      const value = error as { status?: number; response?: { data?: { code?: { code?: string } | string } } };
      const field = value.response?.data?.code; const code = typeof field === "string" ? field : field?.code;
      if (["forbidden", "invalid_input", "invalid_binding", "revoked_binding", "disabled", "conflict", "unavailable"].includes(code || "")) throw new CheckinError(code as ConstructorParameters<typeof CheckinError>[0], value.status || 400);
      throw new CheckinError(value.status === 403 ? "forbidden" : "unavailable", value.status === 403 ? 403 : 503);
    }
  }

  private async cachedResult(token: string | undefined, stored: StoredLookup): Promise<CheckinArrivalResult> {
    // Only an observed final base command may use this route. The original
    // privileged begin supplies its authoritative envelope, never a fabricated DTO.
    if (!stored.final) throw new CheckinError("conflict", 409);
    await this.confirmBinding(token, stored.command.context);
    const { attendeeId: _selected, ...command } = stored.command;
    let response: { result?: CheckinArrivalResult };
    try {
      response = await this.pb.send("/api/wts/checkin-arrivals", { method: "POST", requestKey: null, body: { operation: "begin", identityHash: checkinEventBindingHash(token), actorUserId: this.actor.userId, sourceKey: this.source.sourceKey, command } });
    } catch (error) {
      const value = error as { status?: number; response?: { data?: { code?: { code?: string } | string } } };
      const field = value.response?.data?.code; const code = typeof field === "string" ? field : field?.code;
      if (["forbidden", "invalid_input", "invalid_binding", "revoked_binding", "disabled", "conflict", "unavailable"].includes(code || "")) throw new CheckinError(code as ConstructorParameters<typeof CheckinError>[0], value.status || 400);
      throw new CheckinError(value.status === 403 ? "forbidden" : "unavailable", value.status === 403 ? 403 : 503);
    }
    await this.confirmBinding(token, command.context);
    if (!response.result) throw new CheckinError("conflict", 409);
    return response.result;
  }

  async getRecovery(token: string | undefined, operationId: string): Promise<CheckinLookupRecovery> {
    if (!checkinLookupRecoveryOperationIdSchema.safeParse(operationId).success) throw new CheckinError("invalid_input", 400);
    const stored = await this.lookupCommand(token, { operation: "get", operationId });
    const result = stored.final ? await this.cachedResult(token, stored) : undefined;
    const checked = await this.lookupCommand(token, { operation: "get", operationId });
    return { ...checked.recovery, ...(result ? { result } : {}) };
  }

  async recover(token: string | undefined, input: CheckinLookupRecoverInput): Promise<CheckinArrivalResult> {
    const parsed = checkinLookupRecoverInputSchema.safeParse(input);
    if (!parsed.success) throw new CheckinError("invalid_input", 400);
    const stored = await this.lookupCommand(token, { operation: "recover", ...parsed.data });
    if (stored.final) return this.cachedResult(token, stored);
    // Reacquire only for actual preflight, using the frozen server snapshot.
    let read: LookupRead;
    try { read = await this.source.identity(stored.snapshot, stored.command.attendeeId); } catch { read = { state: "unavailable" }; }
    await this.lookupCommand(token, { operation: "recover", operationId: stored.command.operationId, action: "replay" });
    if (read.state !== "complete") throw new CheckinError("unavailable", 503);
    const people = checkinLookupAttendeeSchema.array().length(1).safeParse(read.attendees);
    if (!people.success || people.data[0].attendeeId !== stored.command.attendeeId || qrHash(people.data[0].publicId) !== stored.command.qrHash) throw new CheckinError("conflict", 409);
    const { qrHash: _hash, priorOperationId, ...command } = stored.command;
    return this.confirm(token, { ...command, qrIdentity: people.data[0].publicId, ...(priorOperationId ? { priorOperationId } : {}) });
  }

  async confirm(bindingToken: string | undefined, input: CheckinLookupConfirmInput): Promise<CheckinArrivalResult> {
    const parsed = checkinLookupConfirmInputSchema.safeParse(input);
    if (!parsed.success) throw new CheckinError("invalid_input", 400);
    const { attendeeId, ...command } = parsed.data;
    // Fresh arrivals remain fully fenced by the ledger. Exact finalized replay
    // needs current human/binding authority, not mutable catalogue availability.
    await this.confirmBinding(bindingToken, command.context);
    const { qrIdentity, ...opaque } = parsed.data;
    await this.lookupCommand(bindingToken, { operation: "bind", operationId: command.operationId, command: { ...opaque, qrHash: qrHash(qrIdentity), priorOperationId: opaque.priorOperationId ?? "" } });
    const source: CheckinArrivalSource = {
      sourceKey: this.arrivalSource.sourceKey,
      resolve: async (snapshot, qrIdentity) => {
        const resolution = await this.arrivalSource.resolve(snapshot, qrIdentity);
        // The arrival adapter proves current event/list membership and eligibility;
        // bind its exact public identity to the explicitly selected attendee.
        if (resolution.state === "eligible" && (resolution.attendee.upstreamAttendeeId !== attendeeId || resolution.attendee.publicId !== qrIdentity)) return { state: "rejected", reason: "invalid_identity" };
        return resolution;
      },
      affiliation: (snapshot, attendee) => this.arrivalSource.affiliation(snapshot, attendee),
    };
    const result = await new CheckinArrivalService(this.pb, this.actor, source).preflight(bindingToken, command);
    // Existing workflow replays deliberately skip upstream. Validate the selected
    // ID against its immutable durable identity, not a new potentially failed read.
    if ("workflow" in result) {
      const workflow = await this.pb.collection("checkin_arrival_workflows").getOne(result.workflow.id, { requestKey: null, fields: "upstream_attendee_id" });
      if (workflow.upstream_attendee_id !== attendeeId) throw new CheckinError("conflict", 409);
    }
    await this.confirmBinding(bindingToken, command.context);
    return result;
  }
}
