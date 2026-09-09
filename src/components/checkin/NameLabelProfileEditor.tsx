import { For, Show, createSignal } from "solid-js";
import { LABEL_FONT_VERSION, LABEL_RENDERER_VERSION, SYNTHETIC_LABEL_CONFIG, type LabelProfileConfig } from "~/lib/checkin-label-render-contract";
import type { LabelProfileStation } from "~/lib/checkin-label-client";

const geometryFields = [
  ["raster.width", "Raster width", 1], ["raster.height", "Raster height", 1],
  ["printable.x", "Printable left", 0], ["printable.y", "Printable top", 0],
  ["printable.width", "Printable width", 1], ["printable.height", "Printable height", 1],
  ["margins.top", "Top safe margin", 0], ["margins.right", "Right safe margin", 0],
  ["margins.bottom", "Bottom safe margin", 0], ["margins.left", "Left safe margin", 0],
  ["offset.x", "Horizontal offset", -2048], ["offset.y", "Vertical offset", -2048],
  ["feed.gapDots", "Gap feed", 1], ["feed.advanceDots", "Additional feed", 0],
  ["density", "Density (1–5)", 1], ["threshold", "Monochrome threshold (1–254)", 1],
] as const;
interface Props { station: LabelProfileStation; existing?: LabelProfileConfig; locked: boolean; review(config: LabelProfileConfig): void }
function values(config: LabelProfileConfig): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name] of geometryFields) {
    const [group, key] = name.split(".");
    const value = config[group as keyof LabelProfileConfig];
    fields[name] = String(key ? (value as Record<string, unknown>)[key] : value);
  }
  return fields;
}

/** Physical mode deliberately starts empty. Synthetic dots cannot become a
 * purported measured profile merely by unticking a checkbox. */
export function NameLabelProfileEditor(props: Props) {
  const initial = props.existing ?? SYNTHETIC_LABEL_CONFIG;
  const [synthetic, setSynthetic] = createSignal(initial.synthetic);
  const [measurements, setMeasurements] = createSignal(values(initial));
  const [stockRef, setStockRef] = createSignal(initial.stockRef);
  const [direction, setDirection] = createSignal<LabelProfileConfig["direction"]>(initial.direction);
  function changeMode(value: boolean) {
    setSynthetic(value); setMeasurements(value ? values(SYNTHETIC_LABEL_CONFIG) : {});
    setStockRef(value ? SYNTHETIC_LABEL_CONFIG.stockRef : ""); setDirection(0);
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (props.locked) return;
    const n = (name: string) => Number(measurements()[name]);
    const config: LabelProfileConfig = {
      rendererVersion: LABEL_RENDERER_VERSION, fontVersion: LABEL_FONT_VERSION,
      printerRef: props.station.printerRef, stockRef: stockRef(), synthetic: synthetic(),
      media: { widthMm: 50, heightMm: 30, kind: "precut-gap" },
      raster: { width: n("raster.width"), height: n("raster.height") },
      printable: { x: n("printable.x"), y: n("printable.y"), width: n("printable.width"), height: n("printable.height") },
      margins: { top: n("margins.top"), right: n("margins.right"), bottom: n("margins.bottom"), left: n("margins.left") },
      offset: { x: n("offset.x"), y: n("offset.y") }, direction: direction(),
      feed: { mode: "gap", gapDots: n("feed.gapDots"), advanceDots: n("feed.advanceDots") }, density: n("density"), threshold: n("threshold"),
    };
    props.review(config);
  }
  return (
    <form method="post" action="/api/checkin-labels" aria-label="Edit Name Label profile" onSubmit={submit}>
      <fieldset disabled={props.locked || !props.station.printerRef} class="min-w-0 space-y-4">
        <legend class="text-lg font-bold">New immutable profile version</legend>
        <p>Printer asset: {props.station.printerRef || "Not configured — set the station printer asset reference first"}. Configuration saves as unapproved, including changes to previously approved profiles.</p>
        <p class="text-sm">Printer and stock asset references use 1–80 letters, digits, dots, underscores or hyphens, starting with a letter or digit. Do not enter device paths, credentials or capability identifiers.</p>
        <label for="label-profile-synthetic" class="flex gap-3 items-start"><input id="label-profile-synthetic" type="checkbox" class="checkbox" checked={synthetic()} onChange={(event) => changeMode(event.currentTarget.checked)} /><span>Synthetic profile — tests and previews only</span></label>
        <Show when={!synthetic()}><p class="alert alert-warning">Enter measured device dots for this exact printer and stock. Changing to measured mode clears synthetic dimensions. Saving or previewing is not physical approval.</p></Show>
        <label for="label-stock" class="block font-medium">Stock asset reference</label>
        <input id="label-stock" class="input input-bordered min-h-12 w-full text-base" required maxlength={80} value={stockRef()} onInput={(event) => setStockRef(event.currentTarget.value)} />
        <p>Stock format fixed: 50×30 mm generic pre-cut gap. Geometry, margins, offsets and feed below are dots, not mm. Density and threshold are device/raster settings.</p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <For each={geometryFields}>{([key, label, min]) => (
            <div class="min-w-0">
              <label for={`label-${key}`} class="block font-medium">{label}</label>
              <input id={`label-${key}`} type="number" class="input input-bordered min-h-12 w-full min-w-0 text-base" required step={1} min={min} max={key === "density" ? 5 : key === "threshold" ? 254 : 2048} value={measurements()[key] ?? ""} onInput={(event) => setMeasurements((current) => ({ ...current, [key]: event.currentTarget.value }))} />
            </div>
          )}</For>
        </div>
        <label for="label-direction" class="block font-medium">Raster direction</label>
        <select id="label-direction" class="select select-bordered min-h-12 w-full text-base" value={direction()} onChange={(event) => setDirection(Number(event.currentTarget.value) as LabelProfileConfig["direction"])}>
          <For each={[0, 90, 180, 270]}>{(degrees) => <option value={degrees}>{degrees}° clockwise</option>}</For>
        </select>
        <p class="text-sm break-words">Renderer: {LABEL_RENDERER_VERSION}<br />Font: {LABEL_FONT_VERSION}. Font sizes and the two-row layout are renderer-owned, not a label designer.</p>
        <button type="submit" class="btn btn-outline min-h-12">Review Name Label profile</button>
      </fieldset>
    </form>
  );
}
