import { For, Show, createSignal, onSettled } from "solid-js";
import { createAsyncResource } from "~/lib/async-resource";
import { listLabelProfiles, previewNameLabel } from "~/lib/checkin-label-client";
import type { LabelRasterResult } from "~/lib/checkin-label-render-contract";
import { NameLabelRaster } from "~/components/checkin/NameLabelRaster";
import { NameLabelProfileAdmin } from "~/components/checkin/NameLabelProfileAdmin";

export function CheckinLabelAdmin() {
  const [catalogue, actions] = createAsyncResource(listLabelProfiles);
  const [profileId, setProfileId] = createSignal("");
  const [name, setName] = createSignal("");
  const [affiliation, setAffiliation] = createSignal("");
  const [result, setResult] = createSignal<LabelRasterResult>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [fontReady, setFontReady] = createSignal(false);
  const [fontError, setFontError] = createSignal(false);
  onSettled(() => {
    let cancelled = false;
    void Promise.all([400, 700].map((weight) => document.fonts.load(`${weight} 16px "WTS Name Label"`, "Ѓорѓи Ќќ Žé gjpq"))).then((faces) => {
      if (cancelled) return;
      if (faces.some((loaded) => loaded.length === 0 || loaded.some((face) => face.status !== "loaded"))) throw new Error("Pinned display font missing");
      setFontReady(true);
    }).catch(() => { if (!cancelled) setFontError(true); });
    return () => { cancelled = true; };
  });
  let previewGeneration = 0;
  function invalidate() { previewGeneration++; setResult(undefined); setError(""); }
  async function preview(event: SubmitEvent) {
    event.preventDefault();
    if (pending() || catalogue.error || catalogue.loading || !fontReady()) return;
    invalidate();
    const generation = previewGeneration;
    const profile = catalogue()?.profiles.find((profile) => profile.id === profileId());
    if (profileId() && !profile) { setError("Profile is unavailable. Refresh and choose an exact version."); return; }
    setPending(true);
    try {
      const rendered = await previewNameLabel({ name: name(), affiliation: affiliation() }, profile);
      if (generation === previewGeneration) setResult(rendered);
    } catch (failure) {
      if (generation === previewGeneration) setError(failure instanceof Error ? failure.message : "Name Label preview failed. Retry explicitly.");
    } finally { setPending(false); }
  }
  async function refresh() { invalidate(); await actions.refetch().catch(() => undefined); }
  return (
    <section aria-label="Name Label profiles" data-font-ready={fontReady() ? "true" : "false"} class="wts-name-label-text min-w-0 rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-5 break-words">
      <h2 class="text-2xl font-bold">Name Label profiles and preview</h2>
      <p>50×30 mm generic pre-cut gap stock. Exactly two rows: larger bold name, smaller affiliation; a missing affiliation stays blank. Rows shrink independently to readable minima, then use visible ellipsis.</p>
      <p>Device measurements are explicit dots, not a millimetre conversion. Historical 40×20 mm / 384×120 settings are not calibrated defaults.</p>
      <Show when={catalogue.error}><p role="alert" class="alert alert-error">Name Label profiles unavailable. Refresh before configuring or previewing a stored profile.</p></Show>
      <Show when={fontError()}><p role="alert" class="alert alert-error">Pinned display fonts failed to load. Restore the bundled Name Label fonts and reload this page; preview is unavailable.</p></Show>
      <button type="button" class="btn btn-outline min-h-12" disabled={catalogue.loading} onClick={() => void refresh()}>Refresh Name Label profiles</button>
      <Show when={catalogue()}>{(data) => (
        <>
          <form method="post" action="/api/checkin-labels" aria-label="Name Label preview" class="space-y-3" onSubmit={(event) => void preview(event)}>
            <label for="label-preview-profile" class="block font-medium">Preview profile version</label>
            <select id="label-preview-profile" class="select select-bordered min-h-12 w-full min-w-0 max-w-full text-base" value={profileId()} onChange={(event) => { invalidate(); setProfileId(event.currentTarget.value); }}>
              <option value="">Synthetic preview</option>
              <For each={data().profiles}>{(profile) => <option value={profile.id}>{data().stations.find((station) => station.id === profile.stationId)?.label ?? profile.stationId} · v{profile.version} · {profile.approval}{profile.config.synthetic ? " · synthetic" : ""}</option>}</For>
            </select>
            <Show when={!profileId()}><p class="alert alert-warning">Synthetic preview only — not calibrated</p></Show>
            <p id="label-text-help" class="text-sm">Transient label text only. No email, QR, URL or upstream capability. Text and raster stay in memory, never in profile audit history.</p>
            <label for="label-name" class="block font-medium">Attendee name</label>
            <input id="label-name" class="input input-bordered min-h-12 w-full text-base" required maxlength={300} autocomplete="off" value={name()} aria-describedby="label-text-help" onInput={(event) => { invalidate(); setName(event.currentTarget.value); }} />
            <label for="label-affiliation" class="block font-medium">Affiliation</label>
            <input id="label-affiliation" class="input input-bordered min-h-12 w-full text-base" maxlength={300} autocomplete="off" value={affiliation()} onInput={(event) => { invalidate(); setAffiliation(event.currentTarget.value); }} />
            <button type="submit" class="btn btn-primary min-h-12" disabled={!fontReady() || pending() || catalogue.loading || !!catalogue.error}>{pending() ? "Rendering Name Label…" : "Preview Name Label"}</button>
            <button type="button" class="btn btn-ghost min-h-12" onClick={() => { invalidate(); setName(""); setAffiliation(""); }}>Clear preview text and raster</button>
          </form>
          <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
          <Show when={result()}>{(rendered) => <NameLabelRaster result={rendered()} />}</Show>
          <NameLabelProfileAdmin catalogue={data()} available={!catalogue.loading && !catalogue.error} refresh={refresh} />
        </>
      )}</Show>
    </section>
  );
}
