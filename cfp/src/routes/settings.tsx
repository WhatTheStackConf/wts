import { createSignal, For, onSettled, Show } from "solid-js";
import { getWorkspace, saveApplicant } from "~/lib/cfp-actions";
import type { FieldIssue, Workspace } from "~/lib/cfp-model";
import { ErrorNotice } from "~/components/ApplicantUI";

const expenseOptions = ["Yes", "No", "Other"] as const;

export default function Settings() {
  const [workspace, setWorkspace] = createSignal<Workspace>();
  const [contact, setContact] = createSignal("");
  const [expenses, setExpenses] = createSignal<"Yes" | "No" | "Other" | "">("");
  const [error, setError] = createSignal<{ code: string; message: string; issues: FieldIssue[] }>();
  const [saved, setSaved] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(true);

  const load = async () => {
    setLoading(true);
    try {
      const result = await getWorkspace();
      if (result.ok) {
        setWorkspace(result.value);
        setContact(result.value.settings.value.preferredContactMethod);
        setExpenses(result.value.settings.value.companyCoverExpenses ?? "");
        setError(undefined);
      } else setError({ code: result.error.code, message: result.error.message, issues: result.error.issues });
    } catch {
      setError({ code: "unavailable", message: "Your settings could not load. Try again later.", issues: [] });
    }
    setLoading(false);
  };
  onSettled(() => { void load().catch(() => { setError({ code: "unavailable", message: "Your settings could not load. Try again later.", issues: [] }); setLoading(false); }); });
  const reload = () => {
    if (workspace() && !window.confirm("Discard the changes on this page and load the latest saved settings?")) return;
    void load();
  };
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    const current = workspace();
    if (!current || busy()) return;
    setBusy(true);
    setSaved(false);
    try {
      const result = await saveApplicant({ settings: { expectedRevision: current.settings.revision, changes: { preferredContactMethod: contact().trim(), companyCoverExpenses: expenses() || null } } });
      if (result.ok) {
        setWorkspace({ ...current, settings: result.value.settings });
        setSaved(true);
        setError(undefined);
      } else setError({ code: result.error.code, message: result.error.message, issues: result.error.issues });
    } catch {
      setError({ code: "unavailable", message: "The settings save failed. Your values remain on this page. Try again.", issues: [] });
    }
    setBusy(false);
  };

  return <>
    <header class="page-heading"><h1>Applicant settings</h1><p>These preferences apply to all your applications. You can maintain them when the CFP is closed.</p></header>
    <Show when={loading()}><div class="cfp-loading" role="status">Loading your settings…</div></Show>
    <Show when={error()}><ErrorNotice message={error()?.message} issues={error()?.issues} onRetry={error()?.code !== "unauthenticated" ? reload : undefined} retryLabel="Reload saved settings" /><Show when={error()?.code === "unauthenticated"}><a href={`/auth/login?returnTo=${encodeURIComponent("/settings")}`} rel="external">Sign in to edit settings</a></Show></Show>
    <Show when={workspace() && error()?.code !== "unauthenticated" && error()?.code !== "unavailable"}>
      <form class="surface form" onSubmit={save}>
        <div class="field"><label for="contact-method">Preferred contact method</label><p class="hint" id="contact-method-help">Add the contact channel you prefer the organizers to use.</p><input id="contact-method" class="control" name="preferredContactMethod" maxlength="500" aria-describedby="contact-method-help" autocomplete="off" value={contact()} onInput={(event) => setContact(event.currentTarget.value)} /></div>
        <fieldset class="field" style={{ border: "none", padding: 0, margin: 0 }}>
          <legend>Can your company cover travel or accommodation?</legend>
          <p class="hint" id="company-cover-help">Choose Yes, No, or Other. You can leave this blank until you know.</p>
          <div class="choice-grid" role="radiogroup" aria-describedby="company-cover-help">
            <label class="choice"><input type="radio" name="companyCoverExpenses" value="" checked={expenses() === ""} onChange={() => setExpenses("")} /><span>Not specified</span></label>
            <For each={expenseOptions}>{(option) => <label class="choice"><input type="radio" name="companyCoverExpenses" value={option} checked={expenses() === option} onChange={() => setExpenses(option)} /><span>{option}</span></label>}</For>
          </div>
        </fieldset>
        <div class="form-actions"><a class="button button-secondary" href="/applications">Back to applications</a><button class="button" type="submit" disabled={busy()}>{busy() ? "Saving settings…" : "Save settings"}</button></div>
        <Show when={saved()}><p role="status" class="muted">Your applicant settings are saved.</p></Show>
      </form>
    </Show>
  </>;
}
