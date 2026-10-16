import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../pocketbase/sync-to-listmonk.sh", import.meta.url);
const fakeCurl = `#!/bin/bash
url="" data="" prev=""
for arg in "$@"; do
  [ "$prev" = "-d" ] && data="$arg"
  case "$arg" in http*) url="$arg" ;; esac
  prev="$arg"
done
case "$url" in
  */auth-with-password) echo '{"token":"fixture-token"}' ;;
  */api/collections/users/records*) cat "$FIXTURE/users.json" ;;
  */api/subscribers) printf '%s\\n' "$data" >> "$FIXTURE/subscribers.log"; printf 200 ;;
esac
`;

function runSync(users, extraEnv = []) {
  const root = mkdtempSync(join(tmpdir(), "wts-listmonk-sync-"));
  try {
    mkdirSync(join(root, "repo", "pocketbase"), { recursive: true });
    mkdirSync(join(root, "bin"));
    copyFileSync(script, join(root, "repo", "pocketbase", "sync-to-listmonk.sh"));
    writeFileSync(join(root, "bin", "curl"), fakeCurl);
    chmodSync(join(root, "bin", "curl"), 0o755);
    writeFileSync(join(root, "repo", ".env.local"), [
      "POCKETBASE_SUPERUSER_EMAIL=root@example.test", "POCKETBASE_SUPERUSER_PASSWORD=pw",
      "LISTMONK_USERNAME=sync", "LISTMONK_API_TOKEN=tok", ...extraEnv, "",
    ].join("\n"));
    writeFileSync(join(root, "users.json"), JSON.stringify({ totalItems: users.length, totalPages: 1, items: users }));
    writeFileSync(join(root, "subscribers.log"), "");
    const run = spawnSync("env", [
      "-i", `PATH=${join(root, "bin")}:/usr/bin:/bin`, `HOME=${root}`, `FIXTURE=${root}`,
      "bash", join(root, "repo", "pocketbase", "sync-to-listmonk.sh"),
    ], { encoding: "utf8" });
    const posted = readFileSync(join(root, "subscribers.log"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return { status: run.status, stdout: run.stdout, posted: posted.map(({ email, name }) => ({ email, name })), lists: posted.map(({ lists }) => lists) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("skips users without an email instead of posting their name as the email", () => {
  const result = runSync([
    { email: "", name: "Nobody" },
    { email: "ann@example.test", name: "Ann Lee" },
    { email: "solo@example.test" },
  ]);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(result.posted, [
    { email: "ann@example.test", name: "Ann Lee" },
    { email: "solo@example.test", name: "" },
  ]);
  assert.match(result.stdout, /Synced: {2}2\n/);
});

test("subscribes to LISTMONK_LIST_ID from the env file", () => {
  const result = runSync([{ email: "ann@example.test", name: "Ann Lee" }], ["LISTMONK_LIST_ID=7"]);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(result.lists, [[7]]);
});

test("subscribes to list 2 when the env file sets no LISTMONK_LIST_ID", () => {
  const result = runSync([{ email: "ann@example.test", name: "Ann Lee" }]);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(result.lists, [[2]]);
});
