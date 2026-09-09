import { Show, createSignal, onSettled } from "solid-js";
import type { LabelRasterResult } from "~/lib/checkin-label-render-contract";

/** Displays the server's exact font-backed PNG. Never measures text or substitutes
 * a browser font, so the browser cannot diverge from production row fitting. */
export function NameLabelRaster(props: { result: LabelRasterResult }) {
  let canvas: HTMLCanvasElement | undefined;
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal("");
  onSettled(() => {
    let cancelled = false;
    const result = props.result;
    const image = new Image();
    image.src = `data:image/png;base64,${result.pngBase64}`;
    void image.decode().then(() => {
      if (cancelled || !canvas) return;
      const context = canvas.getContext("2d");
      if (!context || image.naturalWidth !== result.width || image.naturalHeight !== result.height) throw new Error("Invalid raster dimensions");
      canvas.width = result.width; canvas.height = result.height;
      context.drawImage(image, 0, 0);
      setReady(true);
    }).catch(() => { if (!cancelled) setError("Raster could not be displayed. Preview again; do not use a missing or stale image."); });
    return () => { cancelled = true; image.src = ""; };
  });
  return (
    <figure class="min-w-0 space-y-3">
      <Show when={error()}><p class="alert alert-error" role="alert">{error()}</p></Show>
      <canvas ref={(element) => { canvas = element; }} role="img" aria-label="Rendered Name Label" aria-describedby="label-render-description" data-payload-hash={ready() ? props.result.payloadHash : undefined} width={props.result.width} height={props.result.height} class="h-auto max-w-full rounded border border-base-content/30 bg-white" style={{ visibility: ready() ? "visible" : "hidden" }} />
      <figcaption id="label-render-description" class="space-y-2 break-words">
        <p>Exact production-boundary raster · {props.result.width} × {props.result.height} dots. Pinned font loaded on the server; no browser fallback font.</p>
        <p><strong>Row 1:</strong> {props.result.rows[0].text} · {props.result.rows[0].fontSize} dots, bold</p>
        <p><strong>Row 2:</strong> {props.result.rows[1].text || "(blank)"} · {props.result.rows[1].fontSize} dots</p>
        <Show when={props.result.rows[0].shortened}><p role="status" class="text-warning font-bold">Name shortened with ellipsis</p></Show>
        <Show when={props.result.rows[1].shortened}><p role="status" class="text-warning font-bold">Affiliation shortened with ellipsis</p></Show>
        <Show when={!props.result.rows[1].text}><p>Affiliation row is blank</p></Show>
        <p class="text-sm">Renderer: {props.result.snapshot.rendererVersion}<br />Font: {props.result.snapshot.fontVersion}</p>
        <p class="text-xs break-all">Payload identity: {props.result.payloadHash}</p>
        <p class="font-bold">Preview is not physical calibration or approval. No admission or print intent was created.</p>
      </figcaption>
    </figure>
  );
}
