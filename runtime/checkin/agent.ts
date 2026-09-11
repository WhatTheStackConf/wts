import { createHash, randomBytes } from "node:crypto";
import { AgentJournal } from "./journal.js";
import type { NiimbotPrinter } from "./printer.js";
import { AgentError, journalFailureState, object, safeUrl, validIdentity, validWork, validCancellation, type AgentIdentity, type AgentReadinessDTO, type Authorization, type JournalState, type Operation, type Outcome, type Work } from "./protocol.js";

export interface AgentTransport { request(operation: Operation, payload: Record<string, unknown>): Promise<unknown> }
interface TransportOptions { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number; timeoutMs?: number }
/** Only read-like requests retry automatically. Mutations are explicitly retried by their owner. */
export class HttpAgentTransport implements AgentTransport {
  private url: URL;
  private fetcher: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private random: () => number;
  private timeout: number;
  constructor(url: string, private credential: string, options: TransportOptions = {}) {
    this.url = new URL("/v1/agent", safeUrl(url));
    if (!/^wts_agent_[a-f0-9]{64}$/.test(credential)) throw new AgentError("invalid_config");
    this.fetcher = options.fetch ?? fetch; this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random; this.timeout = options.timeoutMs ?? 5000;
    if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 10000) throw new AgentError("invalid_config");
  }
  async request(operation: Operation, payload: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify({ operation, payload });
    if (Buffer.byteLength(body) > 16384) throw new AgentError("invalid_request");
    const limit = ["heartbeat", "work", "status", "cancellations"].includes(operation) ? 3 : 1;
    for (let attempt = 0; attempt < limit; attempt++) {
      try { return await this.once(body); }
      catch (error) {
        const failure = error instanceof AgentError ? error : new AgentError("network_unavailable", true);
        if (!failure.retryable || attempt + 1 === limit) throw failure;
        // Long Retry-After values stop this bounded batch, never retry prematurely.
        if (failure.retryAfterMs > 30000) throw new AgentError("backpressure");
        await this.sleep(Math.max(failure.retryAfterMs, Math.min(4000, 250 * 2 ** attempt) * (0.5 + this.random() * 0.5)));
      }
    }
    throw new AgentError("network_unavailable");
  }
  private async once(body: string): Promise<unknown> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await this.fetcher(this.url, { method: "POST", redirect: "error", credentials: "omit", signal: controller.signal, headers: { Authorization: `Bearer ${this.credential}`, "Content-Type": "application/json", Accept: "application/json" }, body });
      if (!response.ok) {
        const retry = response.headers.get("retry-after");
        const retryMs = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
        await response.body?.cancel();
        throw new AgentError(response.status === 429 ? "backpressure" : response.status >= 500 ? "coordinator_unavailable" : "request_rejected", response.status === 429 || response.status >= 500, Number.isFinite(retryMs) ? retryMs : 0);
      }
      if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) { await response.body?.cancel(); throw new AgentError("invalid_response"); }
      const reader = response.body?.getReader(); if (!reader) throw new AgentError("invalid_response");
      const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 65536) { await reader.cancel(); throw new AgentError("invalid_response"); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      try { return object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { throw new AgentError("invalid_response"); }
    } catch (error) { throw error instanceof AgentError ? error : new AgentError("network_unavailable", true); }
    finally { clearTimeout(timer); }
  }
}

export async function reportJournalFailure(identity: AgentIdentity, transport: AgentTransport, state: Exclude<JournalState, "healthy">): Promise<void> {
  await transport.request("heartbeat", { ...identity, protocolGeneration: 1, schemaGeneration: 1, journalState: state, journalSequence: 1, journalDigest: createHash("sha256").update(`unavailable:${state}`).digest("hex") });
}

export class AgentRuntime {
  private now: () => number;
  private mono: () => number;
  private deadlines = new Map<string, { wall: number; mono: number; requested: number }>();
  private agentId: string | null = null;
  private ttl = 10000;
  private printQueue: Promise<void> = Promise.resolve();
  constructor(private identity: AgentIdentity, private journal: AgentJournal, private transport: AgentTransport, options: { now?: () => number; monotonic?: () => number } = {}) {
    validIdentity(identity); this.identity = { ...identity }; this.now = options.now ?? Date.now; this.mono = options.monotonic ?? (() => performance.now());
  }
  private async readiness(operation: "heartbeat" | "status", payload: Record<string, unknown>) {
    const result = object(await this.transport.request(operation, payload)); const station = object(result.station);
    if (station.stationId !== this.identity.stationId || typeof station.readyForAuthorization !== "boolean" || station.operationsEnabled !== false || !["connected", "stale", "never_seen"].includes(String(station.connection)) || !["healthy", "quarantined", "unknown"].includes(String(station.journal)) || !Number.isInteger(station.authorizationTtlMs) || Number(station.authorizationTtlMs) < 100 || Number(station.authorizationTtlMs) > 10000 || typeof station.agentId !== "string") throw new AgentError("invalid_response");
    if (this.agentId && station.agentId !== this.agentId) throw new AgentError("identity_mismatch");
    this.agentId = station.agentId; this.ttl = Number(station.authorizationTtlMs);
    return { station: station as unknown as AgentReadinessDTO };
  }
  async heartbeat() {
    let health;
    try { health = this.journal.heartbeat(); }
    catch (error) {
      const state = journalFailureState(error);
      await reportJournalFailure(this.identity, this.transport, state); throw error;
    }
    return this.readiness("heartbeat", { ...this.identity, protocolGeneration: 1, schemaGeneration: 1, ...health });
  }
  status() { return this.readiness("status", { stationId: this.identity.stationId }); }
  async work(purpose: "initial" | "label" = "label"): Promise<{ attempts: Work[] }> {
    this.journal.snapshot();
    const result = object(await this.transport.request("work", { stationId: this.identity.stationId, purpose }));
    if (Object.keys(result).length !== 1 || !Array.isArray(result.attempts) || result.attempts.length > 10) throw new AgentError("invalid_response");
    const attempts = result.attempts.map(validWork);
    for (const work of attempts) {
      const record = this.receive(work);
      const acknowledged = object(await this.transport.request("ack", { stationId: this.identity.stationId, attemptId: record.attemptId, payloadHash: record.payloadHash }));
      if (Object.keys(acknowledged).length !== 2 || acknowledged.attemptId !== record.attemptId || acknowledged.acknowledged !== true) throw new AgentError("invalid_response");
    }
    return { attempts };
  }
  /** Run before heartbeat/work, including with a revoked credential. Never starts printer work. */
  async recover(): Promise<{ reported: number; acknowledged: number; pending: number }> {
    const run = async () => {
      const result = { reported: 0, acknowledged: 0, pending: 0 };
      const pending = new Set<string>();
      for (const record of this.journal.pending().filter(a => ["possibly_starting", "started", "possibly_printing"].includes(a.state)).slice(0, 10)) {
        try { await this.report(record.attemptId, record.outcome ?? "output_uncertain"); result.reported++; }
        catch { pending.add(record.attemptId); }
      }
      const reply = object(await this.transport.request("cancellations", { stationId: this.identity.stationId }));
      if (Object.keys(reply).length !== 1 || !Array.isArray(reply.cancellations) || reply.cancellations.length > 10) throw new AgentError("invalid_response");
      const intents = reply.cancellations.map(validCancellation);
      for (const intent of intents) {
        const record = this.receive(intent.work);
        // A lost/rejected start reply is not itself proof. Only a durable server
        // cancellation with an explicit unstarted authorization permits this.
        const rejectedStart = record.state === "possibly_starting" && intent.startState === "not_started";
        if (!rejectedStart && !["received", "authorized", "cancelled", "reported"].includes(record.state)) { pending.add(record.attemptId); continue; }
        if (record.cancellation && record.cancellation.cancellationId !== intent.cancellationId) throw new AgentError("attempt_conflict");
        if (!record.cancellation) {
          const disposition = record.state === "reported" ? "settled" : "neutralized";
          if (disposition === "neutralized") record.state = "cancelled";
          record.cancellation = { cancellationId: intent.cancellationId, disposition, acknowledged: false, ...(rejectedStart ? { startState: "not_started" as const } : {}) };
          this.journal.put(record); this.deadlines.delete(record.attemptId);
        }
      }
      // Replay durable unacknowledged intents even when the server lost its ack response.
      for (const record of this.journal.pending().filter(a => a.cancellation && !a.cancellation.acknowledged).slice(0, 10)) {
        const cancellation = record.cancellation!;
        const ack = object(await this.transport.request("neutralized", { stationId: this.identity.stationId, attemptId: record.attemptId, payloadHash: record.payloadHash, cancellationId: cancellation.cancellationId, disposition: cancellation.disposition }));
        if (Object.keys(ack).length !== 2 || ack.cancellationId !== cancellation.cancellationId || ack.acknowledged !== true) throw new AgentError("invalid_response");
        cancellation.acknowledged = true; this.journal.put(record); result.acknowledged++;
        pending.delete(record.attemptId);
      }
      result.pending = pending.size;
      return result;
    };
    const next = this.printQueue.then(run, run);
    this.printQueue = next.then(() => undefined, () => undefined);
    return next;
  }
  private receive(input: Work): import("./protocol.js").JournalAttempt {
    const work = validWork(input);
    if (work.profileId !== this.identity.profileId) throw new AgentError("profile_mismatch");
    const previous = this.journal.get(work.attemptId);
    if (previous) {
      if (previous.profileId !== work.profileId || previous.payloadHash !== work.payloadHash || JSON.stringify(previous.payload) !== JSON.stringify(work.payload)) throw new AgentError("attempt_conflict");
      return previous;
    }
    const record = { ...work, state: "received" as const }; this.journal.put(record); return record;
  }
  /** Process one delivered print in a single serialized task, never in parallel with another USB task. */
  async process(work: Work, printer: NiimbotPrinter): Promise<Outcome> {
    const run = async () => {
      const record = this.receive(work);
      if (!record.payload) throw new AgentError("invalid_response");
      const profile = object(record.payload.profile);
      const config = object(profile.config ?? profile);
      if (printer.printerIdentity !== this.identity.printerIdentity || config.printerRef !== this.identity.printerIdentity) throw new AgentError("printer_identity_mismatch");
      if (record.state === "cancelled") throw new AgentError("attempt_cancelled");
      if (record.state === "reported") return record.outcome!;
      if (record.state === "possibly_starting" || record.state === "started" || record.state === "possibly_printing") return this.report(record.attemptId, record.outcome ?? "output_uncertain").then((value) => value.outcome);
      await printer.prepare?.(record.attemptId, record.payload);
      // A persisted authorization does not retain a process-local monotonic
      // deadline. Re-read the SAME authorization; never extend its expiry.
      if (record.state === "received" || record.state === "authorized" && !this.deadlines.has(record.attemptId)) await this.authorize(work);
      if (this.journal.get(record.attemptId)?.state === "authorized") await this.start(record.attemptId);
      const beforePrint = this.journal.get(record.attemptId);
      if (!beforePrint || beforePrint.state !== "started") throw new AgentError("start_blocked");
      beforePrint.state = "possibly_printing"; this.journal.put(beforePrint);
      try {
        await printer.print(record.attemptId, record.payload);
      } catch {
        return (await this.report(record.attemptId, "output_uncertain")).outcome;
      }
      return (await this.report(record.attemptId, "protocol_complete")).outcome;
    };
    const next = this.printQueue.then(run, run);
    this.printQueue = next.then(() => undefined, () => undefined);
    return next;
  }
  async authorize(work: Work): Promise<Authorization> {
    const record = this.receive(work);
    if (!["received", "authorized"].includes(record.state)) throw new AgentError("already_started");
    if (!record.authorizationHash) { record.authorizationHash = createHash("sha256").update(randomBytes(32)).digest("hex"); this.journal.put(record); }
    const requested = this.now(); const monotonic = this.mono();
    const value = object(await this.transport.request("authorize", { stationId: this.identity.stationId, attemptId: record.attemptId, payloadHash: record.payloadHash, authorizationHash: record.authorizationHash }));
    const expires = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : NaN;
    if (Object.keys(value).length !== 8 || value.attemptId !== record.attemptId || value.stationId !== this.identity.stationId || value.payloadHash !== record.payloadHash || typeof value.agentId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(value.agentId) || (this.agentId && value.agentId !== this.agentId) || ![value.stationGeneration, value.systemGeneration, value.coordinatorGeneration].every(v => Number.isSafeInteger(v) && Number(v) >= 1)) throw new AgentError("invalid_response");
    if (!Number.isFinite(expires) || this.now() < requested || this.now() >= expires || expires > this.now() + this.ttl || this.mono() - monotonic >= this.ttl) throw new AgentError("authorization_expired");
    const auth = value as unknown as Authorization;
    if (record.authorization && JSON.stringify(record.authorization) !== JSON.stringify(auth)) throw new AgentError("authorization_conflict");
    record.authorization = auth; record.state = "authorized"; this.journal.put(record);
    this.agentId = auth.agentId;
    this.deadlines.set(record.attemptId, { wall: Math.min(expires, requested + this.ttl), mono: monotonic + Math.min(this.ttl, expires - requested), requested });
    return auth;
  }
  async start(attemptId: string): Promise<{ attemptId: string; started: true; reportUntil: string }> {
    const record = this.journal.get(attemptId); const deadline = this.deadlines.get(attemptId);
    if (!record || record.state !== "authorized" || !record.authorization || !deadline) throw new AgentError("start_blocked");
    if (this.now() < deadline.requested || this.now() >= deadline.wall || this.mono() >= deadline.mono) throw new AgentError("authorization_expired");
    // Future physical-start seam only: no USB/printer command exists in this slice.
    record.state = "possibly_starting"; this.journal.put(record); this.deadlines.delete(attemptId);
    const result = object(await this.transport.request("start", { stationId: this.identity.stationId, attemptId, payloadHash: record.payloadHash, authorizationHash: record.authorizationHash }));
    if (Object.keys(result).length !== 3 || result.attemptId !== attemptId || result.started !== true || typeof result.reportUntil !== "string" || (result.reportUntil !== "" && !Number.isFinite(Date.parse(result.reportUntil)))) throw new AgentError("invalid_response");
    if (this.now() < deadline.requested || this.now() >= deadline.wall || this.mono() >= deadline.mono) throw new AgentError("authorization_expired");
    record.state = "started"; record.reportUntil = result.reportUntil; this.journal.put(record);
    return { attemptId, started: true, reportUntil: result.reportUntil };
  }
  async report(attemptId: string, outcome: Outcome): Promise<{ attemptId: string; outcome: Outcome }> {
    const record = this.journal.get(attemptId);
    if (!["output_uncertain", "protocol_complete"].includes(outcome) || !record || !["possibly_starting", "started", "possibly_printing", "reported"].includes(record.state) || !record.authorizationHash || (record.outcome && record.outcome !== outcome) || (["possibly_starting", "started"].includes(record.state) && outcome !== "output_uncertain")) throw new AgentError("outcome_blocked");
    record.outcome = outcome; this.journal.put(record);
    const result = object(await this.transport.request("outcome", { stationId: this.identity.stationId, attemptId, authorizationHash: record.authorizationHash, outcome }));
    if (Object.keys(result).length !== 2 || result.attemptId !== attemptId || result.outcome !== outcome) throw new AgentError("invalid_response");
    record.state = "reported"; this.journal.put(record); return { attemptId, outcome };
  }
}
