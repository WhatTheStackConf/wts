import { For, Show, createSignal, onCleanup, onSettled } from "solid-js";
import { Meta, Title } from "@solidjs/meta";
import { useRequireCheckinOperator } from "~/lib/route-guards";
import { registrationProgrammes, registrationRosterSchema, type RegistrationRoster } from "~/lib/registrations-contract";
const accessDenied = (status: number) => status === 401 || status === 403;
const rosterFailure = (status: number) => accessDenied(status) ? "Access denied. Sign in with an operator account." : "Registrations unavailable. Refresh to try again.";
const rosterError = (reason: unknown) => reason instanceof Error && reason.message.startsWith("Access denied") ? reason.message : "Registrations unavailable. Refresh to try again.";
function Roster() {
  const [programme, setProgramme] = createSignal(registrationProgrammes[0]?.id || "");
  const [search, setSearch] = createSignal("");
  const [roster, setRoster] = createSignal<RegistrationRoster>();
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal("");
  let epoch = 0, disposed = false;
  let controller: AbortController | undefined;
  onCleanup(() => { disposed = true; epoch++; controller?.abort(); });
  async function refresh() {
    const version = ++epoch; controller?.abort(); controller = new AbortController();
    const current = () => !disposed && version === epoch;
    setRoster(undefined); setBusy(true); setError("");
    try {
      const response = await fetch("/api/registrations", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!current()) return;
      if (!response.ok) { if (accessDenied(response.status)) setSearch(""); throw new Error(rosterFailure(response.status)); }
      const value = registrationRosterSchema.parse(await response.json());
      if (current()) setRoster(value);
    } catch (reason) { if (current()) setError(rosterError(reason)); }
    finally { if (current()) setBusy(false); }
  }
  onSettled(() => { void refresh(); });
  const all = () => roster()?.registrations.filter(row => row.programmeId === programme()) || [];
  const results = () => { const query = search().trim().toLocaleLowerCase(); return all().filter(row => `${row.name} ${row.email}`.toLocaleLowerCase().includes(query)); };
  return <section class="space-y-4" aria-label="Registration list" aria-busy={busy() ? "true" : "false"}>
    <div class="flex flex-wrap gap-3">
      <label class="flex flex-col gap-1">Programme<select class="select select-bordered" value={programme()} onChange={event => { setProgramme(event.currentTarget.value); setSearch(""); }}><For each={registrationProgrammes}>{p => <option value={p.id}>{p.name}</option>}</For></select></label>
      <label class="flex flex-col gap-1">Search names or emails<input class="input input-bordered" type="search" autocomplete="off" spellcheck={false} value={search()} onInput={event => setSearch(event.currentTarget.value)} /></label>
      <button type="button" class="btn btn-outline self-end" disabled={busy()} onClick={() => void refresh()}>Refresh</button>
    </div>
    <Show when={busy()}><p role="status">Reading HiEvents…</p></Show>
    <Show when={error()}><p role="alert">{error()}</p></Show>
    <Show when={roster()}>{value => <>
      <p role="status">{results().length} shown / {all().length} registrations · Last refreshed {new Date(value().refreshedAt).toLocaleTimeString()}</p>
      <Show when={all().length > 0} fallback={<p>No registrations for this programme.</p>}>
        <Show when={results().length > 0} fallback={<p>No matching names or emails.</p>}>
          <div class="overflow-x-auto"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Ticket status</th></tr></thead><tbody><For each={results()}>{row => <tr><td>{row.name || "Not supplied"}</td><td class="break-all">{row.email || "Not supplied"}</td><td>{row.ticketStatus || "Unknown"}</td></tr>}</For></tbody></table></div>
        </Show>
      </Show>
    </>}</Show>
  </section>;
}
export default function RegistrationsPage() {
  const guard = useRequireCheckinOperator("/registrations");
  return <div class="min-h-screen bg-base-300 text-base-content"><Title>Registrations | WTS 2026</Title><Meta name="robots" content="noindex,nofollow" /><Meta name="referrer" content="no-referrer" />
    <main class="mx-auto max-w-6xl space-y-5 px-4 py-6"><header class="flex flex-wrap items-center justify-between gap-3"><h1 class="text-3xl font-bold">Pre-conference registrations</h1><a href="/checkin" target="_self" class="btn btn-ghost">Scanner</a></header>
    <p class="text-sm opacity-80">Read-only from HiEvents. Use HiEvents for check-in. Arrival status is not inferred. Configured free and paid WTS pre-conference programmes are listed; registrations made through other platforms are not included.</p>
    <Show when={guard.authorized()} fallback={<p role="status">Checking operator access…</p>}><For each={guard.user() ? [`${guard.user()!.id}:${guard.user()!.role}`] : []}>{() => <Roster />}</For></Show>
    </main></div>;
}
