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
    case "bootstrap-admin": {
      const [edition, userId] = args;
      if (args.length !== 2 || !edition || !userId) throw new Error(usage);
      const grant = bootstrapAdmin(edition, userId);
      console.log(JSON.stringify({ editionId: grant.editionId, wtsUserId: grant.wtsUserId, role: grant.role, state: grant.state, revision: grant.revision }));
      break;
    }
    case "mail-tick":
      if (args.length !== 0) throw new Error(usage);
      console.log(JSON.stringify(await runMailTick()));
      break;
    case "mail-resume": {
      const [edition, firstJob, ...otherJobs] = args;
      if (!edition || !firstJob) throw new Error(usage);
      console.log(JSON.stringify(resumeRestoredMail(edition, [firstJob, ...otherJobs])));
      break;
    }
    case "backup":
      if (args.length !== 1 || !args[0]) throw new Error(usage);
      await backup(args[0]); console.log("The CFP backup is complete.");
      break;
    case "restore":
      if (args.length !== 2 || !args[0] || !args[1]) throw new Error(usage);
      await restore(args[0], args[1]);
      console.log("The CFP restore is complete. Sessions and flows are cleared. Both gates are closed. Staff grants are disabled. Unsent mail remains suspended.");
      break;
    default: throw new Error(usage);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "The CFP maintenance command failed.");
  process.exitCode = 1;
}
