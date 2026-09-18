import { createSignal, For, Match, Show, Switch } from "solid-js";
import { createAsyncResource } from "~/lib/async-resource";
import { useAuth } from "~/lib/auth-context";
import { adminPrepareBoothAchievements, adminReadBoothAchievementCatalogue } from "~/lib/wts-2026-booth-actions";
import type { BoothSetupInput, BoothSetupReceipt } from "~/lib/wts-2026-booth-setup";
import type { AdminGamificationOperationsDto } from "~/lib/gamification-operations";
import { AdminFormField, adminFormPanelClass, adminInputClass, adminSelectClass } from "~/components/admin/AdminPageShell";

interface Props { operations: () => AdminGamificationOperationsDto | null | undefined; onChanged: () => unknown }
export default function AdminBoothAchievements(props: Props) {
  const auth = useAuth();
  const [catalogue, { refetch }] = createAsyncResource(() => auth.user?.id, async userId => userId ? adminReadBoothAchievementCatalogue(userId) : []);
  const [scheduleId, setScheduleId] = createSignal("");
  const [fullXp, setFullXp] = createSignal(20);
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [failed, setFailed] = createSignal(false);
  const [held, setHeld] = createSignal(false);
  const [receipt, setReceipt] = createSignal<BoothSetupReceipt[]>([]);
  let command: BoothSetupInput | undefined;
  let commandUser = "";
  async function prepare(event: SubmitEvent) {
    event.preventDefault();
    if (busy()) return;
    if (!command) {
      command = { scheduleId: scheduleId(), fullXp: fullXp(), startsAt: "2026-09-18T22:00:00.000Z", endsAt: "2026-09-19T22:00:00.000Z", operationId: crypto.randomUUID() };
      commandUser = auth.user?.id || "";
    }
    setBusy(true); setHeld(true); setFailed(false); setMessage("");
    try {
      const result = await adminPrepareBoothAchievements(command, commandUser);
      if (auth.user?.id !== commandUser) throw new Error("Your signed-in User changed. Reload this page.");
      setReceipt(result); setHeld(false); command = undefined;
      setMessage(`${result.length} achievement, Mission, Activity and question drafts are ready. Nothing is live yet. Review and activate in Catalog and Score schedules, then register the original codes in Printed codes.`);
      await props.onChanged();
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Could not finish creating drafts. Retry this request to resume without duplicates.");
    } finally { setBusy(false); }
  }
  return <div class="space-y-6">
    <div class="rounded-xl border border-primary-400/20 bg-primary-500/10 p-5 text-sm leading-relaxed">
      <h2 class="text-xl font-bold text-white">WTS 2026 booth achievements</h2>
      <p class="mt-2">Twelve Blade Runner and programme questions, each with three choices. A correct answer earns full XP; a wrong answer earns half. Both unlock the Badge, once per person.</p>
      <p class="mt-2">The printed labels and lookup prefixes identify the existing QR codes. They are not new codes. No partner contact sharing is enabled.</p>
    </div>
    <Show when={catalogue.error}><div role="alert">Could not load the private catalogue. <button class="btn btn-sm" type="button" onClick={() => void refetch()}>Retry catalogue</button></div></Show>
    <Show when={catalogue()}>{entries => <div class="grid gap-4 md:grid-cols-2">
      <For each={entries()}>{entry => <section class="rounded-xl border border-white/15 p-4 space-y-2">
        <h3 class="font-bold">{entry.name}</h3>
        <p class="text-sm">{entry.booth} · {entry.printedLabel} · <span class="font-mono">{entry.lookupPrefix}</span></p>
        <p>{entry.question}</p>
        <ol class="list-decimal pl-6 text-sm"><For each={entry.choices}>{(choice, index) => <li>{choice}<Show when={index() === entry.correctIndex}><strong> — correct</strong></Show></li>}</For></ol>
      </section>}</For>
    </div>}</Show>
    <form class={adminFormPanelClass} onSubmit={prepare} aria-busy={busy() ? "true" : "false"}>
      <fieldset class="space-y-4" disabled={busy() || held()}>
        <AdminFormField id="booth-catalogue-schedule" label="Draft score schedule" required hint="Create the intended full-event draft in Score schedules first. Its effective time must be no later than 2026-09-19 00:00 Europe/Skopje.">
          <select id="booth-catalogue-schedule" class={adminSelectClass()} required value={scheduleId()} onChange={event => setScheduleId(event.currentTarget.value)}>
            <option value="">Choose a draft schedule</option><For each={(props.operations()?.schedules || []).filter(schedule => schedule.status === "draft")}>{schedule => <option value={schedule.id}>{schedule.key}</option>}</For>
          </select>
        </AdminFormField>
        <AdminFormField id="booth-catalogue-xp" label="Full XP per booth" hint="Default: 20 correct / 10 incorrect, for both total and leaderboard XP. Even numbers only; existing event caps still apply." required>
          <input id="booth-catalogue-xp" type="number" min="2" max="1000" step="2" class={adminInputClass()} value={fullXp()} onInput={event => setFullXp(Number(event.currentTarget.value))} required />
        </AdminFormField>
        <p class="text-sm">Window: 2026-09-19 00:00–2026-09-20 00:00 Europe/Skopje. Each shared booth Activity supports up to 10,000 participants, one award each. This creates drafts only; it does not replace published records or register bearer codes.</p>
      </fieldset>
      <Show when={message()}><div class={`alert mt-4 ${failed() ? "alert-error" : "alert-info"}`} role={failed() ? "alert" : "status"}>{message()}</div></Show>
      <button class="btn btn-primary mt-4 min-h-12" type="submit" disabled={busy() || !catalogue()?.length}><Switch fallback="Prepare 12 achievement drafts"><Match when={busy()}>Preparing drafts…</Match><Match when={held()}>Retry same setup</Match></Switch></button>
      <Show when={held() && !busy()}><p class="mt-2 text-sm">This request is held for safe retry. If an input needs correcting, reload this tab; matching drafts will be reused, never overwritten.</p></Show>
    </form>
    <Show when={receipt().length}><ul class="space-y-2 text-sm"><For each={receipt()}>{row => <li>{row.booth}: {row.name} — Activity <span class="font-mono">{row.activityId}</span>, printed prefix <span class="font-mono">{row.lookupPrefix}</span></li>}</For></ul></Show>
  </div>;
}
