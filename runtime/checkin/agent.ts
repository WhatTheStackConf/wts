import { createHash, randomBytes } from "node:crypto";
import { AgentJournal } from "./journal.js";
import { AgentError, journalFailureState, object, safeUrl, validIdentity, validWork, type AgentIdentity, type AgentReadinessDTO, type Authorization, type JournalState, type Operation, type Outcome, type Work } from "./protocol.js";

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
    const limit = ["heartbeat", "work", "status"].includes(operation) ? 3 : 1;
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
  async work(): Promise<{ attempts: Work[] }> {
    this.journal.snapshot();
    const result = object(await this.transport.request("work", { stationId: this.identity.stationId }));
    if (Object.keys(result).length !== 1 || !Array.isArray(result.attempts) || result.attempts.length > 10) throw new AgentError("invalid_response");
    const attempts = result.attempts.map(validWork);
    for (const work of attempts) this.receive(work);
    return { attempts };
  }
  private receive(input: Work): import("./protocol.js").JournalAttempt {
    const work = validWork(input);
    if (work.profileId !== this.identity.profileId) throw new AgentError("profile_mismatch");
    const previous = this.journal.get(work.attemptId);
    if (previous) {
      if (previous.profileId !== work.profileId || previous.payloadHash !== work.payloadHash) throw new AgentError("attempt_conflict");
      return previous;
    }
    const record = { ...work, state: "received" as const }; this.journal.put(record); return record;
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
    if (!["output_uncertain", "protocol_complete"].includes(outcome) || !record || !["possibly_starting", "started", "reported"].includes(record.state) || !record.authorizationHash || (record.outcome && record.outcome !== outcome) || (record.state === "possibly_starting" && outcome !== "output_uncertain")) throw new AgentError("outcome_blocked");
    record.outcome = outcome; this.journal.put(record);
    const result = object(await this.transport.request("outcome", { stationId: this.identity.stationId, attemptId, authorizationHash: record.authorizationHash, outcome }));
    if (Object.keys(result).length !== 2 || result.attemptId !== attemptId || result.outcome !== outcome) throw new AgentError("invalid_response");
    record.state = "reported"; this.journal.put(record); return { attemptId, outcome };
  }
}
