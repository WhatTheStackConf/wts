import { backup, importLocalBundle, initializeEdition, migrate, restore, setEditionRole } from "../src/server/storage.ts";

const usage = "Use init EDITION NAMESPACE, migrate, import BUNDLE.json, role EDITION USER enable|disable, backup NEW_DIRECTORY, or restore BACKUP_DIRECTORY NEW_DIRECTORY.";
type Command = (args: string[]) => void | Promise<void>;

function requireArguments(args: string[], count: number): void {
  if (args.length !== count) throw new Error(usage);
}

const commands = new Map<string, Command>([
  ["init", (args) => {
    requireArguments(args, 2);
    console.log(JSON.stringify(initializeEdition(args[0]!, args[1]!)));
  }],
  ["migrate", (args) => {
    requireArguments(args, 0);
    migrate(); console.log("The site schema is current.");
  }],
  ["import", (args) => {
    requireArguments(args, 1);
    console.log(JSON.stringify(importLocalBundle(args[0]!)));
  }],
  ["role", (args) => {
    if (args.length !== 3 || !["enable", "disable"].includes(args[2]!)) throw new Error(usage);
    setEditionRole(args[0]!, args[1]!, args[2] === "enable");
    console.log("The edition role is current.");
  }],
  ["backup", async (args) => {
    requireArguments(args, 1);
    await backup(args[0]!); console.log("The backup is complete.");
  }],
  ["restore", (args) => {
    requireArguments(args, 2);
    restore(args[0]!, args[1]!);
    console.log("The restore is complete. Sessions are cleared. Admin grants are disabled.");
  }],
]);

async function main([command, ...args]: string[]): Promise<void> {
  try {
    const run = commands.get(command ?? "");
    if (!run) throw new Error(usage);
    await run(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The maintenance command failed.");
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
