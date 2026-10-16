import { Match, Show, Switch, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import { cameraErrorMessage, createCameraFrameGate, decodeCameraPixels } from "~/lib/checkin-camera";
import "./scanner-panel.css";

interface CheckinCameraScannerProps {
  compact?: boolean;
  /** Runs in the Start button gesture, before the media permission promise. */
  onActivate?: () => void | Promise<void>;
  /** Live authority gate. Checking permission does not grant arrival authority. */
  enabled: boolean;
  held: boolean;
  scope?: string;
  /** False rejects this QR without latching; repeated identical frames remain suppressed. */
  onDecode: (value: string) => void | boolean;
}
/** Downscales the current preview frame for on-device decoding. */
function framePixels(video: HTMLVideoElement, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const scale = Math.min(1, 720 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
export function CheckinCameraScanner(props: CheckinCameraScannerProps) {
  const [state, setState] = createSignal<"off" | "starting" | "running" | "error">("off");
  const [error, setError] = createSignal("");
  let video: HTMLVideoElement | undefined;
  let stream: MediaStream | undefined;
  let timer: number | undefined;
  let generation = 0;
  let gate = createCameraFrameGate();
  function stop() {

    generation++;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    stream?.getTracks().forEach((track) => track.stop()); stream = undefined;
    if (video) { video.pause(); video.srcObject = null; }
    setState("off");
  }
  let previousScope = props.scope;
  createEffect(() => props.scope, (scope) => {
    if (scope !== previousScope) { previousScope = scope; stop(); }
  });
  createEffect(() => props.held, (held) => { if (!held) gate.resume(); });
  onSettled(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", stop);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", stop); };
  });
  onCleanup(stop);
  const paused = () => props.held || !props.enabled;
  const canDecode = () => props.enabled && !props.held && !document.hidden;
  function fail(current: number, message: string) {
    if (current === generation) { stop(); setError(message); setState("error"); }
  }
  // Feedback is optional. Neither an audio policy refusal nor a throwing
  // callback can turn a camera permission gesture into a failed scan.
  function activateFeedback() {
    try { void Promise.resolve(props.onActivate?.()).catch(() => undefined); } catch { /* optional feedback */ }
  }
  function requestCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 960 }, height: { ideal: 720 } } });
  }
  function attachStream(acquired: MediaStream, current: number) {
    stream = acquired;
    for (const track of acquired.getVideoTracks()) track.addEventListener("ended", () => fail(current, "Camera disconnected. Reconnect it, then start again."), { once: true });
    if (!video) throw new Error("Video unavailable");
    video.srcObject = stream;
    return video.play();
  }
  const decodableVideo = () => canDecode() && video && video.readyState >= 2 && video.videoWidth ? video : undefined;
  function deliver(current: number, value: string | null) {
    // Permission/decoder promises can settle after stop, rebind or a hold.
    if (current === generation && canDecode() && gate.accept(value) && value !== null) {
      if (props.onDecode(value) === false) gate.resume();
    }
  }
  async function start() {
    if (paused() || state() === "starting") return;
    activateFeedback();
    stop(); setError(""); setState("starting");
    const current = generation;
    try {
      const acquired = await requestCamera();
      if (current !== generation || !canDecode()) { acquired.getTracks().forEach((track) => track.stop()); if (current === generation) stop(); return; }
      await attachStream(acquired, current);
      if (current !== generation) return;
      setState("running"); gate = createCameraFrameGate();
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas unavailable");
      const tick = async () => {
        if (current !== generation) return;
        try {
          const frame = decodableVideo();
          if (frame) deliver(current, await decodeCameraPixels(framePixels(frame, canvas, context)));
        } catch (failure) {
          fail(current, cameraErrorMessage(failure));
        }
        if (current === generation) timer = window.setTimeout(() => void tick(), 180);
      };
      void tick();
    } catch (failure) {
      fail(current, cameraErrorMessage(failure));
    }
  }
  return <Show when={props.compact} fallback={<section aria-label="Attendee camera" class="min-w-0 space-y-3">
    <video ref={(element) => { video = element; }} muted playsinline aria-label="attendee camera preview" class="w-full max-w-md rounded-lg bg-black aspect-[4/3] object-contain" hidden={state() !== "running"} />
    <p role="status"><Show when={state() === "starting"} fallback={<Show when={state() === "running"} fallback="Camera off."><Show when={paused()} fallback="Camera scanning. Show one QR at a time.">Camera paused. Resolve or safely park held work before another attendee.</Show></Show>}>Waiting for camera permission. You can cancel without submitting an arrival.</Show></p>
    <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
    <div class="flex flex-wrap gap-3">
      <button type="button" class="btn btn-primary min-h-12" disabled={paused() || state() === "starting" || state() === "running"} onClick={() => void start()}>Start attendee camera</button>
      <button type="button" class="btn btn-outline min-h-12" disabled={state() === "off" || state() === "error"} onClick={stop}>Stop attendee camera</button>
    </div>
    <p class="text-sm">Camera frames are decoded on this phone and never uploaded. Remove the previous QR before scanning again. Switching apps stops the camera; return here and restart explicitly.</p>
  </section>}>
    <section aria-label="Attendee camera" class="checkin-scanner-compact">
      <div class="checkin-scanner-preview">
        <video ref={(element) => { video = element; }} muted playsinline aria-label="attendee camera preview" hidden={state() !== "running"} />
        <Show when={state() === "running"} fallback={<p class="checkin-scanner-placeholder"><Show when={state() === "starting"} fallback="Show one attendee QR at a time">Allow camera access to scan</Show></p>}>
          <span class="checkin-scanner-target" aria-hidden="true" />
        </Show>
      </div>
      <p role="status" class="checkin-scanner-status"><Switch fallback="Camera off"><Match when={state() === "starting"}>Waiting for camera permission…</Match><Match when={state() === "running"}><Show when={paused()} fallback="Ready for an attendee QR">Scanning paused</Show></Match></Switch></p>
      <Show when={error()}><p role="alert" class="text-sm break-words">{error()}</p></Show>
      <div class="checkin-scanner-controls">
        <Show when={state() === "running" || state() === "starting"} fallback={<button type="button" class="btn btn-primary" disabled={paused()} onClick={() => void start()}>Start scanning</button>}>
          <button type="button" class="btn btn-outline" onClick={stop}><Show when={state() === "starting"} fallback="Stop">Cancel camera</Show></button>
        </Show>
      </div>
    </section>
  </Show>;
}
