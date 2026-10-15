import { AgentError } from "./protocol.js";
import { listSerialDevices, resolveSerialDevice, validPrinterSerial, validSerialDeviceSelector, type SerialDeviceSelector } from "./serial-devices.js";

interface OpenedPrinter { abstraction: { getPrinterSerialNumber(): Promise<string> } }
/** Identity comes from the open stream, never a second lookup of a mutable path. */
export async function verifyOpenedPrinter(client: OpenedPrinter, expected: string): Promise<void> {
  validPrinterSerial(expected);
  let serial: string;
  try { serial = await client.abstraction.getPrinterSerialNumber(); }
  catch { throw new AgentError("printer_identity_unverified"); }
  if (serial !== expected) throw new AgentError("printer_identity_mismatch");
}

/** Explicit enrollment query. Caller must own the USB lease. No print task sent. */
export async function inspectSerialPrinter(selector: SerialDeviceSelector): Promise<{ device: SerialDeviceSelector; address: string; printerSerial: string; model: string }> {
  const device = validSerialDeviceSelector(selector);
  const { initClient } = await import("@mmote/niimblue-node");
  const address = resolveSerialDevice(device, await listSerialDevices());
  const client = initClient("serial", address, false);
  let connected = false;
  try {
    await client.connect(); connected = true;
    let printerSerial: string;
    try { printerSerial = validPrinterSerial(await client.abstraction.getPrinterSerialNumber()); }
    catch { throw new AgentError("printer_identity_unverified"); }
    if (resolveSerialDevice(device, await listSerialDevices()) !== address) throw new AgentError("device_ambiguous");
    return { device, address, printerSerial, model: client.getModelMetadata()?.model ?? "unknown" };
  } finally { if (connected) await client.disconnect(); }
}
