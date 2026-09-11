import { Show, createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { CheckinLookup } from "~/components/checkin/CheckinLookup";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
import "~/styles/app.css";
const initial: CheckinEventContext = { protocolVersion: 1, edition: "WTS2026", eventId: "aaaaaaaaaaaaaaa", eventGeneration: 1, bindingId: "bbbbbbbbbbbbbbb", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 };
function Fixture() {
 const legacy = new URLSearchParams(location.search).has("legacy");
 const [context, setContext] = createSignal<CheckinEventContext | null>(initial);
 const [binding, setBinding] = createSignal("human:binding-one");
 const [decision, setDecision] = createSignal("");
 const [ready, setReady] = createSignal(true);
 const [verifying, setVerifying] = createSignal(false);
 const [busy, setBusy] = createSignal(false);
 const [mounted, setMounted] = createSignal(true);
 return <main style={{ width: "100%", "max-width": "600px" }}>
  <button onClick={() => { setBinding("human:binding-two"); setContext({ ...initial, stationId: "wts2026station2", bindingId: "ccccccccccccccc", bindingVersion: 2 }); }}>Rebind test station</button>
  <button onClick={() => setContext({ ...initial, eventId: "ddddddddddddddd", selectionVersion: 2 })}>Change test event</button>
  <button onClick={() => { setBinding("human:binding-one"); setContext(initial); }}>Restore test context</button>
  <button onClick={() => setContext(null)}>Drop test context</button>
  <button onClick={() => setReady(!ready())}>Toggle test readiness</button>
  <button onClick={() => setVerifying(!verifying())}>Toggle test verification</button>
  <button onClick={() => setMounted(!mounted())}>Toggle lookup mount</button>
  <Show when={mounted()}><CheckinLookup context={context()} eventTitle="Selected event" stationLabel={context()?.stationId ?? ""} bindingScope={legacy ? undefined : binding()} verifying={legacy ? undefined : verifying()} ready={ready()} onBusy={value => { setBusy(value); }} onDecision={result => { setDecision(result.state); }} /></Show>
  <output aria-label="Decision">{decision()}</output>
  <output aria-label="Lookup busy">{String(busy())}</output>
 </main>;
}
render(() => <Fixture />, document.getElementById("app")!);
