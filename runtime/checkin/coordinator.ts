import { createHash, randomBytes } from "node:crypto";
import { CheckinReadError } from "../../src/lib/checkin-upstream-read.js";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type PocketBase from "pocketbase";
import { validResetJob, type ResetJob, type ResetOutcome, type ResetTransport, type Cancellation } from "./protocol.js";
import type { AgentReadinessDTO, Work as Attempt, Authorization, AdmissionJob, AdmissionOutcome, AdmissionProcessor } from "./protocol.js";

interface Options { now?: () => number; heartbeatIntervalMs?: number; heartbeatTimeoutMs?: number; authorizationTtlMs?: number }
interface Replies {
  policy: Record<string, unknown>;
  purge_complete: Record<string, unknown>;
  heartbeat: { station: AgentReadinessDTO };
  status: { station: AgentReadinessDTO };
  work: { attempts: Attempt[] };
  cancellations: { cancellations: Cancellation[] };
  neutralized: { cancellationId: string; acknowledged: true };
  ack: { attemptId: string; acknowledged: true };
  authorize: Authorization;
  start: { attemptId: string; started: true; reportUntil: string };
  outcome: { attemptId: string; outcome: "protocol_complete" | "output_uncertain" };
}
type Operation = keyof Replies;
class Rejected extends Error {
  constructor(readonly status: number) { super("Agent request rejected."); }
}
const fields: Record<Operation, string[]> = {
  policy: ["stationId", "journalIdentity"],
  purge_complete: ["stationId", "journalIdentity", "purgeToken", "method"],
  heartbeat: ["stationId", "agentIdentity", "printerIdentity", "journalIdentity", "profileId", "protocolGeneration", "schemaGeneration", "journalSequence", "journalDigest", "journalState"],
  status: ["stationId"], work: ["stationId"], cancellations: ["stationId"],
  neutralized: ["stationId", "attemptId", "payloadHash", "cancellationId", "disposition"],
  ack: ["stationId", "attemptId", "payloadHash"],
  authorize: ["stationId", "attemptId", "payloadHash", "authorizationHash"],
  start: ["stationId", "attemptId", "payloadHash", "authorizationHash"],
  outcome: ["stationId", "attemptId", "authorizationHash", "outcome"],
};
function shape(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function matches(value: unknown, regex: RegExp) { return typeof value === "string" && regex.test(value); }
function validate(operation: string, payload: unknown): asserts operation is Operation {
  const baseKeys = Object.hasOwn(fields, operation) ? fields[operation as Operation] : [];
  const keys = operation === "work" && payload && typeof payload === "object" && Object.hasOwn(payload, "purpose") ? ["stationId", "purpose"] : baseKeys;
  if (!Object.hasOwn(fields, operation) || !shape(payload, keys)) throw new Rejected(400);
  if (operation === "work" && Object.hasOwn(payload, "purpose") && !["initial", "label"].includes(String(payload.purpose))) throw new Rejected(400);
  if (!matches(payload.stationId, /^wts2026station[123]$/)) throw new Rejected(400);
  for (const [key, value] of Object.entries(payload)) {
    if (["payloadHash", "authorizationHash", "journalDigest"].includes(key) && !matches(value, /^[a-f0-9]{64}$/)) throw new Rejected(400);
    if (["agentIdentity", "printerIdentity", "journalIdentity"].includes(key) && !matches(value, /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/)) throw new Rejected(400);
    if (["attemptId", "cancellationId"].includes(key) && !matches(value, /^[a-z0-9]{15}$/)) throw new Rejected(400);
    if (key === "profileId" && !matches(value, /^(?:[a-z0-9]{15})?$/)) throw new Rejected(400);
    if (["protocolGeneration", "schemaGeneration", "journalSequence"].includes(key) && (!Number.isSafeInteger(value) || (value as number) < 1)) throw new Rejected(400);
  }
  if (operation === "neutralized" && !["neutralized", "settled"].includes(String(payload.disposition))) throw new Rejected(400);
  if (operation === "heartbeat" && !["healthy", "lost", "corrupt", "restored"].includes(String(payload.journalState))) throw new Rejected(400);
  if (operation === "outcome" && !["protocol_complete", "output_uncertain"].includes(String(payload.outcome))) throw new Rejected(400);
}

/** Independently supervised, outbound-agent-only boundary. Never sends device I/O. */
export class Coordinator {
  private readonly owner = randomBytes(32).toString("hex");
  private readonly now: Options["now"];
  private readonly config: Required<Omit<Options, "now">>;
  private server?: Server;
  private active = false;
  constructor(private readonly pb: PocketBase, options: Options = {}) {
    this.now = options.now;
    this.config = { heartbeatIntervalMs: options.heartbeatIntervalMs ?? 5000, heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 15000, authorizationTtlMs: options.authorizationTtlMs ?? 10000 };
  }
  private clockOverride(): { nowMs?: number } {
    // Production RPCs use PB's transaction clock: a later pulse may commit
    // before an earlier request arrives. Only explicit test clocks travel.
    return this.now ? { nowMs: this.now() } : {};
  }
  private async command<T>(operation: string, data: object = {}): Promise<T> {
    try {
      return await this.pb.send<T>("/api/wts/checkin-agents", { method: "POST", body: { ...data, operation, owner: this.owner, ...this.clockOverride() }, requestKey: null, signal: AbortSignal.timeout(5000) });
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new Rejected(status && [400, 403, 409].includes(status) ? status : 503);
    }
  }
  private async admissionCommand<T>(operation: string, data: object = {}): Promise<T> {
    try {
      return await this.pb.send<T>("/api/wts/checkin-arrivals", { method: "POST", body: { ...data, operation, owner: this.owner, ...this.clockOverride() }, requestKey: null, signal: AbortSignal.timeout(5000) });
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new Rejected(status && [400, 403, 409].includes(status) ? status : 503);
    }
  }
  async listen(host = "127.0.0.1", port = 0): Promise<string> {
    if (this.server || this.active) throw new Rejected(409);
    await this.command("machine_acquire", { config: this.config });
    this.active = true;
    return this.listenGateway(host, port);
  }
  async lifecycleMode(): Promise<"open" | "closed" | "restore_required"> {
    const result = await this.command<{ mode: string }>("machine_coordinator_status");
    if (!["open", "closed", "restore_required"].includes(result.mode)) throw new Rejected(503);
    return result.mode as "open" | "closed" | "restore_required";
  }
  /** One-way in this process: reopening requires explicit operator restart. */
  async enterReportingOnly(): Promise<void> {
    if (await this.lifecycleMode() === "open") throw new Rejected(409);
    this.active = false;
  }
  async listenReportingOnly(host = "127.0.0.1", port = 0): Promise<string> {
    if (this.server || this.active) throw new Rejected(409);
    await this.enterReportingOnly();
    return this.listenGateway(host, port);
  }
  private async listenGateway(host: string, port: number): Promise<string> {
    const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, (req, res) => { void this.handle(req, res); });
    server.maxRequestsPerSocket = 100;
    server.timeout = 10000;
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.removeListener("error", reject); resolve(); }); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Rejected(503);
      return `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
    } catch { await this.close(); throw new Rejected(503); }
  }
  async pulse(): Promise<{ generation: number }> {
    if (!this.active) throw new Rejected(503);
    return this.command("machine_pulse");
  }
  async close(): Promise<void> {
    const server = this.server; this.server = undefined;
    if (server) await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    if (this.active) { this.active = false; try { await this.command("machine_release"); } catch { /* A fenced owner must not release its successor. */ } }
  }
  /** Privileged in-process producer seam ONLY; deliberately absent from HTTP. */
  async prepareAttempt(agentId: string, payloadHash: string): Promise<Attempt> {
    if (!this.active || !matches(agentId, /^[a-z0-9]{15}$/) || !matches(payloadHash, /^[a-f0-9]{64}$/)) throw new Rejected(400);
    return this.command("machine_prepare", { agentId, payloadHash });
  }
  private async resetCommand<T>(operation: string, data: object = {}): Promise<T> {
    if (!this.active) throw new Rejected(503);
    try {
      return await this.pb.send<T>("/api/wts/checkin-recovery", { method: "POST", body: { ...data, operation, owner: this.owner, ...this.clockOverride() }, requestKey: null, signal: AbortSignal.timeout(5000) });
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new Rejected(status && [400, 403, 409].includes(status) ? status : 503);
    }
  }
  /** Privileged producer only: the committed claim is the durable possibly-sent fence. */
  async claimReset(): Promise<ResetJob | null> {
    const result = await this.resetCommand<unknown>("machine_reset_claim");
    if (!shape(result, ["job"])) throw new Rejected(503);
    return result.job === null ? null : validResetJob(result.job);
  }
  async recordResetResult(resetId: string, outcome: ResetOutcome): Promise<{ resetId: string; state: ResetOutcome }> {
    if (!matches(resetId, /^[a-z0-9]{15}$/) || !["deleted", "uncertain", "identity_changed"].includes(outcome)) throw new Rejected(400);
    const result = await this.resetCommand<unknown>("machine_reset_result", { resetId, outcome });
    if (!shape(result, ["resetId", "state"]) || result.resetId !== resetId || result.state !== outcome) throw new Rejected(503);
    return { resetId, state: outcome };
  }
  private async fenceResetDelete(job: ResetJob): Promise<void> {
    if (!this.active) throw new Rejected(503);
    const result = await this.pb.send<unknown>("/api/wts/checkin-reset-fence", {
      // This endpoint requires nowMs in its exact shape but already ignores it
      // for authority, using the backend clock unconditionally.
      method: "POST", body: { operation: "machine_reset_fence", owner: this.owner, nowMs: this.now?.() ?? Date.now(), job },
      requestKey: null, signal: AbortSignal.timeout(5000),
    });
    if (!shape(result, ["resetId", "authorized"]) || result.resetId !== job.resetId || result.authorized !== true) throw new Rejected(503);
  }
  /** Claim is nonreplayable; fresh inspection must precede the one-time send grant. */
  async processResets(transport: ResetTransport, limit = 10): Promise<number> {
    // Reject the legacy one-argument contract rather than silently allowing unfenced DELETE.
    if (typeof transport?.reset !== "function" || transport.reset.length < 2) throw new Rejected(400);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Rejected(400);
    let processed = 0;
    while (processed < limit) {
      const job = await this.claimReset();
      if (!job) break;
      let outcome: ResetOutcome = "uncertain";
      let attempted = false, granted = false, finished = false;
      try {
        const value = await transport.reset(structuredClone(job), async () => {
          if (attempted || finished) throw new Rejected(409);
          attempted = true; // Even a lost grant response consumes this callback.
          await this.fenceResetDelete(job);
          granted = true;
        });
        if (value === "uncertain" || value === "identity_changed" && !attempted || value === "deleted" && granted) outcome = value;
      } catch { /* A timeout/crash/lost fence or DELETE response never permits a retry. */ }
      finally { finished = true; }
      await this.recordResetResult(job.resetId, outcome);
      processed++;
    }
    return processed;
  }
  /** Claim one reserved arrival and persist its possibly-sent boundary. */
  async claimAdmission(): Promise<AdmissionJob | null> {
    if (!this.active) throw new Rejected(503);
    const result = await this.admissionCommand<{ job: AdmissionJob | null }>("machine_admission_claim");
    return result.job;
  }
  /** Complete an admission attempt after the external response is classified. */
  async recordAdmissionResult(attemptId: string, outcome: AdmissionOutcome): Promise<{ attemptId: string; state: string }> {
    if (!this.active || !matches(attemptId, /^[a-z0-9]{15}$/)) throw new Rejected(400);
    return this.admissionCommand("machine_admission_result", { attemptId, outcome });
  }
  private async fenceAdmissionSend(job: AdmissionJob): Promise<void> {
    await this.admissionCommand("machine_admission_fence", { attemptId: job.attemptId, coordinatorGeneration: job.coordinatorGeneration });
  }
  private async releaseAdmission(job: AdmissionJob, error?: unknown): Promise<void> {
    await this.admissionCommand("machine_admission_release", { attemptId: job.attemptId, retryAfterMs: error instanceof CheckinReadError ? error.retryAfterMs : 0, retryBlocked: error instanceof CheckinReadError && error.retryBlocked });
  }
  /** Stage queued initial labels as agent-owned work; the agent performs USB I/O. */
  async claimPrints(limit = 10): Promise<number> {
    if (!this.active || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Rejected(400);
    const result = await this.command<{ claimed: number }>("machine_print_claim", { limit });
    if (!Number.isSafeInteger(result.claimed) || result.claimed < 0 || result.claimed > limit) throw new Rejected(503);
    return result.claimed;
  }
  private async reconcileAdmissions(): Promise<void> {
    await this.admissionCommand("machine_admission_reconcile");
  }
  /** Process bounded work in the coordinator process; never exposed by its HTTP server. */
  async processAdmissions(processor: AdmissionProcessor, limit = 10): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Rejected(400);
    await this.reconcileAdmissions();
    let processed = 0;
    while (processed < limit) {
      const job = await this.claimAdmission();
      if (!job) break;
      let outcome: AdmissionOutcome | null = null;
      let sendFenced = false;
      try {
        const attendee = await processor.attendee(job);
        if (!attendee) {
          await this.releaseAdmission(job);
        } else if (attendee.eligibility && attendee.eligibility !== "eligible") {
          outcome = { state: "rejected", reason: attendee.eligibility };
        } else {
          await this.fenceAdmissionSend(job);
          sendFenced = true;
          outcome = attendee.alreadyCheckedIn
            ? { state: "existing_unattributed", fingerprint: createHash("sha256").update(`wts2026:existing:${job.upstreamEventId}:${job.upstreamAttendeeId}:${job.upstreamListId}`).digest("hex") }
            : await processor.admit(job, attendee);
        }
      } catch (error) {
        if (sendFenced) outcome = { state: "uncertain" };
        else try { await this.releaseAdmission(job, error); } catch { /* A failed release is recovered by the next coordinator generation. */ }
      }
      if (outcome) {
        try { await this.recordAdmissionResult(job.attemptId, outcome); }
        catch (error) {
          if (!sendFenced) throw error;
          await this.reconcileAdmissions();
        }
      }
      processed++;
      if (!outcome) break;
    }
    return processed;
  }
  async machine<K extends Operation>(credential: string, operation: K, payload: unknown): Promise<Replies[K]> {
    if (!matches(credential, /^wts_agent_[a-f0-9]{64}$/)) throw new Rejected(403);
    validate(operation, payload);
    const credentialHash = createHash("sha256").update(`wts2026:agent:${credential}`).digest("hex");
    if (operation === "policy" || operation === "purge_complete") {
      try {
        return await this.pb.send<Replies[K]>("/api/wts/checkin-lifecycle-proxy", { method: "POST", body: { operation: `machine_${operation}`, credentialHash, payload }, requestKey: null, signal: AbortSignal.timeout(5000) });
      } catch (error) {
        const status = (error as { status?: number }).status;
        throw new Rejected(status && [400, 403, 409].includes(status) ? status : 503);
      }
    }
    if (!this.active && !["status", "outcome", "cancellations", "neutralized"].includes(operation)) throw new Rejected(503);
    return this.command(`machine_${operation}`, { credentialHash, payload });
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, value: unknown) => {
      const body = JSON.stringify(value);
      if (Buffer.byteLength(body) > 16384) return reply(503, { error: "Agent request rejected." });
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }); res.end(body);
    };
    try {
      if (req.method !== "POST" || req.url !== "/v1/agent") throw new Rejected(404);
      if (req.headers.cookie !== undefined || req.headers.origin !== undefined || req.headers["sec-fetch-site"] !== undefined || !matches(req.headers.authorization, /^Bearer wts_agent_[a-f0-9]{64}$/)) throw new Rejected(403);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] || "")) throw new Rejected(415);
      if (Number(req.headers["content-length"]) > 8192) throw new Rejected(413);
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new Rejected(413); chunks.push(Buffer.from(chunk)); }
      let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Rejected(400); }
      if (!shape(body, ["operation", "payload"]) || typeof body.operation !== "string") throw new Rejected(400);
      validate(body.operation, body.payload);
      reply(200, await this.machine(req.headers.authorization!.slice(7), body.operation, body.payload));
    } catch (error) { reply(error instanceof Rejected ? error.status : 503, { error: "Agent request rejected." }); }
  }
}
