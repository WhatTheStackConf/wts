import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { readConfig } from "./config.js";
import { migrate, provisionClient } from "./migration.js";
import { ImportFailure, importSnapshot } from "./import.js";
import { exportPocketBase } from "./export-pocketbase.js";

async function readPrivateFile(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error("Credential files must be private regular files owned by this user.");
    return await file.readFile("utf8");
  } finally { await file.close(); }
}

async function main() {
  const command = process.argv[2];
  if (!command || !["migrate", "client", "import", "export-pocketbase"].includes(command)) throw new Error("Select migrate, client, import, or export-pocketbase.");
  const { values, positionals } = parseArgs({ args: process.argv.slice(3), strict: true, allowPositionals: false, options: {
    manifest: { type: "string" }, "secret-file": { type: "string" }, snapshot: { type: "string" },
    "dry-run": { type: "boolean", default: false }, database: { type: "string" }, output: { type: "string" },
    "source-version": { type: "string" }, "avatar-base": { type: "string" }, "offline-backup": { type: "boolean", default: false },
  } });
  if (positionals.length) throw new Error("Unexpected command arguments.");
  if (command === "export-pocketbase") {
    if (!values.database || !values.output || !values["source-version"]) throw new Error("Set the offline backup, output, and source version.");
    return exportPocketBase({ database: values.database, output: values.output, sourceVersion: values["source-version"], avatarBase: values["avatar-base"], offlineBackup: values["offline-backup"] });
  }
  const config = readConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
  try {
    switch (command) {
      case "migrate": return await migrate(pool, config.origin);
      case "client": {
        if (!values.manifest || !values["secret-file"]) throw new Error("Set the client manifest and private secret file.");
        const manifestFile = await open(values.manifest, constants.O_RDONLY | constants.O_NOFOLLOW);
        let manifest: unknown;
        try { manifest = JSON.parse(await manifestFile.readFile("utf8")); } finally { await manifestFile.close(); }
        const secret = (await readPrivateFile(values["secret-file"])).replace(/\r?\n$/, "");
        return await provisionClient(pool, config, manifest, secret);
      }
      case "import": {
        if (!values.snapshot) throw new Error("Set the private snapshot file.");
        const snapshot: unknown = JSON.parse(await readPrivateFile(values.snapshot));
        return await importSnapshot(pool, config.origin, snapshot, values["dry-run"]);
      }
      default: throw new Error("The command is invalid.");
    }
  } finally { await pool.end(); }
}

try {
  const report = await main();
  process.stdout.write(JSON.stringify(report) + "\n");
} catch (error) {
  const report = error instanceof ImportFailure
    ? { status: "failed", error: error.code, message: error.message }
    : { status: "failed", error: "operation_failed", message: "The auth command failed. Check its private inputs and database policy." };
  process.stderr.write(JSON.stringify(report) + "\n");
  process.exitCode = 1;
}
