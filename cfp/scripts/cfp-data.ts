import { backup, initializeEdition, migrate, restore, setCfpOpen } from "../src/server/storage.ts";

const usage = "Use migrate, init EDITION, open EDITION, close EDITION, backup NEW_DIRECTORY, or restore BACKUP_DIRECTORY NEW_DIRECTORY.";
const [command, ...args] = process.argv.slice(2);
try {
  switch (command) {
    case "migrate":
      if (args.length !== 0) throw new Error(usage);
      migrate(); console.log("The CFP schema is current.");
      break;
    case "init":
      if (args.length !== 1 || !args[0]) throw new Error(usage);
      initializeEdition(args[0]); console.log("The CFP edition is initialized. New editions remain closed.");
      break;
    case "open":
    case "close":
      if (args.length !== 1 || !args[0]) throw new Error(usage);
      setCfpOpen(args[0], command === "open"); console.log(`The CFP edition is ${command === "open" ? "open" : "closed"}.`);
      break;
    case "backup":
      if (args.length !== 1 || !args[0]) throw new Error(usage);
      await backup(args[0]); console.log("The CFP backup is complete.");
      break;
    case "restore":
      if (args.length !== 2 || !args[0] || !args[1]) throw new Error(usage);
      await restore(args[0], args[1]); console.log("The CFP restore is complete. Sessions and flows are cleared. CFP editions are closed.");
      break;
    default: throw new Error(usage);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "The CFP maintenance command failed.");
  process.exitCode = 1;
}
