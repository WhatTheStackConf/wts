import type { CheckinArrivalDecision } from "~/lib/checkin-arrival-contract";

/** Bundled, pinned pure-JS decoder; works without experimental BarcodeDetector
 * (not available on supported Safari). Images never leave the browser. */
export async function decodeCameraPixels(image: Pick<ImageData, "data" | "width" | "height">): Promise<string | null> {
  const { default: jsQR } = await import("jsqr");
  const value = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data ?? null;

  return value;
}

/** No async gap between accepting a frame and holding it. Resuming cannot
 * accept the card still in view: require three clear frames first. */
export function createCameraFrameGate() {
  let held = false;
  let previous: string | null = null;
  let clearFrames = 0;
  return {
    accept(value: string | null) {
      if (held) return false;
      if (value === null) { if (++clearFrames >= 3) previous = null; return false; }
      clearFrames = 0;
      if (value === previous) return false;
      held = true; previous = value; return true;
    },
    resume() { held = false; clearFrames = 0; },
  };
}

/** Station QR is an exact same-origin provisioning link, not an attendee, login
 * credential, arbitrary URL to navigate, or bare code to infer authority from. */
export function provisioningCameraCode(value: string, origin: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.pathname !== "/checkin" || url.search || url.username || url.password) return null;
    return /^#provision=([a-f0-9]{64})$/.exec(url.hash)?.[1] ?? null;
  } catch { return null; }
}

export function cameraDecisionSettled(decision: CheckinArrivalDecision | undefined): boolean {
  if (!decision) return false;
  if (decision.state === "already_handled" || decision.state === "rejected") return true;
  return "workflow" in decision && decision.workflow.state === "accepted" && decision.workflow.printState === "completed";
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera permission denied. Allow camera access in this site's browser settings, then try again. No arrival was submitted.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No usable camera found. Connect a camera or use the exact attendee QR input. No arrival was submitted.";
  if (name === "NotReadableError") return "Camera is busy or unavailable. Close other camera apps, then try again.";
  return "Camera could not start or decode. Use HTTPS, check camera access and try again, or use the exact attendee QR input.";
}
