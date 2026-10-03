import { backup, importLocalBundle, initializeEdition, migrate, restore, setEditionRole } from "../src/server/storage.ts";

const usage = "Use init EDITION NAMESPACE, migrate, import BUNDLE.json, role EDITION USER enable|disable, backup NEW_DIRECTORY, or restore BACKUP_DIRECTORY NEW_DIRECTORY.";
const [command, ...args] = process.argv.slice(2);
try {
  switch (command) {
    case "init":
      if (args.length !== 2) throw new Error(usage);
      console.log(JSON.stringify(initializeEdition(args[0]!, args[1]!)));
      break;
    case "migrate":
      if (args.length !== 0) throw new Error(usage);
      migrate(); console.log("The site schema is current.");
      break;
    case "import":
      if (args.length !== 1) throw new Error(usage);
      console.log(JSON.stringify(importLocalBundle(args[0]!)));
      break;
    case "role":
      if (args.length !== 3 || !["enable", "disable"].includes(args[2]!)) throw new Error(usage);
      setEditionRole(args[0]!, args[1]!, args[2] === "enable");
      console.log("The edition role is current.");
      break;
    case "backup":
      if (args.length !== 1) throw new Error(usage);
      await backup(args[0]!); console.log("The backup is complete.");
      break;
    case "restore":
      if (args.length !== 2) throw new Error(usage);
      restore(args[0]!, args[1]!);
      console.log("The restore is complete. Sessions are cleared. Admin grants are disabled.");
      break;
    default: throw new Error(usage);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "The maintenance command failed.");
  process.exitCode = 1;
}
