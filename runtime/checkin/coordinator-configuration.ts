import { HttpAdmissionProcessor } from "./admission.js";
import { createCheckinRecoverySource } from "../../src/lib/checkin-recovery-upstream.js";
import { AgentError } from "./protocol.js";
import { readPrivateObject } from "./private-configuration.js";

/** Read once: both producers share the same validated private credential snapshot. */
export function loadCoordinatorProcessors(credentialFile: unknown) {
  const explicit = credentialFile !== undefined;
  const config = explicit ? readPrivateObject(credentialFile) : {
    apiUrl: process.env.HIEVENTS_API_URL, apiKey: process.env.HIEVENTS_API_KEY, accountId: process.env.HIEVENTS_ACCOUNT_ID,
  };
  if (explicit && (Object.keys(config).length !== 3 || Object.keys(config).some(key => !["apiUrl", "apiKey", "accountId"].includes(key))
      || typeof config.apiUrl !== "string" || typeof config.apiKey !== "string" || typeof config.accountId !== "string")) throw new AgentError("invalid_config");
  const input = { apiUrl: config.apiUrl as string | undefined, apiKey: config.apiKey as string | undefined, accountId: config.accountId as string | undefined };
  const admission = new HttpAdmissionProcessor(input);
  if (!admission.isConfigured) {
    if (explicit) throw new AgentError("invalid_config");
    return { admission: null, reset: null };
  }
  return { admission, reset: createCheckinRecoverySource(input) };
}
/** Compatibility API for existing callers. */
export function loadCoordinatorAdmission(credentialFile: unknown): HttpAdmissionProcessor | null {
  return loadCoordinatorProcessors(credentialFile).admission;
}
