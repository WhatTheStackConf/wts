import { DatabaseSync } from "node:sqlite";
import { closeSync, openSync, fsyncSync, lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { AgentError, validIdentity, validWork, type AgentIdentity, type JournalAttempt } from "./protocol.js";

interface State { generation: 1; identity: AgentIdentity; sequence: number; attempts: JournalAttempt[] }
function digest(data: string) { return createHash("sha256").update(data).digest("hex"); }
function identityKey(identity: AgentIdentity) { return JSON.stringify(Object.entries(identity).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)); }

/** File-backed, FULL synchronous transactions. Creation is explicitly separate from recovery. */
export class AgentJournal {
  private db!: DatabaseSync;
  private state!: State;
  private inode: number;
  private device: number;
  private path: string;
  static provision(path: string, identity: AgentIdentity): void {
    validIdentity(identity);
    if (path === ":memory:") throw new AgentError("invalid_config");
    let fd: number;
    try { fd = openSync(path, "wx", 0o600); } catch { throw new AgentError("journal_exists"); }
    fsyncSync(fd); closeSync(fd);
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE journal (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, digest TEXT NOT NULL)");
      const state: State = { generation: 1, identity: { ...identity }, sequence: 1, attempts: [] };
      const data = JSON.stringify(state);
      db.prepare("INSERT INTO journal VALUES (1, ?, ?)").run(data, digest(data));
    } finally { db.close(); }
    const dir = openSync(dirname(resolve(path)), "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  constructor(path: string, identity: AgentIdentity) {
    validIdentity(identity); this.path = resolve(path);
    let stat;
    try { stat = lstatSync(this.path); } catch { throw new AgentError("journal_lost"); }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new AgentError("journal_corrupt");
    this.inode = stat.ino; this.device = stat.dev;
    try {
      this.db = new DatabaseSync(this.path, { readOnly: false });
      this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000");
      const check = this.db.prepare("PRAGMA integrity_check").get();
      if (!check || Object.values(check)[0] !== "ok") throw new Error();
      const row = this.db.prepare("SELECT data, digest FROM journal WHERE id=1").get();
      if (!row || typeof row.data !== "string" || digest(row.data) !== row.digest) throw new Error();
      const state = JSON.parse(row.data) as State;
      if (state.generation !== 1 || !Number.isSafeInteger(state.sequence) || state.sequence < 1 || !Array.isArray(state.attempts)) throw new Error();
      validIdentity(state.identity);
      for (const attempt of state.attempts) {
        validWork({ attemptId: attempt.attemptId, profileId: attempt.profileId, payloadHash: attempt.payloadHash });
        if (!["received", "authorized", "possibly_starting", "started", "reported"].includes(attempt.state)) throw new Error();
      }
      if (identityKey(state.identity) !== identityKey(identity)) throw new AgentError("journal_restored");
      this.state = state;
    } catch (error) {
      this.db?.close();
      throw error instanceof AgentError && error.category === "journal_restored" ? error : new AgentError("journal_corrupt");
    }
  }
  private checkFile() {
    try { const stat = lstatSync(this.path); if (stat.ino !== this.inode || stat.dev !== this.device || !stat.isFile()) throw new AgentError("journal_restored"); }
    catch (error) { throw error instanceof AgentError ? error : new AgentError("journal_lost"); }
  }
  private save(next: State) {
    this.checkFile();
    next.sequence++;
    if (!Number.isSafeInteger(next.sequence)) throw new AgentError("journal_corrupt");
    const data = JSON.stringify(next);
    try {
      this.db.exec("BEGIN IMMEDIATE");
      // Detect another owner or a stale/replaced snapshot even before a heartbeat.
      const result = this.db.prepare("UPDATE journal SET data=?, digest=? WHERE id=1 AND digest=?").run(data, digest(data), digest(JSON.stringify(this.state)));
      if (result.changes !== 1) throw new Error();
      this.db.exec("COMMIT"); this.state = next;
    } catch { try { this.db.exec("ROLLBACK"); } catch { /* fail closed */ } throw new AgentError("journal_corrupt"); }
  }
  snapshot() { this.checkFile(); return { journalState: "healthy" as const, journalSequence: this.state.sequence, journalDigest: digest(JSON.stringify(this.state)) }; }
  heartbeat() { this.save(structuredClone(this.state)); return this.snapshot(); }
  get(attemptId: string): JournalAttempt | undefined { this.checkFile(); return structuredClone(this.state.attempts.find(a => a.attemptId === attemptId)); }
  pending(): JournalAttempt[] { this.checkFile(); return structuredClone(this.state.attempts); }
  put(attempt: JournalAttempt): void {
    const next = structuredClone(this.state);
    const index = next.attempts.findIndex(a => a.attemptId === attempt.attemptId);
    if (index >= 0) {
      const old = next.attempts[index];
      const transitions: Record<JournalAttempt["state"], JournalAttempt["state"][]> = {
        received: ["received", "authorized"], authorized: ["authorized", "possibly_starting"],
        possibly_starting: ["possibly_starting", "started", "reported"], started: ["started", "reported"], reported: ["reported"],
      };
      if (!transitions[old.state].includes(attempt.state)) throw new AgentError("attempt_conflict");
      if (old.profileId !== attempt.profileId || old.payloadHash !== attempt.payloadHash || (old.authorizationHash && old.authorizationHash !== attempt.authorizationHash) || (old.outcome && old.outcome !== attempt.outcome)) throw new AgentError("attempt_conflict");
      next.attempts[index] = structuredClone(attempt);
    } else next.attempts.push(structuredClone(attempt));
    this.save(next);
  }
  close() { this.db.close(); }
}
