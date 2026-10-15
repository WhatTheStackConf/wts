import { backup, initializeEdition, migrate, restore, setCfpOpen } from "../src/server/storage.ts";
import { bootstrapAdmin } from "../src/server/staff.ts";
import { resumeRestoredMail, runMailTick } from "../src/server/cfp-mail.ts";

const usage = [
  "Use one CFP maintenance command:",
  "migrate",
  "init EDITION",
  "open EDITION",
  "close EDITION",
  "bootstrap-admin EDITION WTS_USER_ID",
  "mail-tick",
  "mail-resume EDITION JOB_ID [JOB_ID ...]",
  "backup NEW_DIRECTORY",
  "restore BACKUP_DIRECTORY NEW_DIRECTORY",
].join("\n");
type Command = (args: string[]) => void | Promise<void>;

function requireArguments(args: string[], count: number): void {
  if (args.length !== count || args.some((value) => !value)) throw new Error(usage);
}

function setGate(args: string[], open: boolean): void {
  requireArguments(args, 1);
  setCfpOpen(args[0]!, open); console.log(`The CFP edition is ${open ? "open" : "closed"}.`);
}

const commands = new Map<string, Command>([
  ["migrate", (args) => {
    requireArguments(args, 0);
    migrate(); console.log("The CFP schema is current.");
  }],
  ["init", (args) => {
    requireArguments(args, 1);
    initializeEdition(args[0]!); console.log("The CFP edition is initialized. New editions remain closed.");
  }],
  ["open", (args) => setGate(args, true)],
  ["close", (args) => setGate(args, false)],
  ["bootstrap-admin", (args) => {
    requireArguments(args, 2);
    const grant = bootstrapAdmin(args[0]!, args[1]!);
    console.log(JSON.stringify({ editionId: grant.editionId, wtsUserId: grant.wtsUserId, role: grant.role, state: grant.state, revision: grant.revision }));
  }],
  ["mail-tick", async (args) => {
    requireArguments(args, 0);
    console.log(JSON.stringify(await runMailTick()));
  }],
  ["mail-resume", (args) => {
    const [edition, firstJob, ...otherJobs] = args;
    if (!edition || !firstJob) throw new Error(usage);
    console.log(JSON.stringify(resumeRestoredMail(edition, [firstJob, ...otherJobs])));
  }],
  ["backup", async (args) => {
    requireArguments(args, 1);
    await backup(args[0]!); console.log("The CFP backup is complete.");
  }],
  ["restore", async (args) => {
    requireArguments(args, 2);
    await restore(args[0]!, args[1]!);
    console.log("The CFP restore is complete. Sessions and flows are cleared. Both gates are closed. Staff grants are disabled. Unsent mail remains suspended.");
  }],
]);

async function main([command, ...args]: string[]): Promise<void> {
  try {
    const run = commands.get(command ?? "");
    if (!run) throw new Error(usage);
    await run(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The CFP maintenance command failed.");
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
