import { createEffect, createSignal, onSettled } from "solid-js";
import type { LaunchRenderer as RendererHandle } from "~/components/landing/launch-renderer";
import { PlanetHorizonArtwork } from "~/components/landing/LaunchArtwork";
import "~/styles/launch-scene.css";

interface RendererModule {
  createLaunchRenderer(
    canvas: HTMLCanvasElement,
    onContextLost: () => void,
  ): RendererHandle | undefined;
}

interface LaunchSceneProps {
  active?: boolean;
}

export default function LaunchScene(props: LaunchSceneProps) {
  const [rendererStatus, setRendererStatus] = createSignal<"static" | "loading" | "webgl" | "unavailable">("static");
  const [inView, setInView] = createSignal(false);
  const [pageVisible, setPageVisible] = createSignal(true);
  const [motionAllowed, setMotionAllowed] = createSignal(true);
  const [pageLoaded, setPageLoaded] = createSignal(false);
  let hostElement: HTMLDivElement | undefined;
  let canvasElement: HTMLCanvasElement | undefined;
  let renderer: RendererHandle | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let rendererModule: RendererModule | undefined;
  let disposed = false;
  let importStarted = false;
  let importRequested = false;
  let cancelIdle: (() => void) | undefined;

  const isRendering = () => rendererStatus() === "webgl" && motionAllowed() && inView() && pageVisible() && (props.active ?? true);
  const motionState = () => {
    if (rendererStatus() !== "webgl" || !motionAllowed()) return "static";
    return isRendering() ? "running" : "paused";
  };

  const setUnavailable = () => {
    renderer?.stop();
    renderer?.dispose();
    renderer = undefined;
    setRendererStatus("unavailable");
  };

  const createRenderer = () => {
    if (disposed || rendererStatus() === "unavailable" || renderer || !rendererModule || !canvasElement || !motionAllowed() || !inView() || !pageVisible() || !(props.active ?? true)) return;
    const created = rendererModule.createLaunchRenderer(canvasElement, setUnavailable);
    if (!created) {
      setUnavailable();
      return;
    }
    renderer = created;
    setRendererStatus("webgl");
  };

  const beginDeferredImport = () => {
    if (disposed || importStarted || !pageLoaded() || !motionAllowed() || !inView() || !pageVisible() || !(props.active ?? true)) return;
    importStarted = true;
    setRendererStatus("loading");
    const loadRenderer = () => {
      cancelIdle = undefined;
      if (disposed || !motionAllowed()) return;
      if (!inView() || !pageVisible() || !(props.active ?? true)) {
        importStarted = false;
        setRendererStatus("static");
        return;
      }
      importRequested = true;
      void import("~/components/landing/launch-renderer").then((module) => {
        if (disposed) return;
        rendererModule = module;
        setRendererStatus("static");
        createRenderer();
      }).catch(() => {
        if (!disposed) setRendererStatus("unavailable");
      });
    };

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(loadRenderer, { timeout: 1600 });
      cancelIdle = () => idleWindow.cancelIdleCallback?.(handle);
    } else {
      const handle = window.setTimeout(loadRenderer, 180);
      cancelIdle = () => window.clearTimeout(handle);
    }
  };

  const onIntersection = (entries: IntersectionObserverEntry[]) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    setInView(entry.isIntersecting);
  };

  // Solid 2 event writes settle later; reconcile from committed state.
  createEffect(
    () => ({ canLoad: pageLoaded() && motionAllowed() && inView() && pageVisible() && (props.active ?? true), running: isRendering() }),
    ({ canLoad, running }) => {
      if (disposed) return;
      if (running) renderer?.start();
      else renderer?.stop();
      if (canLoad) {
        createRenderer();
        beginDeferredImport();
      } else if (cancelIdle) {
        cancelIdle();
        cancelIdle = undefined;
        if (!importRequested) {
          importStarted = false;
          setRendererStatus("static");
        }
      }
    },
  );

  const setHostRef = (element: HTMLDivElement) => { hostElement = element; };
  const setCanvasRef = (element: HTMLCanvasElement) => { canvasElement = element; };

  onSettled(() => {
    if (!hostElement || typeof window === "undefined") return;
    const onLoad = () => setPageLoaded(true);
    setPageLoaded(document.readyState === "complete");
    if (document.readyState !== "complete") window.addEventListener("load", onLoad, { once: true });

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const refreshPermission = () => {
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      const allowed = !motionPreference.matches && !connection?.saveData;
      setMotionAllowed(allowed);
      if (!allowed) {
        cancelIdle?.();
        cancelIdle = undefined;
        if (renderer) {
          renderer.stop();
        } else {
          if (!importRequested) importStarted = false;
          setRendererStatus("static");
        }
      }
    };
    refreshPermission();
    motionPreference.addEventListener("change", refreshPermission);
    const updatePageVisibility = () => {
      setPageVisible(!document.hidden);
    };
    setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", updatePageVisibility);
    intersectionObserver = new IntersectionObserver(onIntersection, { threshold: 0.01 });
    intersectionObserver.observe(hostElement);

    return () => {
      disposed = true;
      cancelIdle?.();
      intersectionObserver?.disconnect();
      motionPreference.removeEventListener("change", refreshPermission);
      document.removeEventListener("visibilitychange", updatePageVisibility);
      window.removeEventListener("load", onLoad);
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
      data-motion={motionState()}
    >
      <span class="launch-scene__star launch-scene__star--one" />
      <span class="launch-scene__star launch-scene__star--two" />
      <span class="launch-scene__star launch-scene__star--three" />
      <span class="launch-scene__star launch-scene__star--four" />
      <span class="launch-scene__star launch-scene__star--five" />
      <span class="launch-scene__star launch-scene__star--six" />
      <PlanetHorizonArtwork />
      <canvas
        ref={setCanvasRef}
        class="launch-scene__canvas"
        hidden={rendererStatus() !== "webgl" || !motionAllowed()}
        style={{ display: rendererStatus() === "webgl" && motionAllowed() ? "block" : "none" }}
      />
    </div>
  );
}
