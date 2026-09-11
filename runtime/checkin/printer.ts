import { ImageEncoder, initClient, loadImageFromBase64, printImages } from "@mmote/niimblue-node";
import { LabelType } from "@mmote/niimbluelib";
import { renderNameLabel, type LabelProfile } from "../../src/lib/checkin-label-renderer.js";
import { AgentError, validPrintPayload, type PrintPayload } from "./protocol.js";

export interface NiimbotPrinter {
  readonly printerIdentity: string;
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
}

export interface NiimbotSerialDriver {
  print(request: NiimbotPrintRequest): Promise<void>;
}

function stableSerialPath(address: string): boolean {
  return address.startsWith("/dev/serial/by-id/") && address.length <= 240 && !address.includes("\0");
}

/** Maintained NIIMBOT B1 serial driver. The complete task is one call. */
export const maintainedNiimbotSerialDriver: NiimbotSerialDriver = {
  async print(request) {
    const client = initClient("serial", request.address, request.debug);
    let connected = false;
    try {
      await client.connect();
      connected = true;
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

export class NiimbotSerialPrinter implements NiimbotPrinter {
  readonly printerIdentity: string;
  private readonly address: string;
  private readonly debug: boolean;
  private readonly driver: NiimbotSerialDriver;
  private readonly prepared = new Map<string, string>();

  constructor(printerIdentity: string, options: { address: string; debug?: boolean; driver?: NiimbotSerialDriver }) {
    if (!printerIdentity || !stableSerialPath(options.address)) throw new AgentError("invalid_config");
    this.printerIdentity = printerIdentity;
    this.address = options.address;
    this.debug = options.debug ?? false;
    this.driver = options.driver ?? maintainedNiimbotSerialDriver;
  }

  private async raster(payload: PrintPayload): Promise<string> {
    const value = validPrintPayload(payload);
    const profile = value.profile as unknown as LabelProfile;
    const config = profile.config;
    if (config.printerRef !== this.printerIdentity) throw new AgentError("printer_identity_mismatch");
    const density = config.density;
    const labelType = config.feed.mode === "gap" ? 1 : NaN;
    if (!Number.isInteger(density) || density < 1 || density > 5 || !Number.isInteger(labelType) || labelType < 0 || labelType > 255) throw new AgentError("invalid_request");
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
    this.prepared.set(attemptId, await this.raster(payload));
  }

  async print(attemptId: string, payload: PrintPayload): Promise<void> {
    const pngBase64 = this.prepared.get(attemptId) ?? await this.raster(payload);
    this.prepared.delete(attemptId);
    const value = validPrintPayload(payload);
    const profile = value.profile as unknown as LabelProfile;
    const config = profile.config;
    const density = config.density;
    const labelType = config.feed.mode === "gap" ? 1 : NaN;
    if (!Number.isInteger(density) || density < 1 || density > 5 || !Number.isInteger(labelType) || labelType < 0 || labelType > 255) throw new AgentError("invalid_request");
    await this.driver.print({ address: this.address, model: "B1", density, labelType, printDirection: "top", pngBase64, debug: this.debug });
  }
}

/** Explicitly synthetic transport for local integration tests and demos. */
export class SimulatedNiimbotPrinter implements NiimbotPrinter {
  readonly printed: { attemptId: string; payload: PrintPayload }[] = [];
  constructor(readonly printerIdentity: string, private readonly send?: (attemptId: string, payload: PrintPayload) => Promise<void>) {}

  async print(attemptId: string, payload: PrintPayload): Promise<void> {
    await this.send?.(attemptId, payload);
    this.printed.push({ attemptId, payload: structuredClone(payload) });
  }
}
