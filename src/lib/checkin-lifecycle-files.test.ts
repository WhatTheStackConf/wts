import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vite-plus/test";
import { AgentJournal } from "../../runtime/checkin/journal";
import { retireCheckinJournal, localLifecycleMode, canRequestActiveAuthority, expireFeatureBackups } from "../../runtime/checkin/checkin-lifecycle-purge";

it("compacts the actual file journal at the deadline, retires spools and rejects restored stale history", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-lifecycle-local-"));
  const journalPath = join(root, "journal.sqlite");
  const identity = { stationId: "wts2026station1", agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: "test-profile" };
  const deadline = "2026-10-10T00:00:00.000Z";
  const policy = { edition: "WTS2026" as const, mode: "purge_only" as const, purgeDeadline: deadline, purgeToken: "a".repeat(48), stationId: identity.stationId, journalIdentity: identity.journalIdentity };
  try {
    AgentJournal.provision(journalPath, identity);
    const db = new DatabaseSync(journalPath);
    // Preserve the actual journal table/file shape; inject a synthetic sensitive
    // body to prove compaction removes bytes even from invalid/restored history.
    const data = JSON.stringify({ identity, sensitive: "Synthetic Attendee Secret ".repeat(500) });
    db.prepare("UPDATE journal SET data=?,digest=?").run(data, createHash("sha256").update(data).digest("hex")); db.close();
    mkdirSync(join(root, "spool")); writeFileSync(join(root, "spool", "label.raster"), "Synthetic Raster Secret");
    copyFileSync(journalPath, join(root, "stale.backup"));
    let quiesced = 0;
    const retire = (nowMs: number) => retireCheckinJournal({ root, journalName: "journal.sqlite", policy, nowMs, quiesce: async () => { quiesced++; } });
    expect(await retire(Date.parse(deadline) - 1)).toBeNull();
    expect(readFileSync(journalPath).includes(Buffer.from("Synthetic Attendee Secret"))).toBe(true);
    const receipt = await retire(Date.parse(deadline));
    expect(receipt?.method).toBe("retired_and_compacted"); expect(quiesced).toBe(1);
    expect(readFileSync(journalPath).includes(Buffer.from("Synthetic Attendee Secret"))).toBe(false);
    expect(existsSync(join(root, "spool", "label.raster"))).toBe(false);
    expect(() => new AgentJournal(journalPath, identity)).toThrow();
    copyFileSync(join(root, "stale.backup"), journalPath);
    expect(localLifecycleMode(root)).toBe("purge_only");
    await retire(Date.parse(deadline) + 1);
    expect(readFileSync(journalPath).includes(Buffer.from("Synthetic Attendee Secret"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it.each([false, true])("retires a spool completed during quiescence (directory already existed: %s)", async (existingDirectory) => {
  const root = mkdtempSync(join(tmpdir(), "wts-lifecycle-late-spool-"));
  const identity = { stationId: "wts2026station1", agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "late-spool-journal", profileId: "test-profile" };
  const policy = { edition: "WTS2026" as const, mode: "purge_only" as const, purgeDeadline: "2026-10-10T00:00:00.000Z", purgeToken: "a".repeat(48), stationId: identity.stationId, journalIdentity: identity.journalIdentity };
  try {
    AgentJournal.provision(join(root, "journal.sqlite"), identity);
    if (existingDirectory) mkdirSync(join(root, "spool"));
    const receipt = await retireCheckinJournal({ root, journalName: "journal.sqlite", policy, nowMs: Date.parse(policy.purgeDeadline), quiesce: async () => {
      await Promise.resolve();
      mkdirSync(join(root, "spool"), { recursive: true });
      writeFileSync(join(root, "spool", "late.raster"), "Synthetic attendee raster from an in-flight task");
    } });
    expect(receipt?.method).toBe("retired_and_compacted");
    expect(existsSync(join(root, "spool", "late.raster"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it("refuses a retirement receipt if unexpected material appears during quiescence", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-lifecycle-unknown-spool-"));
  const identity = { stationId: "wts2026station1", agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "late-spool-journal", profileId: "test-profile" };
  const policy = { edition: "WTS2026" as const, mode: "purge_only" as const, purgeDeadline: "2026-10-10T00:00:00.000Z", purgeToken: "a".repeat(48), stationId: identity.stationId, journalIdentity: identity.journalIdentity };
  try {
    AgentJournal.provision(join(root, "journal.sqlite"), identity);
    await expect(retireCheckinJournal({ root, journalName: "journal.sqlite", policy, nowMs: Date.parse(policy.purgeDeadline), quiesce: async () => {
      mkdirSync(join(root, "spool")); writeFileSync(join(root, "spool", "unknown.txt"), "Preserve for explicit inventory");
    } })).rejects.toThrow("Unknown spool material");
    expect(readFileSync(join(root, "spool", "unknown.txt"), "utf8")).toBe("Preserve for explicit inventory");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it("expires synthetic feature-bearing backups by the fixed deadline without touching non-feature files", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-lifecycle-backup-"));
  try {
    writeFileSync(join(root, "feature.zip"), "Synthetic Attendee Backup");
    writeFileSync(join(root, "unrelated.txt"), "Keep");
    const manifest = [{ file: "feature.zip", edition: "WTS2026" as const, purgeDeadline: "2026-10-10T00:00:00.000Z" }];
    expect(expireFeatureBackups(root, manifest, Date.parse(manifest[0].purgeDeadline) - 1)).toEqual([]);
    expect(expireFeatureBackups(root, manifest, Date.parse(manifest[0].purgeDeadline))).toEqual(["feature.zip"]);
    expect(existsSync(join(root, "feature.zip"))).toBe(false);
    expect(readFileSync(join(root, "unrelated.txt"), "utf8")).toBe("Keep");
    expect(localLifecycleMode(join(root, "unknown"))).toBe("quarantined");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("refuses foreign identity, changed token, symlinks, missing/malformed journals and unrelated spools before deletion", async () => {
  const root = mkdtempSync(join(tmpdir(), "wts-lifecycle-boundary-"));
  const identity = { stationId: "station1", agentIdentity: "pi", printerIdentity: "printer", journalIdentity: "journal1", profileId: "profile" };
  const policy = { edition: "WTS2026" as const, mode: "purge_only" as const, purgeDeadline: "2026-10-10T00:00:00.000Z", purgeToken: "a".repeat(48), stationId: identity.stationId, journalIdentity: identity.journalIdentity };
  const path = join(root, "journal.sqlite");
  const retire = (p = policy, journalName = "journal.sqlite") => retireCheckinJournal({ root, journalName, policy: p, nowMs: Date.parse(policy.purgeDeadline), quiesce: async () => {} });
  try {
    expect(canRequestActiveAuthority(root)).toBe(true); // only permission to ask, NOT print
    await expect(retire()).rejects.toThrow();
    AgentJournal.provision(path, identity);
    const original = readFileSync(path);
    await expect(retire({ ...policy, journalIdentity: "foreign" })).rejects.toThrow();
    await expect(retire(policy, "../journal.sqlite")).rejects.toThrow();
    expect(readFileSync(path)).toEqual(original);
    expect(existsSync(join(root, "lifecycle-fence.json"))).toBe(false);
    mkdirSync(join(root, "spool"));
    writeFileSync(join(root, "keep.txt"), "Not a spool");
    symlinkSync(join(root, "keep.txt"), join(root, "spool", "label.raster"));
    await expect(retire()).rejects.toThrow();
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("Not a spool");
    rmSync(join(root, "spool", "label.raster"));
    writeFileSync(join(root, "spool", "unrelated.txt"), "Keep");
    await expect(retire()).rejects.toThrow();
    rmSync(join(root, "spool", "unrelated.txt"));
    // Interrupted quiescence leaves durable closure, no retirement receipt.
    await expect(retireCheckinJournal({ root, journalName: "journal.sqlite", policy, nowMs: Date.parse(policy.purgeDeadline), quiesce: async () => { throw new Error("crash"); } })).rejects.toThrow("crash");
    expect(localLifecycleMode(root)).toBe("purge_only");
    expect(canRequestActiveAuthority(root)).toBe(false);
    await expect(retire({ ...policy, purgeToken: "b".repeat(48) })).rejects.toThrow();
    const receipt = await retire();
    expect(await retire()).toEqual(receipt); // lost network receipt, offline restart
    writeFileSync(join(root, "lifecycle-fence.json"), "malformed");
    expect(canRequestActiveAuthority(root)).toBe(false);
    expect(localLifecycleMode(root)).toBe("quarantined");
    await expect(retire()).rejects.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
