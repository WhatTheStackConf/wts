import { createEffect, createSignal, onSettled, untrack } from "solid-js";
import {
  LAUNCH_STATIONS,
  flightFromScroll,
  reachableTops,
  launchState,
  type LaunchState,
} from "~/components/landing/launch-model";
import { GLITCH_MS, glitchStrength, mayGlitch, nextAmbientDelay } from "~/components/landing/launch-glitch";
import type { LaunchRenderer as RendererHandle } from "~/components/landing/launch-renderer";
import { SkopjeSkyline } from "~/components/landing/SkopjeSkyline";
import "~/styles/launch-scene.css";

export type LaunchSceneMode = "static" | "webgl";

type RendererStatus = "static" | "loading" | "webgl" | "unavailable";

interface RendererModule {
  createLaunchRenderer(
    canvas: HTMLCanvasElement,
    onContextLost: () => void,
  ): RendererHandle | undefined;
}

interface LaunchSceneProps {
  onNightChange?: (night: boolean) => void;
  onModeChange?: (mode: LaunchSceneMode) => void;
}

interface SceneParts {
  frame: HTMLElement;
  ground: HTMLElement;
}

interface FlightHooks {
  draw(state: LaunchState): void;
  night(night: boolean): void;
  station(): void;
}

const STATION_ORDER = LAUNCH_STATIONS.map((station) => station.id);
const COUNTDOWN = launchState(0);
// Prototype lag: close 12% of the gap per 30 fps frame, independent of the display rate.
const LAG_PER_FRAME = 0.12;
const LAG_FRAME_MS = 1000 / 30;
const MAX_STEP_MS = 100;
const SETTLED = 1e-4;
const BAR_MS = 2400;
const IGNITION_PX = 1.6;
const REVEAL_FRAMES = 3;

function stationTops(root: ParentNode): number[] {
  const scrollY = window.scrollY;
  const measured = STATION_ORDER.map((id) => {
    const element = root.querySelector<HTMLElement>(`[data-launch-station="${id}"]`);
    return element ? element.getBoundingClientRect().top + scrollY : Number.NaN;
  });
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const tops = reachableTops(measured, maxScroll, window.innerHeight);
  // The countdown hero lives in the fixed cover, so its measured top follows the scroll.
  for (let index = tops.length - 2; index >= 0; index -= 1) {
    tops[index] = Math.min(tops[index], tops[index + 1]);
  }
  return tops;
}

function easeToward(current: number, target: number, elapsedMs: number): number {
  const keep = (1 - LAG_PER_FRAME) ** (elapsedMs / LAG_FRAME_MS);
  const next = target + (current - target) * keep;
  return Math.abs(target - next) < SETTLED ? target : next;
}

function shakeTransform(amplitude: number, seconds: number): string {
  if (amplitude <= 0.01) return "";
  const x = (Math.sin(seconds * 61) + Math.sin(seconds * 37)) * amplitude * 0.5;
  const y = (Math.sin(seconds * 53 + 1) + Math.sin(seconds * 29)) * amplitude * 0.5;
  const turn = Math.sin(seconds * 17) * amplitude * 0.06;
  return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${turn.toFixed(3)}deg)`;
}

function placeParts(parts: SceneParts, state: LaunchState) {
  // The skyline rides the shader horizon until the ground has left the window.
  const drop = (COUNTDOWN.horizon - state.horizon) * 100;
  parts.ground.style.visibility = state.ground > 0 ? "" : "hidden";
  parts.ground.style.transform = drop ? `translate3d(0, ${drop.toFixed(3)}%, 0)` : "";
}

function resetParts(parts: SceneParts) {
  for (const element of [parts.frame, parts.ground]) {
    element.style.transform = "";
    element.style.visibility = "";
  }
}

class LaunchFlight {
  private target = 0;
  private flight = 0;
  private night = false;
  private running = false;
  private frameId = 0;
  private lastTime = 0;
  private ignitionAt = Number.NEGATIVE_INFINITY;
  private station: LaunchState["station"] | undefined;

  constructor(
    private readonly parts: SceneParts,
    private readonly hooks: FlightHooks,
  ) {}

  aim(target: number) {
    this.target = target;
    if (this.running) {
      this.wake();
      return;
    }
    this.flight = target;
    this.publishNight(launchState(target).night);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.flight = this.target;
    this.lastTime = 0;
    this.apply(launchState(this.flight), 0);
    this.wake();
  }

  stop() {
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.lastTime = 0;
  }

  reset() {
    this.stop();
    resetParts(this.parts);
  }

  private wake() {
    if (this.running && !this.frameId) this.frameId = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.frameId = 0;
    if (!this.running) return;
    const previous = this.flight;
    const elapsed = this.lastTime ? Math.min(now - this.lastTime, MAX_STEP_MS) : 0;
    this.flight = easeToward(this.flight, this.target, elapsed);
    if (previous < 1 && this.flight >= 1) this.ignitionAt = now;
    const state = launchState(this.flight);
    const shake = state.shake + Math.max(0, 1 - (now - this.ignitionAt) / BAR_MS) * IGNITION_PX;
    this.apply(state, shake, now);
    const moving = this.flight !== this.target || shake > 0.01;
    this.lastTime = moving ? now : 0;
    if (moving) this.wake();
  };

  private apply(state: LaunchState, shake: number, now = 0) {
    this.hooks.draw(state);
    placeParts(this.parts, state);
    this.parts.frame.style.transform = shakeTransform(shake, now / 1000);
    this.publishNight(state.night);
    if (this.station !== undefined && state.station !== this.station) this.hooks.station();
    this.station = state.station;
  }

  private publishNight(night: boolean) {
    if (night === this.night) return;
    this.night = night;
    this.hooks.night(night);
  }
}

/** The odd signal glitch: the sky shader slices and the skyline jumps for one short hit. */
class SignalGlitch {
  private enabled = false;
  private timer = 0;
  private frameId = 0;
  private startedAt = Number.NEGATIVE_INFINITY;
  private seed = 0;

  constructor(
    private readonly scene: HTMLElement,
    private readonly target: () => RendererHandle | undefined,
  ) {}

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.queue();
  }

  disable() {
    this.enabled = false;
    window.clearTimeout(this.timer);
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.finish();
  }

  fire() {
    const now = performance.now();
    if (!this.enabled || !mayGlitch(now, this.startedAt)) return;
    this.startedAt = now;
    this.seed = (this.seed + 1) % 64;
    this.scene.dataset.glitch = this.seed % 2 ? "a" : "b";
    this.queue();
    if (!this.frameId) this.frameId = requestAnimationFrame(this.frame);
  }

  private queue() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.fire(), nextAmbientDelay(Math.random()));
  }

  private readonly frame = (now: number) => {
    this.frameId = 0;
    const age = now - this.startedAt;
    if (age >= GLITCH_MS) {
      this.finish();
      return;
    }
    this.target()?.setGlitch(glitchStrength(age), this.seed + 0.37);
    this.frameId = requestAnimationFrame(this.frame);
  };

  private finish() {
    this.target()?.setGlitch(0, this.seed);
    delete this.scene.dataset.glitch;
  }
}

function readMotionPermission(query: MediaQueryList): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !query.matches && !connection?.saveData;
}

function scheduleIdle(callback: () => void): () => void {
  const idleWindow = window as Window & {
    requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 1600 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, 180);
  return () => window.clearTimeout(handle);
}

// The renderer draws on its own clock after its canvas is sized; wait a few frames so the
// first visible canvas frame is a drawn one, never an empty buffer.
function afterFirstFrames(canvas: HTMLCanvasElement, done: () => void): () => void {
  let frameId = 0;
  let frames = 0;
  const count = () => {
    frames += 1;
    frameId = frames >= REVEAL_FRAMES ? 0 : requestAnimationFrame(count);
    if (!frameId) done();
  };
  const observer = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1]?.contentRect;
    if (!box || box.width <= 0 || box.height <= 0) return;
    observer.disconnect();
    frameId = requestAnimationFrame(count);
  });
  observer.observe(canvas);
  return () => {
    observer.disconnect();
    if (frameId) cancelAnimationFrame(frameId);
  };
}

export default function LaunchScene(props: LaunchSceneProps) {
  const [rendererStatus, setRendererStatus] = createSignal<RendererStatus>("static");
  const [revealed, setRevealed] = createSignal(false);
  const [pageVisible, setPageVisible] = createSignal(true);
  const [motionAllowed, setMotionAllowed] = createSignal(true);
  const [pageLoaded, setPageLoaded] = createSignal(false);
  let hostElement: HTMLDivElement | undefined;
  let frameElement: HTMLDivElement | undefined;
  let groundElement: HTMLDivElement | undefined;
  let canvasElement: HTMLCanvasElement | undefined;
  let renderer: RendererHandle | undefined;
  let rendererModule: RendererModule | undefined;
  let flight: LaunchFlight | undefined;
  let glitch: SignalGlitch | undefined;
  let disposed = false;
  let importStarted = false;
  let cancelIdle: (() => void) | undefined;
  let cancelReveal: (() => void) | undefined;

  const sceneWanted = () => motionAllowed() && pageVisible();
  const isRendering = () => rendererStatus() === "webgl" && sceneWanted();
  const mode = (): LaunchSceneMode => (rendererStatus() === "webgl" && motionAllowed() && revealed() ? "webgl" : "static");
  const canvasState = () => {
    if (rendererStatus() !== "webgl" || !motionAllowed()) return "off";
    return revealed() ? "on" : "warming";
  };

  const setUnavailable = () => {
    cancelReveal?.();
    flight?.stop();
    renderer?.stop();
    renderer?.dispose();
    renderer = undefined;
    setRevealed(false);
    setRendererStatus("unavailable");
  };

  const startScene = () => {
    if (!renderer) return;
    flight?.start();
    renderer.start();
  };

  const createRenderer = () => {
    if (disposed || renderer || !rendererModule || !canvasElement || !sceneWanted()) return;
    if (rendererStatus() === "unavailable") return;
    const created = rendererModule.createLaunchRenderer(canvasElement, setUnavailable);
    if (!created) {
      setUnavailable();
      return;
    }
    renderer = created;
    setRendererStatus("webgl");
    startScene();
    cancelReveal = afterFirstFrames(canvasElement, () => setRevealed(true));
  };

  const loadRenderer = () => {
    cancelIdle = undefined;
    if (disposed || !sceneWanted()) {
      importStarted = false;
      setRendererStatus("static");
      return;
    }
    void import("~/components/landing/launch-renderer").then((module) => {
      if (disposed) return;
      rendererModule = module;
      createRenderer();
    }).catch(() => {
      if (!disposed) setRendererStatus("unavailable");
    });
  };

  const beginDeferredImport = () => {
    if (disposed || importStarted || !pageLoaded() || !sceneWanted()) return;
    importStarted = true;
    setRendererStatus("loading");
    cancelIdle = scheduleIdle(loadRenderer);
  };

  // Solid 2 event writes settle later; reconcile from committed state.
  createEffect(
    () => ({ canLoad: pageLoaded() && sceneWanted(), running: isRendering() }),
    ({ canLoad, running }) => {
      if (disposed) return;
      if (running) startScene();
      else {
        renderer?.stop();
        flight?.stop();
      }
      if (canLoad) untrack(() => {
        createRenderer();
        beginDeferredImport();
      });
    },
  );

  // Effects can re-run with an unchanged value; act on real mode changes only.
  let reportedMode: LaunchSceneMode | undefined;
  createEffect(mode, (current) => {
    if (current === reportedMode) return;
    reportedMode = current;
    if (current === "static") flight?.reset();
    props.onModeChange?.(current);
  });

  // Glitches play only over a drawn WebGL window, never in the static or reduced-motion scene.
  createEffect(
    () => isRendering() && revealed(),
    (on) => (on ? glitch?.enable() : glitch?.disable()),
  );

  const setHostRef = (element: HTMLDivElement) => { hostElement = element; };
  const setFrameRef = (element: HTMLDivElement) => { frameElement = element; };
  const setGroundRef = (element: HTMLDivElement) => { groundElement = element; };
  const setCanvasRef = (element: HTMLCanvasElement) => { canvasElement = element; };

  const watchScroll = (root: ParentNode, track: LaunchFlight) => {
    let tops = stationTops(root);
    const onScroll = () => track.aim(flightFromScroll(window.scrollY, window.innerHeight, tops));
    const remeasure = () => {
      tops = stationTops(root);
      onScroll();
    };
    const layoutObserver = new ResizeObserver(remeasure);
    if (root instanceof Element) layoutObserver.observe(root);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", remeasure);
    void document.fonts?.ready.then(remeasure);
    onScroll();
    return () => {
      layoutObserver.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", remeasure);
    };
  };

  const watchPermissions = () => {
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const refreshPermission = () => {
      const allowed = readMotionPermission(motionPreference);
      setMotionAllowed(allowed);
      if (allowed) return;
      cancelIdle?.();
      cancelIdle = undefined;
      if (!renderer) importStarted = false;
    };
    const updatePageVisibility = () => setPageVisible(!document.hidden);
    refreshPermission();
    updatePageVisibility();
    motionPreference.addEventListener("change", refreshPermission);
    document.addEventListener("visibilitychange", updatePageVisibility);
    return () => {
      motionPreference.removeEventListener("change", refreshPermission);
      document.removeEventListener("visibilitychange", updatePageVisibility);
    };
  };

  onSettled(() => {
    if (!hostElement || !frameElement || !groundElement || typeof window === "undefined") return;
    const onLoad = () => setPageLoaded(true);
    setPageLoaded(document.readyState === "complete");
    if (document.readyState !== "complete") window.addEventListener("load", onLoad, { once: true });

    flight = new LaunchFlight(
      { frame: frameElement, ground: groundElement },
      {
        draw: (state) => renderer?.setState(state),
        night: (night) => props.onNightChange?.(night),
        station: () => glitch?.fire(),
      },
    );
    glitch = new SignalGlitch(hostElement, () => renderer);
    const stopPermissions = watchPermissions();
    const stopScroll = watchScroll(hostElement.parentElement ?? document, flight);

    return () => {
      disposed = true;
      cancelIdle?.();
      cancelReveal?.();
      stopPermissions();
      stopScroll();
      window.removeEventListener("load", onLoad);
      flight?.reset();
      glitch?.disable();
      renderer?.stop();
      renderer?.dispose(true);
      renderer = undefined;
    };
  });

  return (
    <div
      ref={setHostRef}
      class="launch-scene"
      aria-hidden="true"
      data-renderer={rendererStatus()}
      data-mode={mode()}
    >
      <div ref={setFrameRef} class="launch-scene__frame">
        <div class="launch-scene__sky" />
        <canvas ref={setCanvasRef} class="launch-scene__canvas" data-state={canvasState()} />
        <div ref={setGroundRef} class="launch-scene__ground">
          <SkopjeSkyline class="launch-scene__skyline" />
          <span class="launch-scene__ground-line" />
          <span class="launch-scene__datum">Skopje {LAUNCH_STATIONS[0].datum}</span>
        </div>
      </div>
    </div>
  );
}
