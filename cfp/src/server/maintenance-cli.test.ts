import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/cfp-data.ts", import.meta.url));
const usage = "Use one CFP maintenance command:\nmigrate\ninit EDITION\nopen EDITION\nclose EDITION\nbootstrap-admin EDITION WTS_USER_ID\nmail-tick\nmail-resume EDITION JOB_ID [JOB_ID ...]\nbackup NEW_DIRECTORY\nrestore BACKUP_DIRECTORY NEW_DIRECTORY\n";

function cli(dataDir: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, ...args], {
    env: { PATH: process.env.PATH, CFP_DATA_DIR: dataDir, CFP_EDITION_ID: "2027", CFP_MAIL_MODE: "disabled", NODE_ENV: "test" }, encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

test("the maintenance CLI reports usage for unknown commands and wrong argument counts", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-cli-"));
  try {
    const data = join(root, "data");
    for (const args of [[], ["nope"], ["toString"], ["migrate", "extra"], ["init"], ["init", ""], ["open", "2027", "x"], ["bootstrap-admin", "2027"], ["mail-tick", "x"], ["mail-resume", "2027"], ["backup"], ["restore", "a"]]) {
      assert.deepEqual(cli(data, ...args), { stdout: "", stderr: usage, status: 1 }, args.join(" "));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the maintenance CLI prints each command outcome and fails closed with the error message", () => {
  const root = mkdtempSync(join(tmpdir(), "wts-cfp-cli-"));
  try {
    const data = join(root, "data");
    const ok = (stdout: string) => ({ stdout: `${stdout}\n`, stderr: "", status: 0 });
    const failed = (stderr: string) => ({ stdout: "", stderr: `${stderr}\n`, status: 1 });
    assert.deepEqual(cli(data, "migrate"), ok("The CFP schema is current."));
    assert.deepEqual(cli(data, "init", "2027"), ok("The CFP edition is initialized. New editions remain closed."));
    assert.deepEqual(cli(data, "open", "2027"), ok("The CFP edition is open."));
    assert.deepEqual(cli(data, "close", "2027"), ok("The CFP edition is closed."));
    assert.deepEqual(cli(data, "bootstrap-admin", "2027", "ghost"), failed("The exact WTS user ID needs an existing local OIDC binding."));
    const db = new DatabaseSync(join(data, "cfp.sqlite"));
    try {
      db.prepare("INSERT INTO cfp_accounts VALUES (?,?)").run("admin", 1);
      db.prepare("INSERT INTO oidc_bindings VALUES (?,?,?,?)").run("https://identity.example.test", "subject", "admin", 1);
    } finally { db.close(); }
    assert.deepEqual(cli(data, "bootstrap-admin", "2027", "admin"), ok('{"editionId":"2027","wtsUserId":"admin","role":"admin","state":"active","revision":1}'));
    assert.deepEqual(cli(data, "mail-tick"), ok('{"reportsCreated":0,"sent":0,"failed":0,"suspended":0,"disabled":true}'));
    assert.deepEqual(cli(data, "mail-resume", "2027", "a".repeat(64)), failed("Select suspended jobs from the named edition."));
    assert.deepEqual(cli(data, "mail-resume", "2027", "a".repeat(64), "a".repeat(64)), failed("Supply each mail job ID once."));
    const backup = join(root, "backup");
    assert.deepEqual(cli(data, "backup", backup), ok("The CFP backup is complete."));
    assert.deepEqual(cli(data, "restore", backup, data), failed("Restore only into a new directory."));
    assert.deepEqual(cli(data, "restore", backup, join(root, "restored")), ok("The CFP restore is complete. Sessions and flows are cleared. Both gates are closed. Staff grants are disabled. Unsent mail remains suspended."));
    assert.deepEqual(cli("", "migrate"), failed("Set CFP_DATA_DIR before opening the CFP database."));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
