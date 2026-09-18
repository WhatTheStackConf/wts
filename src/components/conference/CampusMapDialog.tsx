import { createSignal, onCleanup } from "solid-js";
import { Icon } from "~/components/Icon";
import {
  CAMPUS_MAP_ALT,
  CAMPUS_MAP_HEIGHT,
  CAMPUS_MAP_URL,
  CAMPUS_MAP_WIDTH,
} from "~/lib/campus-map";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.35;

interface Point {
  x: number;
  y: number;
}

interface PinchStart {
  distance: number;
  midpoint: Point;
  offset: Point;
  zoom: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first: Point, second: Point): Point {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

export function CampusMapDialog() {
  let dialog!: HTMLDialogElement;
  let viewport!: HTMLDivElement;
  let previousPageOverflow = "";
  let resizeObserver: ResizeObserver | undefined;

  const pointers = new Map<number, Point>();
  const [fitScale, setFitScale] = createSignal(1);
  const [zoom, setZoom] = createSignal(1);
  const [offset, setOffset] = createSignal<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = createSignal(false);

  let dragStart: { pointer: Point; offset: Point } | undefined;
  let pinchStart: PinchStart | undefined;

  const clampOffset = (next: Point, nextZoom = zoom(), nextFitScale = fitScale()): Point => {
    const viewportWidth = viewport?.clientWidth || 0;
    const viewportHeight = viewport?.clientHeight || 0;
    const imageWidth = CAMPUS_MAP_WIDTH * nextFitScale * nextZoom;
    const imageHeight = CAMPUS_MAP_HEIGHT * nextFitScale * nextZoom;

    const x = imageWidth <= viewportWidth
      ? (viewportWidth - imageWidth) / 2
      : clamp(next.x, viewportWidth - imageWidth, 0);
    const y = imageHeight <= viewportHeight
      ? (viewportHeight - imageHeight) / 2
      : clamp(next.y, viewportHeight - imageHeight, 0);

    return { x, y };
  };

  const resetView = () => {
    if (!viewport) return;
    const edgeInset = viewport.clientWidth >= 768 ? 48 : 8;
    const availableWidth = Math.max(1, viewport.clientWidth - edgeInset * 2);
    const availableHeight = Math.max(1, viewport.clientHeight - edgeInset * 2);
    const nextFitScale = Math.min(
      availableWidth / CAMPUS_MAP_WIDTH,
      availableHeight / CAMPUS_MAP_HEIGHT,
    );
    const imageWidth = CAMPUS_MAP_WIDTH * nextFitScale;
    const imageHeight = CAMPUS_MAP_HEIGHT * nextFitScale;

    setFitScale(nextFitScale);
    setZoom(1);
    setOffset({
      x: (viewport.clientWidth - imageWidth) / 2,
      y: (viewport.clientHeight - imageHeight) / 2,
    });
  };

  const zoomAround = (nextZoom: number, origin?: Point) => {
    const currentZoom = zoom();
    const boundedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (boundedZoom === currentZoom) return;

    const focalPoint = origin ?? {
      x: viewport.clientWidth / 2,
      y: viewport.clientHeight / 2,
    };
    const ratio = boundedZoom / currentZoom;
    const currentOffset = offset();
    const nextOffset = {
      x: focalPoint.x - (focalPoint.x - currentOffset.x) * ratio,
      y: focalPoint.y - (focalPoint.y - currentOffset.y) * ratio,
    };

    setZoom(boundedZoom);
    setOffset(clampOffset(nextOffset, boundedZoom));
  };

  const openMap = () => {
    if (dialog.open) return;
    previousPageOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    dialog.showModal();
    requestAnimationFrame(resetView);
  };

  const closeMap = () => {
    if (dialog.open) dialog.close();
  };

  const handleClose = () => {
    document.documentElement.style.overflow = previousPageOverflow;
    pointers.clear();
    dragStart = undefined;
    pinchStart = undefined;
    setDragging(false);
  };

  const viewportPoint = (event: MouseEvent | PointerEvent | WheelEvent): Point => {
    const bounds = viewport.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const beginPinch = () => {
    const [first, second] = Array.from(pointers.values());
    if (!first || !second) return;
    pinchStart = {
      distance: Math.max(1, distance(first, second)),
      midpoint: midpoint(first, second),
      offset: offset(),
      zoom: zoom(),
    };
    dragStart = undefined;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    viewport.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, viewportPoint(event));
    setDragging(true);

    if (pointers.size === 1) {
      dragStart = { pointer: viewportPoint(event), offset: offset() };
    } else if (pointers.size === 2) {
      beginPinch();
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, viewportPoint(event));

    if (pointers.size >= 2 && pinchStart) {
      const [first, second] = Array.from(pointers.values());
      if (!first || !second) return;
      const currentMidpoint = midpoint(first, second);
      const nextZoom = clamp(
        pinchStart.zoom * (distance(first, second) / pinchStart.distance),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const ratio = nextZoom / pinchStart.zoom;
      const nextOffset = {
        x: currentMidpoint.x - (pinchStart.midpoint.x - pinchStart.offset.x) * ratio,
        y: currentMidpoint.y - (pinchStart.midpoint.y - pinchStart.offset.y) * ratio,
      };
      setZoom(nextZoom);
      setOffset(clampOffset(nextOffset, nextZoom));
      return;
    }

    if (pointers.size === 1 && dragStart) {
      const current = viewportPoint(event);
      setOffset(clampOffset({
        x: dragStart.offset.x + current.x - dragStart.pointer.x,
        y: dragStart.offset.y + current.y - dragStart.pointer.y,
      }));
    }
  };

  const handlePointerEnd = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 1) {
      const pointer = Array.from(pointers.values())[0];
      dragStart = pointer ? { pointer, offset: offset() } : undefined;
      pinchStart = undefined;
      return;
    }
    if (pointers.size === 0) {
      dragStart = undefined;
      pinchStart = undefined;
      setDragging(false);
    }
  };

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.002);
    zoomAround(zoom() * factor, viewportPoint(event));
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const panDistance = 48;
    const currentOffset = offset();
    if (event.key === "+" || event.key === "=") zoomAround(zoom() * ZOOM_STEP);
    else if (event.key === "-") zoomAround(zoom() / ZOOM_STEP);
    else if (event.key === "0") resetView();
    else if (event.key === "ArrowLeft") setOffset(clampOffset({ ...currentOffset, x: currentOffset.x + panDistance }));
    else if (event.key === "ArrowRight") setOffset(clampOffset({ ...currentOffset, x: currentOffset.x - panDistance }));
    else if (event.key === "ArrowUp") setOffset(clampOffset({ ...currentOffset, y: currentOffset.y + panDistance }));
    else if (event.key === "ArrowDown") setOffset(clampOffset({ ...currentOffset, y: currentOffset.y - panDistance }));
    else return;
    event.preventDefault();
  };

  onCleanup(() => {
    resizeObserver?.disconnect();
    if (dialog?.open) dialog.close();
    if (typeof document !== "undefined") {
      document.documentElement.style.overflow = previousPageOverflow;
    }
  });

  return (
    <>
      <button type="button" class="btn btn-primary min-h-12 w-full sm:w-auto" aria-haspopup="dialog" onClick={openMap}>
        <Icon icon="material-symbols:map-outline" class="text-xl" aria-hidden="true" />
        Campus map
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="campus-map-dialog-title"
        class="m-auto h-dvh w-screen max-w-none bg-transparent p-0 text-white backdrop:bg-dark-950/95"
        onClose={handleClose}
      >
        <section class="flex h-dvh w-screen flex-col bg-dark-950/95">
          <header class="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-white/15 bg-dark-900/95 px-3 py-2 sm:px-5">
            <div class="min-w-0">
              <h2 id="campus-map-dialog-title" class="truncate font-star text-xl text-secondary-300 sm:text-2xl">
                <span class="sm:hidden">Map</span>
                <span class="hidden sm:inline">WTS 2026 campus map</span>
              </h2>
              <p class="hidden text-xs text-secondary-200/75 sm:block">Drag to pan · scroll or pinch to zoom</p>
            </div>
            <div class="flex shrink-0 items-center gap-1" aria-label="Map controls">
              <button
                type="button"
                class="btn btn-ghost btn-square min-h-11 min-w-11 text-2xl"
                aria-label="Zoom out"
                disabled={zoom() <= MIN_ZOOM}
                onClick={() => zoomAround(zoom() / ZOOM_STEP)}
              >
                −
              </button>
              <button
                type="button"
                class="btn btn-ghost min-h-11 min-w-16 px-2 font-mono text-xs"
                aria-label="Reset map zoom"
                onClick={resetView}
              >
                {Math.round(zoom() * 100)}%
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-square min-h-11 min-w-11 text-2xl"
                aria-label="Zoom in"
                disabled={zoom() >= MAX_ZOOM}
                onClick={() => zoomAround(zoom() * ZOOM_STEP)}
              >
                +
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-square ml-1 min-h-11 min-w-11 text-2xl"
                aria-label="Close campus map"
                autofocus
                onClick={closeMap}
              >
                ×
              </button>
            </div>
          </header>

          <div
            ref={(element) => {
              viewport = element;
              resizeObserver = new ResizeObserver(() => {
                if (dialog.open) resetView();
              });
              resizeObserver.observe(element);
            }}
            class={`relative min-h-0 flex-1 overflow-hidden bg-dark-950 outline-none select-none ${dragging() ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ "touch-action": "none" }}
            tabindex="0"
            aria-label="Interactive campus map. Use arrow keys to pan, plus and minus to zoom, and zero to reset."
            onKeyDown={handleKeyDown}
            onWheel={handleWheel}
            onDblClick={(event) => zoomAround(zoom() > 1 ? 1 : 2, viewportPoint(event))}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          >
            <img
              src={CAMPUS_MAP_URL}
              alt={CAMPUS_MAP_ALT}
              width={CAMPUS_MAP_WIDTH}
              height={CAMPUS_MAP_HEIGHT}
              draggable={false}
              class="pointer-events-none absolute left-0 top-0 h-auto max-w-none will-change-transform"
              style={{
                width: `${CAMPUS_MAP_WIDTH}px`,
                transform: `translate3d(${offset().x}px, ${offset().y}px, 0) scale(${fitScale() * zoom()})`,
                "transform-origin": "top left",
              }}
            />
          </div>

          <p class="shrink-0 border-t border-white/15 bg-dark-900/95 px-4 py-2 text-center font-mono text-xs text-secondary-200/75 sm:hidden">
            Drag to pan · pinch to zoom
          </p>
        </section>
      </dialog>
    </>
  );
}
