import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { CheckinOperatorRecovery } from "~/components/checkin/CheckinRecovery";
import "~/styles/app.css";
function Fixture() {
 const [scope, setScope] = createSignal("operator:binding-one");
 const compact = new URLSearchParams(location.search).has("compact");
 const [unavailable, setUnavailable] = createSignal(false);
 const [busy, setBusy] = createSignal(false);
 return <main><button onClick={() => setScope("operator:binding-two")}>Rebind test station</button><button onClick={() => setUnavailable(true)}>Verify unavailable</button><button onClick={() => setUnavailable(false)}>Verify restored</button><output aria-label="Recovery busy">{busy() ? "busy" : "idle"}</output><CheckinOperatorRecovery scopeKey={scope()} compact={compact} unavailable={unavailable()} onBusyChange={value => { setBusy(value); }} workflowId={compact ? undefined : "aaaaaaaaaaaaaaa"} /></main>;
}
render(() => <Fixture />, document.getElementById("app")!);
