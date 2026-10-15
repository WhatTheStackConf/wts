import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { readPrivateFile, readPrivateObject } from "./private-configuration.js";
import { AgentError, object, safeUrl, validIdentity, type AgentIdentity } from "./protocol.js";
import { serialDeviceKey, validSerialDeviceSelector, validPrinterSerial, type SerialDeviceSelector } from "./serial-devices.js";

export interface HostStation {
  configFile: string;
  identity: AgentIdentity;
  journalPath: string;
  credentialFile: string;
  printerDevice?: SerialDeviceSelector;
  simulated: boolean;
}
export function privateHostPath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value)) throw new AgentError("invalid_config");
  const path = resolve(value);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o077) throw new Error();
    return realpathSync(path);
  } catch { throw new AgentError("invalid_config"); }
}
export function validateAgentConfigKeys(config: Record<string, unknown>): void {
  if (Object.keys(config).some(k => !["identity", "journalPath", "coordinatorUrl", "agentCredentialFile", "once", "pollIntervalMs", "printerMode", "printerAddress", "printerDevice", "printerSerial", "printerDebug"].includes(k))) throw new AgentError("invalid_config");
  if (config.printerDevice !== undefined && config.printerAddress !== undefined) throw new AgentError("invalid_config");
  if (config.printerDevice !== undefined) { validSerialDeviceSelector(config.printerDevice); validPrinterSerial(config.printerSerial); }
}
function checkPollInterval(value: unknown): void {
  if (value !== undefined && (!Number.isInteger(value) || Number(value) < 100 || Number(value) > 60000)) throw new AgentError("invalid_config");
}
/** Whether a host station prints to the simulator; only simulated or enrolled serial printers run. */
function simulatedPrinter(config: Record<string, unknown>): boolean {
  const simulated = config.printerMode === "simulated";
  if (!simulated && config.printerMode !== "serial" || config.printerAddress !== undefined || config.once !== undefined && typeof config.once !== "boolean" || config.printerDebug !== undefined && typeof config.printerDebug !== "boolean") throw new AgentError("invalid_config");
  checkPollInterval(config.pollIntervalMs);
  return simulated;
}
function stationPrinterDevice(config: Record<string, unknown>, simulated: boolean, claim: (key: string) => void): SerialDeviceSelector | undefined {
  const printerDevice = simulated ? undefined : validSerialDeviceSelector(config.printerDevice);
  if (printerDevice) claim(`hardwareSerial:${validPrinterSerial(config.printerSerial)}`);
  if (simulated && config.printerDevice !== undefined) throw new AgentError("invalid_config");
  return printerDevice;
}
function hostStation(item: unknown, claim: (key: string) => void): HostStation {
  const entry = object(item);
  if (Object.keys(entry).length !== 1) throw new AgentError("invalid_config");
  const configFile = privateHostPath(entry.configFile);
  const config = readPrivateObject(configFile); validateAgentConfigKeys(config);
  const identity = validIdentity(config.identity);
  if (typeof config.coordinatorUrl !== "string") throw new AgentError("invalid_config");
  safeUrl(config.coordinatorUrl);
  const journalPath = privateHostPath(config.journalPath);
  const credentialFile = privateHostPath(config.agentCredentialFile);
  const credential = readPrivateFile(credentialFile).trim();
  if (!/^wts_agent_[a-f0-9]{64}$/.test(credential)) throw new AgentError("invalid_config");
  const simulated = simulatedPrinter(config);
  const printerDevice = stationPrinterDevice(config, simulated, claim);
  for (const key of ["stationId", "agentIdentity", "printerIdentity", "journalIdentity"] as const) claim(`${key}:${identity[key]}`);
  for (const key of [`config:${configFile}`, `journal:${journalPath}`, `state:${dirname(journalPath)}`, `credential:${createHash("sha256").update(credential).digest("hex")}`, ...(printerDevice ? [`usb:${serialDeviceKey(printerDevice)}`] : [])]) claim(key);
  return { configFile, identity, journalPath, credentialFile, simulated, ...(printerDevice ? { printerDevice } : {}) };
}
/** Complete manifest validation happens before any worker or device is opened. */
export function loadHostConfiguration(path: string): HostStation[] {
  const manifest = readPrivateObject(privateHostPath(path));
  if (Object.keys(manifest).length !== 2 || manifest.version !== 1 || !Array.isArray(manifest.stations) || !manifest.stations.length || manifest.stations.length > 16) throw new AgentError("invalid_config");
  const unique = new Set<string>();
  const claim = (key: string) => { if (unique.has(key)) throw new AgentError("duplicate_assignment"); unique.add(key); };
  return manifest.stations.map(item => hostStation(item, claim));
}
