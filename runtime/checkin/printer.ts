import type { LabelType } from "@mmote/niimbluelib";
import { renderNameLabel, type LabelProfile } from "../../src/lib/checkin-label-renderer.js";
import { AgentError, validPrintPayload, type PrintPayload } from "./protocol.js";
import { listSerialDevices, resolveSerialDevice, supportedSerialPath, validSerialDeviceSelector, validPrinterSerial, type SerialDeviceSelector, type SerialPortInfo } from "./serial-devices.js";
import { verifyOpenedPrinter } from "./printer-identification.js";

export interface NiimbotPrinter {
  readonly printerIdentity: string;
  checkReady?(): Promise<void>;
  prepare?(attemptId: string, payload: PrintPayload): Promise<void>;
  print(attemptId: string, payload: PrintPayload): Promise<void>;
}

export interface NiimbotPrintRequest {
  address: string;
  model: "B1";
  density: number;
  labelType: number;
  printDirection: "top" | "left";
  pngBase64: string;
  debug: boolean;
  expectedSerial?: string;
}

export interface NiimbotSerialDriver {
  print(request: NiimbotPrintRequest): Promise<void>;
}

function stableSerialPath(address: unknown): address is string {
  return supportedSerialPath(address, "linux") && address.startsWith("/dev/serial/by-id/");
}

/** Driver density and label type; only gap-fed profiles have a supported label type. */
function driverSettings(config: LabelProfile["config"]): { density: number; labelType: number } {
  const density = config.density;
  const labelType = config.feed.mode === "gap" ? 1 : NaN;
  if (!Number.isInteger(density) || density < 1 || density > 5 || !Number.isInteger(labelType) || labelType < 0 || labelType > 255) throw new AgentError("invalid_request");
  return { density, labelType };
}

/** Maintained NIIMBOT B1 serial driver. The complete task is one call. */
export const maintainedNiimbotSerialDriver: NiimbotSerialDriver = {
  async print(request) {
    // The pinned upstream serial and image subpaths still import the BLE barrel.
    // Keep it out of discovery, readiness and injected/simulated worker startup.
    const { ImageEncoder, initClient, loadImageFromBase64, printImages } = await import("@mmote/niimblue-node");
    const client = initClient("serial", request.address, request.debug);
    let connected = false;
    try {
      await client.connect();
      connected = true;
      if (request.expectedSerial !== undefined) await verifyOpenedPrinter(client, request.expectedSerial);
      // Some B1 firmware accepts the initial negotiation but times out on the
      // optional info packet. Reject an explicit mismatch; retain the stable
      // by-id path as the identity fence when metadata is unavailable.
      const metadata = client.getModelMetadata();
      if (metadata && (metadata.model !== request.model || !metadata.id.includes(4096))) throw new AgentError("printer_identity_mismatch");
      const image = await loadImageFromBase64(request.pngBase64);
      const encoded = await ImageEncoder.encodeImage(image, request.printDirection);
      if (encoded.cols < 8 || encoded.cols % 8 !== 0 || encoded.rows < 1) throw new AgentError("invalid_request");
      await printImages(client, request.model, [{ encoded, quantity: 1 }], {
        density: request.density,
        labelType: request.labelType as LabelType,
        quantity: 1,
      });
    } finally {
      if (connected) await client.disconnect();
    }
  },
};

export interface NiimbotSerialPrinterOptions {
  address?: string;
  device?: SerialDeviceSelector;
  printerSerial?: string;
  debug?: boolean;
  driver?: NiimbotSerialDriver;
  listPorts?: () => Promise<SerialPortInfo[]>;
}

export class NiimbotSerialPrinter implements NiimbotPrinter {
  readonly printerIdentity: string;
  private readonly address?: string;
  private readonly device?: SerialDeviceSelector;
  private readonly printerSerial?: string;
  private readonly listPorts: () => Promise<SerialPortInfo[]>;
  private readonly debug: boolean;
  private readonly driver: NiimbotSerialDriver;
  private readonly prepared = new Map<string, string>();

  constructor(printerIdentity: string, options: NiimbotSerialPrinterOptions) {
    if (!printerIdentity || !options || (options.device !== undefined ? options.address !== undefined : !stableSerialPath(options.address))) throw new AgentError("invalid_config");
    this.printerIdentity = printerIdentity;
    this.address = options.address;
    this.device = options.device === undefined ? undefined : validSerialDeviceSelector(options.device);
    this.printerSerial = this.device ? validPrinterSerial(options.printerSerial) : options.printerSerial;
    this.listPorts = options.listPorts ?? listSerialDevices;
    this.debug = options.debug ?? false;
    this.driver = options.driver ?? maintainedNiimbotSerialDriver;
  }

  private async resolveAddress(): Promise<string> {
    if (this.device) return resolveSerialDevice(this.device, await this.listPorts());
    return this.address!;
  }

  /** Read-only readiness, never opens the device or loads the physical driver. */
  async checkReady(): Promise<void> {
    await this.resolveAddress();
  }

  private async raster(payload: PrintPayload): Promise<string> {
    const value = validPrintPayload(payload);
    const profile = value.profile as unknown as LabelProfile;
    const config = profile.config;
    if (config.printerRef !== this.printerIdentity) throw new AgentError("printer_identity_mismatch");
    driverSettings(config);
    if (value.pngBase64) return value.pngBase64;
    const raster = await renderNameLabel({
      text: value.text,
      profile,
      mode: "production",
      expected: {
        profileId: profile.id,
        profileVersion: profile.version,
        printerRef: config.printerRef,
        stockRef: config.stockRef,
        rendererVersion: config.rendererVersion,
        fontVersion: config.fontVersion,
      },
    });
    return raster.pngBase64;
  }

  async prepare(attemptId: string, payload: PrintPayload): Promise<void> {
    this.prepared.delete(attemptId);
    await this.checkReady();
    this.prepared.set(attemptId, await this.raster(payload));
  }

  async print(attemptId: string, payload: PrintPayload): Promise<void> {
    const pngBase64 = this.prepared.get(attemptId) ?? await this.raster(payload);
    this.prepared.delete(attemptId);
    const value = validPrintPayload(payload);
    const profile = value.profile as unknown as LabelProfile;
    const config = profile.config;
    if (config.printerRef !== this.printerIdentity) throw new AgentError("printer_identity_mismatch");
    const { density, labelType } = driverSettings(config);
    // Do not reuse the preparation path: a replug may have assigned it to another printer.
    const address = await this.resolveAddress();
    await this.driver.print({ address, model: "B1", density, labelType, printDirection: "top", pngBase64, debug: this.debug, ...(this.printerSerial ? { expectedSerial: this.printerSerial } : {}) });
  }
}

/** Explicitly synthetic transport for local integration tests and demos. */
export class SimulatedNiimbotPrinter implements NiimbotPrinter {
  readonly printed: { attemptId: string; payload: PrintPayload }[] = [];
  constructor(readonly printerIdentity: string, private readonly send?: (attemptId: string, payload: PrintPayload) => Promise<void>) {}

  async checkReady(): Promise<void> {}

  async print(attemptId: string, payload: PrintPayload): Promise<void> {
    await this.send?.(attemptId, payload);
    this.printed.push({ attemptId, payload: structuredClone(payload) });
  }
}
