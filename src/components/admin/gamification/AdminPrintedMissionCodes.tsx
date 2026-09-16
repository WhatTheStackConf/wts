import { createSignal, For, Show } from "solid-js";
import { useAuth } from "~/lib/auth-context";
import { adminRegisterGamificationCodes } from "~/lib/gamification-operations-actions";
import type { AdminCodeRegistrationInput, AdminCodeRegistrationResult, AdminGamificationOperationsDto } from "~/lib/gamification-operations";
import { parseMissionCodeImport } from "~/lib/mission-code-import";
import { scheduleLocalDateTimeToInstant } from "~/lib/programme";
import { AdminFormField, AdminFormSection, adminFormPanelClass, adminInputClass, adminSelectClass, adminTextareaClass } from "~/components/admin/AdminPageShell";

interface Props { operations: () => AdminGamificationOperationsDto | null | undefined; onChanged: () => unknown }
function skopjeInput(value?: string): string {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Skopje", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T") : "";
}

export default function AdminPrintedMissionCodes(props: Props) {
  const auth = useAuth();
  const [activityId, setActivityId] = createSignal("");
  const [label, setLabel] = createSignal("");
  const [raw, setRaw] = createSignal("");
  const [from, setFrom] = createSignal("");
  const [until, setUntil] = createSignal("");
  const [max, setMax] = createSignal("100");
  const [role, setRole] = createSignal<AdminCodeRegistrationInput["evidenceRole"]>("single");
  const [busy, setBusy] = createSignal(false);
  const [held, setHeld] = createSignal(false);
  const [error, setError] = createSignal("");
  const [receipt, setReceipt] = createSignal<AdminCodeRegistrationResult>();
  let command: AdminCodeRegistrationInput | undefined;
  let actor = "";
  const activities = () => (props.operations()?.activities || []).filter(activity => activity.status === "active" && activity.enabled && ["single_code", "two_code_start", "two_code_finish", "static_puzzle_code"].includes(activity.evidenceMode));
  const select = (id: string) => {
    setActivityId(id);
    const activity = activities().find(item => item.id === id);
    setFrom(skopjeInput(activity?.activeFrom)); setUntil(skopjeInput(activity?.activeUntil));
    setMax(String(activity?.maxClaims || 100));
    setRole(activity?.evidenceMode === "two_code_start" ? "start" : activity?.evidenceMode === "two_code_finish" ? "finish" : activity?.evidenceMode === "static_puzzle_code" ? "static_puzzle" : "single");
  };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy()) return;
    setError("");
    try {
      if (!command) {
        const rawCodes = parseMissionCodeImport(raw());
        if (!activityId() || !label().trim()) throw new Error("Choose an active Activity and a safe batch label.");
        command = { activityId: activityId(), label: label().trim(), rawCodes, evidenceRole: role(), startsAt: scheduleLocalDateTimeToInstant(from()), endsAt: scheduleLocalDateTimeToInstant(until()), maxRedemptions: Number(max()), perUserLimit: 1, operationId: crypto.randomUUID() };
        actor = auth.user?.id || "";
      }
      setBusy(true); setHeld(true);
      const result = await adminRegisterGamificationCodes(command, actor);
      if (!result.success || !result.data) throw new Error(result.error || "Registration could not be confirmed. Retry this batch.");
      if (result.data.batch.id !== command.operationId || result.data.batch.quantity !== command.rawCodes.length || !result.data.batch.committed) throw new Error("Registration receipt did not match. Retry the original batch.");
      setReceipt(result.data); setRaw(""); command = undefined; actor = ""; setHeld(false);
      await props.onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : "Registration could not be confirmed. Retry the original batch."); }
    finally { setBusy(false); }
  };
  return <form class={adminFormPanelClass} onSubmit={submit} aria-busy={busy() ? "true" : "false"}>
    <AdminFormSection title="Register already-printed codes" description="Use this for an existing printed manifest. These exact codes are registered; no replacement QR codes are generated. All entries must be new and belong to this Activity.">
      <fieldset class="grid gap-4 md:grid-cols-2" disabled={busy() || held()}>
        <AdminFormField id="printed-code-activity" label="Active Activity" required><select id="printed-code-activity" class={adminSelectClass()} required value={activityId()} onChange={event => select(event.currentTarget.value)}><option value="">Choose Activity</option><For each={activities()}>{activity => <option value={activity.id}>{activity.key}</option>}</For></select></AdminFormField>
        <AdminFormField id="printed-code-label" label="Batch label" required><input id="printed-code-label" class={adminInputClass()} required value={label()} onInput={event => setLabel(event.currentTarget.value)} /></AdminFormField>
        <AdminFormField id="printed-code-from" label="Active from (Skopje time)" required><input id="printed-code-from" type="datetime-local" class={adminInputClass()} required value={from()} onInput={event => setFrom(event.currentTarget.value)} /></AdminFormField>
        <AdminFormField id="printed-code-until" label="Active until (Skopje time)" required><input id="printed-code-until" type="datetime-local" class={adminInputClass()} required value={until()} onInput={event => setUntil(event.currentTarget.value)} /></AdminFormField>
        <AdminFormField id="printed-code-max" label="Maximum participants per code" hint="Each User can earn this Activity only once, across original and replacement codes." required><input id="printed-code-max" type="number" min="1" class={adminInputClass()} required value={max()} onInput={event => setMax(event.currentTarget.value)} /></AdminFormField>
        <AdminFormField id="printed-code-role" label="Evidence role"><select id="printed-code-role" class={adminSelectClass()} value={role()} onChange={event => setRole(event.currentTarget.value as AdminCodeRegistrationInput["evidenceRole"])}><option value="single">Single scan</option><option value="start">Start</option><option value="finish">Finish</option><option value="static_puzzle">Static discovery</option></select></AdminFormField>
        <AdminFormField id="printed-code-values" label="Existing printed codes" hint="Paste one full code per line, at most 100. Keep the original manifest private. Do not paste QR URLs or include these values in support messages." required class="md:col-span-2"><textarea id="printed-code-values" class={adminTextareaClass("min-h-40 font-mono")} required maxlength="32000" autocomplete="off" spellcheck={false} value={raw()} onInput={event => setRaw(event.currentTarget.value)} /></AdminFormField>
      </fieldset>
    </AdminFormSection>
    <Show when={error()}><p class="alert alert-error mt-4" role="alert">{error()}</p></Show>
    <Show when={held()}><p class="mt-4 text-sm">This exact batch is held for retry. A retry cannot create a second registration. For a definitively rejected batch, use a new form after correcting its source manifest; never replace already-printed code identities.</p></Show>
    <Show when={receipt()}>{saved => <div class="alert alert-success mt-4" role="status">Registered {saved().batch.quantity} exact printed codes. Batch reference: {saved().batch.id}. Originals are unchanged and code values have been cleared from this form.</div>}</Show>
    <div class="mt-6 flex justify-end"><button type="submit" class="btn btn-primary min-h-12" disabled={busy()}>{busy() ? "Registering…" : held() ? "Retry exact registration" : "Register printed codes"}</button></div>
  </form>;
}
