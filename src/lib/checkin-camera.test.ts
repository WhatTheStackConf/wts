import { describe, expect, it } from "vite-plus/test";
import QRCode from "qrcode";
import { cameraHeldReference, recoverCameraArrival } from "~/lib/checkin-camera-recovery";
import type { CheckinArrivalHistory } from "~/lib/checkin-arrival-contract";

describe("held camera recovery", () => {
  it("keeps opaque holds isolated by binding and clears only the current operation", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const a = cameraHeldReference(storage, "binding-a");
    const b = cameraHeldReference(storage, "binding-b");
    const id = "11111111-1111-4111-8111-111111111111";
    a.hold(id); expect(a.read()).toBe(id); expect(b.read()).toBeNull();
    a.clear("other"); expect(a.read()).toBe(id);
    a.clear(id); expect(a.read()).toBeNull();
    storage.setItem("wts:camera-held:binding-a", "attendee-qr");
    expect(() => a.read()).toThrow("unreadable");
  });
  it("follows history pagination and treats missing history as unknown", async () => {
    const empty: CheckinArrivalHistory = { items: [], nextCursor: "next", day: "2026-09-10", operationsEnabled: false };
    const calls: (string | undefined)[] = [];
    const history = async (cursor?: string): Promise<CheckinArrivalHistory> => {
      calls.push(cursor);
      return cursor ? { ...empty, nextCursor: null, items: [{ id: "row", operationId: "operation", stationId: "wts2026station1", eventId: "event", createdAt: "", completedAt: null, result: { state: "dependency_unavailable" } }] } : empty;
    };
    expect(await recoverCameraArrival("operation", history, () => true)).toEqual({ state: "dependency_unavailable" });
    expect(calls).toEqual([undefined, "next"]);
    expect(await recoverCameraArrival("missing", history, () => true)).toBeUndefined();
    await expect(recoverCameraArrival("missing", async () => empty, () => true)).rejects.toThrow("cursor");
  });
  it("discards history settled after a rebind", async () => {
    let bound = true;
    const result = await recoverCameraArrival("operation", async () => {
      bound = false;
      return { items: [], nextCursor: "next", day: "2026-09-10", operationsEnabled: false };
    }, () => bound);
    expect(result).toBeUndefined();
  });
});
import { cameraDecisionSettled, createCameraFrameGate, decodeCameraPixels, provisioningCameraCode } from "~/lib/checkin-camera";
import type { CheckinArrivalDecision } from "~/lib/checkin-arrival-contract";

describe("camera arrival public boundaries", () => {
  it("decodes explicitly synthetic RGBA QR pixels without BarcodeDetector", async () => {
    const qr = QRCode.create("A-TEST001", { errorCorrectionLevel: "M" });
    const size = (qr.modules.size + 8) * 8;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / 8) - 4; const my = Math.floor(y / 8) - 4;
      if (mx >= 0 && my >= 0 && mx < qr.modules.size && my < qr.modules.size && qr.modules.get(my, mx)) {
        const index = (y * size + x) * 4; pixels[index] = 0; pixels[index + 1] = 0; pixels[index + 2] = 0;
      }
    }
    expect(await decodeCameraPixels({ data: pixels, width: size, height: size })).toBe("A-TEST001");
  });
  it("latches synchronously, rejects repeated frames and needs clear frames before a rescan", () => {
    const gate = createCameraFrameGate();
    expect(gate.accept("A-TEST001")).toBe(true);
    expect(gate.accept("A-TEST001")).toBe(false);
    expect(gate.accept("A-TEST002")).toBe(false);
    gate.resume();
    expect(gate.accept("A-TEST001")).toBe(false);
    gate.accept(null); gate.accept(null); gate.accept(null);
    expect(gate.accept("A-TEST001")).toBe(true);
  });
  it("keeps provisioning authority distinct and never follows a foreign URL", () => {
    const code = "a".repeat(64);
    expect(provisioningCameraCode(`https://wts.test/checkin#provision=${code}`, "https://wts.test")).toBe(code);
    for (const value of ["A-TEST001", code, `https://evil.test/checkin#provision=${code}`, `https://wts.test/checkin?x=1#provision=${code}`]) {
      expect(provisioningCameraCode(value, "https://wts.test")).toBeNull();
    }
  });
  it("never releases queued, pending or physically uncertain work as a completed result", () => {
    const workflow = { id: "a".repeat(15), stationId: "wts2026station1", eventId: "e".repeat(15), eventTitle: "Synthetic", state: "accepted", name: "Synthetic", affiliation: "", profileId: "p", createdAt: "2026-09-10" } as const;
    for (const printState of ["queued", "dispatched", "uncertain", "cancelled", null] as const) {
      expect(cameraDecisionSettled({ state: "accepted", workflow: { ...workflow, printState }, printIntentId: "p".repeat(15) })).toBe(false);
    }
    expect(cameraDecisionSettled({ state: "accepted", workflow: { ...workflow, printState: "completed" }, printIntentId: "p".repeat(15) })).toBe(true);
    for (const state of ["reserved", "admission_pending", "admission_uncertain", "existing_unattributed"] as const) {
      expect(cameraDecisionSettled({ state, workflow } as CheckinArrivalDecision)).toBe(false);
    }
    expect(cameraDecisionSettled({ state: "rejected", reason: "not_in_list" })).toBe(true);
  });
});
