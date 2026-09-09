import { createHash } from "node:crypto";
import type PocketBase from "pocketbase";
import type { CheckinActor } from "~/lib/checkin-contract";
import type { CheckinAdminEventCatalogue, CheckinConfigureEvent, CheckinConfigureEventResult, CheckinEventConfiguration, CheckinEventOptions, CheckinEventCatalogue, CheckinEventContext, CheckinEventSelection, CheckinEventSnapshot, CheckinEventServiceContract } from "~/lib/checkin-event-contract";
import { CheckinError } from "~/lib/checkin-service";
import { checkinUpstreamId, configureCheckinEventSchema, checkinEventContextSchema, selectCheckinEventSchema } from "~/lib/checkin-event-validation";

/** Injected read-only transport boundary. Never accepts browser credentials. */
export interface CheckinEventSource {
  sourceKey: string;
  discover(): Promise<{ state: "complete" | "partial" | "unavailable"; events: { id: string; title: string }[] }>;
  options(eventId: string): Promise<CheckinEventOptions>;
}
interface Configurations { configurations: CheckinEventConfiguration[]; sourceMismatch: boolean }
export class CheckinEventService implements CheckinEventServiceContract {
  constructor(private readonly pb: PocketBase, private readonly actor: CheckinActor, private readonly source: CheckinEventSource) {}
  private async request<T>(operation: string, body: object = {}): Promise<T> {
    if (!this.actor?.userId || !["admin", "checkin_operator"].includes(this.actor.role) || (operation.startsWith("admin_") && this.actor.role !== "admin")) throw new CheckinError("forbidden", 403);
    try {
      return await this.pb.send<T>("/api/wts/checkin-events", { method: "POST", body: { ...body, operation, actorUserId: this.actor.userId, sourceKey: this.source.sourceKey }, requestKey: null });
    } catch (error) {
      const value = error as { status?: number; response?: { data?: { code?: { code?: string } | string } } };
      const field = value.response?.data?.code;
      const code = typeof field === "string" ? field : field?.code;
      if (["forbidden", "invalid_input", "invalid_binding", "revoked_binding", "disabled", "conflict", "unavailable"].includes(code || "")) throw new CheckinError(code as ConstructorParameters<typeof CheckinError>[0], value.status || 400);
      throw new CheckinError(value.status === 403 || value.status === 401 ? "forbidden" : "unavailable", value.status === 403 || value.status === 401 ? 403 : 503);
    }
  }
  async adminCatalogue(): Promise<CheckinAdminEventCatalogue> {
    await this.request<Configurations>("admin_catalogue");
    const upstream = await this.source.discover();
    // Recheck role after the network read; no stale authority response.
    const stored = await this.request<Configurations>("admin_catalogue");
    const events = upstream.state === "complete" ? upstream.events.map((event) => ({ upstreamEventId: event.id, title: event.title, upstreamAvailable: true, configuration: stored.configurations.find((entry) => entry.upstreamEventId === event.id) ?? null })) : [];
    for (const configuration of stored.configurations) if (!events.some((event) => event.upstreamEventId === configuration.upstreamEventId)) events.push({ upstreamEventId: configuration.upstreamEventId, title: configuration.title, upstreamAvailable: false, configuration });
    return { state: stored.sourceMismatch ? "unavailable" : upstream.state, events, sourceMismatch: stored.sourceMismatch };
  }
  async adminOptions(upstreamEventId: string): Promise<CheckinEventOptions> {
    if (!checkinUpstreamId.safeParse(upstreamEventId).success) throw new CheckinError("invalid_input", 400);
    const stored = await this.request<Configurations>("admin_catalogue");
    if (stored.sourceMismatch) throw new CheckinError("unavailable", 503);
    const options = await this.source.options(upstreamEventId);
    await this.request("admin_catalogue");
    return options;
  }
  async configure(input: CheckinConfigureEvent): Promise<CheckinConfigureEventResult> {
    const parsed = configureCheckinEventSchema.safeParse(input);
    if (!parsed.success) throw new CheckinError("invalid_input", 400);
    const command = parsed.data;
    const replay = await this.request<CheckinConfigureEventResult | null>("admin_replay", { command });
    if (replay) return replay;
    const discovered = await this.source.discover();
    if (discovered.state !== "complete") throw new CheckinError("unavailable", 503);
    const event = discovered.events.find((entry) => entry.id === command.upstreamEventId);
    if (!event) throw new CheckinError("invalid_input", 400);
    if (command.enabled && (!command.member || !command.listId)) throw new CheckinError("invalid_input", 400);
    if (command.listId || command.affiliation) {
      const options = await this.source.options(command.upstreamEventId);
      if (options.state !== "complete") throw new CheckinError("unavailable", 503);
      if (command.listId && !options.lists.some((list) => list.id === command.listId)) throw new CheckinError("invalid_input", 400);
      if (command.affiliation) {
        const mapping = command.affiliation;
        const question = options.questions.find((question) => question.id === mapping.questionId);
        if (!question || mapping.productIds.some((id) => !options.products.some((product) => product.id === id) || (question.productIds.length > 0 && !question.productIds.includes(id)))) throw new CheckinError("invalid_input", 400);
      }
    }
    return this.request("admin_configure", { command, title: event.title });
  }
  async catalogue(bindingToken?: string): Promise<CheckinEventCatalogue> {
    const identityHash = checkinEventBindingHash(bindingToken);
    const availability = await this.readAvailability(identityHash);
    return this.request("catalogue", { identityHash, ...availability });
  }
  private async readAvailability(identityHash: string) {
    // These exact upstream references never leave the authenticated server.
    const configurations = await this.request<CheckinEventConfiguration[]>("inspect", { identityHash });
    const upstream = await this.source.discover();
    let upstreamState = upstream.state;
    const verifiedMappings: { eventId: string; generation: number; listId: string }[] = [];
    if (upstream.state === "complete") {
      for (const entry of configurations) {
        if (!entry.member || !entry.enabled || !entry.listId || !upstream.events.some((event) => event.id === entry.upstreamEventId)) continue;
        const options = await this.source.options(entry.upstreamEventId);
        if (options.state !== "complete") { upstreamState = "partial"; continue; }
        if (!options.lists.some((list) => list.id === entry.listId)) continue;
        if (entry.affiliation) {
          const mapping = entry.affiliation;
          const question = options.questions.find((question) => question.id === mapping.questionId);
          if (!question || mapping.productIds.some((id) => !options.products.some((product) => product.id === id) || (question.productIds.length > 0 && !question.productIds.includes(id)))) continue;
        }
        verifiedMappings.push({ eventId: entry.id, generation: entry.generation, listId: entry.listId });
      }
    }
    return { upstreamState, discoveryComplete: upstream.state === "complete", verifiedMappings };
  }
  async select(bindingToken: string | undefined, input: CheckinEventSelection): Promise<CheckinEventCatalogue> {
    const parsed = selectCheckinEventSchema.safeParse(input);
    if (!parsed.success) throw new CheckinError("invalid_input", 400);
    const identityHash = checkinEventBindingHash(bindingToken);
    const availability = await this.readAvailability(identityHash);
    if (!availability.discoveryComplete) throw new CheckinError("unavailable", 503);
    return this.request("select", { identityHash, selection: parsed.data, ...availability });
  }
  /** Read-only context resolution, NOT admission acceptance. A downstream intake
   * transaction must apply the same fence when persisting its immutable work. */
  async validateContext(bindingToken: string | undefined, input: CheckinEventContext): Promise<CheckinEventSnapshot> {
    const parsed = checkinEventContextSchema.safeParse(input);
    if (!parsed.success) throw new CheckinError("invalid_input", 400);
    const args = { identityHash: checkinEventBindingHash(bindingToken), context: parsed.data };
    const snapshot = await this.request<CheckinEventSnapshot>("context", args);
    const upstream = await this.source.discover();
    if (upstream.state !== "complete" || !upstream.events.some((event) => event.id === snapshot.upstreamEventId)) throw new CheckinError("unavailable", 503);
    const options = await this.source.options(snapshot.upstreamEventId);
    if (options.state !== "complete" || !options.lists.some((list) => list.id === snapshot.upstreamListId)) throw new CheckinError("unavailable", 503);
    return this.request("context", args);
  }
}

export function checkinEventBindingHash(token: string | undefined): string {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new CheckinError("invalid_binding", 403);
  return createHash("sha256").update(`wts2026:binding:${token}`).digest("hex");
}
