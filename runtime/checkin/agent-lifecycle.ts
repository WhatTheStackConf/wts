import { lstatSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AgentJournal } from "./journal.js";
import type { AgentTransport } from "./agent.js";
import { AgentError, object, type AgentIdentity } from "./protocol.js";
import { retireCheckinJournal, type CheckinPurgePolicy } from "./checkin-lifecycle-purge.js";

type OpenMode = "active" | "reporting_only";

function safe(path: string, directory = false) {
  const s = lstatSync(path);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1)) throw new AgentError("lifecycle_unsafe_path");
}
function rethrowUnlessMissing(e: unknown) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
function safeIfPresent(path: string) {
  try { safe(path); } catch (e) { rethrowUnlessMissing(e); }
}
function verifyOwnedRoot(root: string) {
  for (let p = root; ; p = dirname(p)) { safe(p, true); if (dirname(p) === p) break; }
  const s = lstatSync(root);
  if (s.uid !== process.getuid?.() || (s.mode & 0o022)) throw new AgentError("lifecycle_unsafe_path");
}
function policy(value: unknown, identity: AgentIdentity): CheckinPurgePolicy {
  const p = object(value);
  if (p.edition !== "WTS2026" || p.mode !== "purge_only" || p.stationId !== identity.stationId || p.journalIdentity !== identity.journalIdentity || typeof p.purgeDeadline !== "string" || !Number.isFinite(Date.parse(p.purgeDeadline)) || typeof p.purgeToken !== "string" || !/^[A-Za-z0-9]{32,64}$/.test(p.purgeToken)) throw new AgentError("lifecycle_invalid_policy");
  // Explicit projection: never persist arbitrary server fields, payloads or secrets.
  return { edition: "WTS2026", mode: "purge_only", stationId: identity.stationId, journalIdentity: identity.journalIdentity, purgeDeadline: p.purgeDeadline, purgeToken: p.purgeToken };
}
function readFence(root: string, identity: AgentIdentity): CheckinPurgePolicy | null {
  const fence = join(root, "lifecycle-fence.json");
  try {
    safe(fence); const s = lstatSync(fence);
    if (s.uid !== process.getuid?.() || s.mode & 0o077 || s.size > 4096) throw new AgentError("lifecycle_invalid_policy");
    return policy(JSON.parse(readFileSync(fence, "utf8")), identity);
  } catch (e) { rethrowUnlessMissing(e); return null; }
}
/** CLI serial loop + service's outer flock own journal/USB for this lifetime. */
export class AgentLifecycle {
  private root: string;
  private path: string;
  private cached: CheckinPurgePolicy | null = null;
  constructor(path: string, private identity: AgentIdentity, private transport: AgentTransport) {
    this.path = resolve(path); this.root = dirname(this.path);
    try {
      verifyOwnedRoot(this.root);
      // Missing journals still fetch policy first, then the CLI's existing
      // journal-failure reporting path quarantines active devices. Never create.
      for (const suffix of ["", "-wal", "-shm", "-journal"]) safeIfPresent(this.path + suffix);
      this.cached = readFence(this.root, identity);
    } catch (e) { throw e instanceof AgentError ? e : new AgentError("lifecycle_journal_unverifiable"); }
  }
  private verifyJournal() {
    safe(this.path);
    const db = new DatabaseSync(this.path, { readOnly: true });
    let retired: unknown;
    try { retired = db.prepare("SELECT name FROM sqlite_master WHERE name='lifecycle_retired'").get(); } finally { db.close(); }
    // Preserve full AgentJournal identity, digest, schema and class fences.
    if (!retired) { const journal = new AgentJournal(this.path, this.identity); journal.close(); }
    else if (!this.cached) throw new AgentError("lifecycle_journal_unverifiable");
  }
  async check(quiesce: () => Promise<void>): Promise<OpenMode | "purge_only" | "retired"> {
    try {
      // A learned deadline is executable offline; do not wait for any network.
      if (!this.cached || Date.now() < Date.parse(this.cached.purgeDeadline)) {
        const open = await this.refreshPolicy();
        if (open) return open;
      }
      if (!this.cached) throw new AgentError("lifecycle_policy_unavailable");
      return await this.retire(this.cached, quiesce);
    } catch (e) { throw e instanceof AgentError ? e : new AgentError("lifecycle_journal_unverifiable"); }
  }
  /** The server's open mode, or null when no reply arrived or a purge policy now applies. */
  private async refreshPolicy(): Promise<OpenMode | null> {
    let response: unknown;
    try { response = await this.transport.request("policy", { stationId: this.identity.stationId, journalIdentity: this.identity.journalIdentity }); }
    catch (e) { if (!this.cached) throw e; }
    if (response === undefined) return null;
    const p = object(response);
    if (p.mode !== "purge_only") return this.openMode(p);
    const next = policy(p, this.identity);
    if (this.cached && JSON.stringify(next) !== JSON.stringify(this.cached)) throw new AgentError("lifecycle_policy_conflict");
    this.cached = next;
    return null;
  }
  private openMode(p: Record<string, unknown>): OpenMode {
    if (this.cached || Object.keys(p).length !== 4 || p.edition !== "WTS2026" || p.stationId !== this.identity.stationId || p.journalIdentity !== this.identity.journalIdentity || !["active", "reporting_only"].includes(String(p.mode))) throw new AgentError("lifecycle_invalid_policy");
    return p.mode as OpenMode;
  }
  private async retire(cached: CheckinPurgePolicy, quiesce: () => Promise<void>): Promise<"purge_only" | "retired"> {
    this.verifyJournal();
    const receipt = await retireCheckinJournal({ root: this.root, journalName: basename(this.path), policy: cached, nowMs: Date.now(), quiesce });
    if (!receipt) return "purge_only";
    try {
      const result = object(await this.transport.request("purge_complete", { ...receipt }));
      const confirmed = policy(result, this.identity);
      if (JSON.stringify(confirmed) !== JSON.stringify(cached) || result.completed !== true) throw new AgentError("lifecycle_invalid_receipt");
      console.log("agent_purge_complete");
    } catch { console.log("agent_purge_receipt_pending"); }
    return "retired";
  }
}
