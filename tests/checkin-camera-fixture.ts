import type { Page } from "@playwright/test";
import QRCode from "qrcode";

/** Explicitly SYNTHETIC media. The real getUserMedia permission request runs
 * first against Chromium's fake device. Only its returned frames are replaced
 * with a local canvas stream; no decoder or application API is mocked. */
export async function installSyntheticCamera(page: Page) {
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const media = { canvas: null as HTMLCanvasElement | null, requests: 0, stopped: 0 };
    Object.assign(window, { __wtsSyntheticCamera: media });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      media.requests++;
      const actual = await getUserMedia(constraints);
      actual.getTracks().forEach((track) => track.stop());
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, 640, 480);
      media.canvas = canvas;
      const stream = canvas.captureStream(12);
      // Keep synthetic frames flowing like a real camera, even for a static QR.
      const frames = window.setInterval(() => context.drawImage(canvas, 0, 0), 80);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track); track.stop = () => { window.clearInterval(frames); media.stopped++; stop(); };
      }
      return stream;
    };
    // Prove the production decoder does not depend on native BarcodeDetector.
    Object.defineProperty(window, "BarcodeDetector", { value: undefined, configurable: true });
  });
}
export async function showSyntheticQr(page: Page, value: string | null) {
  const data = value === null ? null : await QRCode.toDataURL(value, { width: 360, margin: 4, errorCorrectionLevel: "M" });
  await page.evaluate(async (data) => {
    const camera = (window as unknown as { __wtsSyntheticCamera: { canvas: HTMLCanvasElement | null } }).__wtsSyntheticCamera;
    if (!camera.canvas) throw new Error("Synthetic camera has not started");
    const context = camera.canvas.getContext("2d")!;
    context.fillStyle = "white"; context.fillRect(0, 0, 640, 480);
    if (data) {
      const image = new Image(); image.src = data; await image.decode();
      context.drawImage(image, 140, 60, 360, 360);
    }
  }, data);
}
