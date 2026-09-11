import { Match, Show, Switch, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import { cameraErrorMessage, createCameraFrameGate, decodeCameraPixels } from "~/lib/checkin-camera";
import "./scanner-panel.css";

interface CheckinCameraScannerProps {
  compact?: boolean;
  /** Runs in the Start button gesture, before the media permission promise. */
  onActivate?: () => void | Promise<void>;
  purpose: "attendee" | "station";
  /** Live authority gate. Checking permission does not grant arrival authority. */
  enabled: boolean;
  held: boolean;
  scope?: string;
  /** False rejects this QR without latching; repeated identical frames remain suppressed. */
  onDecode: (value: string) => void | boolean;
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
  async function start() {
    if (!props.enabled || props.held || state() === "starting") return;
    // Feedback is optional. Neither an audio policy refusal nor a throwing
    // callback can turn a camera permission gesture into a failed scan.
    try { void Promise.resolve(props.onActivate?.()).catch(() => undefined); } catch { /* optional feedback */ }
    stop(); setError(""); setState("starting");
    const current = generation;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 960 }, height: { ideal: 720 } } });
      if (current !== generation || !props.enabled || props.held || document.hidden) { acquired.getTracks().forEach((track) => track.stop()); if (current === generation) stop(); return; }
      stream = acquired;
      for (const track of acquired.getVideoTracks()) track.addEventListener("ended", () => {
        if (current === generation) { stop(); setError("Camera disconnected. Reconnect it, then start again."); setState("error"); }
      }, { once: true });
      if (!video) throw new Error("Video unavailable");
      video.srcObject = stream;
      await video.play();
      if (current !== generation) return;
      setState("running"); gate = createCameraFrameGate();
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas unavailable");
      const tick = async () => {
        if (current !== generation) return;
        try {

          if (props.enabled && !props.held && !document.hidden && video && video.readyState >= 2 && video.videoWidth) {
            const scale = Math.min(1, 720 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const value = await decodeCameraPixels(context.getImageData(0, 0, canvas.width, canvas.height));
            // Permission/decoder promises can settle after stop, rebind or a hold.
            if (current === generation && props.enabled && !props.held && !document.hidden && gate.accept(value) && value !== null) {
              if (props.onDecode(value) === false) gate.resume();
            }
          }
        } catch (failure) {
          if (current === generation) { stop(); setError(cameraErrorMessage(failure)); setState("error"); }
        }
        if (current === generation) timer = window.setTimeout(() => void tick(), 180);
      };
      void tick();
    } catch (failure) {
      if (current === generation) { stop(); setError(cameraErrorMessage(failure)); setState("error"); }
    }
  }
  return <Show when={props.compact} fallback={<section aria-label={`${props.purpose === "attendee" ? "Attendee" : "Station"} camera`} class="min-w-0 space-y-3">
    <video ref={(element) => { video = element; }} muted playsinline aria-label={`${props.purpose} camera preview`} class="w-full max-w-md rounded-lg bg-black aspect-[4/3] object-contain" hidden={state() !== "running"} />
    <p role="status"><Show when={state() === "starting"} fallback={<Show when={state() === "running"} fallback="Camera off."><Show when={props.held || !props.enabled} fallback="Camera scanning. Show one QR at a time.">Camera paused. Resolve or safely park held work before another attendee.</Show></Show>}>Waiting for camera permission. You can cancel without submitting an arrival.</Show></p>
    <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
    <div class="flex flex-wrap gap-3">
      <button type="button" class="btn btn-primary min-h-12" disabled={!props.enabled || props.held || state() === "starting" || state() === "running"} onClick={() => void start()}>Start {props.purpose} camera</button>
      <button type="button" class="btn btn-outline min-h-12" disabled={state() === "off" || state() === "error"} onClick={stop}>Stop {props.purpose} camera</button>
    </div>
    <p class="text-sm">Camera frames are decoded on this phone and never uploaded. Remove the previous QR before scanning again. Switching apps stops the camera; return here and restart explicitly.</p>
  </section>}>
    <section aria-label={`${props.purpose === "attendee" ? "Attendee" : "Station"} camera`} class="checkin-scanner-compact">
      <div class="checkin-scanner-preview">
        <video ref={(element) => { video = element; }} muted playsinline aria-label={`${props.purpose} camera preview`} hidden={state() !== "running"} />
        <Show when={state() === "running"} fallback={<p class="checkin-scanner-placeholder"><Show when={state() === "starting"} fallback={<Show when={props.purpose === "station"} fallback="Show one attendee QR at a time">Show your station QR</Show>}>Allow camera access to scan</Show></p>}>
          <span class="checkin-scanner-target" aria-hidden="true" />
        </Show>
      </div>
      <p role="status" class="checkin-scanner-status"><Switch fallback="Camera off"><Match when={state() === "starting"}>Waiting for camera permission…</Match><Match when={state() === "running"}><Show when={props.held || !props.enabled} fallback={<Show when={props.purpose === "station"} fallback="Ready for an attendee QR">Ready for your station QR</Show>}>Scanning paused</Show></Match></Switch></p>
      <Show when={error()}><p role="alert" class="text-sm break-words">{error()}</p></Show>
      <div class="checkin-scanner-controls">
        <Show when={state() === "running" || state() === "starting"} fallback={<button type="button" class="btn btn-primary" disabled={!props.enabled || props.held} onClick={() => void start()}>Start scanning</button>}>
          <button type="button" class="btn btn-outline" onClick={stop}><Show when={state() === "starting"} fallback="Stop">Cancel camera</Show></button>
        </Show>
      </div>
    </section>
  </Show>;
}
