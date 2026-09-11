import { DatabaseSync } from "node:sqlite";
import { closeSync, openSync, fsyncSync, lstatSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { AgentError, validIdentity, validPrintPayload, validWork, type AgentIdentity, type JournalAttempt } from "./protocol.js";

interface ProfileAdoption { previousProfileId: string; profileId: string; path: string; sequence: number; previousDigest: string }
interface State { generation: 1; identity: AgentIdentity; sequence: number; attempts: JournalAttempt[]; profileAdoption?: ProfileAdoption }
export interface ProfileAdoptionReceipt {
  category: "journal_profile_adopted"; previousProfileId: string; profileId: string;
  journalSequence: number; journalDigest: string; replayed: boolean;
}
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
  /** Offline, first-use metadata transition; never an identity-check bypass on startup. */
  static adoptProfile(path: string, previousIdentity: AgentIdentity, newProfileId: string): ProfileAdoptionReceipt {
    validIdentity(previousIdentity);
    if (typeof newProfileId !== "string" || !/^[a-z0-9]{15}$/.test(newProfileId) || newProfileId === previousIdentity.profileId) throw new AgentError("invalid_profile");
    const nextIdentity = { ...previousIdentity, profileId: newProfileId };
    let journal: AgentJournal;
    try { journal = new AgentJournal(path, previousIdentity); }
    catch (error) {
      if (!(error instanceof AgentError) || error.category !== "journal_restored") throw error;
      // Only the explicit command can check the new identity for a lost-receipt replay.
      journal = new AgentJournal(path, nextIdentity);
    }
    try {
      journal.checkFile();
      if (lstatSync(journal.path).nlink !== 1 || realpathSync(journal.path) !== journal.path) throw new AgentError("journal_corrupt");
      if (journal.state.profileAdoption && journal.state.profileAdoption.path !== journal.path) throw new AgentError("journal_restored");
      journal.db.exec("BEGIN IMMEDIATE");
      const currentData = JSON.stringify(journal.state);
      const previousDigest = digest(currentData);
      const row = journal.db.prepare("SELECT data, digest FROM journal WHERE id=1").get();
      if (!row || row.data !== currentData || row.digest !== previousDigest) throw new AgentError("journal_corrupt");
      // pending() intentionally includes settled history. No attempt is eligible.
      if (journal.state.attempts.length !== 0) throw new AgentError("journal_not_empty");
      const replayed = identityKey(journal.state.identity) === identityKey(nextIdentity);
      if (replayed) {
        const adoption = journal.state.profileAdoption;
        if (!adoption || adoption.previousProfileId !== previousIdentity.profileId || adoption.profileId !== newProfileId || adoption.path !== journal.path) throw new AgentError("journal_restored");
      } else {
        const next = structuredClone(journal.state);
        next.sequence++;
        if (!Number.isSafeInteger(next.sequence)) throw new AgentError("journal_corrupt");
        next.identity = nextIdentity;
        next.profileAdoption = { previousProfileId: previousIdentity.profileId, profileId: newProfileId, path: journal.path, sequence: next.sequence, previousDigest };
        const data = JSON.stringify(next);
        const result = journal.db.prepare("UPDATE journal SET data=?, digest=? WHERE id=1 AND digest=?").run(data, digest(data), previousDigest);
        if (result.changes !== 1) throw new AgentError("journal_corrupt");
        journal.state = next;
      }
      journal.checkFile();
      journal.db.exec("COMMIT");
      return { category: "journal_profile_adopted", previousProfileId: previousIdentity.profileId, profileId: newProfileId, journalSequence: journal.state.sequence, journalDigest: digest(JSON.stringify(journal.state)), replayed };
    } catch (error) {
      try { journal.db.exec("ROLLBACK"); } catch { /* fail closed */ }
      throw error instanceof AgentError ? error : new AgentError("journal_corrupt");
    } finally { journal.close(); }
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
      if (state.profileAdoption !== undefined) {
        const a = state.profileAdoption;
        if (!a || Object.keys(a).length !== 5 || !["previousProfileId", "profileId", "path", "sequence", "previousDigest"].every(key => Object.hasOwn(a, key)) || typeof a.profileId !== "string" || a.profileId.length !== 15 || !/^[a-z0-9]{15}$/.test(a.profileId) || a.profileId !== state.identity.profileId || a.previousProfileId === a.profileId || typeof a.path !== "string" || resolve(a.path) !== a.path || !Number.isSafeInteger(a.sequence) || a.sequence < 2 || a.sequence > state.sequence || typeof a.previousDigest !== "string" || !/^[a-f0-9]{64}$/.test(a.previousDigest)) throw new Error();
        validIdentity({ ...state.identity, profileId: a.previousProfileId });
      }
      for (const attempt of state.attempts) {
        validWork({ attemptId: attempt.attemptId, profileId: attempt.profileId, payloadHash: attempt.payloadHash, ...(attempt.payload ? { payload: attempt.payload } : {}) });
        if (!["received", "authorized", "possibly_starting", "started", "possibly_printing", "reported", "cancelled"].includes(attempt.state)) throw new Error();
        if (attempt.payload) validPrintPayload(attempt.payload);
        this.validateCancellation(attempt);
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
  private validateCancellation(attempt: JournalAttempt) {
    const c = attempt.cancellation;
    if (c && (!Object.keys(c).every(key => ["cancellationId", "disposition", "acknowledged", "startState"].includes(key)) || !/^[a-z0-9]{15}$/.test(c.cancellationId) || typeof c.acknowledged !== "boolean" || !["neutralized", "settled"].includes(c.disposition) || (c.startState !== undefined && (c.startState !== "not_started" || c.disposition !== "neutralized")) || (c.disposition === "neutralized" ? attempt.state !== "cancelled" : attempt.state !== "reported"))) throw new AgentError("attempt_conflict");
    if (attempt.state === "cancelled" && !c) throw new AgentError("attempt_conflict");
  }
  put(attempt: JournalAttempt): void {
    validWork({ attemptId: attempt.attemptId, profileId: attempt.profileId, payloadHash: attempt.payloadHash, ...(attempt.payload ? { payload: attempt.payload } : {}) });
    this.validateCancellation(attempt);
    const next = structuredClone(this.state);
    const index = next.attempts.findIndex(a => a.attemptId === attempt.attemptId);
    if (index >= 0) {
      const old = next.attempts[index];
      const transitions: Record<JournalAttempt["state"], JournalAttempt["state"][]> = {
        received: ["received", "authorized", "cancelled"], authorized: ["authorized", "possibly_starting", "cancelled"], cancelled: ["cancelled"],
        possibly_starting: ["possibly_starting", "started", "reported"], started: ["started", "possibly_printing", "reported"], possibly_printing: ["possibly_printing", "reported"], reported: ["reported"],
      };
      const provedUnstarted = old.state === "possibly_starting" && attempt.state === "cancelled" && attempt.cancellation?.startState === "not_started";
      if (!provedUnstarted && !transitions[old.state].includes(attempt.state)) throw new AgentError("attempt_conflict");
      if (old.profileId !== attempt.profileId || old.payloadHash !== attempt.payloadHash || JSON.stringify(old.payload) !== JSON.stringify(attempt.payload) || (old.authorizationHash && old.authorizationHash !== attempt.authorizationHash) || (old.outcome && old.outcome !== attempt.outcome)) throw new AgentError("attempt_conflict");
      if (old.authorization && JSON.stringify(old.authorization) !== JSON.stringify(attempt.authorization)) throw new AgentError("attempt_conflict");
      if (old.cancellation && (!attempt.cancellation || old.cancellation.cancellationId !== attempt.cancellation.cancellationId || old.cancellation.disposition !== attempt.cancellation.disposition || old.cancellation.startState !== attempt.cancellation.startState || (old.cancellation.acknowledged && !attempt.cancellation.acknowledged))) throw new AgentError("attempt_conflict");
      next.attempts[index] = structuredClone(attempt);
    } else next.attempts.push(structuredClone(attempt));
    this.save(next);
  }
  close() { this.db.close(); }
}
