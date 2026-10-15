import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { AgentError } from "./protocol.js";

export interface SerialDeviceSelector {
  vendorId: string;
  productId: string;
  serialNumber: string;
  interface?: string;
}

export interface SerialPortInfo {
  path: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  interface?: string;
}

function hexId(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^(?:0x)?[0-9a-f]{1,4}$/i.test(value)) return undefined;
  return value.replace(/^0x/i, "").toLowerCase().padStart(4, "0");
}

function unsafeAscii(value: string, minimum: number): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < minimum || code === 127) return true;
  }
  return false;
}
function identityString(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256 && value.trim().length > 0 && !unsafeAscii(value, 32);
}
function optionalIdentityString(value: unknown): boolean {
  return value === undefined || identityString(value);
}

/** Validate enrollment, never infer a serial from a path, product or location. */
export function validSerialDeviceSelector(value: unknown): SerialDeviceSelector {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentError("invalid_config");
  const v = value as Record<string, unknown>;
  const vendorId = hexId(v.vendorId), productId = hexId(v.productId);
  if (!Object.keys(v).every(key => ["vendorId", "productId", "serialNumber", "interface"].includes(key)) || !vendorId || !productId || !identityString(v.serialNumber) || !optionalIdentityString(v.interface)) throw new AgentError("invalid_config");
  return { vendorId, productId, serialNumber: v.serialNumber, ...(v.interface !== undefined ? { interface: v.interface as string } : {}) };
}

/** Physical ownership excludes the interface; JSON framing avoids delimiter collisions. */
export function serialDeviceKey(selector: SerialDeviceSelector): string {
  const value = validSerialDeviceSelector(selector);
  return JSON.stringify([value.vendorId, value.productId, value.serialNumber]);
}

/** Only local callout/USB serial paths, never arbitrary files or path traversal. */
export function supportedSerialPath(path: unknown, platform: string = process.platform): path is string {
  if (typeof path !== "string" || path.length > 240 || unsafeAscii(path, 33)) return false;
  if (platform === "darwin") return /^\/dev\/cu\.[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(path);
  if (platform === "linux") return /^\/dev\/(?:ttyACM|ttyUSB)[0-9]+$/.test(path) || /^\/dev\/serial\/by-id\/[A-Za-z0-9_-][A-Za-z0-9_.:+-]*$/.test(path);
  return false;
}

/** Fail closed: even aliases are ambiguous without evidence they are one endpoint. */
export function resolveSerialDevice(selector: SerialDeviceSelector, ports: SerialPortInfo[], platform: string = process.platform): string {
  const wanted = validSerialDeviceSelector(selector);
  if (!["darwin", "linux"].includes(platform) || !Array.isArray(ports)) throw new AgentError("invalid_config");
  const family = ports.filter(port => port && supportedSerialPath(port.path, platform) && hexId(port.vendorId) === wanted.vendorId && hexId(port.productId) === wanted.productId && (wanted.interface === undefined || port.interface === wanted.interface));
  // A serial-less member of this family cannot prove that it is a different printer.
  if (family.some(port => !identityString(port.serialNumber))) throw new AgentError("device_ambiguous");
  const matches = family.filter(port => port.serialNumber === wanted.serialNumber);
  if (matches.length === 0) throw new AgentError("device_missing");
  if (matches.length !== 1) throw new AgentError("device_ambiguous");
  if (ports.filter(port => port?.path === matches[0].path).length !== 1) throw new AgentError("device_ambiguous");
  return matches[0].path;
}

/** Read-only OS inventory: SerialPort.list does not construct or open a port. */
export function serialCalloutPath(path: string, platform: string = process.platform): string {
  // serialport's IOKit enumerator returns dial-in names. Darwin exposes the same
  // endpoint's non-carrier-waiting callout device under /dev/cu.<same suffix>.
  if (platform === "darwin" && /^\/dev\/tty\.[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(path) && !unsafeAscii(path, 33)) return path.replace("/dev/tty.", "/dev/cu.");
  return path;
}

export async function listSerialDevices(): Promise<SerialPortInfo[]> {
  if (!["darwin", "linux"].includes(process.platform)) throw new AgentError("invalid_config");
  let serialPort: { list(): Promise<SerialPortInfo[]> };
  try {
    // serialport 13 is supplied by the pinned niimbluelib dependency. Resolve
    // relative to its manifest without importing its eager BLE/client barrels.
    const require = createRequire(import.meta.url);
    const dependencyRequire = createRequire(require.resolve("@mmote/niimbluelib"));
    serialPort = dependencyRequire("serialport").SerialPort;
  } catch {
    throw new AgentError("invalid_config");
  }
  let ports: SerialPortInfo[];
  try {
    ports = await serialPort.list();
  } catch {
    throw new AgentError("device_missing", true);
  }
  return ports.map(port => ({ ...port, path: serialCalloutPath(port.path) })).filter(port => supportedSerialPath(port.path)).map(port => {
    const result: SerialPortInfo = { path: port.path };
    for (const key of ["vendorId", "productId", "serialNumber", "pnpId", "locationId", "interface"] as const) {
      if (typeof port[key] === "string") result[key] = port[key];
    }
    return result;
  });
}

/** Legacy by-id agents reserve the same physical USB key as host workers. */
export async function legacySerialDevice(address: string): Promise<SerialDeviceSelector> {
  if (!supportedSerialPath(address, "linux") || !address.startsWith("/dev/serial/by-id/")) throw new AgentError("invalid_config");
  let path: string;
  try { path = realpathSync(address); } catch { throw new AgentError("device_missing"); }
  const matches = (await listSerialDevices()).filter(port => {
    try { return realpathSync(port.path) === path; } catch { return false; }
  });
  if (matches.length !== 1) throw new AgentError(matches.length ? "device_ambiguous" : "device_missing");
  const port = matches[0];
  return validSerialDeviceSelector({ vendorId: port.vendorId, productId: port.productId, serialNumber: port.serialNumber });
}

export function validPrinterSerial(value: unknown): string {
  if (!identityString(value)) throw new AgentError("invalid_config");
  return value;
}
